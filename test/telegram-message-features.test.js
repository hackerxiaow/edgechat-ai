import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";

import { toggleMessageReaction, listReactionsForMessage } from "../worker/src/data/reactions.ts";
import { updateMessageContent, getMessageById, insertMessage } from "../worker/src/data/messages.ts";
import { createD1Adapter } from "./support/d1.js";

const SQL = await initSqlJs();
const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const KEYRING = JSON.stringify({
	activeKeyId: "v1",
	keys: { v1: Buffer.alloc(32, 7).toString("base64") },
});

function createEnvironment() {
	const database = new SQL.Database();
	database.exec(schema);
	database.run(
		`INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin)
		 VALUES
		   (1, 'alice', 'Alice', 'hash', 'salt', 0),
		   (2, 'bob', 'Bob', 'hash', 'salt', 0),
		   (3, 'charlie', 'Charlie', 'hash', 'salt', 0)`,
	);
	// general 频道 (id = 1) 已由 schema.sql 自动创建
	database.run(
		`INSERT INTO messages (id, channel_id, sender_id, content)
		 VALUES (10, 1, 1, 'Hello from Alice'), (11, 1, 2, 'Hello from Bob')`,
	);
	return {
		database,
		env: {
			DB: createD1Adapter(database),
			EDGECHAT_ENCRYPTION_KEYRING: KEYRING,
		},
	};
}

test("表情回应：添加、切换与按 Emoji 聚合统计", async () => {
	const { env } = createEnvironment();

	// Alice 给消息 10 点赞 👍
	const r1 = await toggleMessageReaction(env.DB, {
		channelId: 1,
		messageId: 10,
		userId: 1,
		emoji: "👍",
	});
	assert.equal(r1.action, "added");

	// Bob 也给消息 10 点赞 👍
	const r2 = await toggleMessageReaction(env.DB, {
		channelId: 1,
		messageId: 10,
		userId: 2,
		emoji: "👍",
	});
	assert.equal(r2.action, "added");

	// Bob 还给消息 10 点了 ❤️
	const r3 = await toggleMessageReaction(env.DB, {
		channelId: 1,
		messageId: 10,
		userId: 2,
		emoji: "❤️",
	});
	assert.equal(r3.action, "added");

	// 聚合查询
	const reactions = await listReactionsForMessage(env.DB, 10);
	assert.equal(reactions.length, 2);

	const thumbsUp = reactions.find((r) => r.emoji === "👍");
	assert.ok(thumbsUp);
	assert.equal(thumbsUp.count, 2);
	assert.deepEqual(thumbsUp.users.map((u) => u.id).sort(), [1, 2]);

	const heart = reactions.find((r) => r.emoji === "❤️");
	assert.ok(heart);
	assert.equal(heart.count, 1);
	assert.deepEqual(heart.users.map((u) => u.id), [2]);

	// Alice 再次点 👍，应当移除
	const r4 = await toggleMessageReaction(env.DB, {
		channelId: 1,
		messageId: 10,
		userId: 1,
		emoji: "👍",
	});
	assert.equal(r4.action, "removed");

	const reactionsAfter = await listReactionsForMessage(env.DB, 10);
	const thumbsUpAfter = reactionsAfter.find((r) => r.emoji === "👍");
	assert.ok(thumbsUpAfter);
	assert.equal(thumbsUpAfter.count, 1);
	assert.deepEqual(thumbsUpAfter.users.map((u) => u.id), [2]);
});

test("表情回应：写入与删除时触发 message_events 同步事件", async () => {
	const { database, env } = createEnvironment();

	// 清空初始事件
	database.run("DELETE FROM message_events");

	// 添加回应
	await toggleMessageReaction(env.DB, {
		channelId: 1,
		messageId: 10,
		userId: 2,
		emoji: "🔥",
	});

	const events = database.exec("SELECT channel_id, message_id, event_type FROM message_events")[0]?.values || [];
	assert.equal(events.length, 1);
	assert.deepEqual(events[0], [1, 10, "created"]);

	// 移除回应也会写入事件
	await toggleMessageReaction(env.DB, {
		channelId: 1,
		messageId: 10,
		userId: 2,
		emoji: "🔥",
	});

	const eventsAfter = database.exec("SELECT channel_id, message_id, event_type FROM message_events")[0]?.values || [];
	assert.equal(eventsAfter.length, 2);
	assert.deepEqual(eventsAfter[1], [1, 10, "created"]);
});

test("消息编辑：只能编辑自己的消息并记录 edited_at 与同步事件", async () => {
	const { database, env } = createEnvironment();

	// Alice 编辑自己的消息 10
	database.run("DELETE FROM message_events");
	const updated = await updateMessageContent(env, {
		messageId: 10,
		channelId: 1,
		userId: 1,
		content: "Hello from Alice (edited)",
	});

	assert.ok(updated);
	assert.equal(updated.content, "Hello from Alice (edited)");
	assert.ok(updated.editedAt, "应该有 editedAt 标记");

	// 触发器写入了同步事件
	const events = database.exec("SELECT channel_id, message_id, event_type FROM message_events")[0]?.values || [];
	assert.equal(events.length, 1);
	assert.deepEqual(events[0], [1, 10, "created"]);

	// Bob 试图编辑 Alice 的消息 10，应当拒绝
	await assert.rejects(
		() => updateMessageContent(env, {
			messageId: 10,
			channelId: 1,
			userId: 2,
			content: "Hacked by Bob",
		}),
		/Cannot edit other users' messages/,
	);

	// 空内容应当拒绝
	await assert.rejects(
		() => updateMessageContent(env, {
			messageId: 10,
			channelId: 1,
			userId: 1,
			content: "   ",
		}),
		/Message content cannot be empty/,
	);
});

test("消息转发：携带 forward_from_name 元数据并正常投影", async () => {
	const { env } = createEnvironment();

	const msg = await insertMessage(env, {
		channelId: 1,
		senderId: 2,
		content: "转发自 Alice 的消息",
		forwardFromName: "Alice",
	});

	assert.ok(msg);
	assert.equal(msg.forwardFromName, "Alice");
	assert.equal(msg.content, "转发自 Alice 的消息");

	// 读取时也能取回
	const fetched = await getMessageById(env, msg.id);
	assert.ok(fetched);
	assert.equal(fetched.forwardFromName, "Alice");
});
