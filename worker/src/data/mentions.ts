import { activeUserSql } from "../user-status.ts";

export function normalizeMentionUserIds(values: unknown): number[] {
	if (!Array.isArray(values)) {
		return [];
	}
	return [
		...new Set(values.map(Number).filter((value) => Number.isInteger(value) && value > 0)),
	];
}

function isMentionBoundary(character: string): boolean {
	return !character || /[\s()[\]{}<>"'，。！？、：；,.!?]/u.test(character);
}

export function contentMentionsUsername(content: unknown, username: unknown): boolean {
	const text = String(content || "");
	const token = `@${String(username || "")}`;
	if (token.length <= 1) {
		return false;
	}

	let offset = text.indexOf(token);
	while (offset !== -1) {
		const before = offset > 0 ? text[offset - 1] : "";
		const after = text[offset + token.length] || "";
		if (isMentionBoundary(before) && isMentionBoundary(after)) {
			return true;
		}
		offset = text.indexOf(token, offset + token.length);
	}
	return false;
}

interface MentionCandidateRow {
	user_id: number;
	username: string;
}

export async function resolveMessageMentionUserIds(
	db: D1Database,
	{
		channelId,
		roomKind,
		senderId,
		content,
		candidateUserIds,
	}: {
		channelId: number | string;
		roomKind: string;
		senderId: number | string;
		content: string;
		candidateUserIds: unknown;
	},
): Promise<number[]> {
	const candidates = normalizeMentionUserIds(candidateUserIds).filter(
		(userId) => userId !== Number(senderId),
	);
	if (roomKind === "dm" || candidates.length === 0) {
		return [];
	}

	const placeholders = candidates.map(() => "?").join(", ");
	const { results } = await db
		.prepare(
			`SELECT cm.user_id, u.username
			 FROM channel_members cm
			 JOIN users u ON u.id = cm.user_id
			 WHERE cm.channel_id = ?
			   AND cm.user_id IN (${placeholders})
			   AND u.deleted_at IS NULL
			   AND ${activeUserSql("u")}`,
		)
		.bind(Number(channelId), ...candidates)
		.all<MentionCandidateRow>();

	return results
		.filter((row) => contentMentionsUsername(content, row.username))
		.map((row) => Number(row.user_id));
}
