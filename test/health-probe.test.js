import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";

import worker from "../worker/src/index.ts";
import { createD1Adapter } from "./support/d1.js";

const SQL = await initSqlJs();
const schemaSql = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const validKeyring = JSON.stringify({
	activeKeyId: "test",
	keys: { test: Buffer.alloc(32, 7).toString("base64") },
});

function createDatabase() {
	const database = new SQL.Database();
	database.exec(schemaSql);
	return database;
}

async function probe(env, { deep = true } = {}) {
	const query = deep ? "?deep=1" : "";
	return worker.fetch(
		new Request(`https://edgechat.test/api/health${query}`),
		env,
	);
}

/** 失败细节只应该进 Worker 日志，不进响应体。 */
async function captureConsoleError(run) {
	const original = console.error;
	const logged = [];
	console.error = (...args) => logged.push(args.map(String).join(" "));
	try {
		return { result: await run(), logged };
	} finally {
		console.error = original;
	}
}

test("浅探测保持常量响应，不碰数据库也不碰密钥", async () => {
	const response = await probe(
		{ DB: { prepare() { throw new Error("浅探测不应查询 D1"); } } },
		{ deep: false },
	);

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true });
});

test("深度探测在全绿时返回 ok 与空的失败列表", async () => {
	const database = createDatabase();
	const response = await probe({
		DB: createD1Adapter(database),
		EDGECHAT_ENCRYPTION_KEYRING: validKeyring,
	});

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true, failed: [] });
	database.close();
});

test("缺少加密密钥时深度探测返回 503，且只暴露检查 id", async () => {
	const database = createDatabase();
	const { result: response, logged } = await captureConsoleError(() =>
		probe({ DB: createD1Adapter(database) }),
	);

	assert.equal(response.status, 503);
	const body = await response.json();
	assert.deepEqual(body, { ok: false, failed: ["crypto"] });
	// 响应体里不能出现密钥变量名、错误原文或表名。
	assert.doesNotMatch(JSON.stringify(body), /EDGECHAT_ENCRYPTION_KEYRING|required|gc_state/);
	// 但细节必须留在日志里，方便排查。
	assert.ok(logged.some((line) => line.includes("health_check_failed:crypto")));
	database.close();
});

test("迁移没跑完（缺表）时深度探测报 schema 失败", async () => {
	const database = createDatabase();
	// 用 sessions 做样本：它只影响 schema 检查，不会连带影响 gc 检查。
	database.run("DROP TABLE sessions");
	const { result: response, logged } = await captureConsoleError(() =>
		probe({
			DB: createD1Adapter(database),
			EDGECHAT_ENCRYPTION_KEYRING: validKeyring,
		}),
	);

	assert.equal(response.status, 503);
	assert.deepEqual(await response.json(), { ok: false, failed: ["schema"] });
	assert.ok(logged.some((line) => line.includes("missing tables: sessions")));
	database.close();
});

test("D1 完全不可用时报 d1 失败", async () => {
	const { result: response } = await captureConsoleError(() =>
		probe({
			DB: { prepare() { throw new Error("d1 down"); } },
			EDGECHAT_ENCRYPTION_KEYRING: validKeyring,
		}),
	);

	assert.equal(response.status, 503);
	// 数据库挂了，依赖它的 schema 与 gc 检查同样应当失败。
	assert.deepEqual(await response.json(), { ok: false, failed: ["d1", "schema", "gc"] });
});

test("惰性 GC 停摆超过容忍窗口时报 gc 失败，从未跑过则不算故障", async () => {
	const stale = createDatabase();
	stale.run(
		"INSERT INTO gc_state (id, last_started_at) VALUES ('scheduled', datetime('now', '-7 day'))",
	);
	const { result: staleResponse } = await captureConsoleError(() =>
		probe({
			DB: createD1Adapter(stale),
			EDGECHAT_ENCRYPTION_KEYRING: validKeyring,
			GC_MIN_INTERVAL_MINUTES: "60",
		}),
	);
	assert.equal(staleResponse.status, 503);
	assert.deepEqual(await staleResponse.json(), { ok: false, failed: ["gc"] });
	stale.close();

	// 空 gc_state（刚部署、还没有请求）不是故障。
	const fresh = createDatabase();
	const freshResponse = await probe({
		DB: createD1Adapter(fresh),
		EDGECHAT_ENCRYPTION_KEYRING: validKeyring,
	});
	assert.equal(freshResponse.status, 200);
	assert.deepEqual(await freshResponse.json(), { ok: true, failed: [] });
	fresh.close();
});

test("容忍窗口随最小间隔放大，避免低频部署误报", async () => {
	const database = createDatabase();
	database.run(
		"INSERT INTO gc_state (id, last_started_at) VALUES ('scheduled', datetime('now', '-3 day'))",
	);
	const env = {
		DB: createD1Adapter(database),
		EDGECHAT_ENCRYPTION_KEYRING: validKeyring,
		// 每天一次的话，三天前的记录仍在容忍窗口内。
		GC_MIN_INTERVAL_MINUTES: "1440",
	};
	const { result: response } = await captureConsoleError(() => probe(env));

	assert.equal(response.status, 200);
	assert.deepEqual(await response.json(), { ok: true, failed: [] });
	database.close();
});
