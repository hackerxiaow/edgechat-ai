import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";

import { searchRoomMessages, searchGlobal } from "../worker/src/data/search.ts";
import { insertMessage } from "../worker/src/data/messages.ts";
import { createD1Adapter } from "./support/d1.js";

const SQL = await initSqlJs();
const schema = readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8");
const KEYRING = JSON.stringify({
	activeKeyId: "v1",
	keys: { v1: Buffer.alloc(32, 7).toString("base64") },
});

async function createEnvironment() {
	const database = new SQL.Database();
	database.exec(schema);
	database.run(
		`INSERT INTO users (id, username, display_name, password_hash, password_salt, is_admin)
		 VALUES
		   (1, 'alice', 'Alice Cooper', 'hash', 'salt', 0),
		   (2, 'bob', 'Bob Dylan', 'hash', 'salt', 0)`,
	);
	const env = {
		DB: createD1Adapter(database),
		EDGECHAT_ENCRYPTION_KEYRING: KEYRING,
	};

	// 插入两条加密消息
	await insertMessage(env, {
		channelId: 1,
		senderId: 1,
		content: "The secret keyword is pineapple today",
	});
	await insertMessage(env, {
		channelId: 1,
		senderId: 2,
		content: "I like apples and bananas",
	});

	return { database, env };
}

test("会话内搜索：安全解密并精确匹配关键词", async () => {
	const { env } = await createEnvironment();

	const matches = await searchRoomMessages(env, {
		roomId: 1,
		query: "pineapple",
	});

	assert.equal(matches.length, 1);
	assert.match(matches[0].content, /pineapple/);

	const noMatches = await searchRoomMessages(env, {
		roomId: 1,
		query: "watermelon",
	});
	assert.equal(noMatches.length, 0);
});

test("全局搜索：跨会话匹配群组、联系人与消息", async () => {
	const { env } = await createEnvironment();

	// 搜索用户
	const userResult = await searchGlobal(env, {
		userId: 1,
		query: "Dylan",
	});
	assert.equal(userResult.users.length, 1);
	assert.equal(userResult.users[0].username, "bob");

	// 搜索群组
	const roomResult = await searchGlobal(env, {
		userId: 1,
		query: "general",
	});
	assert.equal(roomResult.rooms.length, 1);
	assert.equal(roomResult.rooms[0].name, "general");

	// 搜索消息正文
	const msgResult = await searchGlobal(env, {
		userId: 1,
		query: "bananas",
	});
	assert.equal(msgResult.messages.length, 1);
	assert.match(msgResult.messages[0].message.content, /bananas/);
	assert.equal(msgResult.messages[0].room.id, 1);
});
