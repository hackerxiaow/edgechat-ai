import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";

import worker from "../worker/src/index.ts";
import {
	resetGcProbeWindow,
	runLazyScheduledGc,
	shouldProbeScheduledGc,
} from "../worker/src/gc.ts";
import { createD1Adapter } from "./support/d1.js";

const SQL = await initSqlJs();
const schemaSql = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

function createDatabase() {
	const database = new SQL.Database();
	database.exec(schemaSql);
	return database;
}

function scalar(database, sql) {
	return Number(database.exec(sql)[0]?.values?.[0]?.[0] || 0);
}

/** 清理间隔现在由后台配置（site_settings），测试直接写库。 */
function setGcInterval(database, minutes) {
	database.run(
		`INSERT INTO site_settings (setting_key, setting_value) VALUES ('gc_interval_minutes', ?)
		 ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value`,
		[String(minutes)],
	);
}

/** 只让指定语句失败，其余照常执行，用来验证 GC 出错后的收尾行为。 */
function failingOn(database, fragment) {
	const db = createD1Adapter(database);
	const guard = (statement, shouldFail) => ({
		async all() {
			return statement.all();
		},
		async first(column) {
			return statement.first(column);
		},
		async run() {
			if (shouldFail) throw new Error("simulated gc outage");
			return statement.run();
		},
		bind(...values) {
			return guard(statement.bind(...values), shouldFail);
		},
	});
	return {
		prepare(sql) {
			return guard(db.prepare(sql), String(sql).includes(fragment));
		},
		batch: (statements) => db.batch(statements),
	};
}

test("Pages 部署没有 Cron Triggers，首次请求抢占并记录本轮开始与结束时间", async () => {
	const database = createDatabase();
	setGcInterval(database, 30);
	const env = { DB: createD1Adapter(database) };

	const summary = await runLazyScheduledGc(env);
	assert.ok(summary, "首次探测应当抢到执行权");
	assert.equal(scalar(database, "SELECT COUNT(*) FROM gc_state"), 1);
	assert.equal(
		scalar(
			database,
			`SELECT COUNT(*) FROM gc_state
			 WHERE id = 'scheduled'
			   AND last_started_at IS NOT NULL
			   AND last_finished_at IS NOT NULL
			   AND last_error = ''`,
		),
		1,
	);
});

test("最小间隔内的重复探测直接跳过，超过间隔后才重新执行", async () => {
	const database = createDatabase();
	setGcInterval(database, 30);
	const env = { DB: createD1Adapter(database) };

	assert.ok(await runLazyScheduledGc(env));
	assert.equal(await runLazyScheduledGc(env), null, "同一间隔内不应重复执行");
	assert.equal(await runLazyScheduledGc(env), null);

	database.run("UPDATE gc_state SET last_started_at = datetime('now', '-29 minute')");
	assert.equal(await runLazyScheduledGc(env), null, "还差一分钟就不该跑");

	database.run("UPDATE gc_state SET last_started_at = datetime('now', '-31 minute')");
	assert.ok(await runLazyScheduledGc(env), "超过间隔后应当重新执行");
	assert.equal(scalar(database, "SELECT COUNT(*) FROM gc_state"), 1, "状态表保持单行");
});

test("惰性 GC 失败会写回错误并按同一间隔等待，不会每个请求都重跑", async () => {
	const database = createDatabase();
	setGcInterval(database, 30);
	const env = {
		DB: failingOn(database, "DELETE FROM realtime_tickets"),
	};

	await assert.rejects(runLazyScheduledGc(env), /simulated gc outage/);
	assert.equal(
		scalar(
			database,
			`SELECT COUNT(*) FROM gc_state
			 WHERE last_error = 'simulated gc outage'
			   AND last_finished_at IS NOT NULL`,
		),
		1,
	);
	assert.equal(await runLazyScheduledGc(env), null, "出错后仍要等满一个间隔");
});

test("只有 /api 请求参与探测，且同一 isolate 内一分钟只探一次", () => {
	resetGcProbeWindow();
	const now = 1_800_000_000_000;

	assert.equal(
		shouldProbeScheduledGc(new Request("https://edgechat.test/files/1/avatar.png"), now),
		false,
	);
	assert.equal(
		shouldProbeScheduledGc(new Request("https://edgechat.test/index.html"), now),
		false,
	);
	// 非 API 请求不占用探测窗口。
	assert.equal(shouldProbeScheduledGc(new Request("https://edgechat.test/api/health"), now), true);
	assert.equal(
		shouldProbeScheduledGc(new Request("https://edgechat.test/api/v1/sync"), now + 59_999),
		false,
	);
	assert.equal(
		shouldProbeScheduledGc(new Request("https://edgechat.test/api/v1/sync"), now + 60_000),
		true,
	);
	assert.equal(
		shouldProbeScheduledGc(new Request("https://edgechat.test/files/1/avatar.png"), now + 120_000),
		false,
	);
});

test("worker.fetch 在带 waitUntil 的 API 请求上异步触发 GC，缺少 ctx 时保持只读", async () => {
	resetGcProbeWindow();
	const database = createDatabase();
	const pending = [];
	const ctx = {
		waitUntil: (promise) => pending.push(promise),
		passThroughOnException() {},
	};

	const response = await worker.fetch(
		new Request("https://edgechat.test/api/health"),
		{ DB: createD1Adapter(database) },
		ctx,
	);
	assert.equal(response.status, 200);
	assert.equal(pending.length, 1, "响应先行返回，GC 交给 waitUntil");
	await Promise.all(pending);
	assert.equal(scalar(database, "SELECT COUNT(*) FROM gc_state"), 1);

	// 同一 isolate 内紧接着的请求不再重复探测。
	await worker.fetch(
		new Request("https://edgechat.test/api/health"),
		{ DB: createD1Adapter(database) },
		ctx,
	);
	assert.equal(pending.length, 1);

	// 静态资产不触发，也不依赖 ctx。
	resetGcProbeWindow();
	const assetDatabase = createDatabase();
	await worker.fetch(
		new Request("https://edgechat.test/index.html"),
		{ DB: createD1Adapter(assetDatabase) },
		ctx,
	);
	assert.equal(pending.length, 1);
	assert.equal(scalar(assetDatabase, "SELECT COUNT(*) FROM gc_state"), 0);

	// 没有 ExecutionContext（例如单元测试里的 worker.fetch(request, env)）时不应报错。
	resetGcProbeWindow();
	const bareDatabase = createDatabase();
	const bare = await worker.fetch(
		new Request("https://edgechat.test/api/health"),
		{ DB: createD1Adapter(bareDatabase) },
	);
	assert.equal(bare.status, 200);
	assert.equal(scalar(bareDatabase, "SELECT COUNT(*) FROM gc_state"), 0);
});
