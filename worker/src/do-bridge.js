import {
	createInternalHeaders,
	createVerifiedPrincipalHeaders,
} from "./verified-identity.js";
import { submitRoomMessageIdempotent } from "./message-submission.js";
import { deleteRoomMessage } from "./message-deletion.js";
import { pinRoomMessage, unpinRoomMessage } from "./message-pinning.js";
import { authorizeRoom } from "./room-access.js";
import { projectUnreadMessage } from "./unread-projection.js";
import { forwardEdgeChatMessageToTelegram } from "./integrations/telegram/bridge.js";
import { processAiBotResponse } from "./integrations/ai-bot.js";
import { submitExternalMessage } from "./external-message-submission.js";

const INTERNAL_ORIGIN = "https://cfchat.internal";

function getChannelRoomStub(env, kind, roomId) {
	if (!env.CHANNEL_ROOM) return null;
	const name = `${kind}:${Number(roomId)}`;
	return env.CHANNEL_ROOM.get(env.CHANNEL_ROOM.idFromName(name));
}

function getUserInboxStub(env, userId) {
	if (!env.USER_INBOX) return null;
	const name = `user:${Number(userId)}`;
	return env.USER_INBOX.get(env.USER_INBOX.idFromName(name));
}

export async function forwardVerifiedRequest({
	stub,
	request,
	pathname,
	searchParams = {},
	principal,
}) {
	if (!stub) {
		return new Response("Durable Objects not available on this deployment", { status: 501 });
	}
	const url = new URL(request.url);
	url.pathname = pathname;
	for (const [key, value] of Object.entries(searchParams)) {
		if (value !== undefined && value !== null) {
			url.searchParams.set(key, String(value));
		}
	}

	const init = {
		method: request.method,
		headers: createVerifiedPrincipalHeaders(request.headers, principal),
	};
	if (!["GET", "HEAD"].includes(request.method)) {
		init.body = await request.arrayBuffer();
	}
	return stub.fetch(new Request(url.toString(), init));
}

export function forwardRoomConnection({ env, request, kind, roomId, principal }) {
	const stub = getChannelRoomStub(env, kind, roomId);
	if (!stub) {
		return new Response("WebSockets require Workers Paid Durable Objects; using polling mode", { status: 501 });
	}
	return forwardVerifiedRequest({
		stub,
		request,
		pathname: "/connect",
		searchParams: { kind, id: roomId, token: principal.token },
		principal,
	});
}

export function forwardInboxConnection({ env, request, principal }) {
	const stub = getUserInboxStub(env, principal.userId);
	if (!stub) {
		return new Response("WebSockets require Workers Paid Durable Objects; using polling mode", { status: 501 });
	}
	return forwardVerifiedRequest({
		stub,
		request,
		pathname: "/connect",
		principal,
	});
}

export async function notifyUserInbox(env, userId, payload) {
	const stub = getUserInboxStub(env, userId);
	if (!stub) return null;
	return stub.fetch(`${INTERNAL_ORIGIN}/notify`, {
		method: "POST",
		headers: createInternalHeaders({ "Content-Type": "application/json" }),
		body: JSON.stringify(payload),
	});
}

export async function submitClientRoomAction(env, { room, principal, action, ctx = null }) {
	const stub = getChannelRoomStub(env, room.kind, room.id);
	if (stub) {
		return forwardVerifiedRequest({
			stub,
			request: new Request(`${INTERNAL_ORIGIN}/client-action`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ room, action })
			}),
			pathname: '/client-action',
			principal
		});
	}

	// 纯 D1 模式（无需 Durable Objects，直接在 D1 事务与函数中执行）
	const access = await authorizeRoom(env.DB, principal, room.kind, room.id);
	if (!access.ok) {
		return Response.json(
			{ error: { code: 'forbidden', message: '无权访问该会话' } },
			{ status: 403 }
		);
	}

	const meta = { principal, room: access.room };
	if (action?.type === 'send') {
		const result = await submitRoomMessageIdempotent(env, meta, action);
		if (result.created) {
			void projectUnreadMessage(env, {
				room: access.room,
				senderId: result.message.sender?.kind === 'local' ? result.message.sender.id : null,
				message: result.message,
				replyToSenderId: result.replyToSenderId
			}).catch(console.error);

			void forwardEdgeChatMessageToTelegram(env, { room: access.room, message: result.message }).catch(console.error);

			const dummyRoom = {
				env,
				broadcast: async () => {},
				runMessageProjections: () => {}
			};
			const aiTask = processAiBotResponse(dummyRoom, { room: access.room, message: result.message }).catch(console.error);
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
		{ status: 400 }
	);
}

export async function submitExternalRoomMessage(env, payload) {
	const room = payload.room;
	const stub = getChannelRoomStub(env, room.kind, room.id);
	if (stub) {
		return stub.fetch(
			`${INTERNAL_ORIGIN}/external-message`,
			{
				method: "POST",
				headers: createInternalHeaders({ "Content-Type": "application/json" }),
				body: JSON.stringify(payload),
			},
		);
	}
	return submitExternalMessage(env, payload);
}
