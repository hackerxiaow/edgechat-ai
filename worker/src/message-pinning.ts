import type { Message } from "./data/messages.ts";
import type { RoomMeta, SessionUser } from "./types.ts";
import { getPinnedMessage, pinMessage, unpinMessage } from "./data/pins.ts";
import { authorizeChannelManagement } from "./room-access.ts";

export class MessagePinningError extends Error {
	code?: string;
	status?: number;

	constructor(message: string) {
		super(message);
		this.name = "MessagePinningError";
	}
}

type PinAuthorizeFn = (
	db: D1Database,
	principal: SessionUser,
	roomId: number | string,
) => Promise<{ ok: boolean; identity: { userId: number | string } }>;
type PersistPinFn = (
	db: D1Database,
	args: { channelId: number | string; messageId: number; pinnedBy: number | string },
) => Promise<boolean>;
type PersistUnpinFn = (
	db: D1Database,
	args: { channelId: number | string; messageId: number },
) => Promise<boolean>;
type LoadPinnedMessageFn = (env: unknown, roomId: number | string) => Promise<Message | null>;

function normalizeMessageId(payload: { messageId?: unknown }): number {
	const messageId = Number(payload.messageId);
	if (!Number.isInteger(messageId) || messageId <= 0) {
		throw new MessagePinningError("消息不存在");
	}
	return messageId;
}

async function requirePinPermission(
	authorize: PinAuthorizeFn,
	env: { DB: D1Database },
	meta: RoomMeta,
) {
	const access = await authorize(env.DB, meta.principal, meta.room.id);
	if (!access.ok) {
		throw new MessagePinningError("无权管理置顶消息");
	}
	return access;
}

export function createMessagePinning({
	authorize = authorizeChannelManagement as PinAuthorizeFn,
	persistPin = pinMessage,
	loadPinnedMessage = getPinnedMessage as LoadPinnedMessageFn,
}: {
	authorize?: PinAuthorizeFn;
	persistPin?: PersistPinFn;
	loadPinnedMessage?: LoadPinnedMessageFn;
} = {}) {
	return async function pinRoomMessage(
		env: { DB: D1Database },
		meta: RoomMeta,
		payload: { messageId?: unknown },
	) {
		const messageId = normalizeMessageId(payload);
		const access = await requirePinPermission(authorize, env, meta);
		const pinned = await persistPin(env.DB, {
			channelId: meta.room.id,
			messageId,
			pinnedBy: access.identity.userId,
		});
		if (!pinned) {
			throw new MessagePinningError("消息不存在或已被删除");
		}

		const message = await loadPinnedMessage(env, meta.room.id);
		if (!message) {
			throw new MessagePinningError("消息不存在或已被删除");
		}
		return {
			message,
			packet: JSON.stringify({ protocolVersion: 1, type: "message_pinned", message }),
		};
	};
}

export function createMessageUnpinning({
	authorize = authorizeChannelManagement as PinAuthorizeFn,
	persistUnpin = unpinMessage,
}: {
	authorize?: PinAuthorizeFn;
	persistUnpin?: PersistUnpinFn;
} = {}) {
	return async function unpinRoomMessage(
		env: { DB: D1Database },
		meta: RoomMeta,
		payload: { messageId?: unknown },
	) {
		const messageId = normalizeMessageId(payload);
		await requirePinPermission(authorize, env, meta);
		const unpinned = await persistUnpin(env.DB, {
			channelId: meta.room.id,
			messageId,
		});
		if (!unpinned) {
			throw new MessagePinningError("该消息已不再置顶");
		}
		return {
			messageId,
			packet: JSON.stringify({ protocolVersion: 1, type: "message_unpinned", messageId }),
		};
	};
}

export const pinRoomMessage = createMessagePinning();
export const unpinRoomMessage = createMessageUnpinning();
