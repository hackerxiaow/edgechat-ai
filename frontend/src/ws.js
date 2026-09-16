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
	const lastSeenMessageIds = new Set();

	async function fetchSync() {
		if (closed) return;
		try {
			if (cursor === 0) {
				const res = await api.getRecentMessages(kind, roomId, 30);
				cursor = Number(res.syncCursor) || 0;
				if (Array.isArray(res.messages)) {
					for (const m of res.messages) {
						lastSeenMessageIds.add(Number(m.id));
					}
				}
			} else {
				const res = await api.syncRoomMessages(kind, roomId, cursor);
				if (res && Array.isArray(res.events) && res.events.length > 0) {
					for (const ev of res.events) {
						cursor = Math.max(cursor, Number(ev.sequence) || 0);
						if (ev.message && (ev.eventType === 'created' || ev.type === 'message')) {
							const mid = Number(ev.message.id);
							if (!lastSeenMessageIds.has(mid)) {
								lastSeenMessageIds.add(mid);
								onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message', message: ev.message }), socket);
							} else {
								onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message_updated', message: ev.message }), socket);
							}
						} else if (ev.message && (ev.type === 'message_updated' || ev.eventType === 'updated')) {
							onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message_updated', message: ev.message }), socket);
						} else if (ev.eventType === 'deleted' || ev.type === 'message_deleted') {
							onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message_deleted', messageId: ev.messageId }), socket);
						}
					}
				}
				if (res?.nextCursor) {
					cursor = Math.max(cursor, Number(res.nextCursor) || 0);
				}
			}
		} catch (e) {
			if (String(e?.message || '').includes('expired') || e?.status === 409) {
				cursor = 0;
			}
		} finally {
			if (!closed) {
				// 始终每 800ms 轮询一次，高敏度保证收到 AI 与其他成员的新消息
				timer = setTimeout(fetchSync, 800);
			}
		}
	}

	const socket = {
		readyState: 1,
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
						if (res?.message) {
							lastSeenMessageIds.add(Number(res.message.id));
							onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message', message: res.message }), socket);
						}
						void fetchSync();
					}).catch(err => {
						onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'error', error: err.message }), socket);
					});
				} else if (payload.type === 'delete_message') {
					api.deleteRoomMessage(kind, roomId, payload.messageId).then(() => {
						onMessage?.(JSON.stringify({ protocolVersion: 1, type: 'message_deleted', messageId: payload.messageId }), socket);
						void fetchSync();
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

	// 立即通知已打开，并开始常驻高频增量同步
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
