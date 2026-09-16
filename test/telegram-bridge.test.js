import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import initSqlJs from "sql.js";

import { createD1Adapter } from "./support/d1.js";
import { insertExternalMessage, mapMessage } from "../worker/src/data/messages.ts";
import {
	decryptMessageContent,
	encryptAttachment,
	decryptSecretValue,
	encryptMessageContent,
	encryptSecretValue,
} from "../worker/src/encryption.ts";
import { parseTelegramMessageUpdate } from "../worker/src/integrations/telegram/parser.ts";
import {
	formatTelegramMessage,
	ingestTelegramMessage,
	splitTelegramFormattedMessage,
} from "../worker/src/integrations/telegram/bridge.ts";
import {
	sendTelegramMedia,
	sendTelegramText,
} from "../worker/src/integrations/telegram/client.ts";
import {
	importTelegramAttachment,
	loadEdgeChatAttachment,
	TELEGRAM_BRIDGE_FILE_LIMIT,
	TELEGRAM_FILE_SKIP_REASON,
} from "../worker/src/integrations/telegram/files.ts";
import worker from "../worker/src/index.ts";

const keyring = JSON.stringify({
	activeKeyId: "v1",
	keys: {
		v1: Buffer.from(Uint8Array.from({ length: 32 }, (_, index) => index + 1)).toString(
			"base64",
		),
	},
});

test("Telegram 文字消息转换为稳定的外部发送者模型", () => {
	assert.deepEqual(
		parseTelegramMessageUpdate({
			message: {
				message_id: 9,
				text: "hello 👋",
				chat: { id: -100123, title: "Bridge room" },
					from: { id: 42, first_name: "Alice", last_name: "Chen", is_bot: false },
					reply_to_message: { message_id: 8 },
			},
		}),
		{
				telegramChatId: "-100123",
				telegramChatTitle: "Bridge room",
				telegramMessageId: 9,
				sourceMessageId: "-100123:9",
				replySourceMessageId: "-100123:8",
				content: "hello 👋",
				attachment: null,
			sender: { id: "42", displayName: "Alice Chen", avatarUrl: "" },
		},
	);
	assert.equal(parseTelegramMessageUpdate({ message: { text: "bot", from: { is_bot: true } } }), null);
});

test("Telegram 图片、视频、语音、音频与普通文件保留原始元数据", () => {
	const base = {
		message_id: 10,
		caption: "说明",
		chat: { id: -100123, title: "Bridge room" },
		from: { id: 42, first_name: "Alice", is_bot: false },
	};
	const photo = parseTelegramMessageUpdate({
		message: {
			...base,
			photo: [
				{ file_id: "small", file_unique_id: "small-u", file_size: 100 },
				{ file_id: "large", file_unique_id: "large-u", file_size: 200 },
			],
		},
	});
	assert.deepEqual(photo.attachment, {
		kind: "photo",
		fileId: "large",
		fileUniqueId: "large-u",
		fileName: "photo-10.jpg",
		mimeType: "image/jpeg",
		fileSize: 200,
	});
	const video = parseTelegramMessageUpdate({
		message: {
			...base,
			video: {
				file_id: "video",
				file_unique_id: "video-u",
				file_name: "clip.mp4",
				mime_type: "video/mp4",
				file_size: 300,
			},
		},
	});
	assert.equal(video.attachment.kind, "video");
	assert.equal(video.attachment.fileName, "clip.mp4");
	const voice = parseTelegramMessageUpdate({
		message: {
			...base,
			voice: {
				file_id: "voice",
				file_unique_id: "voice-u",
				mime_type: "audio/ogg",
				file_size: 250,
				duration: 8,
			},
		},
	});
	assert.deepEqual(voice.attachment, {
		kind: "voice",
		fileId: "voice",
		fileUniqueId: "voice-u",
		fileName: "voice-10.ogg",
		mimeType: "audio/ogg",
		fileSize: 250,
		durationMs: 8000,
	});
	const audio = parseTelegramMessageUpdate({
		message: {
			...base,
			audio: {
				file_id: "audio",
				file_unique_id: "audio-u",
				file_name: "song.mp3",
				mime_type: "audio/mpeg",
				file_size: 350,
				duration: 12,
			},
		},
	});
	assert.equal(audio.attachment.kind, "audio");
	assert.equal(audio.attachment.durationMs, 12000);
	const document = parseTelegramMessageUpdate({
		message: {
			...base,
			document: {
				file_id: "document",
				file_unique_id: "document-u",
				file_name: "report.pdf",
				mime_type: "application/pdf",
				file_size: 400,
			},
		},
	});
	assert.equal(document.attachment.kind, "document");
	assert.equal(document.content, "说明");
});

test("EdgeChat 出站消息使用粗体用户名、紧邻正文的换行和 HTML 转义", () => {
	assert.equal(
		formatTelegramMessage('Alice & Bob', '<hello> "world"'),
		'<b>Alice &amp; Bob:</b>\n&lt;hello&gt; &quot;world&quot;',
	);
	const chunks = splitTelegramFormattedMessage("Alice", `${"a".repeat(4081)}👋b`, 4096);
	assert.equal(chunks.length, 2);
	assert.equal(Array.from(chunks[0]).length <= 4096, true);
	assert.equal(chunks[0].endsWith("👋"), true);
	assert.equal(chunks[1], "<b>Alice:</b>\nb");
});

test("Telegram 媒体上传按类型构造 multipart 请求", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return Response.json({ ok: true, result: { message_id: 1 } });
	};
	try {
		await sendTelegramMedia("123:token", {
			chatId: "-1001",
			kind: "video",
			bytes: Uint8Array.from([1, 2, 3]),
			filename: "clip.mp4",
			contentType: "video/mp4",
				caption: "<b>Alice:</b>\nhello",
				replyToMessageId: 7,
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.match(captured.url, /\/sendVideo$/);
	assert.equal(captured.init.method, "POST");
	assert.equal(captured.init.headers, undefined);
	assert.equal(captured.init.body.get("chat_id"), "-1001");
	assert.equal(captured.init.body.get("parse_mode"), "HTML");
	assert.equal(captured.init.body.get("caption"), "<b>Alice:</b>\nhello");
	assert.equal(captured.init.body.get("reply_parameters"), '{"message_id":7}');
	assert.equal(captured.init.body.get("video").name, "clip.mp4");

	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return Response.json({ ok: true, result: { message_id: 2 } });
	};
	try {
		await sendTelegramMedia("123:token", {
			chatId: "-1001",
			kind: "voice",
			bytes: Uint8Array.from([4, 5, 6]),
			filename: "voice.ogg",
			contentType: "audio/ogg",
			durationMs: 8400,
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.match(captured.url, /\/sendVoice$/);
	assert.equal(captured.init.body.get("duration"), "8");
	assert.equal(captured.init.body.get("voice").name, "voice.ogg");
});

test("Telegram 文字回复使用 reply_parameters 指向同群原消息", async () => {
	const originalFetch = globalThis.fetch;
	let captured;
	globalThis.fetch = async (url, init) => {
		captured = { url, init };
		return Response.json({ ok: true, result: { message_id: 3 } });
	};
	try {
		await sendTelegramText("123:token", {
			chatId: "-1001",
			text: "reply",
			replyToMessageId: 2,
		});
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.match(captured.url, /\/sendMessage$/);
	assert.deepEqual(JSON.parse(captured.init.body).reply_parameters, { message_id: 2 });
});

test("Telegram 入站附件在 D1 单存储下不导入，出站附件从 D1 读取并解密", async () => {
	// 入站：D1 只能把附件归属到本地账号，Telegram 消息没有对应本地用户，
	// 因此不下载也不落库，连 Telegram 文件接口都不必调用。
	const originalFetch = globalThis.fetch;
	let fetchCount = 0;
	globalThis.fetch = async () => {
		fetchCount += 1;
		return Response.json({ ok: true, result: {} });
	};
	let imported;
	try {
		imported = await importTelegramAttachment(
			{ EDGECHAT_ENCRYPTION_KEYRING: keyring },
			{
				botToken: "123:token",
				telegramChatId: "-1001",
				telegramMessageId: 9,
				attachment: {
					fileId: "file-id",
					fileName: "voice.ogg",
					mimeType: "audio/ogg",
					fileSize: 4,
					kind: "voice",
					durationMs: 4200,
				},
			},
		);
	} finally {
		globalThis.fetch = originalFetch;
	}
	assert.equal(fetchCount, 0);
	assert.deepEqual(imported, {
		attachment: null,
		skipReason: TELEGRAM_FILE_SKIP_REASON.STORAGE_UNAVAILABLE,
	});

	// 没有附件时不需要给出跳过原因。
	assert.deepEqual(
		await importTelegramAttachment(
			{},
			{
				botToken: "123:token",
				telegramChatId: "-1001",
				telegramMessageId: 10,
				attachment: null,
			},
		),
		{ attachment: null, skipReason: null },
	);

	// 出站：正文以加密信封存在 D1，读取后解密再交给 Telegram。
	const objectKey = "7/voice.ogg";
	const plaintext = Uint8Array.from([1, 2, 3, 4]);
	const envelope = await encryptAttachment(keyring, plaintext, objectKey);
	const db = {
		prepare(sql) {
			return {
				bind() {
					return {
						async first() {
							return sql.includes("FROM uploaded_files")
								? { filename: "voice.ogg", content_type: "audio/ogg", data: envelope }
								: null;
						},
					};
				},
			};
		},
	};
	const loaded = await loadEdgeChatAttachment(
		{ DB: db, EDGECHAT_ENCRYPTION_KEYRING: keyring },
		{
			key: objectKey,
			name: "voice.ogg",
			type: "audio/ogg",
			size: plaintext.byteLength,
			kind: "voice",
			durationMs: 4200,
		},
	);
	assert.deepEqual(loaded.file.bytes, plaintext);
	assert.equal(loaded.file.kind, "voice");
	assert.equal(loaded.file.durationMs, 4200);
	assert.equal(loaded.file.type, "audio/ogg");

	// 行不存在或超出 Bridge 上限时按对应原因跳过。
	const emptyDb = {
		prepare: () => ({ bind: () => ({ async first() { return null; } }) }),
	};
	assert.deepEqual(
		await loadEdgeChatAttachment({ DB: emptyDb }, { key: "missing.bin", size: 4 }),
		{ file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.NOT_FOUND },
	);
	assert.deepEqual(
		await loadEdgeChatAttachment(
			{ DB: emptyDb },
			{ key: "huge.bin", size: TELEGRAM_BRIDGE_FILE_LIMIT + 1 },
		),
		{ file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE },
	);
});

test("可信 Telegram 外部消息可以直接引用 Bridge 创建的 R2 附件", async () => {
	let insertBinds;
	const env = {
		EDGECHAT_ENCRYPTION_KEYRING: keyring,
		DB: {
			prepare(sql) {
				if (sql.includes("uploaded_files")) {
					throw new Error("外部附件不应伪造本地上传归属");
				}
				return {
					bind(...binds) {
						return {
							async run() {
								insertBinds = binds;
								return { meta: { last_row_id: 5 } };
							},
							async all() {
								return {
									results: [{
										id: 5,
										channel_id: 7,
										content: insertBinds[2],
										attachment_key: "telegram/-1001/9-a.bin",
										attachment_name: "a.bin",
										attachment_type: "application/octet-stream",
										attachment_size: 4,
										sender_kind: "external",
										external_sender_id: "42",
										external_sender_name: "Alice",
										source: "telegram",
										source_message_id: "-1001:9",
										created_at: "now",
									}],
								};
							},
						};
					},
				};
			},
		},
	};
	const result = await insertExternalMessage(env, {
		channelId: 7,
		content: "caption",
		attachment: {
			key: "telegram/-1001/9-a.bin",
			name: "a.bin",
			type: "application/octet-stream",
			size: 4,
		},
		externalSender: { id: "42", displayName: "Alice", avatarUrl: "" },
		source: "telegram",
		sourceMessageId: "-1001:9",
		sourceAttachmentId: "file-id",
		sourceAttachmentUniqueId: "unique-id",
	});

	assert.equal(result.created, true);
	assert.equal(result.message.attachment.key, "telegram/-1001/9-a.bin");
	assert.equal(insertBinds[16], "file-id");
	assert.equal(insertBinds[17], "unique-id");
});

test("Bot Token 与 Webhook Secret 使用用途绑定的服务端密文", async () => {
	const env = { EDGECHAT_ENCRYPTION_KEYRING: keyring };
	const encrypted = await encryptSecretValue(env, "123:token", "telegram:bot-token");
	assert.equal(encrypted.includes("123:token"), false);
	assert.equal(await decryptSecretValue(env, encrypted, "telegram:bot-token"), "123:token");
	await assert.rejects(
		decryptSecretValue(env, encrypted, "telegram:webhook-secret"),
		/Encrypted secret authentication failed/,
	);
});

test("外部消息密文绑定来源和外部用户 ID", async () => {
	const env = { EDGECHAT_ENCRYPTION_KEYRING: keyring };
	const encrypted = await encryptMessageContent(env, "telegram message", {
		channelId: 7,
		senderId: 0,
		senderContext: "telegram:42",
	});
	assert.match(encrypted, /^edgechat:enc:v2:/);
	assert.equal(
		await decryptMessageContent(env, encrypted, {
			channelId: 7,
			senderId: 0,
			senderContext: "telegram:42",
		}),
		"telegram message",
	);
	await assert.rejects(
		decryptMessageContent(env, encrypted, {
			channelId: 7,
			senderId: 0,
			senderContext: "telegram:99",
		}),
		/Encrypted message authentication failed/,
	);
});

test("消息 projection 保留 Telegram 来源而不伪造 EdgeChat 账号", () => {
	assert.deepEqual(
			mapMessage({
				id: 12,
				content: "hello",
				mentions_json: "[]",
			created_at: "now",
			sender_kind: "external",
			external_sender_id: "42",
			external_sender_name: "Alice",
			external_sender_avatar_url: null,
			source: "telegram",
		}),
			{
				id: 12,
				content: "hello",
				mentionUserIds: [],
				mentions: [],
			createdAt: "now",
			source: "telegram",
			sender: {
				kind: "external",
				id: "42",
				username: "",
				displayName: "Alice",
					avatarUrl: "/api/integrations/telegram/avatar/42",
				source: "telegram",
			},
			attachment: null,
		},
	);
});

test("Telegram 私有群入站写入映射中的真实房间", async () => {
	const SQL = await initSqlJs();
	const database = new SQL.Database();
	database.exec(readFileSync(new URL("../worker/schema.sql", import.meta.url), "utf8"));
	database.run("INSERT INTO channels (id, name, kind) VALUES (9, 'private-bridge', 'private')");
	const env = {
		DB: createD1Adapter(database),
		EDGECHAT_ENCRYPTION_KEYRING: keyring,
	};

	const result = await ingestTelegramMessage(env, {
		mapping: { channelId: 9, channelName: "Private bridge", channelKind: "private" },
		telegramMessage: {
			sourceMessageId: "-100900:1",
			replySourceMessageId: null,
			telegramChatId: "-100900",
			telegramMessageId: 1,
			content: "private inbound",
			attachment: null,
			sender: { id: "42", displayName: "Alice", avatarUrl: "" },
		},
		botToken: "",
	});

	assert.equal(result.created, true);
	const row = database.exec(
		"SELECT channel_id, content, sender_kind, external_sender_id FROM messages WHERE id = ?",
		[result.message.id],
	)[0].values[0];
	assert.equal(Number(row[0]), 9);
	assert.equal(row[2], "external");
	assert.equal(row[3], "42");
	// 正文以绑定来源的密文落库，明文不写入数据库。
	assert.equal(String(row[1]).includes("private inbound"), false);
	database.close();
});

test("Telegram webhook 公开接收而后台配置仍要求登录", async () => {
	const env = {
		DB: {
			prepare() {
				return {
					bind() {
						return this;
					},
					async all() {
						return { results: [] };
					},
				};
			},
		},
		SESSIONS: {
			async get() {
				return null;
			},
		},
	};
	const webhookResponse = await worker.fetch(
		new Request("https://example.com/api/integrations/telegram/webhook", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: "{}",
		}),
		env,
		{},
	);
	const adminResponse = await worker.fetch(
		new Request("https://example.com/api/admin/telegram"),
		env,
		{},
	);

	assert.equal(webhookResponse.status, 503);
	assert.deepEqual(await webhookResponse.json(), { error: "Telegram Bridge 未配置" });
	assert.equal(adminResponse.status, 401);
	assert.deepEqual(await adminResponse.json(), { error: "请先登录" });
});
