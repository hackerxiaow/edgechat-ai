export interface DmChannelRow {
	id: number;
	name: string;
	dm_key: string;
}

export async function ensureDmChannel(
	db: D1Database,
	actorId: number | string,
	targetUserId: number | string,
): Promise<DmChannelRow> {
	const dmKey = [Number(actorId), Number(targetUserId)]
		.sort((left, right) => left - right)
		.join(":");
	const existing = await db
		.prepare(
			`SELECT id, name, dm_key FROM channels
			 WHERE kind = 'dm' AND dm_key = ? AND deleted_at IS NULL LIMIT 1`,
		)
		.bind(dmKey)
		.all<DmChannelRow>();
	if (existing.results[0]) {
		return existing.results[0];
	}

	const created = await db
		.prepare(
			`INSERT INTO channels (name, description, kind, dm_key, created_by)
			 VALUES (?, '', 'dm', ?, ?)`,
		)
		.bind(dmKey, dmKey, Number(actorId))
		.run();
	const channelId = Number(created.meta.last_row_id ?? 0);
	await db.batch([
		db
			.prepare(
				`INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
				 VALUES (?, ?, 'member', ?)`,
			)
			.bind(channelId, Number(actorId), Number(actorId)),
		db
			.prepare(
				`INSERT OR IGNORE INTO channel_members (channel_id, user_id, role, invited_by)
				 VALUES (?, ?, 'member', ?)`,
			)
			.bind(channelId, Number(targetUserId), Number(actorId)),
	]);
	return { id: channelId, name: dmKey, dm_key: dmKey };
}
