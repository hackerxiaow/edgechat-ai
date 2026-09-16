import { hardDeleteChannels } from "./data/channel-deletion.ts";
import { classifyStoredSiteIcon } from "./site-icon.ts";
import type { AppBindings } from "./types.ts";

/** GC 只依赖 D1，其余读取自 env 字符串变量。 */
type GcEnv = Pick<AppBindings, "DB"> & Record<string, unknown>;

interface GcConfig {
	messageRetentionDays: number;
	softDeleteRetentionDays: number;
	batchSize: number;
	maxBatchesPerRun: number;
	r2DeleteMaxRetry: number;
	orphanUploadRetentionDays: number;
	internalOperationBudget: number;
	d1StatementBudget: number;
	r2OperationBudget: number;
	/** 惰性触发的最小间隔（分钟）。 */
	minIntervalMinutes: number;
	trustedSiteOrigins: string[];
}

interface GcBudgetCost {
	d1ApiCalls?: number;
	d1Statements?: number;
	r2Operations?: number;
}

interface GcBudgetSnapshot {
	d1ApiCalls: number;
	d1Statements: number;
	r2Operations: number;
	internalOperations: number;
	exhausted: boolean;
	limits: {
		internalOperations: number;
		d1Statements: number;
		r2Operations: number;
	};
}

interface GcBudget {
	canSpend(cost?: GcBudgetCost): boolean;
	spend(cost: GcBudgetCost): boolean;
	remainingInternalOperations(): number;
	remainingD1Statements(): number;
	remainingR2Operations(): number;
	markExhausted(): void;
	snapshot(): GcBudgetSnapshot;
}

interface GcSummary {
	retryQueueFetched: number;
	retryQueueDeleted: number;
	retryQueueFailed: number;
	retryQueueSkippedReferenced: number;
	expiredMessagesDeleted: number;
	invitesDeleted: number;
	channelsDeleted: number;
	channelMembersDeleted: number;
	channelMessagesDeleted: number;
	usersDeleted: number;
	userMessagesDeleted: number;
	userMembershipsDeleted: number;
	expiredRealtimeTicketsDeleted: number;
	expiredMessageEventsDeleted: number;
	expiredDeviceSessionsDeleted: number;
	r2Deleted: number;
	r2DeleteFailed: number;
	r2DeleteQueued: number;
	r2SkippedReferenced: number;
	orphanUploadsQueued: number;
	orphanUploadsDeleted: number;
	budget: GcBudgetSnapshot | null;
}

type GcRow = Record<string, unknown>;


const DEFAULT_MESSAGE_RETENTION_DAYS = 7;
const DEFAULT_SOFT_DELETE_RETENTION_DAYS = 60;
const DEFAULT_BATCH_SIZE = 90;
const DEFAULT_MAX_BATCHES_PER_RUN = 20;
const DEFAULT_R2_DELETE_MAX_RETRY = 8;
const DEFAULT_ORPHAN_UPLOAD_RETENTION_DAYS = 1;
const DEFAULT_INTERNAL_OPERATION_BUDGET = 900;
const DEFAULT_D1_STATEMENT_BUDGET = 1200;
const DEFAULT_R2_OPERATION_BUDGET = 300;
const DEFAULT_MIN_INTERVAL_MINUTES = 60;
const MAX_BOUND_PARAMETERS = 100;
const MAX_IN_PARAMETERS = 90;
const MAX_ERROR_LENGTH = 500;

/** 惰性 GC 的认领键：单行状态表，只有它保证跨请求、跨 isolate 的最小间隔。 */
export const GC_STATE_ID = "scheduled";

/**
 * 抢锁语句：只有 gc_state 里还没有记录，或上一轮开始时间已经早于最小间隔时才会写入。
 * 返回 0 行表示本轮由别的请求跑着，调用方直接跳过。
 */
export const GC_CLAIM_QUERY = `INSERT INTO gc_state (id, last_started_at, last_error)
	VALUES (?, CURRENT_TIMESTAMP, '')
	ON CONFLICT(id) DO UPDATE SET
	  last_started_at = CURRENT_TIMESTAMP,
	  last_error = ''
	WHERE gc_state.last_started_at IS NULL
	   OR gc_state.last_started_at <= datetime('now', ?)`;

/**
 * 同一个 isolate 内先用内存窗口挡住重复探测：轮询客户端每 800ms 打一次 /api/*，
 * 不该每次都去 D1 抢锁。真正的最小间隔仍由 gc_state 保证。
 */
const GC_PROBE_WINDOW_MS = 60_000;
let lastGcProbeAt = 0;

/** 仅测试使用：清掉 isolate 内的探测窗口。 */
export function resetGcProbeWindow(): void {
	lastGcProbeAt = 0;
}

/** 只有 /api/* 请求值得探测一次，静态资产与附件下载不参与。 */
export function shouldProbeScheduledGc(request: Request, now: number = Date.now()): boolean {
	if (!new URL(request.url).pathname.startsWith("/api/")) return false;
	if (lastGcProbeAt !== 0 && now - lastGcProbeAt < GC_PROBE_WINDOW_MS) return false;
	lastGcProbeAt = now;
	return true;
}

export const ORPHAN_UPLOAD_QUERY = `SELECT object_key, created_at
	FROM uploaded_files
	WHERE created_at < datetime('now', ?)
	  AND object_key != ?
	  AND NOT EXISTS (
		SELECT 1 FROM pending_r2_delete
		WHERE pending_r2_delete.object_key = uploaded_files.object_key
	  )
	  AND NOT EXISTS (
		SELECT 1 FROM messages
		WHERE messages.attachment_key = uploaded_files.object_key
		  AND messages.deleted_at IS NULL
	  )
	  AND NOT EXISTS (
		SELECT 1 FROM users
		WHERE users.avatar_key = uploaded_files.object_key
		  AND users.deleted_at IS NULL
	  )
	  AND NOT EXISTS (
		SELECT 1 FROM channels
		WHERE channels.avatar_key = uploaded_files.object_key
		  AND channels.deleted_at IS NULL
	  )
	ORDER BY created_at ASC, object_key ASC
	LIMIT ?`;

function toPositiveInteger(value: unknown, fallback: number): number {
	const parsed = Number(value);
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
	return Math.floor(parsed);
}

function getGcConfig(env: GcEnv): GcConfig {
	return {
		messageRetentionDays: toPositiveInteger(
			env.MESSAGE_RETENTION_DAYS,
			DEFAULT_MESSAGE_RETENTION_DAYS,
		),
		softDeleteRetentionDays: toPositiveInteger(
			env.SOFT_DELETE_RETENTION_DAYS,
			DEFAULT_SOFT_DELETE_RETENTION_DAYS,
		),
		batchSize: Math.min(
			toPositiveInteger(env.GC_BATCH_SIZE, DEFAULT_BATCH_SIZE),
			MAX_IN_PARAMETERS,
		),
		maxBatchesPerRun: toPositiveInteger(
			env.GC_MAX_BATCHES_PER_RUN,
			DEFAULT_MAX_BATCHES_PER_RUN,
		),
		r2DeleteMaxRetry: toPositiveInteger(
			env.R2_DELETE_MAX_RETRY,
			DEFAULT_R2_DELETE_MAX_RETRY,
		),
		orphanUploadRetentionDays: toPositiveInteger(
			env.ORPHAN_UPLOAD_RETENTION_DAYS,
			DEFAULT_ORPHAN_UPLOAD_RETENTION_DAYS,
		),
		internalOperationBudget: toPositiveInteger(
			env.GC_INTERNAL_OPERATION_BUDGET,
			DEFAULT_INTERNAL_OPERATION_BUDGET,
		),
		d1StatementBudget: toPositiveInteger(
			env.GC_D1_STATEMENT_BUDGET,
			DEFAULT_D1_STATEMENT_BUDGET,
		),
		r2OperationBudget: toPositiveInteger(
			env.GC_R2_OPERATION_BUDGET,
			DEFAULT_R2_OPERATION_BUDGET,
		),
		minIntervalMinutes: toPositiveInteger(
			env.GC_MIN_INTERVAL_MINUTES,
			DEFAULT_MIN_INTERVAL_MINUTES,
		),
		trustedSiteOrigins: String(env.SITE_ORIGINS || "")
			.split(",")
			.map((value) => value.trim())
			.filter(Boolean),
	};
}

/**
 * 附件删除预算：历史上对应 R2 对象操作，D1 单存储后用来限制每次 GC 尝试删除的附件数量，
 * 避免一次请求把整张 uploaded_files 扫空。内部操作与 D1 语句预算只统计真实的 D1 调用。
 */
function createExecutionBudget(config: GcConfig): GcBudget {
	const used = { d1ApiCalls: 0, d1Statements: 0, r2Operations: 0 };
	let exhausted = false;

	function canSpend({ d1ApiCalls = 0, d1Statements = 0, r2Operations = 0 }: GcBudgetCost = {}): boolean {
		return (
			used.d1ApiCalls + d1ApiCalls <= config.internalOperationBudget &&
			used.d1Statements + d1Statements <= config.d1StatementBudget &&
			used.r2Operations + r2Operations <= config.r2OperationBudget
		);
	}

	return {
		canSpend,
		spend(cost: GcBudgetCost): boolean {
			if (!canSpend(cost)) {
				exhausted = true;
				return false;
			}
			used.d1ApiCalls += cost.d1ApiCalls || 0;
			used.d1Statements += cost.d1Statements || 0;
			used.r2Operations += cost.r2Operations || 0;
			return true;
		},
		remainingInternalOperations() {
			return config.internalOperationBudget - used.d1ApiCalls;
		},
		remainingD1Statements() {
			return config.d1StatementBudget - used.d1Statements;
		},
		remainingR2Operations() {
			return config.r2OperationBudget - used.r2Operations;
		},
		markExhausted() {
			exhausted = true;
		},
		snapshot() {
			return {
				...used,
				internalOperations: used.d1ApiCalls,
				exhausted,
				limits: {
					internalOperations: config.internalOperationBudget,
					d1Statements: config.d1StatementBudget,
					r2Operations: config.r2OperationBudget,
				},
			};
		},
	};
}

function createSummary(): GcSummary {
	return {
		retryQueueFetched: 0,
		retryQueueDeleted: 0,
		retryQueueFailed: 0,
		retryQueueSkippedReferenced: 0,
		expiredMessagesDeleted: 0,
		invitesDeleted: 0,
		channelsDeleted: 0,
		channelMembersDeleted: 0,
		channelMessagesDeleted: 0,
		usersDeleted: 0,
		userMessagesDeleted: 0,
		userMembershipsDeleted: 0,
		expiredRealtimeTicketsDeleted: 0,
		expiredMessageEventsDeleted: 0,
		expiredDeviceSessionsDeleted: 0,
		r2Deleted: 0,
		r2DeleteFailed: 0,
		r2DeleteQueued: 0,
		r2SkippedReferenced: 0,
		orphanUploadsQueued: 0,
		orphanUploadsDeleted: 0,
		budget: null,
	};
}

function safeErrorMessage(error: unknown): string {
	return String((error as { message?: unknown })?.message || error || "unknown_error").slice(0, MAX_ERROR_LENGTH);
}

function placeholders(length: number): string {
	return Array.from({ length }, () => "?").join(", ");
}

function valueRows(length: number): string {
	return Array.from({ length }, () => "(?)").join(", ");
}

function uniqueKeys(keys: unknown[]): string[] {
	return [
		...new Set(
			keys
				.map((value) => String(value || "").trim())
				.filter(Boolean),
		),
	];
}

function resultChanges(result: unknown): number {
	return Number((result as { meta?: { changes?: unknown } })?.meta?.changes || 0);
}

async function loadSiteIconGuard(db: D1Database, config: GcConfig, budget: GcBudget) {
	if (!budget.spend({ d1ApiCalls: 1, d1Statements: 1 })) return null;
	const { results } = await db
		.prepare(
			"SELECT setting_value FROM site_settings WHERE setting_key = 'site_icon_url' LIMIT 1",
		)
		.all();
	const reference = classifyStoredSiteIcon(
		results[0]?.setting_value,
		config.trustedSiteOrigins,
	);
	// 无可信 origin 时，历史完整 /files/ URL 只作为保守保护项，不据此改写或认定域名属于本站。
	return reference.key || null;
}

async function findReferencedKeys(db: D1Database, keys: string[], siteIconKey: string | null, budget: GcBudget): Promise<Set<string> | null> {
	const unique = uniqueKeys(keys);
	if (!unique.length) return new Set();
	if (unique.length > MAX_IN_PARAMETERS) throw new Error("Too many GC reference keys");
	if (!budget.spend({ d1ApiCalls: 1, d1Statements: 1 })) return null;
	const { results } = await db
		.prepare(
			`WITH candidate(object_key) AS (VALUES ${valueRows(unique.length)})
			 SELECT candidate.object_key
			 FROM candidate
			 WHERE EXISTS (
			   SELECT 1 FROM messages
			   WHERE attachment_key = candidate.object_key AND deleted_at IS NULL
			 ) OR EXISTS (
			   SELECT 1 FROM users
			   WHERE avatar_key = candidate.object_key AND deleted_at IS NULL
			 ) OR EXISTS (
			   SELECT 1 FROM channels
			   WHERE avatar_key = candidate.object_key AND deleted_at IS NULL
			 )`,
		)
		.bind(...unique)
		.all();
	const referenced = new Set(results.map((row) => String(row.object_key)));
	if (siteIconKey && unique.includes(siteIconKey)) referenced.add(siteIconKey);
	return referenced;
}

async function reserveR2DeleteKeys(db: D1Database, keys: string[], budget: GcBudget): Promise<number | null> {
	const unique = uniqueKeys(keys);
	if (!unique.length) return 0;
	if (unique.length > MAX_IN_PARAMETERS) throw new Error("Too many GC reserve keys");
	if (!budget.spend({ d1ApiCalls: 1, d1Statements: 1 })) return null;
	const result = await db
		.prepare(
			`INSERT OR IGNORE INTO pending_r2_delete (object_key)
			 VALUES ${valueRows(unique.length)}`,
		)
		.bind(...unique)
		.run();
	return resultChanges(result);
}

async function removePendingR2DeleteKeys(db: D1Database, keys: string[], budget: GcBudget): Promise<number | null> {
	const unique = uniqueKeys(keys);
	if (!unique.length) return 0;
	if (!budget.spend({ d1ApiCalls: 1, d1Statements: 1 })) return null;
	const result = await db
		.prepare(
			`DELETE FROM pending_r2_delete
			 WHERE object_key IN (${placeholders(unique.length)})`,
		)
		.bind(...unique)
		.run();
	return resultChanges(result);
}

/**
 * D1 单存储下「删除对象」就是删掉 uploaded_files 的那一行，并与清掉待删占位放在同一个
 * 批次里：两者要么一起生效，要么一起回滚，避免删除成功却留下占位或反过来。
 */
async function completeR2Delete(db: D1Database, key: string, budget: GcBudget) {
	if (!budget.spend({ d1ApiCalls: 1, d1Statements: 2 })) return false;
	await db.batch([
		db.prepare("DELETE FROM uploaded_files WHERE object_key = ?").bind(key),
		db.prepare("DELETE FROM pending_r2_delete WHERE object_key = ?").bind(key),
	]);
	return true;
}

function retryDelayMinutes(nextRetryCount: number, retryExponentCap: number): number {
	const exponent = Math.min(Math.max(nextRetryCount, 1), retryExponentCap);
	return Math.min(2 ** exponent, 24 * 60);
}

async function markR2RetryFailure(db: D1Database, key: string, retryCount: number, delayMinutes: number, errorMessage: string, budget: GcBudget) {
	if (!budget.spend({ d1ApiCalls: 1, d1Statements: 1 })) return false;
	await db
		.prepare(
			`UPDATE pending_r2_delete
			 SET retry_count = ?,
			     next_retry_at = datetime('now', ?),
			     last_error = ?,
			     updated_at = CURRENT_TIMESTAMP
			 WHERE object_key = ?`,
		)
		.bind(retryCount, `+${delayMinutes} minutes`, errorMessage, key)
		.run();
	return true;
}

async function processR2Rows(env: GcEnv, config: GcConfig, summary: GcSummary, rows: GcRow[], siteIconKey: string | null, budget: GcBudget) {
	if (!rows.length) return false;
	const referenced = await findReferencedKeys(
		env.DB,
		rows.map((row) => String(row.object_key)),
		siteIconKey,
		budget,
	);
	if (referenced === null) return false;

	if (referenced.size) {
		const removed = await removePendingR2DeleteKeys(env.DB, [...referenced], budget);
		if (removed === null) return false;
		summary.retryQueueSkippedReferenced += removed;
		summary.r2SkippedReferenced += removed;
	}

	let progressed = referenced.size > 0;
	for (const row of rows) {
		const key = String(row.object_key || "");
		if (!key || referenced.has(key)) continue;
		// 最坏情况：删除批次用掉 1 次调用/2 条语句，失败后写回退避再用掉 1 次调用/1 条语句。
		// 预算不足时必须停下来，否则删除成功却写不进退避状态会丢掉重试机会。
		const worstCaseCost = { d1ApiCalls: 2, d1Statements: 3, r2Operations: 1 };
		if (!budget.canSpend(worstCaseCost)) {
			budget.markExhausted();
			break;
		}

		budget.spend({ r2Operations: 1 });
		progressed = true;
		try {
			const completed = await completeR2Delete(env.DB, key, budget);
			if (!completed) {
				budget.markExhausted();
				break;
			}
			summary.retryQueueDeleted += 1;
			summary.r2Deleted += 1;
		} catch (error) {
			const nextRetry = Number(row.retry_count || 0) + 1;
			const retryPersisted = await markR2RetryFailure(
				env.DB,
				key,
				nextRetry,
				retryDelayMinutes(nextRetry, config.r2DeleteMaxRetry),
				safeErrorMessage(error),
				budget,
			);
			if (!retryPersisted) {
				budget.markExhausted();
				break;
			}
			summary.retryQueueFailed += 1;
			summary.r2DeleteFailed += 1;
		}
	}
	return progressed;
}

async function runRetryQueueStep(env: GcEnv, config: GcConfig, summary: GcSummary, siteIconKey: string | null, budget: GcBudget) {
	// 单条待删记录最坏花掉 2 次 D1 调用与 3 条语句，另外给本次查询本身留 4 个单位。
	const capacity = Math.min(
		config.batchSize,
		budget.remainingR2Operations(),
		Math.floor((budget.remainingInternalOperations() - 4) / 2),
		Math.floor((budget.remainingD1Statements() - 4) / 3),
	);
	if (capacity <= 0) {
		budget.markExhausted();
		return false;
	}
	if (!budget.spend({ d1ApiCalls: 1, d1Statements: 1 })) return false;
	const { results } = await env.DB.prepare(
		`SELECT object_key, retry_count
		 FROM pending_r2_delete
		 WHERE next_retry_at <= CURRENT_TIMESTAMP
		 ORDER BY next_retry_at ASC, object_key ASC
		 LIMIT ?`,
	)
		.bind(capacity)
		.all();
	summary.retryQueueFetched += results.length;
	return processR2Rows(env, config, summary, results, siteIconKey, budget);
}

async function runMobileProtocolCleanupStep(env: GcEnv, config: GcConfig, summary: GcSummary, budget: GcBudget) {
	if (!budget.spend({ d1ApiCalls: 3, d1Statements: 4 })) return { progress: false, more: true };
	const ticketResult = await env.DB.prepare(
		`DELETE FROM realtime_tickets
		 WHERE token_hash IN (
		   SELECT token_hash FROM realtime_tickets
		   WHERE expires_at <= CURRENT_TIMESTAMP OR consumed_at IS NOT NULL
		   ORDER BY expires_at ASC LIMIT ?
		 )`,
	)
		.bind(config.batchSize)
		.run();

	const eventCutoff = `-${config.messageRetentionDays} day`;
	const [, eventResult] = await env.DB.batch([
		env.DB.prepare(
			`INSERT INTO message_event_compaction (channel_id, compacted_through, updated_at)
			 SELECT channel_id, MAX(sequence), CURRENT_TIMESTAMP
			 FROM (
			   SELECT sequence, channel_id FROM message_events
			   WHERE created_at < datetime('now', ?)
			   ORDER BY sequence ASC LIMIT ?
			 ) AS expired_events
			 WHERE true
			 GROUP BY channel_id
			 ON CONFLICT(channel_id) DO UPDATE SET
			   compacted_through = MAX(message_event_compaction.compacted_through, excluded.compacted_through),
			   updated_at = CURRENT_TIMESTAMP`,
		).bind(eventCutoff, config.batchSize),
		env.DB.prepare(
			`DELETE FROM message_events
			 WHERE sequence IN (
			   SELECT sequence FROM message_events
			   WHERE created_at < datetime('now', ?)
			   ORDER BY sequence ASC LIMIT ?
			 )`,
		).bind(eventCutoff, config.batchSize),
	]);
	const deviceResult = await env.DB.prepare(
		`DELETE FROM device_sessions
		 WHERE id IN (
		   SELECT id FROM device_sessions
		   WHERE expires_at < datetime('now', ?)
		      OR (revoked_at IS NOT NULL AND revoked_at < datetime('now', ?))
		   ORDER BY expires_at ASC LIMIT ?
		 )`,
	)
		.bind(
			`-${config.softDeleteRetentionDays} day`,
			`-${config.softDeleteRetentionDays} day`,
			config.batchSize,
		)
		.run();

	const changes = [ticketResult, eventResult, deviceResult].map(resultChanges);
	summary.expiredRealtimeTicketsDeleted += changes[0];
	summary.expiredMessageEventsDeleted += changes[1];
	summary.expiredDeviceSessionsDeleted += changes[2];
	return {
		progress: changes.some((count) => count > 0),
		more: changes.some((count) => count >= config.batchSize),
	};
}

async function runExpiredMessagesStep(env: GcEnv, config: GcConfig, summary: GcSummary, budget: GcBudget) {
	if (!budget.spend({ d1ApiCalls: 1, d1Statements: 2 })) {
		return { progress: false, more: true };
	}
	const cutoff = `-${config.messageRetentionDays} day`;
	const [queued, deleted] = await env.DB.batch([
		env.DB.prepare(
			`INSERT OR IGNORE INTO pending_r2_delete (object_key)
			 SELECT attachment_key FROM messages
			 WHERE id IN (
			   SELECT id FROM messages
			   WHERE created_at < datetime('now', ?)
			   ORDER BY id ASC LIMIT ?
			 ) AND attachment_key IS NOT NULL AND attachment_key != ''`,
		).bind(cutoff, config.batchSize),
		env.DB.prepare(
			`DELETE FROM messages
			 WHERE id IN (
			   SELECT id FROM messages
			   WHERE created_at < datetime('now', ?)
			   ORDER BY id ASC LIMIT ?
			 )`,
		).bind(cutoff, config.batchSize),
	]);
	const queuedCount = resultChanges(queued);
	const deletedCount = resultChanges(deleted);
	summary.r2DeleteQueued += queuedCount;
	summary.expiredMessagesDeleted += deletedCount;
	return { progress: deletedCount > 0, more: deletedCount >= config.batchSize };
}

async function runHardDeleteInvitesStep(env: GcEnv, config: GcConfig, summary: GcSummary, budget: GcBudget) {
	if (!budget.spend({ d1ApiCalls: 1, d1Statements: 1 })) {
		return { progress: false, more: true };
	}
	const cutoff = `-${config.softDeleteRetentionDays} day`;
	const result = await env.DB.prepare(
		`DELETE FROM registration_invites
		 WHERE id IN (
		   SELECT id FROM registration_invites
		   WHERE (deleted_at IS NOT NULL AND deleted_at < datetime('now', ?))
		      OR (deleted_at IS NULL AND consumed_at IS NOT NULL AND consumed_at < datetime('now', ?))
		   ORDER BY id ASC LIMIT ?
		 )`,
	)
		.bind(cutoff, cutoff, config.batchSize)
		.run();
	const deleted = resultChanges(result);
	summary.invitesDeleted += deleted;
	return { progress: deleted > 0, more: deleted >= config.batchSize };
}

async function runHardDeleteChannelsStep(env: GcEnv, config: GcConfig, summary: GcSummary, budget: GcBudget) {
	if (!budget.canSpend({ d1ApiCalls: 2, d1Statements: 6 })) {
		budget.markExhausted();
		return { progress: false, more: true };
	}
	budget.spend({ d1ApiCalls: 1, d1Statements: 1 });
	const cutoff = `-${config.softDeleteRetentionDays} day`;
	const channelBatchSize = Math.min(config.batchSize, Math.floor(MAX_IN_PARAMETERS / 2));
	const { results } = await env.DB.prepare(
		`SELECT id FROM channels
		 WHERE deleted_at IS NOT NULL
		   AND deleted_at < datetime('now', ?)
		   AND kind IN ('public', 'private')
		   AND name != 'general'
		 ORDER BY id ASC LIMIT ?`,
	)
		.bind(cutoff, channelBatchSize)
		.all();
	if (!results.length) return { progress: false, more: false };
	budget.spend({ d1ApiCalls: 1, d1Statements: 5 });
	const deleted = await hardDeleteChannels(
		env.DB,
		results.map((row) => Number(row.id)),
	);
	summary.channelMessagesDeleted += deleted.channelMessagesDeleted;
	summary.channelMembersDeleted += deleted.channelMembersDeleted;
	summary.channelsDeleted += deleted.channelsDeleted;
	summary.r2DeleteQueued += deleted.r2DeleteQueued;
	return { progress: deleted.channelsDeleted > 0, more: results.length >= channelBatchSize };
}

async function runHardDeleteUsersStep(env: GcEnv, config: GcConfig, summary: GcSummary, budget: GcBudget) {
	if (!budget.canSpend({ d1ApiCalls: 3, d1Statements: 10 })) {
		budget.markExhausted();
		return { progress: false, more: true };
	}
	const userBatchSize = Math.min(config.batchSize, Math.floor(MAX_IN_PARAMETERS / 3));
	budget.spend({ d1ApiCalls: 1, d1Statements: 1 });
	const cutoff = `-${config.softDeleteRetentionDays} day`;
	const { results } = await env.DB.prepare(
		`SELECT id FROM users
		 WHERE deleted_at IS NOT NULL AND deleted_at < datetime('now', ?)
		 ORDER BY id ASC LIMIT ?`,
	)
		.bind(cutoff, userBatchSize)
		.all();
	if (!results.length) return { progress: false, more: false };

	const userIds = results.map((row) => Number(row.id));
	const idsSql = placeholders(userIds.length);
	budget.spend({ d1ApiCalls: 1, d1Statements: 1 });
	const queued = await env.DB.prepare(
		`INSERT OR IGNORE INTO pending_r2_delete (object_key)
		 SELECT attachment_key FROM messages
		 WHERE sender_id IN (${idsSql}) AND attachment_key IS NOT NULL AND attachment_key != ''
		 UNION
		 SELECT avatar_key FROM users
		 WHERE id IN (${idsSql}) AND avatar_key IS NOT NULL AND avatar_key != ''
		 UNION
		 SELECT object_key FROM uploaded_files
		 WHERE owner_user_id IN (${idsSql})`,
	)
		.bind(...userIds, ...userIds, ...userIds)
		.run();
	summary.r2DeleteQueued += resultChanges(queued);

	budget.spend({ d1ApiCalls: 1, d1Statements: 8 });
	const cleanup = await env.DB.batch([
		env.DB.prepare(`UPDATE channels SET created_by = NULL WHERE created_by IN (${idsSql})`).bind(...userIds),
		env.DB.prepare(`UPDATE registration_invites SET created_by = NULL WHERE created_by IN (${idsSql})`).bind(...userIds),
		env.DB.prepare(`UPDATE registration_invites SET consumed_by_user_id = NULL WHERE consumed_by_user_id IN (${idsSql})`).bind(...userIds),
		env.DB.prepare(`UPDATE channel_members SET invited_by = NULL WHERE invited_by IN (${idsSql})`).bind(...userIds),
		env.DB.prepare(`DELETE FROM uploaded_files WHERE owner_user_id IN (${idsSql})`).bind(...userIds),
		env.DB.prepare(`DELETE FROM messages WHERE sender_id IN (${idsSql})`).bind(...userIds),
		env.DB.prepare(`DELETE FROM channel_members WHERE user_id IN (${idsSql})`).bind(...userIds),
		env.DB.prepare(`DELETE FROM users WHERE id IN (${idsSql})`).bind(...userIds),
	]);
	summary.userMessagesDeleted += resultChanges(cleanup[5]);
	summary.userMembershipsDeleted += resultChanges(cleanup[6]);
	summary.usersDeleted += resultChanges(cleanup[7]);
	return { progress: resultChanges(cleanup[7]) > 0, more: results.length >= userBatchSize };
}

async function runOrphanedUploadsStep(env: GcEnv, config: GcConfig, summary: GcSummary, siteIconKey: string | null, budget: GcBudget) {
	if (!budget.canSpend({ d1ApiCalls: 2, d1Statements: 2 })) {
		budget.markExhausted();
		return { progress: false, more: true };
	}
	budget.spend({ d1ApiCalls: 1, d1Statements: 1 });
	const { results } = await env.DB.prepare(ORPHAN_UPLOAD_QUERY)
		.bind(
			`-${config.orphanUploadRetentionDays} day`,
			siteIconKey || "",
			config.batchSize,
		)
		.all();
	if (!results.length) return { progress: false, more: false };
	const queued = await reserveR2DeleteKeys(
		env.DB,
		results.map((row) => String(row.object_key)),
		budget,
	);
	if (queued === null) return { progress: false, more: true };
	summary.r2DeleteQueued += queued;
	summary.orphanUploadsQueued += queued;
	return { progress: queued > 0, more: results.length >= config.batchSize };
}

export async function runScheduledGc(env: GcEnv) {
	const config = getGcConfig(env);
	const budget = createExecutionBudget(config);
	const summary = createSummary();
	const siteIconKey = await loadSiteIconGuard(env.DB, config, budget);
	const steps = [
		runMobileProtocolCleanupStep,
		runExpiredMessagesStep,
		runHardDeleteInvitesStep,
		runHardDeleteChannelsStep,
		runHardDeleteUsersStep,
	];
	const active = steps.map(() => true);
	let orphanActive = true;

	for (let round = 0; round < config.maxBatchesPerRun; round += 1) {
		let progress = false;
		for (const [index, step] of steps.entries()) {
			if (!active[index]) continue;
			const result = await step(env, config, summary, budget);
			progress ||= result.progress;
			if (!result.more) active[index] = false;
		}
		if (orphanActive) {
			const result = await runOrphanedUploadsStep(
				env,
				config,
				summary,
				siteIconKey,
				budget,
			);
			progress ||= result.progress;
			if (!result.more) orphanActive = false;
		}
		const retryProgress = await runRetryQueueStep(
			env,
			config,
			summary,
			siteIconKey,
			budget,
		);
		progress = retryProgress || progress;
		if (!progress) break;
	}

	summary.budget = budget.snapshot();
	console.log(JSON.stringify({ type: "scheduled_gc_summary", config, summary }));
	return summary;
}

export async function cleanupR2Keys(env: GcEnv, keys: string[]) {
	const config = getGcConfig(env);
	const budget = createExecutionBudget(config);
	const summary = createSummary();
	const siteIconKey = await loadSiteIconGuard(env.DB, config, budget);

	for (let offset = 0; offset < keys.length; offset += MAX_IN_PARAMETERS) {
		const chunk = uniqueKeys(keys.slice(offset, offset + MAX_IN_PARAMETERS));
		const referenced = await findReferencedKeys(env.DB, chunk, siteIconKey, budget);
		if (referenced === null) break;
		const candidates = chunk.filter((key) => !referenced.has(key));
		summary.r2SkippedReferenced += referenced.size;
		const queued = await reserveR2DeleteKeys(env.DB, candidates, budget);
		if (queued === null) break;
		summary.r2DeleteQueued += queued;

		if (!candidates.length) continue;
		if (!budget.spend({ d1ApiCalls: 1, d1Statements: 1 })) break;
		const { results } = await env.DB.prepare(
			`SELECT object_key, retry_count FROM pending_r2_delete
			 WHERE object_key IN (${placeholders(candidates.length)})
			   AND next_retry_at <= CURRENT_TIMESTAMP
			 ORDER BY next_retry_at ASC, object_key ASC`,
		)
			.bind(...candidates)
			.all();
		await processR2Rows(env, config, summary, results, siteIconKey, budget);
	}

	summary.budget = budget.snapshot();
	return summary;
}

/** GC 收尾记录；失败只记日志，不影响已经拿到的 GC 结果。 */
async function recordGcRunFinished(db: D1Database, errorMessage: string): Promise<void> {
	try {
		await db
			.prepare(
				`UPDATE gc_state
				 SET last_finished_at = CURRENT_TIMESTAMP, last_error = ?
				 WHERE id = ?`,
			)
			.bind(errorMessage, GC_STATE_ID)
			.run();
	} catch (error) {
		console.warn("gc_state_update_failed", safeErrorMessage(error));
	}
}

/**
 * Cloudflare Pages Functions 没有 Cron Triggers，定时 GC 只能挂在请求路径上：
 * 先用一条原子 UPSERT 抢占本轮执行权，抢到才真正跑，并由调用方交给 waitUntil 异步完成。
 * 失败也按同一间隔等待下一轮，避免每次请求都重跑一次已经出错的 GC。
 */
export async function runLazyScheduledGc(env: GcEnv): Promise<GcSummary | null> {
	const config = getGcConfig(env);
	const claimed = await env.DB.prepare(GC_CLAIM_QUERY)
		.bind(GC_STATE_ID, `-${config.minIntervalMinutes} minute`)
		.run();
	if (resultChanges(claimed) < 1) return null;

	try {
		const summary = await runScheduledGc(env);
		await recordGcRunFinished(env.DB, "");
		return summary;
	} catch (error) {
		await recordGcRunFinished(env.DB, safeErrorMessage(error));
		throw error;
	}
}

export const GC_LIMITS = Object.freeze({
	maxBoundParameters: MAX_BOUND_PARAMETERS,
	maxInParameters: MAX_IN_PARAMETERS,
});
