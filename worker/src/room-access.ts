export type RoomKind = "public" | "private" | "dm";

const ROOM_KINDS = new Set<string>(["public", "private", "dm"]);

export const ROOM_ACCESS_FAILURE = Object.freeze({
	INVALID_ROOM: "invalid_room",
	NOT_FOUND: "not_found",
	FORBIDDEN: "forbidden",
});

export interface RoomIdentity {
	isAdmin: boolean;
	userId: number;
}

export interface RoomRecord {
	id: number;
	name: string;
	description: string;
	avatar_key: string | null;
	kind: string;
	dm_key: string | null;
	created_by?: number | null;
	/** 群组创建时间；仅部分查询会带上，缺失时为 undefined。 */
	created_at?: string | null;
}

export interface ChannelMembership {
	channel_id: number;
	user_id: number;
	role: string;
	joined_at: string;
}

export type RoomAccessResult =
	| { ok: true; room: RoomRecord; identity: RoomIdentity }
	| { ok: false; reason: string };

export type ChannelManagementResult =
	| { ok: true; channel: RoomRecord; membership: { role: string }; identity: RoomIdentity }
	| { ok: false; reason: string };

export type MessageModerationResult =
	| { ok: false; reason: string }
	| {
			ok: true;
			room: RoomRecord;
			identity: RoomIdentity;
			membership?: ChannelMembership;
	  };

export function isRoomKind(kind: unknown): kind is RoomKind {
	return ROOM_KINDS.has(String(kind));
}

function normalizePrincipal(principal: unknown): RoomIdentity | null {
	const source = principal as { isAdmin?: unknown; userId?: unknown } | null | undefined;
	const isAdmin = Boolean(source?.isAdmin);
	const userId = Number(source?.userId);
	if (!isAdmin && (!Number.isInteger(userId) || userId <= 0)) {
		return null;
	}
	return {
		isAdmin,
		userId: Number.isInteger(userId) && userId > 0 ? userId : 0,
	};
}

export async function getChannelById(
	db: D1Database,
	channelId: number | string,
): Promise<RoomRecord | null> {
	const numericChannelId = Number(channelId);
	if (!Number.isInteger(numericChannelId) || numericChannelId <= 0) {
		return null;
	}

	const { results } = await db
		.prepare(
			`SELECT id, name, description, avatar_key, kind, dm_key, created_by, created_at
			 FROM channels
			 WHERE id = ?
			   AND deleted_at IS NULL
			 LIMIT 1`,
		)
		.bind(numericChannelId)
		.all<RoomRecord>();
	return results[0] || null;
}

export async function getChannelMembership(
	db: D1Database,
	channelId: number | string,
	userId: number | string,
): Promise<ChannelMembership | null> {
	const numericChannelId = Number(channelId);
	const numericUserId = Number(userId);
	if (
		!Number.isInteger(numericChannelId) ||
		numericChannelId <= 0 ||
		!Number.isInteger(numericUserId) ||
		numericUserId <= 0
	) {
		return null;
	}

	const { results } = await db
		.prepare(
			`SELECT channel_id, user_id, role, joined_at
			 FROM channel_members
			 WHERE channel_id = ?
			   AND user_id = ?
			 LIMIT 1`,
		)
		.bind(numericChannelId, numericUserId)
		.all<ChannelMembership>();
	return results[0] || null;
}

export async function authorizeRoom(
	db: D1Database,
	principal: unknown,
	kind: unknown,
	roomId: unknown,
): Promise<RoomAccessResult> {
	const identity = normalizePrincipal(principal);
	const numericRoomId = Number(roomId);
	if (
		!identity ||
		!isRoomKind(kind) ||
		!Number.isInteger(numericRoomId) ||
		numericRoomId <= 0
	) {
		return { ok: false, reason: ROOM_ACCESS_FAILURE.INVALID_ROOM };
	}

	const membershipCondition = identity.isAdmin
		? "1 = 1"
		: "EXISTS (SELECT 1 FROM channel_members cm WHERE cm.channel_id = c.id AND cm.user_id = ?)";
	const statement = db.prepare(
		`SELECT c.id, c.name, c.description, c.avatar_key, c.kind, c.dm_key
		 FROM channels c
		 WHERE c.id = ?
		   AND c.kind = ?
		   AND c.deleted_at IS NULL
		   AND ${membershipCondition}
		 LIMIT 1`,
	);
	const bound = identity.isAdmin
		? statement.bind(numericRoomId, kind)
		: statement.bind(numericRoomId, kind, identity.userId);
	const { results } = await bound.all<RoomRecord>();
	const room = results[0] || null;
	if (!room) {
		return {
			ok: false,
			reason: identity.isAdmin
				? ROOM_ACCESS_FAILURE.NOT_FOUND
				: ROOM_ACCESS_FAILURE.FORBIDDEN,
		};
	}
	return { ok: true, room, identity };
}

export async function authorizeChannelManagement(
	db: D1Database,
	principal: unknown,
	channelId: number | string,
): Promise<ChannelManagementResult> {
	const identity = normalizePrincipal(principal);
	if (!identity) {
		return { ok: false, reason: ROOM_ACCESS_FAILURE.INVALID_ROOM };
	}

	const channel = await getChannelById(db, channelId);
	if (!channel || channel.kind === "dm") {
		return { ok: false, reason: ROOM_ACCESS_FAILURE.NOT_FOUND };
	}
	if (identity.isAdmin) {
		return {
			ok: true,
			channel,
			membership: { role: "owner" },
			identity,
		};
	}

	const membership = await getChannelMembership(db, channelId, identity.userId);
	if (membership?.role !== "owner") {
		return { ok: false, reason: ROOM_ACCESS_FAILURE.FORBIDDEN };
	}
	return { ok: true, channel, membership, identity };
}

export async function authorizeMessageModeration(
	db: D1Database,
	principal: unknown,
	kind: unknown,
	roomId: unknown,
): Promise<MessageModerationResult> {
	const access = await authorizeRoom(db, principal, kind, roomId);
	if (!access.ok || access.identity.isAdmin) {
		return access;
	}
	if (access.room.kind === "dm") {
		return { ok: false, reason: ROOM_ACCESS_FAILURE.FORBIDDEN };
	}

	const membership = await getChannelMembership(
		db,
		access.room.id,
		access.identity.userId,
	);
	if (membership?.role !== "owner") {
		return { ok: false, reason: ROOM_ACCESS_FAILURE.FORBIDDEN };
	}
	return { ...access, membership };
}
