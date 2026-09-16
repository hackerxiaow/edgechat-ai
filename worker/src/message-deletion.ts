import type { RoomMeta, SessionUser } from "./types.ts";
import { cleanupR2Keys } from "./gc.js";
import {
	getMessageDeletionTarget,
	softDeleteMessage,
	type MessageDeletionTarget,
} from "./data/messages.ts";
import { authorizeMessageModeration } from "./room-access.ts";

export class MessageDeletionError extends Error {
	code?: string;
	status?: number;

	constructor(message: string) {
		super(message);
		this.name = "MessageDeletionError";
	}
}

export interface MessageDeletionResult {
	messageId: number;
	packet: string;
	cleanupPromise: Promise<unknown> | null;
}

type AuthorizeFn = (
	db: D1Database,
	principal: SessionUser,
	kind: string,
	roomId: number | string,
) => Promise<{ ok: boolean }>;
type PersistDeletionFn = (
	db: D1Database,
	args: { channelId: number | string; messageId: number },
) => Promise<boolean>;
type GetDeletionTargetFn = (
	db: D1Database,
	messageId: number,
) => Promise<MessageDeletionTarget | null>;
type CleanupFn = (env: unknown, keys: string[]) => Promise<unknown>;

export function createMessageDeletion({
	authorize = authorizeMessageModeration as AuthorizeFn,
	persistDeletion = softDeleteMessage,
	getDeletionTarget = getMessageDeletionTarget,
	cleanupAttachments = cleanupR2Keys,
}: {
	authorize?: AuthorizeFn;
	persistDeletion?: PersistDeletionFn;
	getDeletionTarget?: GetDeletionTargetFn;
	cleanupAttachments?: CleanupFn;
} = {}) {
	return async function deleteRoomMessage(
		env: { DB: D1Database },
		meta: RoomMeta,
		payload: { messageId: unknown },
	): Promise<MessageDeletionResult> {
		const messageId = Number(payload.messageId);
		if (!Number.isInteger(messageId) || messageId <= 0) {
			throw new MessageDeletionError("消息不存在");
		}

		const target = await getDeletionTarget(env.DB, messageId);
		if (!target || Number(target.channel_id) !== Number(meta.room.id)) {
			throw new MessageDeletionError("消息不存在或已被删除");
		}

		// 检查删除权限：
		// 1. 全站管理员
		// 2. 本人发送的消息 (target.sender_id === meta.principal.userId)
		// 3. AI 机器人消息 (target.source === 'ai' 允许当前频道成员删除清理)
		// 4. 群主 (owner)
		let canDelete = Boolean(meta.principal.isAdmin);
		if (!canDelete && target.sender_id && Number(target.sender_id) === Number(meta.principal.userId)) {
			canDelete = true;
		}
		if (!canDelete && target.source === 'ai') {
			canDelete = true;
		}
		if (!canDelete) {
			const access = await authorize(
				env.DB,
				meta.principal,
				meta.room.kind,
				meta.room.id,
			);
			if (access.ok) {
				canDelete = true;
			}
		}

		if (!canDelete) {
			throw new MessageDeletionError("无权删除该消息");
		}

		const attachmentKey = target?.attachment_key || null;

		const deleted = await persistDeletion(env.DB, {
			channelId: meta.room.id,
			messageId,
		});
		if (!deleted) {
			throw new MessageDeletionError("消息不存在或已被删除");
		}

		const cleanupPromise = attachmentKey
			? Promise.resolve().then(() => cleanupAttachments(env, [attachmentKey])).catch((error) => {
					console.warn("Failed to clean up deleted message attachment", error);
				})
			: null;

		return {
			messageId,
			packet: JSON.stringify({ protocolVersion: 1, type: "message_deleted", messageId }),
			cleanupPromise,
		};
	};
}

export const deleteRoomMessage = createMessageDeletion();
