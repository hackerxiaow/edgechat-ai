import type { AppBindings, SessionUser } from './types.ts';
import { authorizeRoom } from './room-access.js';
import { submitRoomMessageIdempotent } from './message-submission.js';
import { deleteRoomMessage } from './message-deletion.js';
import { pinRoomMessage, unpinRoomMessage } from './message-pinning.js';
import { forwardEdgeChatMessageToTelegram } from './integrations/telegram/bridge.ts';
import { processAiBotResponse } from './integrations/ai-bot.ts';

export interface RoomAction {
	type: 'send' | 'delete_message' | 'pin_message' | 'unpin_message';
	[key: string]: unknown;
}

export interface SubmitClientRoomActionInput {
	room: { id: number | string; kind: string; name?: string };
	principal: SessionUser;
	action: RoomAction;
	/** 传入时把 AI 回复挂到 waitUntil；缺省则同步等待。 */
	ctx?: { waitUntil(promise: Promise<unknown>): void } | null;
}

// 会话消息操作直接在 D1 内完成：没有 Durable Objects，也没有内部请求转发。
// 提交后的投影（Telegram 出站、AI 回复）属于尽力而为的副作用，不阻塞响应。
export async function submitClientRoomAction(
	env: Pick<AppBindings, 'DB'>,
	{ room, principal, action, ctx = null }: SubmitClientRoomActionInput,
): Promise<Response> {
	const access = await authorizeRoom(env.DB, principal, room.kind, room.id);
	if (!access.ok) {
		return Response.json(
			{ error: { code: 'forbidden', message: '无权访问该会话' } },
			{ status: 403 },
		);
	}

	const meta = { principal, room: access.room };

	if (action?.type === 'send') {
		const result = await submitRoomMessageIdempotent(env, meta, action);
		if (result.created) {
			void forwardEdgeChatMessageToTelegram(env, {
				room: access.room,
				message: result.message,
			}).catch(console.error);

			// AI 回复在后台执行，避免阻塞发送响应。
			const aiTask = processAiBotResponse(env, {
				room: access.room,
				message: result.message,
			}).catch(console.error);
			if (ctx && typeof ctx.waitUntil === 'function') {
				ctx.waitUntil(aiTask);
			}
		}
		return Response.json({ created: result.created, message: result.message });
	}

	if (action?.type === 'delete_message') {
		const result = await deleteRoomMessage(env, meta, action);
		return Response.json({ ok: true, messageId: result.messageId });
	}

	if (action?.type === 'pin_message') {
		const result = await pinRoomMessage(env, meta, action);
		return Response.json({ ok: true, message: result.message });
	}

	if (action?.type === 'unpin_message') {
		const result = await unpinRoomMessage(env, meta, action);
		return Response.json({ ok: true, messageId: result.messageId });
	}

	return Response.json(
		{ error: { code: 'invalid_request', message: '不支持的消息操作' } },
		{ status: 400 },
	);
}
