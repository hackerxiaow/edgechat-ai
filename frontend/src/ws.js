import api from "./api.js";
import {
	advanceAfterFailure,
	advanceAfterSuccess,
	createPollState,
	nextPollDelayMs,
	resetForForeground,
} from "./realtime-polling.js";
import {
	connectRuntimeInboxSocket,
	connectRuntimeRoomSocket,
	isDemoMode,
} from "./runtime.js";

/** 后台标签页不需要 800ms 级别的实时性，回前台时会立刻补一次同步。 */
function isDocumentHidden() {
	return typeof document !== "undefined" && document.visibilityState === "hidden";
}

function createPollingRoomSocket({ kind, roomId, onMessage, onTyping, onStatus }) {
	let closed = false;
	let cursor = 0;
	let cursorInitialized = false;
	let timer = null;
	let inFlight = false;
	const lastSeenMessageIds = new Set();
	const pollState = createPollState();

	function schedule(delayMs) {
		if (closed) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(fetchSync, delayMs);
	}

	async function fetchSync() {
		if (closed || inFlight) return;
		inFlight = true;
		let hasEvents = false;
		try {
			if (!cursorInitialized) {
				const res = await api.getRecentMessages(kind, roomId, 30);
				cursor = Number(res?.syncCursor) || 0;
				cursorInitialized = true;
				onTyping?.(Array.isArray(res?.typing) ? res.typing : []);
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
				onTyping?.(Array.isArray(res?.typing) ? res.typing : []);
				// 只有真的拿到新事件才算「热」，否则进入空转退避
				hasEvents = Array.isArray(res?.events) && res.events.length > 0;
			}
			advanceAfterSuccess(pollState, hasEvents);
		} catch (e) {
			advanceAfterFailure(pollState);
			if (String(e?.message || '').includes('expired') || e?.status === 409) {
				cursorInitialized = false;
			}
		} finally {
			inFlight = false;
			// 有事件/回前台 = 800ms 热态；空转逐级退避到 5s；后台 30s；失败指数退避到 30s
			schedule(nextPollDelayMs(pollState, { hidden: isDocumentHidden() }));
		}
	}

	/** 回到前台或网络恢复：清掉退避状态并立即同步一次。 */
	function wakeNow() {
		resetForForeground(pollState);
		if (closed) return;
		if (timer) {
			clearTimeout(timer);
			timer = null;
		}
		void fetchSync();
	}

	function handleVisibilityChange() {
		if (!isDocumentHidden()) wakeNow();
	}

	if (typeof document !== "undefined") {
		document.addEventListener("visibilitychange", handleVisibilityChange);
	}
	if (typeof window !== "undefined") {
		window.addEventListener("online", wakeNow);
	}

	const socket = {
		readyState: 1,
		send() {},
		close() {
			closed = true;
			if (timer) {
				clearTimeout(timer);
				timer = null;
			}
			if (typeof document !== "undefined") {
				document.removeEventListener("visibilitychange", handleVisibilityChange);
			}
			if (typeof window !== "undefined") {
				window.removeEventListener("online", wakeNow);
			}
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

export function connectRoomSocket({ kind, roomId, onMessage, onTyping, onStatus }) {
	if (isDemoMode) {
		return connectRuntimeRoomSocket({ kind, roomId, onMessage, onStatus });
	}
	return createPollingRoomSocket({ kind, roomId, onMessage, onTyping, onStatus });
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
