import assert from "node:assert/strict";
import test from "node:test";

import worker from "../worker/src/index.js";

test("个人资料接口清除头像时同步数据库与会话", async () => {
	let storedSession = {
		token: "session-token",
		userId: 7,
		username: "alice",
		displayName: "Alice",
		avatarUrl: "/files/7%2Fold.png",
		isAdmin: false,
		sessionVersion: 0,
	};
	let update;
	// 会话已迁到 D1 的 sessions 表：读走 first()，写走 INSERT INTO sessions 的 run()。
	const env = {
		DB: {
			prepare(sql) {
				return {
					bind(...binds) {
						return {
								async all() {
									if (sql.includes("SELECT id, username, display_name, avatar_key, bio")) {
										return { results: [{ id: 7, username: "alice", display_name: "Alice", avatar_key: null, bio: "" }] };
									}
								if (sql.includes("SELECT username, is_disabled")) {
									return {
										results: [{
											username: "alice",
											is_disabled: 0,
											deleted_at: null,
											session_version: 0,
											is_admin: 0,
										}],
									};
								}
								throw new Error(`Unexpected query: ${sql}`);
							},
							async first() {
								if (sql.includes("FROM sessions")) {
									return {
										data: JSON.stringify(storedSession),
										expires_at: Math.floor(Date.now() / 1000) + 3600,
									};
								}
								throw new Error(`Unexpected query: ${sql}`);
							},
							async run() {
								if (sql.includes("INSERT INTO sessions")) {
									storedSession = JSON.parse(binds[2]);
									return { meta: { changes: 1 } };
								}
								update = { sql, binds };
								return { success: true };
							},
						};
					},
				};
			},
		},
	};

	const response = await worker.fetch(
		new Request("https://edgechat.test/api/me/profile", {
			method: "PATCH",
			headers: {
				Authorization: "Bearer session-token",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ displayName: "Alice", avatarKey: null }),
		}),
		env,
		{},
	);

	assert.equal(response.status, 200);
	assert.match(update.sql, /avatar_key = \?/);
	assert.deepEqual(update.binds, ["Alice", null, 7]);
	assert.equal((await response.json()).session.avatarUrl, "");
	assert.equal(storedSession.avatarUrl, "");
});
