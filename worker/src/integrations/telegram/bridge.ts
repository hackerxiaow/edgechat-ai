import {
	getTelegramCredentials,
	listEnabledTelegramMappingsForChannel,
	type TelegramMapping,
} from "../../data/telegram.ts";
import { isGroupChannelKind } from "../../../../shared/group-channel.ts";
import { getMessageBySource, type Message } from "../../data/messages.ts";
import {
	findMessageReplyBySource,
	getMessageSourceReference,
	type MessageSourceReference,
} from "../../data/replies.ts";
import { submitExternalMessage } from "../../external-message-submission.ts";
import type { AppBindings } from "../../types.ts";
import { sendTelegramMedia, sendTelegramText } from "./client.ts";
import {
	deleteImportedTelegramAttachment,
	importTelegramAttachment,
	loadEdgeChatAttachment,
	TELEGRAM_FILE_SKIP_REASON,
	type ImportedTelegramAttachment,
} from "./files.ts";
import type { TelegramParsedMessage } from "./parser.ts";

type BridgeEnv = Pick<AppBindings, "DB">;

function logBridgeFailure(message: string, data: Record<string, unknown>): void {
	console.warn(JSON.stringify({ message, ...data }));
}

function escapeTelegramHtml(value: unknown): string {
	return String(value || "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function formatTelegramMessage(displayName: string, content = ""): string {
	const sender = `<b>${escapeTelegramHtml(displayName)}:</b>`;
	const body = escapeTelegramHtml(content);
	return body ? `${sender}\n${body}` : sender;
}

export function splitTelegramFormattedMessage(
	displayName: string,
	content: string,
	limit: number,
): string[] {
	const characters = Array.from(String(content || ""));
	if (!characters.length) return [formatTelegramMessage(displayName)];
	const sender = formatTelegramMessage(displayName);
	const prefix = `${sender}\n`;
	const chunks: string[] = [];
	let current = "";
	for (const character of characters) {
		const escaped = escapeTelegramHtml(character);
		if (Array.from(prefix + current + escaped).length > limit && current) {
			chunks.push(prefix + current);
			current = escaped;
		} else {
			current += escaped;
		}
	}
	if (current) chunks.push(prefix + current);
	return chunks;
}

function telegramMediaKind(contentType: string, attachmentKind?: string): string {
	if (attachmentKind === "voice") return "voice";
	if (contentType.startsWith("image/")) return "photo";
	if (contentType.startsWith("video/")) return "video";
	if (contentType.startsWith("audio/")) return "audio";
	return "document";
}

async function sendTextMessage(
	botToken: string,
	chatId: string | number,
	displayName: string,
	content: string,
	replyToMessageId: number | string | null = null,
): Promise<void> {
	const chunks = splitTelegramFormattedMessage(displayName, content, 4096);
	for (const [index, chunk] of chunks.entries()) {
		await sendTelegramText(botToken, {
			chatId,
			text: chunk,
			replyToMessageId: index === 0 ? replyToMessageId : null,
		});
	}
}

async function sendMessageToTelegram(
	env: BridgeEnv,
	botToken: string,
	mapping: TelegramMapping,
	message: Message,
	replyToMessageId: number | null = null,
): Promise<void> {
	const displayName = message.sender.displayName;
	if (!message.attachment) {
		if (message.content) {
			await sendTextMessage(
				botToken,
				mapping.telegramChatId,
				displayName,
				message.content,
				replyToMessageId,
			);
		}
		return;
	}

	const loaded = await loadEdgeChatAttachment(env, message.attachment);
	if (!loaded.file) {
		logBridgeFailure("telegram outbound attachment skipped", {
			roomId: Number(mapping.channelId),
			mappingId: mapping.id,
			reason: loaded.skipReason,
		});
			if (message.content) {
				await sendTextMessage(
					botToken,
					mapping.telegramChatId,
					displayName,
					message.content,
					replyToMessageId,
				);
		}
		return;
	}
	const file = loaded.file;

	const captions = splitTelegramFormattedMessage(displayName, message.content, 1024);
	await sendTelegramMedia(botToken, {
		chatId: mapping.telegramChatId,
		kind: telegramMediaKind(file.type, file.kind),
		bytes: file.bytes,
		filename: file.name,
		contentType: file.type,
		caption: captions[0],
		durationMs: file.durationMs,
		replyToMessageId,
	});
	for (const chunk of captions.slice(1)) {
		await sendTelegramText(botToken, { chatId: mapping.telegramChatId, text: chunk });
	}
}

function telegramReplyMessageId(
	reference: MessageSourceReference | null,
	telegramChatId: string,
): number | null {
	if (reference?.source !== "telegram") return null;
	const prefix = `${telegramChatId}:`;
	if (!reference.sourceMessageId.startsWith(prefix)) return null;
	const messageId = Number(reference.sourceMessageId.slice(prefix.length));
	return Number.isInteger(messageId) && messageId > 0 ? messageId : null;
}

export async function forwardEdgeChatMessageToTelegram(
	env: BridgeEnv,
	{ room, message }: { room: { id: number | string; kind: string; name?: string }; message: Message },
): Promise<void> {
	if (!isGroupChannelKind(room.kind) || message.source === "telegram") {
		return;
	}

	try {
		const [credentials, mappings, replyReference] = await Promise.all([
			getTelegramCredentials(env),
			listEnabledTelegramMappingsForChannel(env.DB, room.id),
			message.replyToMessageId
				? getMessageSourceReference(env.DB, {
					channelId: room.id,
					messageId: message.replyToMessageId,
				})
				: Promise.resolve(null),
		]);
		if (!credentials || !mappings.length || (!message.content && !message.attachment)) {
			return;
		}

		await Promise.all(
			mappings.map(async (mapping) => {
				try {
						await sendMessageToTelegram(
							env,
							credentials.botToken,
							mapping,
							message,
							telegramReplyMessageId(replyReference, mapping.telegramChatId),
						);
				} catch (error) {
					logBridgeFailure("telegram outbound message failed", {
						roomId: Number(room.id),
						mappingId: mapping.id,
						error: error instanceof Error ? error.message : String(error),
					});
				}
			}),
		);
	} catch (error) {
		logBridgeFailure("telegram outbound bridge failed", {
			roomId: Number(room.id),
			error: error instanceof Error ? error.message : String(error),
		});
	}
}

export async function ingestTelegramMessage(
	env: BridgeEnv,
	{
		mapping,
		telegramMessage,
		botToken,
	}: {
		mapping: TelegramMapping;
		telegramMessage: TelegramParsedMessage;
		botToken: string;
	},
) {
	const existing = await getMessageBySource(
		env,
		"telegram",
		telegramMessage.sourceMessageId,
	);
	if (existing) return { ok: true, created: false };
	const reply = telegramMessage.replySourceMessageId
		? await findMessageReplyBySource(env.DB, {
			channelId: mapping.channelId,
			source: "telegram",
			sourceMessageId: telegramMessage.replySourceMessageId,
		})
		: null;

	let imported: ImportedTelegramAttachment = { attachment: null, skipReason: null };
	if (telegramMessage.attachment) {
		if (!botToken) throw new Error("Telegram Bridge 未配置");
		imported = await importTelegramAttachment(env, {
			botToken,
			telegramChatId: telegramMessage.telegramChatId,
			telegramMessageId: telegramMessage.telegramMessageId,
			attachment: telegramMessage.attachment,
		});
	}

	const attachmentNotice =
		imported.skipReason === TELEGRAM_FILE_SKIP_REASON.TOO_LARGE
			? "附件超过 16 MB，未同步"
			: imported.skipReason === TELEGRAM_FILE_SKIP_REASON.STORAGE_UNAVAILABLE
				? "Telegram 附件需要对象存储，当前 D1 单存储部署不导入附件"
				: "";
	const content = [telegramMessage.content, attachmentNotice].filter(Boolean).join("\n\n");
	try {
		// 纯 D1 部署下提交直接返回结果对象，不再经过 Durable Object 的 HTTP 响应。
		const result = await submitExternalMessage(env, {
			room: {
				id: mapping.channelId,
				kind: mapping.channelKind,
				name: mapping.channelName,
			},
			payload: {
				content,
				attachment: imported.attachment,
				source: "telegram",
				sourceMessageId: telegramMessage.sourceMessageId,
				sourceAttachmentId: telegramMessage.attachment?.fileId || null,
				sourceAttachmentUniqueId: telegramMessage.attachment?.fileUniqueId || null,
				externalSender: telegramMessage.sender,
				replyToMessageId: reply?.messageId || null,
				replyToSenderId: reply?.senderId || null,
			},
		});
		if (!result.created) {
			await deleteImportedTelegramAttachment(env, imported.attachment);
		}
		return { ok: true, ...result };
	} catch (error) {
		// 提交中断时先按去重键复查，避免删除已经被正式消息引用的对象。
		const persisted = await getMessageBySource(
			env,
			"telegram",
			telegramMessage.sourceMessageId,
		).catch(() => null);
		if (persisted) {
			if (persisted.attachment?.key !== imported.attachment?.key) {
				await deleteImportedTelegramAttachment(env, imported.attachment);
			}
			return { ok: true, created: false, message: persisted };
		}
		await deleteImportedTelegramAttachment(env, imported.attachment);
		throw error;
	}
}
