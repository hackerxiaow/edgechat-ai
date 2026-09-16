import { loadEncryptionKeyring } from "./encryption.ts";
import { getRuntimeSettings } from "./data/site-settings.ts";
import { GC_STATE_ID } from "./gc.ts";
import type { AppBindings } from "./types.ts";

/** 缺少任何一张都会被判定为「迁移没跑完」。 */
const REQUIRED_TABLES = ["sessions", "uploaded_files", "gc_state"];

export type HealthCheckId = "d1" | "schema" | "crypto" | "gc";

export interface DeploymentHealth {
	ok: boolean;
	failed: HealthCheckId[];
}

/**
 * 惰性 GC 的容忍窗口：只要还有请求进来（外部监控本身就在打），
 * 清理就该在若干个最小间隔内跑过一次；超过这个窗口说明抢占或执行卡住了。
 */
export function gcStaleAfterMinutes(minIntervalMinutes: number): number {
	return Math.max(minIntervalMinutes, 1) * 6;
}

async function checkDatabase(db: D1Database): Promise<void> {
	await db.prepare("SELECT 1 AS ok").first();
}

async function checkSchema(db: D1Database): Promise<void> {
	const placeholders = REQUIRED_TABLES.map(() => "?").join(", ");
	const { results } = await db
		.prepare(
			`SELECT name FROM sqlite_master
			 WHERE type = 'table' AND name IN (${placeholders})`,
		)
		.bind(...REQUIRED_TABLES)
		.all<{ name: string }>();
	const present = new Set(results.map((row) => String(row.name)));
	const missing = REQUIRED_TABLES.filter((name) => !present.has(name));
	if (missing.length) throw new Error(`missing tables: ${missing.join(", ")}`);
}

function checkEncryptionKey(env: AppBindings): void {
	// 密钥缺失或格式错误都会抛错；这里只关心「能不能加载」，不碰任何数据。
	loadEncryptionKeyring(env);
}

async function checkScheduledGc(db: D1Database, staleAfterMinutes: number): Promise<void> {
	const row = await db
		.prepare("SELECT last_started_at FROM gc_state WHERE id = ? LIMIT 1")
		.bind(GC_STATE_ID)
		.first<{ last_started_at: string | null }>();
	// 从未跑过（例如刚部署、还没有任何请求）不算故障：这个探测请求本身就会触发一轮。
	if (!row?.last_started_at) return;
	// D1 的 CURRENT_TIMESTAMP 是不带时区的 UTC 字符串，必须显式按 UTC 解析。
	const startedAt = new Date(`${String(row.last_started_at).replace(" ", "T")}Z`).getTime();
	if (!Number.isFinite(startedAt)) throw new Error("invalid last_started_at");
	const ageMinutes = (Date.now() - startedAt) / 60_000;
	if (ageMinutes > staleAfterMinutes) {
		throw new Error(`scheduled gc stalled for ${Math.round(ageMinutes)} minutes`);
	}
}

/**
 * 深度健康检查：逐项跑一遍真实依赖，任一项失败就整项失败。
 * 只回传失败的检查 id，错误内容只进 Worker 日志，避免匿名探测拿到内部细节。
 */
export async function checkDeploymentHealth(env: AppBindings): Promise<DeploymentHealth> {
	// 清理间隔来自 site_settings，读不到就按默认值判断，不让配置本身成为故障源。
	const intervalMinutes = await getRuntimeSettings(env.DB)
		.then((settings) => settings.gcIntervalMinutes)
		.catch(() => 60);

	const checks: Array<[HealthCheckId, () => Promise<void> | void]> = [
		["d1", () => checkDatabase(env.DB)],
		["schema", () => checkSchema(env.DB)],
		["crypto", () => checkEncryptionKey(env)],
		["gc", () => checkScheduledGc(env.DB, gcStaleAfterMinutes(intervalMinutes))],
	];

	const failed: HealthCheckId[] = [];
	for (const [id, run] of checks) {
		try {
			await run();
		} catch (error) {
			failed.push(id);
			console.error(`health_check_failed:${id}`, error);
		}
	}

	return { ok: failed.length === 0, failed };
}

/** 只有显式带 ?deep=1 才做真实探测，普通探测保持常量响应。 */
export function isDeepHealthProbe(request: Request): boolean {
	return new URL(request.url).searchParams.get("deep") === "1";
}
