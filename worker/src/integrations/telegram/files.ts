import {
	normalizeContentType,
	safeFilenameExtension,
	sanitizeFilename,
} from "../../attachment-metadata.ts";
import { decryptAttachment, encryptAttachment } from "../../encryption.ts";
import type { AppBindings } from "../../types.ts";
import { downloadTelegramFile, getTelegramFile } from "./client.ts";
import type { TelegramAttachmentInput } from "./parser.ts";

export const TELEGRAM_BRIDGE_FILE_LIMIT = 16 * 1024 * 1024;

export type TelegramFileSkipReason = "too_large" | "storage_unavailable" | "not_found";

export const TELEGRAM_FILE_SKIP_REASON: Readonly<Record<string, TelegramFileSkipReason>> =
	Object.freeze({
		TOO_LARGE: "too_large",
		STORAGE_UNAVAILABLE: "storage_unavailable",
		NOT_FOUND: "not_found",
	});

const FILE_RESPONSE_CACHE_CONTROL = "private, no-store";

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

function telegramObjectKey({
	telegramChatId,
	telegramMessageId,
	filename,
}: {
	telegramChatId: string;
	telegramMessageId: number;
	filename: string;
}): string {
	const extension = safeFilenameExtension(filename);
	return `telegram/${telegramChatId}/${telegramMessageId}-${crypto.randomUUID()}${extension}`;
}

export async function importTelegramAttachment(
	env: Pick<AppBindings, "DB" | "FILES">,
	{
		botToken,
		telegramChatId,
		telegramMessageId,
		attachment,
	}: {
		botToken: string;
		telegramChatId: string;
		telegramMessageId: number;
		attachment: TelegramAttachmentInput | null;
	},
): Promise<ImportedTelegramAttachment> {
	if (!attachment) return { attachment: null, skipReason: null };
	if (!env.FILES) {
		return {
			attachment: null,
			skipReason: TELEGRAM_FILE_SKIP_REASON.STORAGE_UNAVAILABLE,
		};
	}
	if (attachment.fileSize > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { attachment: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}

	const telegramFile = await getTelegramFile(botToken, attachment.fileId);
	const resolvedSize = Number(telegramFile.file_size || attachment.fileSize || 0);
	if (resolvedSize > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { attachment: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}
	const bytes = await downloadTelegramFile(
		botToken,
		String(telegramFile.file_path || ""),
		TELEGRAM_BRIDGE_FILE_LIMIT,
	);
	const name = sanitizeFilename(attachment.fileName);
	const type = normalizeContentType(attachment.mimeType) || "application/octet-stream";
	const key = telegramObjectKey({ telegramChatId, telegramMessageId, filename: name });
	// Telegram 只负责传输，正式附件在进入消息前即转换为 EdgeChat 自有加密 R2 对象。
	const encrypted = await encryptAttachment(env, bytes, key);
	await env.FILES.put(key, encrypted, {
		httpMetadata: { contentType: type, cacheControl: FILE_RESPONSE_CACHE_CONTROL },
		customMetadata: { filename: name, edgechatEncryption: "v1", source: "telegram" },
	});
	return {
		attachment: {
			key,
			name,
			type,
			size: bytes.byteLength,
				...(attachment.kind === "voice" || attachment.kind === "audio"
					? {
						kind: attachment.kind,
						durationMs: attachment.durationMs || 0,
						...(attachment.kind === "voice" ? { waveform: [] } : {}),
					}
					: {}),
		},
		skipReason: null,
	};
}

export async function loadEdgeChatAttachment(
	env: Pick<AppBindings, "DB" | "FILES">,
	attachment: MessageAttachmentLike | null | undefined,
): Promise<LoadedEdgeChatAttachment> {
	if (!attachment) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.NOT_FOUND };
	}
	if (Number(attachment.size) > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}
	if (!env.FILES) {
		return {
			file: null,
			skipReason: TELEGRAM_FILE_SKIP_REASON.STORAGE_UNAVAILABLE,
		};
	}
	const object = await env.FILES.get(attachment.key);
	if (!object) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.NOT_FOUND };
	}
	const decrypted = await decryptAttachment(env, await object.arrayBuffer(), attachment.key);
	if (decrypted.bytes.byteLength > TELEGRAM_BRIDGE_FILE_LIMIT) {
		return { file: null, skipReason: TELEGRAM_FILE_SKIP_REASON.TOO_LARGE };
	}
	return {
		file: {
			bytes: decrypted.bytes,
			name: sanitizeFilename(attachment.name),
				type: normalizeContentType(attachment.type) || "application/octet-stream",
				size: decrypted.bytes.byteLength,
				kind: attachment.kind,
				durationMs: Number(attachment.durationMs || 0),
			},
		skipReason: null,
	};
}

export async function deleteImportedTelegramAttachment(
	env: Pick<AppBindings, "DB" | "FILES">,
	attachment: MessageAttachmentLike | null | undefined,
): Promise<void> {
	if (!attachment?.key || !env.FILES) return;
	try {
		await env.FILES.delete(attachment.key);
	} catch (error) {
		console.warn(JSON.stringify({
			message: "telegram orphan attachment delete failed",
			objectKey: attachment.key,
			error: error instanceof Error ? error.message : String(error),
		}));
	}
}
