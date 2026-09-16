export interface ReplyReference {
	messageId: number | null;
	senderId: number | null;
}

export interface MessageSourceReference {
	source: string;
	sourceMessageId: string;
}

function normalizeReplyMessageId(value: unknown): number | null {
	if (value === null || value === undefined || value === "") {
		return null;
	}
	const messageId = Number(value);
	if (!Number.isInteger(messageId) || messageId <= 0) {
		throw new Error("Reply message is not available");
	}
	return messageId;
}

interface ReplyRow {
	id: number;
	sender_id: number | null;
}

function mapReplyReference(row: ReplyRow): ReplyReference {
	return {
		messageId: Number(row.id),
		senderId: row.sender_id === null || row.sender_id === undefined
			? null
			: Number(row.sender_id),
	};
}

export async function resolveMessageReply(
	db: D1Database,
	{ channelId, replyMessageId }: { channelId: number | string; replyMessageId: unknown },
): Promise<ReplyReference> {
	const messageId = normalizeReplyMessageId(replyMessageId);
	if (messageId === null) {
		return { messageId: null, senderId: null };
	}
	const { results } = await db
		.prepare(
			`SELECT id, sender_id
			 FROM messages
			 WHERE id = ? AND channel_id = ? AND deleted_at IS NULL
			 LIMIT 1`,
		)
		.bind(messageId, Number(channelId))
		.all<ReplyRow>();
	if (!results[0]) {
		throw new Error("Reply message is not available");
	}
	return mapReplyReference(results[0]);
}

export async function findMessageReplyBySource(
	db: D1Database,
	{
		channelId,
		source,
		sourceMessageId,
	}: { channelId: number | string; source: string; sourceMessageId: unknown },
): Promise<ReplyReference | null> {
	if (!sourceMessageId) return null;
	const { results } = await db
		.prepare(
			`SELECT id, sender_id
			 FROM messages
			 WHERE channel_id = ? AND source = ? AND source_message_id = ? AND deleted_at IS NULL
			 LIMIT 1`,
		)
		.bind(Number(channelId), String(source), String(sourceMessageId))
		.all<ReplyRow>();
	return results[0] ? mapReplyReference(results[0]) : null;
}

export async function getMessageSourceReference(
	db: D1Database,
	{ channelId, messageId }: { channelId: number | string; messageId: unknown },
): Promise<MessageSourceReference | null> {
	const normalizedMessageId = normalizeReplyMessageId(messageId);
	if (normalizedMessageId === null) return null;
	const { results } = await db
		.prepare(
			`SELECT source, source_message_id
			 FROM messages
			 WHERE id = ? AND channel_id = ? AND deleted_at IS NULL
			 LIMIT 1`,
		)
		.bind(normalizedMessageId, Number(channelId))
		.all<{ source: string | null; source_message_id: string | null }>();
	if (!results[0]?.source_message_id) return null;
	return {
		source: String(results[0].source || "edgechat"),
		sourceMessageId: String(results[0].source_message_id),
	};
}
