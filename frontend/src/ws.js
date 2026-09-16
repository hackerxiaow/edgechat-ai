import api from "./api.js";
import {
	connectRuntimeInboxSocket,
	connectRuntimeRoomSocket,
	isDemoMode,
} from "./runtime.js";

function createPollingRoomSocket({ kind, roomId, onMessage, onStatus }) {
	let closed = false;
	let cursor = 0;
	let cursorInitialized = false;
	let timer = null;
	const lastSeenMessageIds = new Set();

	async function fetchSync() {
		if (closed) return;
		try {
			if (!cursorInitialized) {
				const res = await api.getRecentMessages(kind, roomId, 30);
				cursor = Number(res?.syncCursor) || 0;
				cursorInitialized = true;
				if (Array.isArray(res?.messages)) {
					for (const m of res.messages) {
						lastSeenMessageIds.add(Number(m.id));
					}
				}
			} else {
				const res = await api.syncRoomMessages(kind, roomId, cursor);
				if (res && Array.isArray(res.events) && res.events.length > 0) {
					for (const ev of res.events) {
						cursor = Math.max(cursor, Number(ev.sequence) || 0);
						if (ev.message && (ev.eventType === 'created' || ev.type === 'message' || ev.type === 'message_updated' || ev.eventType === 'updated')) {
							lastSeenMessageIds.add(Number(ev.message.id));
							onMessage?.(JSON.stringify({
								protocolVersion: 1,
								type: ev.eventType === 'updated' ? 'message_updated' : 'message',
								message: ev.message
							}), socket);
						} else if (ev.eventType === 'deleted' || ev.type === 'message_deleted') {
							onMessage?.(JSON.stringify({
								protocolVersion: 1,
								type: 'message_deleted',
								messageId: ev.messageId
							}), socket);
						}
					}
				}
				if (res?.nextCursor) {
					cursor = Math.max(cursor, Number(res.nextCursor) || 0);
				}
			}
		} catch (e) {
			if (String(e?.message || '').includes('expired') || e?.status === 409) {
				cursorInitialized = false;
			}
		} finally {
			if (!closed) {
				// 始终每 800ms 高敏度轮询，捕获服务端所有新产生或更新的消息
				timer = setTimeout(fetchSync, 800);
			}
		}
	}

	const socket = {
		readyState: 1,
		send() {},
		close() {
			closed = true;
			if (timer) clearTimeout(timer);
			onStatus?.({ status: 'closed', socket, code: 1000, wasClean: true });
		}
	};

	queueMicrotask(() => {
		if (!closed) {
			onStatus?.({ status: 'open', socket });
			void fetchSync();
		}
	});

	return socket;
}

export function connectRoomSocket({ kind, roomId, onMessage, onStatus }) {
	if (isDemoMode) {
		return connectRuntimeRoomSocket({ kind, roomId, onMessage, onStatus });
	}
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
	queueMicrotask(() => {
		if (!closed) onStatus?.({ status: 'open', socket });
	});
	return socket;
}
