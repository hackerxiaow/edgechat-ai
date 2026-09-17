import type { Message, PersistMessageInput, PersistMessageResult } from "./data/messages.ts";
import type { RoomMeta } from "./types.ts";
import { insertMessage, insertMessageIdempotent } from "./data/messages.ts";
import { resolveMessageMentionUserIds } from "./data/mentions.ts";
import { resolveMessageReply, type ReplyReference } from "./data/replies.ts";
import { getDirectMessageBlockStatus } from "./data/user-blocks.ts";

export class MessageSubmissionError extends Error {
	code: string;
	status: number;

	constructor(message: string, code = "invalid_request", status = 400) {
		super(message);
		this.name = "MessageSubmissionError";
		this.code = code;
		this.status = status;
	}
}

export interface MessageSubmissionPayload {
	content?: string;
	attachment?: unknown;
	mentionUserIds?: unknown;
	replyMessageId?: unknown;
	clientMessageId?: string | null;
	forwardFromName?: string | null;
}

export interface MessageSubmissionResult {
	message: Message | null;
	created: boolean;
	replyToSenderId: number | null;
	packet: string;
}

interface DmBlockStatus {
	blockedByPeer?: boolean;
	blockedBySender?: boolean;
}

type PersistMessageFn = (
	env: { DB: D1Database },
	payload: PersistMessageInput,
) => Promise<Message | null | PersistMessageResult>;
type ResolveMentionsFn = (
	db: D1Database,
	args: {
		channelId: number | string;
		roomKind: string;
		senderId: number | string;
		content: string;
		candidateUserIds: unknown;
	},
) => Promise<number[]>;
type ResolveReplyFn = (
	db: D1Database,
	args: { channelId: number | string; replyMessageId: unknown },
) => Promise<ReplyReference>;
type DmBlockStatusFn = (
	db: D1Database,
	channelId: number,
	senderId: number,
) => Promise<DmBlockStatus>;

export function createMessageSubmission({
	persistMessage = insertMessage,
	resolveMentions = resolveMessageMentionUserIds,
	resolveReply = resolveMessageReply,
	resolveDmBlockStatus = getDirectMessageBlockStatus as DmBlockStatusFn,
}: {
	persistMessage?: PersistMessageFn;
	resolveMentions?: ResolveMentionsFn;
	resolveReply?: ResolveReplyFn;
	resolveDmBlockStatus?: DmBlockStatusFn;
} = {}) {
	return async function submitRoomMessage(
		env: { DB: D1Database },
		meta: RoomMeta,
		payload: MessageSubmissionPayload,
	): Promise<MessageSubmissionResult> {
		try {
			if (meta.room.kind === "dm") {
				const blockStatus = await resolveDmBlockStatus(
					env.DB,
					Number(meta.room.id),
					Number(meta.principal.userId),
				);
				if (blockStatus.blockedByPeer) {
					throw new MessageSubmissionError(
						"发送被拒，你已经被拉黑",
						"blocked_by_recipient",
						403,
					);
				}
				if (blockStatus.blockedBySender) {
					throw new MessageSubmissionError(
						"请先解除拉黑再发送",
						"recipient_blocked",
						403,
					);
				}
			}
			const [mentionUserIds, reply] = await Promise.all([
				resolveMentions(env.DB, {
					channelId: meta.room.id,
					roomKind: meta.room.kind,
					senderId: meta.principal.userId,
					content: String(payload.content ?? ""),
					candidateUserIds: payload.mentionUserIds,
				}),
				resolveReply(env.DB, {
					channelId: meta.room.id,
					replyMessageId: payload.replyMessageId,
				}),
			]);
					const persistencePayload: PersistMessageInput = {
						channelId: meta.room.id,
						senderId: meta.principal.userId,
						content: String(payload.content ?? ""),
						attachment: payload.attachment,
						mentionUserIds,
					};
				if (payload.forwardFromName) {
					persistencePayload.forwardFromName = payload.forwardFromName;
				}
			if (reply.messageId) {
				persistencePayload.replyToMessageId = reply.messageId;
				persistencePayload.replyToSenderId = reply.senderId;
			}
			if (payload.clientMessageId) {
				persistencePayload.clientMessageId = payload.clientMessageId;
			}
			const persisted = await persistMessage(env, persistencePayload);
			const message = (persisted as PersistMessageResult)?.message || (persisted as Message | null);
			const created = (persisted as PersistMessageResult)?.message
				? (persisted as PersistMessageResult).created !== false
				: true;
			return {
				message,
				created,
				replyToSenderId: reply.senderId,
				packet: JSON.stringify({ protocolVersion: 1, type: "message", message }),
			};
		} catch (error) {
			const errorMessage = String((error as { message?: unknown })?.message || "");
			if (
				errorMessage === "Invalid attachment" ||
				errorMessage === "Attachment is not available"
			) {
				throw new MessageSubmissionError(
					"附件不存在、无权使用或正在清理，请重新上传",
					"attachment_unavailable",
				);
			}
			if (errorMessage === "Message content cannot be empty") {
				throw new MessageSubmissionError("消息内容不能为空");
			}
			if (errorMessage === "Message idempotency key was already consumed") {
				throw new MessageSubmissionError(
					"该消息已删除，不能使用相同的 clientMessageId 再次发送",
					"client_message_id_consumed",
					409,
				);
			}
			if (errorMessage === "Reply message is not available") {
				throw new MessageSubmissionError(
					"回复的消息不存在或已删除",
					"reply_message_unavailable",
				);
			}
			throw error;
		}
	};
}

export const submitRoomMessage = createMessageSubmission();
export const submitRoomMessageIdempotent = createMessageSubmission({
	persistMessage: insertMessageIdempotent,
});
