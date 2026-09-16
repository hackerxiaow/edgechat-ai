const TELEGRAM_API_ROOT = "https://api.telegram.org";
const TELEGRAM_FILE_ROOT = `${TELEGRAM_API_ROOT}/file`;

export class TelegramApiError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "TelegramApiError";
	}
}

export interface TelegramBotInfo {
	id: number;
	username?: string;
	first_name?: string;
}

export interface TelegramChatInfo {
	id: number;
	type: string;
	title?: string;
	username?: string;
}

export interface TelegramPhotoSize {
	file_id: string;
	file_unique_id?: string;
	width?: number;
	height?: number;
	file_size?: number;
}

export interface TelegramUserProfilePhotos {
	total_count?: number;
	photos?: TelegramPhotoSize[][];
}

export interface TelegramFileInfo {
	file_id: string;
	file_unique_id?: string;
	file_path?: string;
	file_size?: number;
}

export interface TelegramMessageResult {
	message_id: number;
	[key: string]: unknown;
}

interface TelegramEnvelope<T> {
	ok?: boolean;
	description?: string;
	result?: T;
}

function validateBotToken(botToken: unknown): string {
	const token = String(botToken || "").trim();
	if (!/^\d+:[A-Za-z0-9_-]+$/.test(token)) {
		throw new TelegramApiError("Telegram Bot Token 格式无效");
	}
	return token;
}

async function parseTelegramResponse<T>(response: Response): Promise<T> {
	const result = (await response.json().catch(() => null)) as TelegramEnvelope<T> | null;
	if (!response.ok || !result?.ok) {
		throw new TelegramApiError(result?.description || `Telegram API 请求失败：${response.status}`);
	}
	return result.result as T;
}

export async function callTelegramApi<T = unknown>(
	botToken: string,
	method: string,
	payload: Record<string, unknown> = {},
): Promise<T> {
	const token = validateBotToken(botToken);
	const response = await fetch(
		`${TELEGRAM_API_ROOT}/bot${token}/${method}`,
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		},
	);
	return parseTelegramResponse<T>(response);
}

export async function callTelegramMultipartApi<T = unknown>(
	botToken: string,
	method: string,
	formData: FormData,
): Promise<T> {
	const token = validateBotToken(botToken);
	const response = await fetch(`${TELEGRAM_API_ROOT}/bot${token}/${method}`, {
		method: "POST",
		body: formData,
	});
	return parseTelegramResponse<T>(response);
}

export function getTelegramBot(botToken: string): Promise<TelegramBotInfo> {
	return callTelegramApi<TelegramBotInfo>(botToken, "getMe");
}

export function setTelegramWebhook(
	botToken: string,
	{ url, secretToken }: { url: string; secretToken: string },
): Promise<unknown> {
	return callTelegramApi(botToken, "setWebhook", {
		url,
		secret_token: secretToken,
		allowed_updates: ["message"],
		drop_pending_updates: false,
	});
}

export function getTelegramChat(botToken: string, chatId: number | string): Promise<TelegramChatInfo> {
	return callTelegramApi<TelegramChatInfo>(botToken, "getChat", { chat_id: String(chatId) });
}

export function getTelegramUserProfilePhotos(
	botToken: string,
	userId: number | string,
): Promise<TelegramUserProfilePhotos> {
	return callTelegramApi<TelegramUserProfilePhotos>(botToken, "getUserProfilePhotos", {
		user_id: Number(userId),
		offset: 0,
		limit: 1,
	});
}

export interface SendTelegramTextInput {
	chatId: number | string;
	text: string;
	parseMode?: string;
	replyToMessageId?: number | string | null;
}

export function sendTelegramText(
	botToken: string,
	{
		chatId,
		text,
		parseMode = "HTML",
		replyToMessageId = null,
	}: SendTelegramTextInput,
): Promise<TelegramMessageResult> {
	const payload: Record<string, unknown> = {
		chat_id: String(chatId),
		text: String(text),
		parse_mode: parseMode,
	};
	if (replyToMessageId) {
		payload.reply_parameters = { message_id: Number(replyToMessageId) };
	}
	return callTelegramApi<TelegramMessageResult>(botToken, "sendMessage", payload);
}

export function getTelegramFile(botToken: string, fileId: string): Promise<TelegramFileInfo> {
	return callTelegramApi<TelegramFileInfo>(botToken, "getFile", { file_id: String(fileId) });
}

export async function downloadTelegramFile(
	botToken: string,
	filePath: string,
	maxBytes: number,
): Promise<Uint8Array> {
	const token = validateBotToken(botToken);
	const cleanPath = String(filePath || "").replace(/^\/+/, "");
	if (!cleanPath) {
		throw new TelegramApiError("Telegram 文件路径无效");
	}
	const response = await fetch(`${TELEGRAM_FILE_ROOT}/bot${token}/${cleanPath}`);
	if (!response.ok) {
		throw new TelegramApiError(`Telegram 文件下载失败：${response.status}`);
	}
	const contentLength = Number(response.headers.get("content-length") || 0);
	if (contentLength > maxBytes) {
		throw new TelegramApiError("Telegram 文件超过 Bridge 大小限制");
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength > maxBytes) {
		throw new TelegramApiError("Telegram 文件超过 Bridge 大小限制");
	}
	return bytes;
}

export interface SendTelegramMediaInput {
	chatId: number | string;
	kind: string;
	bytes: Uint8Array;
	filename: string;
	contentType: string;
	caption?: string;
	durationMs?: number;
	replyToMessageId?: number | string | null;
}

const MEDIA_METHODS: Record<string, [string, string]> = {
	photo: ["sendPhoto", "photo"],
	video: ["sendVideo", "video"],
	voice: ["sendVoice", "voice"],
	audio: ["sendAudio", "audio"],
	document: ["sendDocument", "document"],
};

export function sendTelegramMedia(
	botToken: string,
	{
		chatId,
		kind,
		bytes,
		filename,
		contentType,
		caption,
		durationMs = 0,
		replyToMessageId = null,
	}: SendTelegramMediaInput,
): Promise<TelegramMessageResult> {
	const [method, field] = MEDIA_METHODS[kind] || MEDIA_METHODS.document;
	const formData = new FormData();
	formData.set("chat_id", String(chatId));
	formData.set("parse_mode", "HTML");
	if (replyToMessageId) {
		formData.set("reply_parameters", JSON.stringify({ message_id: Number(replyToMessageId) }));
	}
	if (caption) formData.set("caption", String(caption));
	if (durationMs > 0 && (kind === "voice" || kind === "audio")) {
		formData.set("duration", String(Math.round(durationMs / 1000)));
	}
	formData.set(field, new Blob([bytes], { type: contentType }), filename);
	return callTelegramMultipartApi<TelegramMessageResult>(botToken, method, formData);
}
