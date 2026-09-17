export interface ReactionUser {
	id: number;
	displayName: string;
}

export interface MessageReactionSummary {
	emoji: string;
	count: number;
	users: ReactionUser[];
}

export interface ToggleReactionInput {
	channelId: number | string;
	messageId: number | string;
	userId: number;
	emoji: string;
}

export interface ToggleReactionResult {
	action: 'added' | 'removed';
}

/**
 * 切换表情回应：若该用户已对该消息发过该 emoji 则移除，否则添加。
 * 数据库触发器会自动在 message_events 写入同步事件，让房间内所有客户端感知。
 */
export async function toggleMessageReaction(
	db: D1Database,
	{ channelId, messageId, userId, emoji }: ToggleReactionInput,
): Promise<ToggleReactionResult> {
	const cleanEmoji = String(emoji || '').trim();
	if (!cleanEmoji || cleanEmoji.length > 32) {
		throw new Error('Invalid emoji');
	}
	const numMessageId = Number(messageId);
	const numChannelId = Number(channelId);

	// 确认消息存在且未被删除
	const msg = await db
		.prepare('SELECT id FROM messages WHERE id = ? AND channel_id = ? AND deleted_at IS NULL LIMIT 1')
		.bind(numMessageId, numChannelId)
		.first<{ id: number }>();
	if (!msg) {
		throw new Error('Message not found');
	}

	// 检查是否已存在该回应
	const existing = await db
		.prepare(
			'SELECT id FROM message_reactions WHERE message_id = ? AND user_id = ? AND emoji = ? LIMIT 1',
		)
		.bind(numMessageId, userId, cleanEmoji)
		.first<{ id: number }>();

	if (existing) {
		await db
			.prepare('DELETE FROM message_reactions WHERE id = ?')
			.bind(existing.id)
			.run();
		return { action: 'removed' };
	}

	await db
		.prepare(
			'INSERT INTO message_reactions (channel_id, message_id, user_id, emoji) VALUES (?, ?, ?, ?)',
		)
		.bind(numChannelId, numMessageId, userId, cleanEmoji)
		.run();
	return { action: 'added' };
}

export async function listReactionsForMessage(
	db: D1Database,
	messageId: number | string,
): Promise<MessageReactionSummary[]> {
	const { results } = await db
		.prepare(
			`SELECT r.emoji, r.user_id, u.display_name
			 FROM message_reactions r
			 JOIN users u ON u.id = r.user_id
			 WHERE r.message_id = ?
			 ORDER BY r.id ASC`,
		)
		.bind(Number(messageId))
		.all<{ emoji: string; user_id: number; display_name: string }>();

	const groups = new Map<string, ReactionUser[]>();
	for (const row of results) {
		const list = groups.get(row.emoji) || [];
		list.push({ id: Number(row.user_id), displayName: row.display_name });
		groups.set(row.emoji, list);
	}

	const summaries: MessageReactionSummary[] = [];
	for (const [emoji, users] of groups.entries()) {
		summaries.push({
			emoji,
			count: users.length,
			users,
		});
	}
	return summaries;
}
