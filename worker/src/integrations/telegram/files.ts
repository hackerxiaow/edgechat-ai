import {
	normalizeContentType,
	sanitizeFilename,
} from "../../attachment-metadata.ts";
import { decryptAttachment } from "../../encryption.ts";
import type { AppBindings } from "../../types.ts";
import type { TelegramAttachmentInput } from "./parser.ts";

export const TELEGRAM_BRIDGE_FILE_LIMIT = 16 * 1024 * 1024;

export type TelegramFileSkipReason = "too_large" | "storage_unavailable" | "not_found";

export const TELEGRAM_FILE_SKIP_REASON: Readonly<Record<string, TelegramFileSkipReason>> =
	Object.freeze({
		TOO_LARGE: "too_large",
		STORAGE_UNAVAILABLE: "storage_unavailable",
		NOT_FOUND: "not_found",
	});

/** 消息附件形状；voice/audio 会额外带时长与波形。 */
export interface MessageAttachmentLike {
	key: string;
	name: string;
	type: string;
	size: number;
	kind?: string;
	durationMs?: number;
	waveform?: number[];
}

export interface ImportedTelegramAttachment {
	attachment: MessageAttachmentLike | null;
	skipReason: TelegramFileSkipReason | null;
}

export interface LoadedEdgeChatAttachment {
	file: {
		bytes: Uint8Array;
		name: string;
		type: string;
		size: number;
		kind?: string;
		durationMs: number;
	} | null;
	skipReason: TelegramFileSkipReason | null;
}

interface StoredFileRow {
	filename: string | null;
	content_type: string | null;
	data: ArrayBuffer | Uint8Array | null;
}

/**
 * D1 单存储下附件正文只能归属到某个本地账号，Telegram 入站消息没有对应的
 * 本地用户，因此不再导入附件，只保留文本与通知。
 */
export async function importTelegramAttachment(
	_env: Pick<AppBindings, "DB">,
	{
		attachment,
	}: {
		botToken: string;
		telegramChatId: string;
		telegramMessageId: number;
		attachment: TelegramAttachmentInput | null;
	},
): Promise<ImportedTelegramAttachment> {
	if (!attachment) return { attachment: null, skipReason: null };
	return { attachment: null, skipReason: TELEGRAM_FILE_SKIP_REASON.STORAGE_UNAVAILABLE };
}

/** 出站方向：EdgeChat 的附件正文存在 D1，直接读出来交给 Telegram。 */
export async function loadEdgeChatAttachment(
	env: Pick<AppBindings, "DB">,
	attachment: MessageAttachmentLike | null | undefined,
): Promise<LoadedEdgeChatAttachment> {
	if (!attachment) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.NOT_FOUND };
	}
	if (Number(attachment.size) > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}

	const row = await env.DB.prepare(
		"SELECT filename, content_type, data FROM uploaded_files WHERE object_key = ? LIMIT 1",
	)
		.bind(String(attachment.key))
		.first<StoredFileRow>();
	if (!row?.data) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.NOT_FOUND };
	}

	const raw = row.data instanceof Uint8Array ? row.data : new Uint8Array(row.data);
	// 附件正文在 D1 里是绑定对象键的加密信封，发送前解密。
	const { bytes } = await decryptAttachment(env, raw, String(attachment.key));
	if (bytes.byteLength > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}

	return {
		file: {
			bytes,
			name: sanitizeFilename(attachment.name),
			type: normalizeContentType(attachment.type) || "application/octet-stream",
			size: bytes.byteLength,
			kind: attachment.kind,
			durationMs: Number(attachment.durationMs || 0),
		},
		skipReason: null,
	};
}

/** 入站附件不再落库，因此没有需要回收的孤儿对象。 */
export async function deleteImportedTelegramAttachment(
	_env: Pick<AppBindings, "DB">,
	_attachment: MessageAttachmentLike | null | undefined,
): Promise<void> {}
