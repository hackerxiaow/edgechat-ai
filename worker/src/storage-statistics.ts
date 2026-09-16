const USER_OBJECT_KEY_PATTERN = /^(\d+)\//;

export interface StorageOwnerRef {
	key: string;
	type: "user" | "telegram" | "unknown";
	userId: number | null;
}

export interface StorageSummary {
	ownerKey: string;
	ownerType: StorageOwnerRef["type"];
	ownerId: number | null;
	objectCount: number;
	bytes: number;
	latestUploadedAt: string | null;
}

/** R2Object 中本模块实际使用的字段。 */
export interface StorageObjectLike {
	key?: string;
	size?: number;
	uploaded?: Date | string;
}

export function storageOwnerFromObjectKey(key: unknown): StorageOwnerRef {
	const normalizedKey = String(key || "");
	const userMatch = USER_OBJECT_KEY_PATTERN.exec(normalizedKey);
	if (userMatch) {
		const userId = Number(userMatch[1]);
		if (Number.isSafeInteger(userId) && userId > 0) {
			return { key: `user:${userId}`, type: "user", userId };
		}
	}

	if (normalizedKey.startsWith("telegram/")) {
		return { key: "system:telegram", type: "telegram", userId: null };
	}

	return { key: "system:unknown", type: "unknown", userId: null };
}

export function summarizeR2Objects(objects: StorageObjectLike[] = []): StorageSummary[] {
	const summaries = new Map<string, StorageSummary>();

	for (const object of objects) {
		const owner = storageOwnerFromObjectKey(object?.key);
		const current = summaries.get(owner.key) || {
			ownerKey: owner.key,
			ownerType: owner.type,
			ownerId: owner.userId,
			objectCount: 0,
			bytes: 0,
			latestUploadedAt: null,
		};
		const uploadedAt = object?.uploaded ? new Date(object.uploaded) : null;

		current.objectCount += 1;
		current.bytes += Math.max(0, Number(object?.size) || 0);
		if (
			uploadedAt &&
			!Number.isNaN(uploadedAt.getTime()) &&
			(!current.latestUploadedAt || uploadedAt > new Date(current.latestUploadedAt))
		) {
			current.latestUploadedAt = uploadedAt.toISOString();
		}

		summaries.set(owner.key, current);
	}

	return [...summaries.values()];
}
