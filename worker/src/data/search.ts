import type { AppBindings } from '../types.ts';
import { listMessages, type Message } from './messages.ts';

export interface SearchRoomMessagesInput {
	roomId: number | string;
	query: string;
	limit?: number;
}

export interface GlobalSearchInput {
	userId: number;
	query: string;
	limit?: number;
}

export interface GlobalSearchResult {
	rooms: Array<{
		id: number;
		kind: string;
		name: string;
		description: string;
		avatarUrl: string;
	}>;
	users: Array<{
		id: number;
		username: string;
		displayName: string;
		avatarUrl: string;
	}>;
	messages: Array<{
		message: Message;
		room: {
			id: number;
			kind: string;
			name: string;
		};
	}>;
}

/**
 * 会话内搜索：由于正文经过 AES-256-GCM 服务端静态加密，
 * 这里在 Worker 内部按权限加载并安全解密后执行子串匹配。
 */
export async function searchRoomMessages(
	env: Pick<AppBindings, 'DB' | 'EDGECHAT_ENCRYPTION_KEYRING'>,
	{ roomId, query, limit = 50 }: SearchRoomMessagesInput,
): Promise<Message[]> {
	const cleanQuery = String(query || '').trim().toLowerCase();
	if (!cleanQuery) return [];

	// 加载该会话内最近的 200 条消息解密匹配
	const allMessages = await listMessages(env, roomId, null, 200);
	const matches = allMessages.filter((msg) =>
		String(msg.content || '').toLowerCase().includes(cleanQuery),
	);
	return matches.slice(0, Math.min(Math.max(1, limit), 100));
}

/**
 * 全局搜索：
 * 1. 匹配该用户所在的群组与公开群
 * 2. 匹配站内联系人
 * 3. 跨会话匹配该用户有权访问的消息正文
 */
export async function searchGlobal(
	env: Pick<AppBindings, 'DB' | 'EDGECHAT_ENCRYPTION_KEYRING'>,
	{ userId, query, limit = 30 }: GlobalSearchInput,
): Promise<GlobalSearchResult> {
	const cleanQuery = String(query || '').trim().toLowerCase();
	if (!cleanQuery) {
		return { rooms: [], users: [], messages: [] };
	}

	// 1. 搜索群组
	const { results: roomRows } = await env.DB.prepare(
		`SELECT DISTINCT c.id, c.kind, c.name, c.description, c.avatar_key
		 FROM channels c
		 LEFT JOIN channel_members cm ON cm.channel_id = c.id
		 WHERE c.deleted_at IS NULL
		   AND (c.kind = 'public' OR cm.user_id = ?)
		   AND (LOWER(c.name) LIKE ? OR LOWER(c.description) LIKE ?)
		 ORDER BY c.id DESC
		 LIMIT 10`,
	)
		.bind(userId, `%${cleanQuery}%`, `%${cleanQuery}%`)
		.all<{ id: number; kind: string; name: string; description: string; avatar_key: string | null }>();

	const rooms = roomRows.map((row) => ({
		id: Number(row.id),
		kind: row.kind,
		name: row.name,
		description: row.description || '',
		avatarUrl: row.avatar_key ? `/api/files/${encodeURIComponent(row.avatar_key)}` : '',
	}));

	// 2. 搜索用户（联系人）
	const { results: userRows } = await env.DB.prepare(
		`SELECT id, username, display_name, avatar_key
		 FROM users
		 WHERE deleted_at IS NULL
		   AND is_disabled = 0
		   AND (LOWER(username) LIKE ? OR LOWER(display_name) LIKE ?)
		 ORDER BY id DESC
		 LIMIT 10`,
	)
		.bind(`%${cleanQuery}%`, `%${cleanQuery}%`)
		.all<{ id: number; username: string; display_name: string; avatar_key: string | null }>();

	const users = userRows.map((row) => ({
		id: Number(row.id),
		username: row.username,
		displayName: row.display_name,
		avatarUrl: row.avatar_key ? `/api/files/${encodeURIComponent(row.avatar_key)}` : '',
	}));

	// 3. 搜索消息：查出用户所加入的群组与 DM 房间 ID
	const { results: memberChannels } = await env.DB.prepare(
		`SELECT c.id, c.kind, c.name
		 FROM channels c
		 JOIN channel_members cm ON cm.channel_id = c.id
		 WHERE cm.user_id = ? AND c.deleted_at IS NULL
		 LIMIT 25`,
	)
		.bind(userId)
		.all<{ id: number; kind: string; name: string }>();

	const matchingMessages: GlobalSearchResult['messages'] = [];
	const maxMatches = Math.min(Math.max(1, limit), 50);

	for (const channel of memberChannels) {
		if (matchingMessages.length >= maxMatches) break;
		const roomMatches = await searchRoomMessages(env, {
			roomId: channel.id,
			query: cleanQuery,
			limit: 5,
		});
		for (const msg of roomMatches) {
			matchingMessages.push({
				message: msg,
				room: {
					id: Number(channel.id),
					kind: channel.kind,
					name: channel.name,
				},
			});
			if (matchingMessages.length >= maxMatches) break;
		}
	}

	return { rooms, users, messages: matchingMessages };
}
