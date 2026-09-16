import { insertExternalMessage, type PersistMessageResult } from "./data/messages.ts";
import type { AppBindings } from "./types.ts";

export interface ExternalMessagePayload {
	content?: string;
	attachment?: unknown;
	externalSender?: {
		id?: string | number;
		displayName?: string;
		username?: string;
		avatarUrl?: string;
	} | null;
	source?: string;
	sourceMessageId?: string | null;
	sourceAttachmentId?: string | null;
	sourceAttachmentUniqueId?: string | null;
	replyToMessageId?: number | string | null;
	replyToSenderId?: number | string | null;
}

export interface ExternalMessageSubmissionResult extends PersistMessageResult {
	replyToSenderId: number | string | null;
	packet: string;
}

export async function submitExternalMessage(
	env: Pick<AppBindings, "DB">,
	{
		room,
		payload,
	}: {
		room: { id: number | string; kind?: string; name?: string };
		payload: ExternalMessagePayload;
	},
): Promise<ExternalMessageSubmissionResult> {
	const result = await insertExternalMessage(env, {
		channelId: room.id,
		content: String(payload.content ?? ""),
		attachment: payload.attachment,
		externalSender: payload.externalSender,
		source: payload.source,
		sourceMessageId: payload.sourceMessageId,
		sourceAttachmentId: payload.sourceAttachmentId,
		sourceAttachmentUniqueId: payload.sourceAttachmentUniqueId,
		replyToMessageId: payload.replyToMessageId,
		replyToSenderId: payload.replyToSenderId,
	});
	return {
		...result,
		replyToSenderId: payload.replyToSenderId || null,
		packet: JSON.stringify({ type: "message", message: result.message }),
	};
}
