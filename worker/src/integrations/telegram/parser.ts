export type TelegramAttachmentKind = "photo" | "video" | "voice" | "audio" | "document";

export interface TelegramAttachmentInput {
	kind: TelegramAttachmentKind;
	fileId: string;
	fileUniqueId: string;
	fileName: string;
	mimeType: string;
	fileSize: number;
	durationMs?: number;
}

export interface TelegramParsedSender {
	id: string;
	displayName: string;
	avatarUrl: string;
}

export interface TelegramParsedMessage {
	telegramChatId: string;
	telegramChatTitle: string;
	telegramMessageId: number;
	sourceMessageId: string;
	content: string;
	attachment: TelegramAttachmentInput | null;
	sender: TelegramParsedSender;
	replySourceMessageId?: string;
}

/** Telegram Update 的子集；只声明本项目实际读取的字段。 */
interface TelegramUser {
	id?: number | string;
	first_name?: string;
	last_name?: string;
	username?: string;
	is_bot?: boolean;
}

interface TelegramFileRef {
	file_id?: string;
	file_unique_id?: string;
	file_name?: string;
	mime_type?: string;
	file_size?: number;
	duration?: number;
}

interface TelegramIncomingMessage {
	message_id?: number;
	chat?: { id?: number | string; title?: string; username?: string };
	from?: TelegramUser;
	text?: string;
	caption?: string;
	photo?: TelegramFileRef[];
	video?: TelegramFileRef;
	voice?: TelegramFileRef;
	audio?: TelegramFileRef;
	document?: TelegramFileRef;
	reply_to_message?: { message_id?: number };
}

export interface TelegramUpdate {
	message?: TelegramIncomingMessage;
}

function displayName(user: TelegramUser | undefined): string {
	const name = [user?.first_name, user?.last_name].filter(Boolean).join(" ").trim();
	return name || user?.username || `Telegram ${user?.id || "用户"}`;
}

function parseAttachment(message: TelegramIncomingMessage): TelegramAttachmentInput | null {
	if (Array.isArray(message.photo) && message.photo.length) {
		const photo = message.photo.at(-1) as TelegramFileRef;
		return {
			kind: "photo",
			fileId: String(photo.file_id),
			fileUniqueId: String(photo.file_unique_id || ""),
			fileName: `photo-${message.message_id}.jpg`,
			mimeType: "image/jpeg",
			fileSize: Number(photo.file_size || 0),
		};
	}
	if (message.video?.file_id) {
		return {
			kind: "video",
			fileId: String(message.video.file_id),
			fileUniqueId: String(message.video.file_unique_id || ""),
			fileName: message.video.file_name || `video-${message.message_id}.mp4`,
			mimeType: message.video.mime_type || "video/mp4",
			fileSize: Number(message.video.file_size || 0),
		};
	}
	if (message.voice?.file_id) {
		return {
			kind: "voice",
			fileId: String(message.voice.file_id),
			fileUniqueId: String(message.voice.file_unique_id || ""),
			fileName: `voice-${message.message_id}.ogg`,
			mimeType: message.voice.mime_type || "audio/ogg",
			fileSize: Number(message.voice.file_size || 0),
			durationMs: Number(message.voice.duration || 0) * 1000,
		};
	}
	if (message.audio?.file_id) {
		return {
			kind: "audio",
			fileId: String(message.audio.file_id),
			fileUniqueId: String(message.audio.file_unique_id || ""),
			fileName: message.audio.file_name || `audio-${message.message_id}.mp3`,
			mimeType: message.audio.mime_type || "audio/mpeg",
			fileSize: Number(message.audio.file_size || 0),
			durationMs: Number(message.audio.duration || 0) * 1000,
		};
	}
	if (message.document?.file_id) {
		return {
			kind: "document",
			fileId: String(message.document.file_id),
			fileUniqueId: String(message.document.file_unique_id || ""),
			fileName: message.document.file_name || `file-${message.message_id}`,
			mimeType: message.document.mime_type || "application/octet-stream",
			fileSize: Number(message.document.file_size || 0),
		};
	}
	return null;
}

export function parseTelegramMessageUpdate(
	update: TelegramUpdate | null | undefined,
): TelegramParsedMessage | null {
	const message = update?.message;
	if (!message?.chat || !message?.from || message.from.is_bot) {
		return null;
	}
	if (!Number.isInteger(Number(message.message_id))) {
		return null;
	}
	const attachment = parseAttachment(message);
	const content = typeof message.text === "string" ? message.text : String(message.caption || "");
	if (!content.trim() && !attachment) {
		return null;
	}

	const parsed: TelegramParsedMessage = {
		telegramChatId: String(message.chat.id),
		telegramChatTitle: message.chat.title || message.chat.username || "",
		telegramMessageId: Number(message.message_id),
		sourceMessageId: `${message.chat.id}:${message.message_id}`,
		content,
		attachment,
		sender: {
			id: String(message.from.id),
			displayName: displayName(message.from),
			avatarUrl: "",
		},
	};
	const replyMessageId = message.reply_to_message?.message_id;
	if (Number.isInteger(Number(replyMessageId))) {
		parsed.replySourceMessageId = `${message.chat.id}:${replyMessageId}`;
	}
	return parsed;
}
