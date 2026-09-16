import { nextTick, ref, watch } from "vue";
import api from "../api.js";
import { dispatchAuthInvalid } from "../auth-storage.js";
import { createRealtimeSession } from "../realtime-session.js";
import { connectRoomSocket } from "../ws.js";
import { t } from "../i18n.js";
import { localizeErrorMessage } from "../localized-error.js";

const WS_CLOSE_UNAUTHORIZED = 4401;
const WS_CLOSE_FORBIDDEN = 4403;
const WS_REASON_UNAUTHORIZED = "session_invalid";
const WS_REASON_FORBIDDEN = "room_forbidden";

export function useChatRoom({
	activeRoom,
	session,
	error,
	roomVisible = { value: true },
	onRoomActivity = () => {},
	onRoomAccessRevoked = () => {},
	roomApi = api,
	openRoomConnection = connectRoomSocket,
}) {
	const messages = ref([]);
	const pinnedMessage = ref(null);
	const highlightedMessageId = ref(null);
	const loading = ref(false);
	const wsStatus = ref("closed");
	const composerText = ref("");
	const pendingAttachment = ref(null);
	const sending = ref(false);
	const messagesEl = ref(null);
	/** 当前房间里仍在输入的人（不含自己）。 */
	const typingUsers = ref([]);
	let typingSentAt = 0;
	let typingActive = false;
	let messageLoadGeneration = 0;
	let highlightTimer = null;

	function roomKey(room = activeRoom.value) {
		return room?.kind && room?.id ? `${room.kind}:${room.id}` : "";
	}

	/**
	 * 上报「正在输入」。D1 模式下 socket.send 是空操作，必须走独立 HTTP 请求
	 * （与 markRoomRead 同一模式）。按 2.5 秒节流，避免每敲一个字就打一次 D1。
	 */
	function reportTyping(typing) {
		const room = activeRoom.value;
		if (!room?.kind || !room?.id) return;
		const now = Date.now();
		if (typing) {
			if (typingActive && now - typingSentAt < 2500) return;
			typingActive = true;
			typingSentAt = now;
		} else {
			if (!typingActive) return;
			typingActive = false;
			typingSentAt = 0;
		}
		void roomApi.setRoomTyping(room.kind, room.id, typing).catch(() => {});
	}

	function clearTyping() {
		typingUsers.value = [];
	}

	function isOwnMessage(message) {
		return (
			message.sender.kind !== "external" &&
			Number(message.sender.id) === Number(session.value?.userId)
		);
	}

	function scrollToBottom() {
		const element = messagesEl.value;
		if (element) {
			requestAnimationFrame(() => {
				element.scrollTop = element.scrollHeight;
			});
		}
	}

	function mergeMessages(...collections) {
		const byId = new Map();
		for (const collection of collections) {
			for (const message of collection || []) {
				byId.set(Number(message.id), message);
			}
		}
		return [...byId.values()].sort((left, right) => Number(left.id) - Number(right.id));
	}

	function highlightMessage(messageId) {
		const numericMessageId = Number(messageId);
		const element = messagesEl.value?.querySelector(
			`[data-message-id="${numericMessageId}"]`,
		);
		if (!element) {
			return false;
		}
		element.scrollIntoView({ behavior: "smooth", block: "center" });
		highlightedMessageId.value = numericMessageId;
		if (highlightTimer !== null) {
			globalThis.clearTimeout(highlightTimer);
		}
		highlightTimer = globalThis.setTimeout(() => {
			highlightedMessageId.value = null;
			highlightTimer = null;
		}, 1400);
		return true;
	}

	function clearMessageHighlight() {
		highlightedMessageId.value = null;
		if (highlightTimer !== null) {
			globalThis.clearTimeout(highlightTimer);
			highlightTimer = null;
		}
	}

	function applyActiveRoomActivity(message) {
		if (!activeRoom.value || !message || !roomVisible.value) {
			return;
		}

		onRoomActivity({ room: activeRoom.value, message });

		if (!isOwnMessage(message)) {
			void roomApi
				.markRoomRead(activeRoom.value.kind, activeRoom.value.id, message.id)
				.catch(() => {});
		}
	}

	function handleRoomAccessRevoked() {
		const room = activeRoom.value;
		if (!room) {
			return;
		}

		disconnectSocket();
		messages.value = [];
		pinnedMessage.value = null;
		clearMessageHighlight();
		onRoomAccessRevoked(room);
	}

	function handleSocketClose(event) {
		const code = Number(event?.code || 0);
		const reason = String(event?.reason || "");
		if (code === WS_CLOSE_UNAUTHORIZED || reason === WS_REASON_UNAUTHORIZED) {
			dispatchAuthInvalid(t('chat.sessionInvalid'));
			return;
		}
		if (code === WS_CLOSE_FORBIDDEN || reason === WS_REASON_FORBIDDEN) {
			handleRoomAccessRevoked();
		}
	}

	function upsertMessage(message) {
		if (!message) return;
		const targetId = Number(message.id);
		const clientMsgId = message.clientMessageId;
		const idx = messages.value.findIndex((m) =>
			(targetId > 0 && Number(m.id) === targetId) ||
			(clientMsgId && m.clientMessageId === clientMsgId)
		);
		if (idx !== -1) {
			messages.value[idx] = { ...messages.value[idx], ...message };
		} else {
			messages.value = [...messages.value, message];
		}
		nextTick().then(scrollToBottom);
	}

	const roomSession = createRealtimeSession({
		openConnection(params, handlers) {
			return openRoomConnection({
				kind: params.kind,
				roomId: params.roomId,
				...handlers,
				// typing 随 800ms 轮询的响应一起回来，不额外发请求。
				onTyping: (users) => {
					if (roomKey() !== `${params.kind}:${params.roomId}`) return;
					typingUsers.value = Array.isArray(users) ? users : [];
				},
			});
		},
		onStatus(event) {
			wsStatus.value = event.status === "reconnecting" ? "connecting" : event.status;
		},
		onClose: handleSocketClose,
		onMessage(payload, connection) {
			if (connection?.key !== roomKey()) {
				return;
			}
			if ((payload.type === "message" || payload.type === "message_updated") && payload.message) {
				upsertMessage(payload.message);
				applyActiveRoomActivity(payload.message);
				return;
			}
			if (payload.type === "message_deleted") {
				const messageId = Number(payload.messageId);
				messages.value = messages.value
					.filter((message) => Number(message.id) !== messageId)
					.map((message) =>
						Number(message.replyToMessageId) === messageId
							? { ...message, replyTo: { id: messageId, deleted: true } }
							: message,
					);
				if (Number(pinnedMessage.value?.id) === messageId) {
					pinnedMessage.value = null;
				}
			}
			if (payload.type === "message_pinned" && payload.message) {
				pinnedMessage.value = payload.message;
			}
			if (
				payload.type === "message_unpinned" &&
				Number(pinnedMessage.value?.id) === Number(payload.messageId)
			) {
				pinnedMessage.value = null;
			}
			if (payload.type === "error") {
				error.value = localizeErrorMessage(payload.error);
			}
		},
	});

	async function loadMessages(before = null, append = false) {
		const room = activeRoom.value;
		const key = roomKey(room);
		if (!key) {
			return false;
		}

		const generation = ++messageLoadGeneration;
		loading.value = true;
		error.value = "";
		try {
			const payload = await roomApi.getMessages(room.kind, room.id, before);
			if (generation !== messageLoadGeneration || roomKey() !== key) {
				return false;
			}
			messages.value = append
				? mergeMessages(payload.messages, messages.value)
				: payload.messages;
			pinnedMessage.value = payload.pinnedMessage || null;
			await nextTick();
			if (!append) {
				scrollToBottom();
			}
			return true;
		} catch (currentError) {
			if (generation === messageLoadGeneration && roomKey() === key) {
				error.value = currentError.message;
			}
			return false;
		} finally {
			if (generation === messageLoadGeneration) {
				loading.value = false;
			}
		}
	}

	async function activateRoom() {
		messageLoadGeneration += 1;
		messages.value = [];
		pinnedMessage.value = null;
		clearMessageHighlight();
		loading.value = false;
		connectSocket();
		return loadMessages();
	}

	function deactivateRoom() {
		messageLoadGeneration += 1;
		messages.value = [];
		pinnedMessage.value = null;
		clearMessageHighlight();
		loading.value = false;
		disconnectSocket();
	}

	function pauseRoom() {
		// 离开聊天内容时只终止在途读取与实时连接，草稿和现有消息留给返回后的恢复流程。
		messageLoadGeneration += 1;
		loading.value = false;
		disconnectSocket();
	}

	function connectSocket() {
		if (!activeRoom.value) {
			return;
		}
		const key = roomKey();
		roomSession.connect(key, {
			kind: activeRoom.value.kind,
			roomId: activeRoom.value.id,
		});
	}

	function disconnectSocket() {
		roomSession.disconnect();
	}

		async function sendMessage(mentionUserIds = [], replyMessageId = null) {
			if (!activeRoom.value) return false;
			if (!composerText.value.trim() && !pendingAttachment.value) {
				return false;
			}

			sending.value = true;
		reportTyping(false);
			error.value = "";
			const clientMessageId = crypto.randomUUID();
			const content = composerText.value;
			const attachment = pendingAttachment.value;
			composerText.value = "";
			pendingAttachment.value = null;

			// 乐观立即上屏：0ms 即刻看到自己的消息！
			const tempId = -Date.now();
			const optimisticMsg = {
				id: tempId,
				content,
				attachment,
				sender: {
					kind: 'local',
					id: Number(session.value?.userId || 1),
					username: session.value?.username || 'me',
					displayName: session.value?.displayName || session.value?.username || 'me',
					avatarUrl: session.value?.avatarUrl || '',
					source: 'edgechat'
				},
				createdAt: new Date().toISOString(),
				source: 'edgechat',
				clientMessageId
			};
			upsertMessage(optimisticMsg);

			try {
				const res = await roomApi.sendRoomMessage(activeRoom.value.kind, activeRoom.value.id, {
					clientMessageId,
					content,
					attachment,
					mentionUserIds,
					replyMessageId: replyMessageId ? Number(replyMessageId) : null
				});
				if (res?.message) {
					upsertMessage(res.message);
				}
				return true;
			} catch (currentError) {
				error.value = currentError.message;
				messages.value = messages.value.filter(m => m.id !== tempId && m.clientMessageId !== clientMessageId);
				return false;
			} finally {
				sending.value = false;
			}
		}

		async function sendVoiceMessage(recording, replyMessageId = null) {
			const key = roomKey();
			if (!roomSession.isOpenFor(key)) {
				error.value = t('chat.realtimeNotReady');
				return false;
			}
			sending.value = true;
			error.value = "";
			let attachment = null;
			try {
				const payload = await roomApi.uploadFile(recording.file);
				attachment = {
					...payload.file,
					kind: "voice",
					durationMs: recording.durationMs,
					waveform: recording.waveform,
				};
				roomSession.send(
					JSON.stringify({
						type: "send",
						content: "",
						attachment,
						mentionUserIds: [],
						replyMessageId: replyMessageId ? Number(replyMessageId) : null,
					}),
					key,
				);
				return true;
			} catch (currentError) {
				pendingAttachment.value = attachment;
				error.value = currentError.message;
				return false;
			} finally {
				sending.value = false;
			}
		}

	function deleteMessage(messageId) {
		const key = activeRoom.value
			? `${activeRoom.value.kind}:${activeRoom.value.id}`
			: "";
		if (!roomSession.isOpenFor(key)) {
			error.value = t('chat.realtimeNotReady');
			return false;
		}

		error.value = "";
		return roomSession.send(
			JSON.stringify({ type: "delete_message", messageId: Number(messageId) }),
			key,
		);
	}

	function pinMessage(messageId) {
		const key = roomKey();
		if (!roomSession.isOpenFor(key)) {
			error.value = t('chat.realtimeNotReady');
			return false;
		}
		error.value = "";
		return roomSession.send(
			JSON.stringify({ type: "pin_message", messageId: Number(messageId) }),
			key,
		);
	}

	function unpinMessage(messageId) {
		const key = roomKey();
		if (!roomSession.isOpenFor(key)) {
			error.value = t('chat.realtimeNotReady');
			return false;
		}
		error.value = "";
		return roomSession.send(
			JSON.stringify({ type: "unpin_message", messageId: Number(messageId) }),
			key,
		);
	}

	async function revealMessage(messageId) {
		const targetId = Number(messageId);
		const key = roomKey();
		if (!targetId || !key) {
			return false;
		}
		await nextTick();
		if (highlightMessage(targetId)) {
			return true;
		}

		try {
			const room = activeRoom.value;
			const payload = await roomApi.getMessages(room.kind, room.id, targetId + 1);
			if (roomKey() !== key) {
				return false;
			}
			pinnedMessage.value = payload.pinnedMessage || pinnedMessage.value;
			messages.value = mergeMessages(payload.messages, messages.value);
			await nextTick();
			return highlightMessage(targetId);
		} catch (currentError) {
			error.value = currentError.message;
			return false;
		}
	}

	function revealPinnedMessage() {
		return revealMessage(pinnedMessage.value?.id);
	}

	async function uploadAttachment(file) {
		if (!file) {
			return;
		}

		try {
			const payload = await roomApi.uploadFile(file);
			pendingAttachment.value = payload.file;
		} catch (currentError) {
			error.value = currentError.message;
		}
	}

	function clearAttachment() {
		pendingAttachment.value = null;
	}

	async function loadOlder() {
		if (loading.value) {
			return;
		}
		const firstMessage = messages.value[0];
		if (firstMessage) {
			await loadMessages(firstMessage.id, true);
		}
	}

	watch(
		messages,
		(current, previous) => {
			const receivedNewLastMessage =
				current.length > previous.length &&
				current.at(-1)?.id !== previous.at(-1)?.id;
			if (receivedNewLastMessage) {
				nextTick().then(scrollToBottom);
			}
		},
		{ flush: "post" },
	);

	return {
		messages,
		pinnedMessage,
		highlightedMessageId,
		loading,
		wsStatus,
		composerText,
		pendingAttachment,
		sending,
		messagesEl,
		typingUsers,
		reportTyping,
		clearTyping,
		isOwnMessage,
		loadMessages,
		activateRoom,
		deactivateRoom,
		pauseRoom,
		connectSocket,
		disconnectSocket,
			sendMessage,
			sendVoiceMessage,
		deleteMessage,
		pinMessage,
			unpinMessage,
			revealMessage,
			revealPinnedMessage,
		uploadAttachment,
		clearAttachment,
		loadOlder,
	};
}
