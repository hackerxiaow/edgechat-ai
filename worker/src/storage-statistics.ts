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

/** uploaded_files 按归属聚合后的行；D1 单存储下附件正文也在同一张表。 */
export interface UploadedFileStatRow {
	owner_user_id: number | null;
	object_count: number;
	bytes: number;
	latest_uploaded_at: string | null;
}

export function storageOwnerFromUserId(ownerUserId: number | null | undefined): StorageOwnerRef {
	const numeric = Number(ownerUserId);
	if (Number.isSafeInteger(numeric) && numeric > 0) {
		return { key: `user:${numeric}`, type: "user", userId: numeric };
	}
	return { key: "system:unknown", type: "unknown", userId: null };
}

export function summarizeUploadedFiles(rows: UploadedFileStatRow[] = []): StorageSummary[] {
	return rows.map((row) => {
		const owner = storageOwnerFromUserId(row.owner_user_id);
		// D1 的 CURRENT_TIMESTAMP 是不带时区的 UTC 字符串，必须显式按 UTC 解析。
		const uploadedAt = row.latest_uploaded_at
			? new Date(`${String(row.latest_uploaded_at).replace(" ", "T")}Z`)
			: null;
		return {
			ownerKey: owner.key,
			ownerType: owner.type,
			ownerId: owner.userId,
			objectCount: Math.max(0, Number(row.object_count) || 0),
			bytes: Math.max(0, Number(row.bytes) || 0),
			latestUploadedAt:
				uploadedAt && !Number.isNaN(uploadedAt.getTime()) ? uploadedAt.toISOString() : null,
		};
	});
}
