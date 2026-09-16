import { decryptMessageContent, encryptMessageContent } from "../encryption.ts";
import type { AppBindings } from "../types.ts";
import { pickAttachment, publicFileUrl } from "../utils.ts";
import { normalizeMentionUserIds } from "./mentions.ts";
import { fileBelongsToUser, isR2ObjectUnavailableError } from "./uploaded-files.ts";

export type AttachmentKind = "voice" | "audio";

export interface MessageAttachment {
	key: string;
	name: string;
	type: string;
	size: number;
	url: string;
	kind?: AttachmentKind;
	durationMs?: number;
	waveform?: number[];
}

export interface MessageSender {
	kind: "local" | "external";
	id: number | string;
	username: string;
	displayName: string;
	avatarUrl: string;
	source: string;
}

export interface MessageMentionSummary {
	userId: number;
	username: string;
	displayName: string;
}

export interface MessageReplyTarget {
	id: number;
	deleted: boolean;
	content?: string;
	sender?: MessageSender;
	attachment?: MessageAttachment | null;
}

export interface Message {
	id: number;
	content: string;
	mentionUserIds: number[];
	mentions: MessageMentionSummary[];
	createdAt: string;
	source: string;
	sender: MessageSender;
	attachment: MessageAttachment | null;
	clientMessageId?: string;
	replyToMessageId?: number;
	replyTo?: MessageReplyTarget;
}

/** MESSAGE_SELECT 的投影结果。 */
export interface MessageRow {
	id: number;
	channel_id: number;
	content: string;
	attachment_key: string | null;
	attachment_name: string | null;
	attachment_type: string | null;
	attachment_size: number | null;
	attachment_kind: string | null;
	attachment_duration_ms: number | null;
	attachment_waveform: string | null;
	sender_kind: string | null;
	external_sender_id: string | null;
	external_sender_name: string | null;
	external_sender_avatar_url: string | null;
	source: string | null;
	source_message_id: string | null;
	source_attachment_id: string | null;
	source_attachment_unique_id: string | null;
	client_message_id: string | null;
	mention_user_ids: string | null;
	reply_to_message_id: number | null;
	reply_to_sender_id: number | null;
	created_at: string;
	sender_id: number | null;
	sender_username: string | null;
	sender_display_name: string | null;
	sender_avatar_key: string | null;
	reply_message_id: number | null;
	reply_content: string | null;
	reply_deleted_at: string | null;
	reply_attachment_key: string | null;
	reply_attachment_name: string | null;
	reply_attachment_type: string | null;
	reply_attachment_size: number | null;
	reply_attachment_kind: string | null;
	reply_attachment_duration_ms: number | null;
	reply_sender_kind: string | null;
	reply_external_sender_id: string | null;
	reply_external_sender_name: string | null;
	reply_external_sender_avatar_url: string | null;
	reply_source: string | null;
	reply_sender_id: number | null;
	reply_sender_username: string | null;
	reply_sender_display_name: string | null;
	reply_sender_avatar_key: string | null;
	mentions_json: string | null;
}

/** 由上游提交入口构造的持久化参数；本地与外部消息共用同一形状。 */
export interface PersistMessageInput {
	channelId: number | string;
	senderId?: number | string | null;
	externalSender?: {
		id?: string | number;
		displayName?: string;
		username?: string;
		avatarUrl?: string;
	} | null;
	content: string;
	attachment?: unknown;
	source?: string;
	sourceMessageId?: string | null;
	sourceAttachmentId?: string | null;
	sourceAttachmentUniqueId?: string | null;
	clientMessageId?: string | null;
	mentionUserIds?: unknown;
	replyToMessageId?: number | string | null;
	replyToSenderId?: number | string | null;
}

export interface PersistMessageResult {
	message: Message | null;
	created: boolean;
}

/** 同步游标落后于已压缩区间时抛出，路由层据此返回 409。 */
export class RoomSyncCursorExpiredError extends Error {
	readonly code = "sync_cursor_expired";
	readonly status = 409;
	constructor() {
		super("Room sync cursor expired");
		this.name = "RoomSyncCursorExpiredError";
	}
}

type MessageEnv = Pick<AppBindings, "DB">;

function toNullableNumber(value: unknown): number | null {
	const number = Number(value);
	return Number.isFinite(number) ? number : null;
}

function mapAttachment(row: MessageRow): MessageAttachment | null {
	if (!row.attachment_key) return null;
	const attachment: MessageAttachment = {
		key: row.attachment_key,
		name: row.attachment_name ?? "",
		type: row.attachment_type ?? "",
		size: toNullableNumber(row.attachment_size) || 0,
		url: publicFileUrl(row.attachment_key),
	};
	if (row.attachment_kind === "voice" || row.attachment_kind === "audio") {
		attachment.kind = row.attachment_kind;
		attachment.durationMs = toNullableNumber(row.attachment_duration_ms) || 0;
		if (row.attachment_kind === "voice") {
			attachment.waveform = JSON.parse(row.attachment_waveform || "[]");
		}
	}
	return attachment;
}

function mapReplyAttachment(row: MessageRow): MessageAttachment | null {
	if (!row.reply_attachment_key) return null;
	const attachment: MessageAttachment = {
		key: row.reply_attachment_key,
		name: row.reply_attachment_name ?? "",
		type: row.reply_attachment_type ?? "",
		size: toNullableNumber(row.reply_attachment_size) || 0,
		url: publicFileUrl(row.reply_attachment_key),
	};
	if (row.reply_attachment_kind === "voice" || row.reply_attachment_kind === "audio") {
		attachment.kind = row.reply_attachment_kind;
		attachment.durationMs = toNullableNumber(row.reply_attachment_duration_ms) || 0;
	}
	return attachment;
}

function mapReplySender(row: MessageRow): MessageSender {
	const isExternal = row.reply_sender_kind === "external";
	const isTelegramExternal = isExternal && row.reply_source === "telegram";
	return {
		kind: isExternal ? "external" : "local",
		id: isExternal ? String(row.reply_external_sender_id || "") : Number(row.reply_sender_id),
		username: isExternal ? "" : row.reply_sender_username ?? "",
		displayName: (isExternal ? row.reply_external_sender_name : row.reply_sender_display_name) ?? "",
		avatarUrl: isExternal
			? isTelegramExternal
				? `/api/integrations/telegram/avatar/${row.reply_external_sender_id}`
				: row.reply_external_sender_avatar_url || ""
			: row.reply_sender_avatar_key
				? publicFileUrl(row.reply_sender_avatar_key)
				: "",
		source: (isExternal ? row.reply_source : "edgechat") ?? "edgechat",
	};
}

export function mapMessage(
	row: MessageRow,
	content: string = row.content,
	replyTo: MessageReplyTarget | null = null,
): Message {
	const isExternal = row.sender_kind === "external";
	const isTelegramExternal = isExternal && row.source === "telegram";
	const mentions: MessageMentionSummary[] = JSON.parse(row.mentions_json || "[]").map(
		(mention: { userId: unknown; username: string; displayName: string }) => ({
			userId: Number(mention.userId),
			username: mention.username,
			displayName: mention.displayName,
		}),
	);
	const message: Message = {
		id: Number(row.id),
		content,
		mentionUserIds: normalizeMentionUserIds(JSON.parse(row.mention_user_ids || "[]")),
		mentions,
		createdAt: row.created_at,
		source: row.source || "edgechat",
		sender: {
			kind: isExternal ? "external" : "local",
			id: isExternal ? String(row.external_sender_id || "") : Number(row.sender_id),
			username: isExternal ? "" : row.sender_username ?? "",
			displayName: (isExternal ? row.external_sender_name : row.sender_display_name) ?? "",
			avatarUrl: isExternal
				? isTelegramExternal
					? `/api/integrations/telegram/avatar/${row.external_sender_id}`
					: row.external_sender_avatar_url || ""
				: row.sender_avatar_key
					? publicFileUrl(row.sender_avatar_key)
					: "",
			source: (isExternal ? row.source : "edgechat") ?? "edgechat",
		},
		attachment: mapAttachment(row),
	};
	if (row.client_message_id) {
		message.clientMessageId = row.client_message_id;
	}
	if (row.reply_to_message_id) {
		message.replyToMessageId = Number(row.reply_to_message_id);
		message.replyTo = replyTo || {
			id: Number(row.reply_to_message_id),
			deleted: true,
		};
	}
	return message;
}

export async function externalSenderExists(
	db: D1Database,
	source: string,
	senderId: number | string,
): Promise<boolean> {
	const { results } = await db
		.prepare(
			`SELECT 1 AS found
			 FROM messages
			 WHERE sender_kind = 'external'
			   AND source = ?
			   AND external_sender_id = ?
			   AND deleted_at IS NULL
			 LIMIT 1`,
		)
		.bind(String(source), String(senderId))
		.all<{ found: number }>();
	return Boolean(results[0]);
}

// 加密层对认证失败保持抛错；这里逐条降级，避免单条坏消息让整个房间返回 500。
const UNDECRYPTABLE_PLACEHOLDER = '（该消息无法解密）';

interface DecryptContext {
	channelId: number;
	senderId: number;
	senderContext: string;
}

async function decryptMessageContentSafely(
	env: MessageEnv,
	value: string | null,
	context: DecryptContext,
): Promise<string> {
	try {
		return await decryptMessageContent(env, value, context);
	} catch (error) {
		console.error('Failed to decrypt message content', { error, channelId: context.channelId });
		return UNDECRYPTABLE_PLACEHOLDER;
	}
}

async function mapDecryptedMessage(env: MessageEnv, row: MessageRow): Promise<Message> {
	const content = await decryptMessageContentSafely(env, row.content, {
		channelId: row.channel_id,
		senderId: row.sender_id ?? 0,
		senderContext:
			row.sender_kind === "external" ? `${row.source}:${row.external_sender_id}` : "",
	});
	let replyTo: MessageReplyTarget | null = null;
	if (row.reply_to_message_id) {
		const replyId = Number(row.reply_to_message_id);
		if (!row.reply_message_id || row.reply_deleted_at) {
			replyTo = { id: replyId, deleted: true };
		} else {
			const replyContent = await decryptMessageContentSafely(env, row.reply_content, {
				channelId: row.channel_id,
				senderId: row.reply_sender_id ?? 0,
				senderContext:
					row.reply_sender_kind === "external"
						? `${row.reply_source}:${row.reply_external_sender_id}`
						: "",
			});
			replyTo = {
				id: replyId,
				deleted: false,
				content: replyContent,
				sender: mapReplySender(row),
				attachment: mapReplyAttachment(row),
			};
		}
	}
	return mapMessage(row, content, replyTo);
}

const MESSAGE_SELECT = `SELECT
		  m.id, m.channel_id, m.content, m.attachment_key, m.attachment_name, m.attachment_type,
		  m.attachment_size, m.attachment_kind, m.attachment_duration_ms, m.attachment_waveform,
		  m.sender_kind, m.external_sender_id, m.external_sender_name,
		  m.external_sender_avatar_url, m.source, m.source_message_id,
		  m.source_attachment_id, m.source_attachment_unique_id, m.client_message_id,
			  m.mention_user_ids, m.reply_to_message_id, m.reply_to_sender_id, m.created_at,
		  u.id AS sender_id, u.username AS sender_username,
		  u.display_name AS sender_display_name, u.avatar_key AS sender_avatar_key,
		  reply.id AS reply_message_id, reply.content AS reply_content,
		  reply.deleted_at AS reply_deleted_at,
		  reply.attachment_key AS reply_attachment_key,
		  reply.attachment_name AS reply_attachment_name,
		  reply.attachment_type AS reply_attachment_type,
		  reply.attachment_size AS reply_attachment_size,
		  reply.attachment_kind AS reply_attachment_kind,
		  reply.attachment_duration_ms AS reply_attachment_duration_ms,
		  reply.sender_kind AS reply_sender_kind,
		  reply.external_sender_id AS reply_external_sender_id,
		  reply.external_sender_name AS reply_external_sender_name,
		  reply.external_sender_avatar_url AS reply_external_sender_avatar_url,
		  reply.source AS reply_source,
		  reply_user.id AS reply_sender_id,
		  reply_user.username AS reply_sender_username,
		  reply_user.display_name AS reply_sender_display_name,
		  reply_user.avatar_key AS reply_sender_avatar_key,
	  COALESCE((
	    SELECT json_group_array(json_object(
	      'userId', mentioned.id,
	      'username', mentioned.username,
	      'displayName', mentioned.display_name
	    ))
	    FROM json_each(COALESCE(m.mention_user_ids, '[]')) mention_ids
	    JOIN users mentioned ON mentioned.id = CAST(mention_ids.value AS INTEGER)
		 ), '[]') AS mentions_json
	 FROM messages m
	 LEFT JOIN users u ON u.id = m.sender_id
	 LEFT JOIN messages reply ON reply.id = m.reply_to_message_id
	 LEFT JOIN users reply_user ON reply_user.id = reply.sender_id`;

export interface MessageDeletionTarget {
	id: number;
	channel_id: number;
	sender_id: number | null;
	source: string | null;
	sender_kind: string | null;
	attachment_key: string | null;
	channel_kind: string;
}

export async function getMessageDeletionTarget(
	db: D1Database,
	messageId: number | string,
): Promise<MessageDeletionTarget | null> {
	const { results } = await db
		.prepare(
			`SELECT m.id, m.channel_id, m.sender_id, m.source, m.sender_kind, m.attachment_key,
			        c.kind AS channel_kind
			 FROM messages m
			 JOIN channels c ON c.id = m.channel_id
			 WHERE m.id = ?
			   AND m.deleted_at IS NULL
			 LIMIT 1`,
		)
		.bind(Number(messageId))
		.all<MessageDeletionTarget>();
	return results[0] || null;
}

export async function listMessages(
	env: MessageEnv,
	roomId: number | string,
	before: number | string | null = null,
	limit: number | string = 30,
	visibility?: { mode: string; joinedAt: string }
): Promise<Message[]> {
	const filters = ["m.channel_id = ?", "m.deleted_at IS NULL"];
	const binds: (number | string)[] = [Number(roomId)];
	if (visibility?.mode === 'hidden') {
		filters.push("m.created_at >= ?");
		binds.push(visibility.joinedAt);
	}
	if (before) {
		filters.push("m.id < ?");
		binds.push(Number(before));
	}
	const { results } = await env.DB.prepare(
		`${MESSAGE_SELECT} WHERE ${filters.join(" AND ")} ORDER BY m.id DESC LIMIT ?`,
	)
		.bind(...binds, Number(limit))
		.all<MessageRow>();
	return (await Promise.all(results.map((row) => mapDecryptedMessage(env, row)))).reverse();
}

export async function getMessageById(
	env: MessageEnv,
	messageId: number | string,
): Promise<Message | null> {
	const { results } = await env.DB.prepare(
		`${MESSAGE_SELECT} WHERE m.id = ? AND m.deleted_at IS NULL LIMIT 1`,
	)
		.bind(Number(messageId))
		.all<MessageRow>();
	return results[0] ? mapDecryptedMessage(env, results[0]) : null;
}

export async function getMessageBySource(
	env: MessageEnv,
	source: string,
	sourceMessageId: string,
): Promise<Message | null> {
	const { results } = await env.DB.prepare(
		`${MESSAGE_SELECT}
		 WHERE m.source = ? AND m.source_message_id = ?
		 LIMIT 1`,
	)
		.bind(String(source), String(sourceMessageId))
		.all<MessageRow>();
	return results[0] ? mapDecryptedMessage(env, results[0]) : null;
}

export async function getMessageByClientId(
	env: MessageEnv,
	channelId: number | string,
	senderId: number | string | null,
	clientMessageId: string,
): Promise<Message | null> {
	const { results } = await env.DB.prepare(
		`${MESSAGE_SELECT}
		 WHERE m.channel_id = ?
		   AND m.sender_id = ?
		   AND m.client_message_id = ?
		   AND m.deleted_at IS NULL
		 LIMIT 1`,
	)
		.bind(Number(channelId), Number(senderId), String(clientMessageId))
		.all<MessageRow>();
	return results[0] ? mapDecryptedMessage(env, results[0]) : null;
}

async function hasConsumedClientMessageId(
	db: D1Database,
	channelId: number | string,
	senderId: number | string | null,
	clientMessageId: string,
): Promise<boolean> {
	const { results } = await db
		.prepare(
			`SELECT id
			 FROM messages
			 WHERE channel_id = ? AND sender_id = ? AND client_message_id = ?
			 LIMIT 1`,
		)
		.bind(Number(channelId), Number(senderId), String(clientMessageId))
		.all<{ id: number }>();
	return Boolean(results[0]);
}

export async function getRoomSyncCursor(
	db: D1Database,
	channelId: number | string,
): Promise<number> {
	const { results } = await db
		.prepare(
			`SELECT MAX(sequence) AS sequence
			 FROM (
			   SELECT COALESCE(MAX(sequence), 0) AS sequence
			   FROM message_events
			   WHERE channel_id = ?
			   UNION ALL
			   SELECT COALESCE(MAX(compacted_through), 0) AS sequence
			   FROM message_event_compaction
			   WHERE channel_id = ?
			 )`,
		)
		.bind(Number(channelId), Number(channelId))
		.all<{ sequence: number }>();
	return Number(results[0]?.sequence || 0);
}

export async function getRoomCompactedCursor(
	db: D1Database,
	channelId: number | string,
): Promise<number> {
	const { results } = await db
		.prepare(
			`SELECT compacted_through
			 FROM message_event_compaction
			 WHERE channel_id = ?
			 LIMIT 1`,
		)
		.bind(Number(channelId))
		.all<{ compacted_through: number }>();
	return Number(results[0]?.compacted_through || 0);
}

export type RoomMessageEvent =
	| { sequence: number; type: "message_deleted"; messageId: number; createdAt: string }
	| { sequence: number; type: "message" | "message_updated"; message: Message; createdAt: string };

export interface RoomMessageEventsPage {
	events: RoomMessageEvent[];
	nextCursor: number;
	hasMore: boolean;
}

export async function listRoomMessageEvents(
	env: MessageEnv,
	channelId: number | string,
	afterSequence: number | string = 0,
	limit: number | string = 100,
	visibility?: { mode: string; joinedAt: string }
): Promise<RoomMessageEventsPage> {
	const normalizedCursor = Number(afterSequence) || 0;
	const compactedThrough = await getRoomCompactedCursor(env.DB, channelId);
	if (normalizedCursor < compactedThrough) {
		throw new RoomSyncCursorExpiredError();
	}
	const pageSize = Math.min(Math.max(Number(limit) || 100, 1), 100);
	const { results } = await env.DB.prepare(
		`SELECT sequence, message_id, event_type, created_at
		 FROM message_events
		 WHERE channel_id = ? AND sequence > ?
		 ORDER BY sequence ASC
		 LIMIT ?`,
	)
		.bind(Number(channelId), normalizedCursor, pageSize + 1)
		.all<{ sequence: number; message_id: number; event_type: string; created_at: string }>();
	const page = results.slice(0, pageSize);
	const events: RoomMessageEvent[] = [];
	for (const row of page) {
		if (row.event_type === "deleted") {
			events.push({
				sequence: Number(row.sequence),
				type: "message_deleted",
				messageId: Number(row.message_id),
				createdAt: row.created_at,
			});
			continue;
		}
		if (row.event_type === "updated") {
			const message = await getMessageById(env, row.message_id);
			if (message) {
				events.push({
					sequence: Number(row.sequence),
					type: "message_updated",
					message,
					createdAt: row.created_at,
				});
			}
			continue;
		}
		const message = await getMessageById(env, row.message_id);
		if (message) {
			events.push({
				sequence: Number(row.sequence),
				type: "message",
				message,
				createdAt: row.created_at,
			});
		}
	}
	return {
		events,
		nextCursor: page.length
			? Number(page[page.length - 1].sequence)
			: normalizedCursor,
		hasMore: results.length > pageSize,
	};
}

export async function softDeleteMessage(
	db: D1Database,
	{ channelId, messageId }: { channelId: number | string; messageId: number | string },
): Promise<boolean> {
	const result = await db
		.prepare(
			`UPDATE messages
			 SET deleted_at = CURRENT_TIMESTAMP
			 WHERE id = ?
			   AND channel_id = ?
			   AND deleted_at IS NULL`,
		)
		.bind(Number(messageId), Number(channelId))
		.run();
	return Number(result.meta?.changes || 0) > 0;
}

interface CleanAttachment {
	key: string;
	name: string;
	type: string;
	size: number;
	kind?: AttachmentKind;
	durationMs?: number;
	waveform?: number[];
}

async function persistMessage(
	env: MessageEnv,
	{
		channelId,
		senderId = null,
		externalSender = null,
		content,
		attachment = null,
		source = "edgechat",
		sourceMessageId = null,
		sourceAttachmentId = null,
		sourceAttachmentUniqueId = null,
		clientMessageId = null,
		mentionUserIds = [],
		replyToMessageId = null,
		replyToSenderId = null,
	}: PersistMessageInput,
): Promise<PersistMessageResult> {
	const isExternal = externalSender !== null;
	const normalizedSenderId = isExternal ? null : Number(senderId);
	const hasAttachment = attachment !== undefined && attachment !== null;
	// 外部附件只能从已验证的内部 Bridge 入口进入；本地客户端仍必须通过上传归属校验。
	const cleanAttachment = pickAttachment(
		attachment,
		isExternal ? {} : { ownerUserId: normalizedSenderId },
	) as CleanAttachment | null;
	const cleanContent = String(content || "").trim();
	if (hasAttachment && !cleanAttachment) {
		throw new Error("Invalid attachment");
	}
	if (
		!isExternal &&
		cleanAttachment &&
		!(await fileBelongsToUser(env.DB, cleanAttachment.key, normalizedSenderId as number))
	) {
		throw new Error("Attachment is not available");
	}
	if (!cleanContent && !cleanAttachment) {
		throw new Error("Message content cannot be empty");
	}
	const externalId = isExternal ? String(externalSender.id || "").trim() : "";
	const externalName = isExternal ? String(externalSender.displayName || "").trim() : "";
	if (isExternal && (!externalId || !externalName || !sourceMessageId)) {
		throw new Error("External sender is incomplete");
	}

	const storedContent = await encryptMessageContent(env, cleanContent, {
		channelId,
		senderId: normalizedSenderId ?? 0,
		senderContext: isExternal ? `${source}:${externalId}` : "",
	});
	const normalizedClientMessageId = isExternal
		? null
		: String(clientMessageId || "").trim() || null;
	const storedMentionUserIds = JSON.stringify(
		isExternal ? [] : normalizeMentionUserIds(mentionUserIds),
	);
	const normalizedReplyToMessageId = replyToMessageId ? Number(replyToMessageId) : null;
	const normalizedReplyToSenderId = replyToSenderId ? Number(replyToSenderId) : null;
	try {
		const result = await env.DB
			.prepare(
				`INSERT INTO messages (
				   channel_id, sender_id, content, attachment_key, attachment_name,
				   attachment_type, attachment_size, attachment_kind, attachment_duration_ms,
				   attachment_waveform, sender_kind, external_sender_id,
					   external_sender_name, external_sender_avatar_url, source, source_message_id,
					   source_attachment_id, source_attachment_unique_id, client_message_id,
						   mention_user_ids, reply_to_message_id, reply_to_sender_id
						 ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
			)
			.bind(
				Number(channelId),
				normalizedSenderId,
				storedContent,
				cleanAttachment?.key || null,
				cleanAttachment?.name || null,
				cleanAttachment?.type || null,
				cleanAttachment?.size || null,
				cleanAttachment?.kind || null,
				cleanAttachment?.kind === "voice" || cleanAttachment?.kind === "audio"
					? cleanAttachment.durationMs
					: null,
				cleanAttachment?.kind === "voice"
					? JSON.stringify(cleanAttachment.waveform)
					: null,
				isExternal ? "external" : "local",
				isExternal ? externalId : null,
				isExternal ? externalName : null,
				isExternal ? String(externalSender.avatarUrl || "") : null,
				String(source || "edgechat"),
				sourceMessageId ? String(sourceMessageId) : null,
				sourceAttachmentId ? String(sourceAttachmentId) : null,
				sourceAttachmentUniqueId ? String(sourceAttachmentUniqueId) : null,
				normalizedClientMessageId,
				storedMentionUserIds,
				normalizedReplyToMessageId,
				normalizedReplyToSenderId,
			)
			.run();
		return {
			message: await getMessageById(env, Number(result.meta.last_row_id ?? 0)),
			created: true,
		};
	} catch (error) {
		if (isR2ObjectUnavailableError(error)) {
			throw new Error("Attachment is not available");
		}
		const message = String((error as { message?: unknown })?.message || error);
		if (sourceMessageId && message.includes("UNIQUE")) {
			const existing = await getMessageBySource(env, source, sourceMessageId);
			if (existing) {
				return { message: existing, created: false };
			}
		}
		if (normalizedClientMessageId && message.includes("UNIQUE")) {
			const existing = await getMessageByClientId(
				env,
				channelId,
				normalizedSenderId,
				normalizedClientMessageId,
			);
			if (existing) {
				return { message: existing, created: false };
			}
			if (
				await hasConsumedClientMessageId(
					env.DB,
					channelId,
					normalizedSenderId,
					normalizedClientMessageId,
				)
			) {
				throw new Error("Message idempotency key was already consumed");
			}
		}
		throw error;
	}
}

export async function insertMessage(
	env: MessageEnv,
	{
		channelId,
		senderId,
		content,
		attachment,
		clientMessageId = null,
		mentionUserIds = [],
		replyToMessageId = null,
		replyToSenderId = null,
	}: PersistMessageInput,
): Promise<Message | null> {
	const result = await persistMessage(env, {
		channelId,
		senderId,
		content,
		attachment,
		clientMessageId,
		mentionUserIds,
		replyToMessageId,
		replyToSenderId,
	});
	return result.message;
}

export function insertMessageIdempotent(
	env: MessageEnv,
	payload: PersistMessageInput,
): Promise<PersistMessageResult> {
	return persistMessage(env, payload);
}

export function insertExternalMessage(
	env: MessageEnv,
	payload: PersistMessageInput,
): Promise<PersistMessageResult> {
	return persistMessage(env, payload);
}
