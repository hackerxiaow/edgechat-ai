import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";

import { insertMessage } from "../worker/src/data/messages.ts";
import { canAccessFile } from "../worker/src/data/uploaded-files.ts";
import { ORPHAN_UPLOAD_QUERY, runScheduledGc } from "../worker/src/gc.ts";
import { createMessageSubmission } from "../worker/src/message-submission.ts";
import { createD1Adapter } from "./support/d1.js";

const SQL = await initSqlJs();
const schemaSql = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

function createDatabase() {
	const database = new SQL.Database();
	database.exec(schemaSql);
	return database;
}

function insertUser(database, username, { deleted = false } = {}) {
	database.run(
		`INSERT INTO users (
		   username, display_name, password_hash, password_salt, deleted_at
		 ) VALUES (?, ?, 'hash', 'salt', ${deleted ? "datetime('now', '-61 day')" : "NULL"})`,
		[username, username],
	);
	return Number(database.exec("SELECT last_insert_rowid()")[0].values[0][0]);
}

/**
 * D1 单存储下 GC 删除的是 uploaded_files 里的行，旧测试观察的 R2 delete 换成
 * 包装 D1 的 run()：可以记录被删的 key，也可以模拟删除失败。
 * 包装后的语句要保留 inner/sql，否则外层计量与失败注入都拿不到原始语句。
 */
function withDeleteBehaviour(db, { deleted = null, fail = false } = {}) {
	return {
		prepare(sql) {
			const statement = db.prepare(sql);
			const isDelete = /DELETE\s+FROM\s+uploaded_files/i.test(String(sql));
			const guard = () => {
				if (fail) throw new Error("simulated D1 delete outage");
			};
			const wrap = (bound) => {
				if (!isDelete) return bound;
				return {
					// 批次执行时外层用的是 inner 语句，注入点必须同时覆盖两条路径。
					...(bound.inner === undefined
						? {}
						: {
								inner: {
									all: () => bound.inner.all(),
									first: (column) => bound.inner.first(column),
									async run() {
										guard();
										return bound.inner.run();
									}
								}
							}),
					...(bound.sql === undefined ? {} : { sql: bound.sql }),
					async all() {
						return bound.all();
					},
					async first(column) {
						return bound.first(column);
					},
					async run() {
						guard();
						return bound.run();
					}
				};
			};
			return {
				...(statement.inner === undefined ? {} : { inner: statement.inner }),
				...(statement.sql === undefined ? {} : { sql: statement.sql }),
				async all() {
					return statement.all();
				},
				async first(column) {
					return statement.first(column);
				},
				async run() {
					return statement.run();
				},
				bind(...values) {
					if (isDelete && deleted) deleted.push(values[0]);
					return wrap(statement.bind(...values));
				}
			};
		},
		...(typeof db.batch === "function" ? { batch: (statements) => db.batch(statements) } : {})
	};
}

function scalar(database, sql) {
	return Number(database.exec(sql)[0]?.values?.[0]?.[0] || 0);
}

function createMeasuredD1(database) {
	const base = createD1Adapter(database);
	const metrics = { apiCalls: 0, statements: 0, maxBindings: 0 };
	return {
		metrics,
		db: {
			prepare(sql) {
				const inner = base.prepare(sql);
				const wrapped = {
					inner,
					sql: String(sql),
					bind(...values) {
						metrics.maxBindings = Math.max(metrics.maxBindings, values.length);
						inner.bind(...values);
						return this;
					},
					async all() {
						metrics.apiCalls += 1;
						metrics.statements += 1;
						return inner.all();
					},
					async run() {
						metrics.apiCalls += 1;
						metrics.statements += 1;
						return inner.run();
					},
				};
				return wrapped;
			},
			async batch(statements) {
				metrics.apiCalls += 1;
				metrics.statements += statements.length;
				return base.batch(statements.map((statement) => statement.inner));
			},
		},
	};
}

test("孤儿扫描使用匹配索引，失败对象进入退避且不阻塞后续批次", async () => {
	const database = createDatabase();
	const userId = insertUser(database, "gc-owner");
	const plan = database.prepare(`EXPLAIN QUERY PLAN ${ORPHAN_UPLOAD_QUERY}`);
	plan.bind(["-1 day", "", 90]);
	const details = [];
	while (plan.step()) {
		details.push(String(plan.getAsObject().detail || ""));
	}
	plan.free();
	assert.equal(
		details.some((detail) => /SCAN (uploaded_files|messages|users|channels)/.test(detail)),
		false,
		details.join("\n"),
	);

	database.run(
		`INSERT INTO uploaded_files (object_key, owner_user_id, created_at) VALUES
		 (?, ?, datetime('now', '-4 day')),
		 (?, ?, datetime('now', '-3 day')),
		 (?, ?, datetime('now', '-2 day'))`,
		["1/a", userId, "1/b", userId, "1/c", userId],
	);
	const attempts = [];
	await runScheduledGc({
		DB: withDeleteBehaviour(createD1Adapter(database), { deleted: attempts, fail: true }),
		GC_BATCH_SIZE: 2,
		GC_MAX_BATCHES_PER_RUN: 3,
		ORPHAN_UPLOAD_RETENTION_DAYS: 1,
	});

	assert.deepEqual(attempts, ["1/a", "1/b", "1/c"]);
	assert.equal(scalar(database, "SELECT COUNT(*) FROM pending_r2_delete"), 3);
	assert.equal(
		scalar(
			database,
			"SELECT COUNT(*) FROM pending_r2_delete WHERE retry_count = 1 AND next_retry_at > CURRENT_TIMESTAMP",
		),
		3,
	);
});

test("R2 删除后 D1 完成批次失败时保留任务并写入退避", async () => {
	const database = createDatabase();
	const userId = insertUser(database, "completion-failure");
	database.run(
		"INSERT INTO uploaded_files (object_key, owner_user_id, created_at) VALUES ('1/completion-failure', ?, datetime('now', '-2 day'))",
		[userId],
	);
	database.run(
		"INSERT INTO pending_r2_delete (object_key) VALUES ('1/completion-failure')",
	);
	const measured = createMeasuredD1(database);
	const regularBatch = measured.db.batch.bind(measured.db);
	let failCompletion = true;
	measured.db.batch = async (statements) => {
		if (
			failCompletion &&
			statements.some((statement) =>
				statement.sql.includes("DELETE FROM uploaded_files WHERE object_key = ?"),
			)
		) {
			failCompletion = false;
			measured.metrics.apiCalls += 1;
			measured.metrics.statements += statements.length;
			throw new Error("simulated D1 completion failure");
		}
		return regularBatch(statements);
	};

	const deleted = [];
	// 批次与预算属于内部保护参数、不再可配：这里只有一条待删任务，行为与定量批次一致。
	const summary = await runScheduledGc({
		DB: withDeleteBehaviour(measured.db, { deleted }),
	});

	assert.deepEqual(deleted, ["1/completion-failure"]);
	assert.equal(summary.r2Deleted, 0);
	assert.equal(summary.r2DeleteFailed, 1);
	assert.equal(summary.budget.d1ApiCalls, measured.metrics.apiCalls);
	assert.equal(summary.budget.d1Statements, measured.metrics.statements);
	assert.equal(
		scalar(
			database,
			`SELECT COUNT(*) FROM pending_r2_delete
			 WHERE object_key = '1/completion-failure'
			   AND retry_count = 1
			   AND next_retry_at > CURRENT_TIMESTAMP`,
		),
		1,
	);
	assert.equal(
		scalar(
			database,
			"SELECT COUNT(*) FROM uploaded_files WHERE object_key = '1/completion-failure'",
		),
		1,
	);
});

test("待删除占位原子阻止消息附件与头像重新引用", () => {
	const database = createDatabase();
	const userId = insertUser(database, "claim-owner");
	const channelId = scalar(database, "SELECT id FROM channels WHERE name = 'general'");
	database.run(
		"INSERT INTO uploaded_files (object_key, owner_user_id) VALUES ('1/race', ?)",
		[userId],
	);
	assert.equal(
		scalar(
			database,
			"SELECT COUNT(*) FROM uploaded_files WHERE object_key = '1/race' AND owner_user_id = " +
				userId,
		),
		1,
	);
	database.run("INSERT INTO pending_r2_delete (object_key) VALUES ('1/race')");

	assert.throws(
		() =>
			database.run(
				"INSERT INTO messages (channel_id, sender_id, content, attachment_key) VALUES (?, ?, 'x', '1/race')",
				[channelId, userId],
			),
		/r2_local_object_unavailable/,
	);
	assert.throws(
		() => database.run("UPDATE users SET avatar_key = '1/race' WHERE id = ?", [userId]),
		/r2_local_object_unavailable/,
	);
	assert.throws(
		() => database.run("UPDATE channels SET avatar_key = '1/race' WHERE id = ?", [channelId]),
		/r2_local_object_unavailable/,
	);
});

test("待删除对象不会继续通过文件读取授权", async () => {
	const database = createDatabase();
	const userId = insertUser(database, "pending-download");
	database.run(
		"INSERT INTO uploaded_files (object_key, owner_user_id) VALUES ('1/pending-download', ?)",
		[userId],
	);
	database.run("UPDATE users SET avatar_key = '1/pending-download' WHERE id = ?", [userId]);
	const db = createD1Adapter(database);
	assert.equal(await canAccessFile(db, "1/pending-download", null), true);
	assert.equal(await canAccessFile(db, "1/pending-download", userId), true);

	database.run("INSERT INTO pending_r2_delete (object_key) VALUES ('1/pending-download')");
	assert.equal(await canAccessFile(db, "1/pending-download", null), false);
	assert.equal(await canAccessFile(db, "1/pending-download", userId), false);
});

test("GC 完成删除并移除占位后，旧请求不能写入失效的本地引用", async () => {
	const database = createDatabase();
	const userId = insertUser(database, "stale-request");
	const channelId = scalar(database, "SELECT id FROM channels WHERE name = 'general'");
	database.run(
		"INSERT INTO uploaded_files (object_key, owner_user_id, created_at) VALUES ('1/stale', ?, datetime('now', '-2 day'))",
		[userId],
	);
	assert.equal(
		scalar(database, `SELECT COUNT(*) FROM uploaded_files WHERE object_key = '1/stale'`),
		1,
	);

	const deleted = [];
	await runScheduledGc({
		DB: withDeleteBehaviour(createD1Adapter(database), { deleted }),
		GC_BATCH_SIZE: 1,
		GC_MAX_BATCHES_PER_RUN: 2,
	});
	assert.deepEqual(deleted, ["1/stale"]);
	assert.equal(scalar(database, "SELECT COUNT(*) FROM uploaded_files"), 0);
	assert.equal(scalar(database, "SELECT COUNT(*) FROM pending_r2_delete"), 0);

	assert.throws(
		() => database.run(
			"INSERT INTO messages (channel_id, sender_id, content, attachment_key) VALUES (?, ?, 'late', '1/stale')",
			[channelId, userId],
		),
		/r2_local_object_unavailable/,
	);
	assert.throws(
		() => database.run("UPDATE users SET avatar_key = '1/stale' WHERE id = ?", [userId]),
		/r2_local_object_unavailable/,
	);
	assert.throws(
		() => database.run("UPDATE channels SET avatar_key = '1/stale' WHERE id = ?", [channelId]),
		/r2_local_object_unavailable/,
	);
});

test("消息预检查后发生完整 GC，实际提交路径返回附件不可用业务错误", async () => {
	const database = createDatabase();
	const userId = insertUser(database, "submission-race");
	const channelId = scalar(database, "SELECT id FROM channels WHERE name = 'general'");
	database.run(
		"INSERT INTO uploaded_files (object_key, owner_user_id) VALUES ('1/request-race', ?)",
		[userId],
	);
	const base = createD1Adapter(database);
	const racingDb = {
		prepare(sql) {
			const statement = base.prepare(sql);
			const isMessageInsert = String(sql).includes("INSERT INTO messages");
			return {
				bind(...values) {
					statement.bind(...values);
					return this;
				},
				all() {
					return statement.all();
				},
				run() {
					if (isMessageInsert) {
						database.run(
							"INSERT INTO pending_r2_delete (object_key) VALUES ('1/request-race')",
						);
						database.run("DELETE FROM uploaded_files WHERE object_key = '1/request-race'");
						database.run("DELETE FROM pending_r2_delete WHERE object_key = '1/request-race'");
					}
					return statement.run();
				},
			};
		},
		batch(statements) {
			return base.batch(statements);
		},
	};
	const submit = createMessageSubmission({
		persistMessage: insertMessage,
		async resolveMentions() { return []; },
		async resolveReply() { return { messageId: null, senderId: null }; },
	});
	await assert.rejects(
		submit(
			{
				DB: racingDb,
				EDGECHAT_ENCRYPTION_KEYRING: JSON.stringify({
					activeKeyId: "test",
					keys: { test: Buffer.alloc(32, 7).toString("base64") },
				}),
			},
			{
				room: { id: channelId, kind: "public" },
				principal: { userId },
			},
			{
				content: "late request",
				attachment: {
					key: "1/request-race",
					name: "race.txt",
					type: "text/plain",
					size: 4,
				},
			},
		),
		(error) => {
			assert.equal(error.code, "attachment_unavailable");
			assert.match(error.message, /附件不存在、无权使用或正在清理/);
			return true;
		},
	);
	assert.equal(scalar(database, "SELECT COUNT(*) FROM messages"), 0);
});

test("有效本地文件、文本消息、头像清空与可信外部附件保持可用", () => {
	const database = createDatabase();
	const ownerId = insertUser(database, "valid-owner");
	const otherId = insertUser(database, "other-owner");
	const channelId = scalar(database, "SELECT id FROM channels WHERE name = 'general'");
	database.run(
		"INSERT INTO uploaded_files (object_key, owner_user_id) VALUES ('1/valid', ?)",
		[ownerId],
	);
	database.run(
		"INSERT INTO messages (channel_id, sender_id, content) VALUES (?, ?, 'text only')",
		[channelId, ownerId],
	);
	database.run(
		"INSERT INTO messages (channel_id, sender_id, content, attachment_key) VALUES (?, ?, 'valid', '1/valid')",
		[channelId, ownerId],
	);
	database.run("UPDATE users SET avatar_key = '1/valid' WHERE id = ?", [ownerId]);
	database.run("UPDATE channels SET avatar_key = '1/valid' WHERE id = ?", [channelId]);
	database.run("UPDATE users SET avatar_key = NULL WHERE id = ?", [ownerId]);
	assert.throws(
		() => database.run(
			"INSERT INTO messages (channel_id, sender_id, content, attachment_key) VALUES (?, ?, 'wrong owner', '1/valid')",
			[channelId, otherId],
		),
		/r2_local_object_unavailable/,
	);
	database.run(
		`INSERT INTO messages (
		   channel_id, sender_id, content, attachment_key, sender_kind,
		   external_sender_id, external_sender_name, source, source_message_id
		 ) VALUES (?, NULL, 'telegram', 'telegram/-1/external.bin', 'external', '7', 'Alice', 'telegram', '-1:1')`,
		[channelId],
	);
	assert.equal(scalar(database, "SELECT COUNT(*) FROM messages"), 3);
});

test("GC 在同一轮里轮转多个步骤，失败的任务保留并可下次续跑", async () => {
	const database = createDatabase();
	const userId = insertUser(database, "budget-owner");
	const channelId = scalar(database, "SELECT id FROM channels WHERE name = 'general'");
	for (let index = 0; index < 120; index += 1) {
		database.run(
			"INSERT INTO uploaded_files (object_key, owner_user_id, created_at) VALUES (?, ?, datetime('now', '-2 day'))",
			[`budget/${String(index).padStart(3, "0")}`, userId],
		);
		database.run(
			"INSERT INTO messages (channel_id, sender_id, content, created_at) VALUES (?, ?, 'old', datetime('now', '-10 day'))",
			[channelId, userId],
		);
		database.run(
			"INSERT INTO registration_invites (token, deleted_at) VALUES (?, datetime('now', '-61 day'))",
			[`budget-token-${index}`],
		);
	}

	const measured = createMeasuredD1(database);
	// 全部删除都失败，用来验证失败任务留在队列、且不影响同一轮里的其它步骤。
	const env = { DB: withDeleteBehaviour(measured.db, { fail: true }) };

	const first = await runScheduledGc(env);
	assert.ok(first.expiredMessagesDeleted > 0, "过期消息应在同一轮里被清理");
	assert.ok(first.invitesDeleted > 0, "过期邀请应在同一轮里被清理");
	assert.ok(first.orphanUploadsQueued > 0, "孤儿附件应被排队");
	assert.ok(first.r2DeleteFailed > 0, "删除失败的任务要留在队列里");
	// 预算与计量必须逐条对齐，否则说明有的 D1 调用没被记账。
	assert.equal(first.budget.d1ApiCalls, measured.metrics.apiCalls);
	assert.equal(first.budget.d1Statements, measured.metrics.statements);
	assert.ok(measured.metrics.maxBindings <= 90, "绑定参数不能超过 D1 的 100 上限");
	assert.ok(first.budget.internalOperations <= first.budget.limits.internalOperations);
	assert.ok(first.budget.d1Statements <= first.budget.limits.d1Statements);

	const pendingBefore = scalar(database, "SELECT COUNT(*) FROM pending_r2_delete");
	assert.ok(pendingBefore > 0, "失败任务必须持久化，不能丢");
	const remainingBefore = scalar(database, "SELECT COUNT(*) FROM uploaded_files");
	const second = await runScheduledGc(env);
	// 退避中的任务不该被立刻重试，但要留在队列里等下一个重试窗口。
	assert.equal(second.retryQueueFetched, 0, "退避中的任务不应被立即重试");
	assert.ok(
		scalar(database, "SELECT COUNT(*) FROM pending_r2_delete") > 0,
		"失败任务仍在队列里等待续跑",
	);
	assert.ok(scalar(database, "SELECT COUNT(*) FROM uploaded_files") <= remainingBefore);
});

test("重复发现已经排队的对象不会重置未来重试时间", async () => {
	const database = createDatabase();
	const userId = insertUser(database, "future-retry");
	database.run(
		"INSERT INTO uploaded_files (object_key, owner_user_id, created_at) VALUES ('1/future', ?, datetime('now', '-2 day'))",
		[userId],
	);
	database.run(
		`INSERT INTO pending_r2_delete (object_key, retry_count, next_retry_at)
		 VALUES ('1/future', 4, datetime('now', '+1 day'))`,
	);
	const before = database.exec(
		"SELECT retry_count, next_retry_at FROM pending_r2_delete WHERE object_key = '1/future'",
	)[0].values[0];
	await runScheduledGc({
		DB: withDeleteBehaviour(createD1Adapter(database), { fail: true }),
	});
	const after = database.exec(
		"SELECT retry_count, next_retry_at FROM pending_r2_delete WHERE object_key = '1/future'",
	)[0].values[0];
	assert.deepEqual(after, before);
});

test("硬删除用户前先持久化其 R2 清理任务", async () => {
	const database = createDatabase();
	const userId = insertUser(database, "deleted-owner", { deleted: true });
	database.run(
		"INSERT INTO uploaded_files (object_key, owner_user_id) VALUES ('1/durable', ?)",
		[userId],
	);
	const baseDb = createD1Adapter(database);
	const failingDb = {
		...baseDb,
		prepare(sql) {
			const statement = baseDb.prepare(sql);
			const failMetadataDelete =
				String(sql).includes("DELETE FROM uploaded_files") &&
				String(sql).includes("owner_user_id IN");
			return {
				bind(...values) {
					statement.bind(...values);
					return this;
				},
				all() {
					return statement.all();
				},
				run() {
					if (failMetadataDelete) {
						throw new Error("simulated metadata delete failure");
					}
					return statement.run();
				},
			};
		},
	};

	await assert.rejects(
		runScheduledGc({ DB: failingDb }),
		/simulated metadata delete failure/,
	);
	assert.equal(
		scalar(
			database,
			"SELECT COUNT(*) FROM pending_r2_delete WHERE object_key = '1/durable'",
		),
		1,
	);
});

test("GC 可以清理从正常建号流程进入 general 的软删用户", async () => {
	const database = createDatabase();
	const userId = insertUser(database, "deleted-general-member");
	assert.equal(
		scalar(database, `SELECT COUNT(*) FROM channel_members WHERE user_id = ${userId}`),
		1,
	);
	database.run(
		"UPDATE users SET deleted_at = datetime('now', '-61 day') WHERE id = ?",
		[userId],
	);
	const summary = await runScheduledGc({
		DB: createD1Adapter(database),
	});
	assert.equal(summary.usersDeleted, 1);
	assert.equal(scalar(database, `SELECT COUNT(*) FROM users WHERE id = ${userId}`), 0);
	assert.equal(scalar(database, `SELECT COUNT(*) FROM channel_members WHERE user_id = ${userId}`), 0);
});
