import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";

import { verifyPassword } from "../worker/src/auth.ts";
import { ensureBootstrapAdmin, readBootstrapAdmin } from "../worker/src/data/bootstrap-admin.ts";
import { createD1Adapter } from "./support/d1.js";

const SQL = await initSqlJs();
const schemaSql = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");

function createDatabase() {
	const database = new SQL.Database();
	database.exec(schemaSql);
	return database;
}

function scalar(database, sql, params = []) {
	const statement = database.prepare(sql);
	statement.bind(params);
	const value = statement.step() ? statement.getAsObject() : null;
	statement.free();
	return value;
}

function adminEnv(database, extra = {}) {
	return {
		DB: createD1Adapter(database),
		EDGECHAT_ADMIN_USERNAME: "root",
		EDGECHAT_ADMIN_PASSWORD: "sup3r-secret",
		...extra,
	};
}

test("账号不存在时按环境变量创建管理员并加入 general", async () => {
	const database = createDatabase();
	const result = await ensureBootstrapAdmin(adminEnv(database));

	assert.equal(result, "created");
	const row = scalar(
		database,
		"SELECT id, username, display_name, is_admin, password_hash, password_salt FROM users WHERE username = 'root'",
	);
	assert.equal(Number(row.is_admin), 1);
	assert.equal(row.display_name, "root");
	// 存的是哈希而不是明文，且能用工整的密码校验通过。
	assert.notEqual(row.password_hash, "sup3r-secret");
	assert.equal(await verifyPassword("sup3r-secret", row.password_hash, row.password_salt), true);
	assert.equal(await verifyPassword("wrong-secret", row.password_hash, row.password_salt), false);
	// 建号流程与普通注册一致：自动进入 general。
	assert.equal(
		Number(scalar(database, `SELECT COUNT(*) AS n FROM channel_members WHERE user_id = ${Number(row.id)}`).n),
		1,
	);
	database.close();
});

test("管理员已存在时不覆盖密码，重复调用保持幂等", async () => {
	const database = createDatabase();
	assert.equal(await ensureBootstrapAdmin(adminEnv(database)), "created");
	const before = scalar(database, "SELECT password_hash, password_salt FROM users WHERE username = 'root'");

	// 改了环境变量密码也不会覆盖已有账号：账号数据以库里为准。
	const again = await ensureBootstrapAdmin(adminEnv(database, { EDGECHAT_ADMIN_PASSWORD: "another-secret" }));
	assert.equal(again, "exists");
	const after = scalar(database, "SELECT password_hash, password_salt FROM users WHERE username = 'root'");
	assert.deepEqual(after, before);
	assert.equal(Number(scalar(database, "SELECT COUNT(*) AS n FROM users").n), 1);
	database.close();
});

test("同名普通账号不会被提权，也不会被占用密码", async () => {
	const database = createDatabase();
	database.run(
		`INSERT INTO users (username, display_name, password_hash, password_salt, is_admin)
		 VALUES ('root', 'root', 'hash', 'salt', 0)`,
	);

	const result = await ensureBootstrapAdmin(adminEnv(database));
	assert.equal(result, "taken");
	assert.equal(Number(scalar(database, "SELECT is_admin FROM users WHERE username = 'root'").is_admin), 0);
	// 原有凭据保持不动，避免用环境变量把别人账号的密码改掉。
	assert.equal(scalar(database, "SELECT password_hash FROM users WHERE username = 'root'").password_hash, "hash");
	database.close();
});

test("用户名大小写不同也视为同一个账号", async () => {
	const database = createDatabase();
	database.run(
		`INSERT INTO users (username, display_name, password_hash, password_salt, is_admin)
		 VALUES ('Root', 'Root', 'hash', 'salt', 1)`,
	);

	const result = await ensureBootstrapAdmin(adminEnv(database));
	assert.equal(result, "exists");
	assert.equal(Number(scalar(database, "SELECT COUNT(*) AS n FROM users").n), 1);
	database.close();
});

test("缺少任一变量或密码过短都不引导，也不留下半个账号", async () => {
	const cases = [
		{ EDGECHAT_ADMIN_USERNAME: "" },
		{ EDGECHAT_ADMIN_PASSWORD: "" },
		{ EDGECHAT_ADMIN_PASSWORD: "12345" },
		{ EDGECHAT_ADMIN_USERNAME: "x".repeat(80) },
	];

	for (const override of cases) {
		const database = createDatabase();
		const env = adminEnv(database, override);
		assert.equal(await ensureBootstrapAdmin(env), "skipped", JSON.stringify(override));
		assert.equal(Number(scalar(database, "SELECT COUNT(*) AS n FROM users").n), 0);
		database.close();
	}
});

test("并发建号撞上唯一约束时按已存在处理，不抛错", async () => {
	const database = createDatabase();
	// 模拟另一个请求抢先把同名账号建好。
	const db = createD1Adapter(database);
	const originalPrepare = db.prepare.bind(db);
	let raced = false;
	db.prepare = (sql) => {
		if (!raced && sql.includes("INSERT INTO users")) {
			raced = true;
			database.run(
				`INSERT INTO users (username, display_name, password_hash, password_salt, is_admin)
				 VALUES ('root', 'root', 'hash', 'salt', 1)`,
			);
		}
		return originalPrepare(sql);
	};

	// 注意：必须用这个被包装过的 DB，否则 mock 不会生效。
	assert.equal(await ensureBootstrapAdmin({ ...adminEnv(database), DB: db }), "exists");
	database.close();
});

test("引导变量只按名字读取，不做任何默认值回退", () => {
	assert.deepEqual(readBootstrapAdmin({}), { username: "", password: "" });
	assert.deepEqual(
		readBootstrapAdmin({ EDGECHAT_ADMIN_USERNAME: " root ", EDGECHAT_ADMIN_PASSWORD: " pw" }),
		{ username: "root", password: " pw" },
	);
});
