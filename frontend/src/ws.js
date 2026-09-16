import api from "./api.js";
import {
	connectRuntimeInboxSocket,
	connectRuntimeRoomSocket,
	isDemoMode,
} from "./runtime.js";

function createPollingRoomSocket({ kind, roomId, onMessage, onStatus }) {
	let closed = false;
	let cursor = 0;
	let timer = null;
	let lastSeenMessageIds = new Set();

	const socket = {
		readyState: 1, // OPEN
		send(data) {
			if (closed) return;
			try {
				const payload = JSON.parse(data);
				if (payload.type === 'send') {
					api.sendRoomMessage(kind, roomId, {
						clientMessageId: crypto.randomUUID(),
						content: payload.content,
						attachment: payload.attachment || null,
						mentionUserIds: payload.mentionUserIds || [],
						replyMessageId: payload.replyMessageId || null
					}).then(res => {
						if (res.message) {
							lastSeenMessageIds.add(Number(res.message.id));
							onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message', message: res.message }), socket);
						}
						void poll();
					}).catch(err => {
						onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'error', error: err.message }), socket);
					});
				} else if (payload.type === 'delete_message') {
					api.deleteRoomMessage(kind, roomId, payload.messageId).then(() => {
						onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message_deleted', messageId: payload.messageId }), socket);
						void poll();
					}).catch(err => {
						onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'error', error: err.message }), socket);
					});
				}
			} catch (e) {
				console.error('Failed to parse or send frame via PollingSocket', e);
			}
		},
		close() {
			closed = true;
			if (timer) clearTimeout(timer);
			onStatus?.({ status: 'closed', socket, code: 1000, wasClean: true });
		}
	};

	async function poll() {
		if (closed) return;
		try {
			// 如果尚未初始化游标，拉取当前最新消息与游标
			if (cursor === 0) {
				const res = await api.getRecentMessages(kind, roomId, 30);
				cursor = res.syncCursor || 0;
				if (Array.isArray(res.messages)) {
					for (const m of res.messages) {
						lastSeenMessageIds.add(Number(m.id));
					}
				}
			} else {
				const res = await api.syncRoomMessages(kind, roomId, cursor);
				if (res.events && res.events.length > 0) {
					for (const ev of res.events) {
						cursor = Math.max(cursor, Number(ev.sequence) || 0);
						if (ev.eventType === 'created' && ev.message) {
							const mid = Number(ev.message.id);
							// 避免重复接收自己刚发出的已渲染消息
							if (!lastSeenMessageIds.has(mid)) {
								lastSeenMessageIds.add(mid);
								onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message', message: ev.message }), socket);
							} else {
								// 如果内容发生了流式变动，派发 message_updated
								onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message_updated', message: ev.message }), socket);
							}
						} else if (ev.eventType === 'deleted') {
							onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message_deleted', messageId: ev.messageId }), socket);
						}
					}
				}
				if (res.nextCursor) cursor = Math.max(cursor, Number(res.nextCursor) || 0);
			}
		} catch (e) {
			if (e?.message?.includes('sync_cursor_expired') || e?.status === 409) {
				cursor = 0;
			}
		} finally {
			if (!closed) {
				// 前台高频轮询（1 秒一次），体验丝滑无感
				timer = setTimeout(poll, 1000);
			}
		}
	}

	// 模拟连接建立，并在 30ms 后通知状态就绪
	setTimeout(() => {
		if (!closed) {
			onStatus?.({ status: 'open', socket });
			void poll();
		}
	}, 30);

	return socket;
}

function openSocket(url, { onMessage, onStatus }) {
	const socket = new WebSocket(url);

	socket.addEventListener("open", () => {
		onStatus?.({ status: "open", socket });
	});

	socket.addEventListener("close", (event) => {
		onStatus?.({
			status: "closed",
			socket,
			code: event.code,
			reason: event.reason,
			wasClean: event.wasClean,
		});
	});

	socket.addEventListener("error", () => {
		onStatus?.({ status: "error", socket });
	});

	socket.addEventListener("message", (event) => {
		onMessage?.(event.data, socket);
	});

	return socket;
}

export function connectRoomSocket({ kind, roomId, onMessage, onStatus }) {
	if (isDemoMode) {
		return connectRuntimeRoomSocket({ kind, roomId, onMessage, onStatus });
	}

	// 纯 Pages + D1 架构优先使用智能增量同步，彻底免除跨边缘 WebSocket/DO 依赖
	return createPollingRoomSocket({ kind, roomId, onMessage, onStatus });
}

export function connectInboxSocket({ onMessage, onStatus }) {
	if (isDemoMode) {
		return connectRuntimeInboxSocket({ onMessage, onStatus });
	}

	let closed = false;
	const socket = {
		readyState: 1,
		send() {},
		close() {
			closed = true;
			onStatus?.({ status: 'closed', socket, code: 1000, wasClean: true });
		}
	};
	setTimeout(() => {
		if (!closed) onStatus?.({ status: 'open', socket });
	}, 30);
	return socket;
}
