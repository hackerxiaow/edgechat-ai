import { computed, ref } from "vue";
import api from "../api.js";
import { compareLocalized, formatDate, t } from "../i18n.js";
import { formatConversationPreview } from "../utils/conversation-preview.js";

function formatListTime(value) {
	if (!value) {
		return "";
	}
	return formatDate(value, { month: "short", day: "numeric" });
}

function mapChannelItem(channel, defaultSubtitle, currentUserId) {
	const preview = formatConversationPreview(channel, currentUserId);
	return {
		key: `${channel.kind}:${channel.id}`,
		id: channel.id,
		kind: channel.kind,
		isGeneral: Boolean(channel.isGeneral),
		title: channel.name,
		subtitle: preview?.preview || defaultSubtitle,
		lastMessageSender: preview?.sender || '',
		lastMessageText: preview?.text || '',
		hasLastMessage: Boolean(preview),
		avatarUrl: channel.avatarUrl || "",
		fallback: channel.name ? channel.name.slice(0, 1) : t('publicGroups.fallback'),
		lastMessageAt: channel.lastMessageAt || "",
		dateLabel: formatListTime(channel.lastMessageAt),
		unreadCount: Number(channel.unreadCount || 0),
		mentionUnreadCount: Number(channel.mentionUnreadCount || 0),
		source: channel,
	};
}

export function useChatSidebar({ applyActiveChannel, selectDm, currentUserId = null, sidebarApi = api }) {
	const channels = ref([]);
	const dms = ref([]);
	const users = ref([]);
	const sidebarLoading = ref(false);

	const conversationItems = computed(() => {
		const uid = typeof currentUserId === 'object' && currentUserId !== null && 'value' in currentUserId
			? currentUserId.value
			: currentUserId;

		const dmItems = dms.value.map((dm) => {
			const preview = formatConversationPreview(dm, uid);
			return {
				key: `dm:${dm.id}`,
				id: dm.id,
				kind: "dm",
				title: dm.otherUser.displayName,
				subtitle: preview?.preview || t('chat.contact', { username: dm.otherUser.username }),
				lastMessageSender: preview?.sender || '',
				lastMessageText: preview?.text || '',
				hasLastMessage: Boolean(preview),
				avatarUrl: dm.otherUser.avatarUrl,
				fallback: dm.otherUser.displayName,
				lastMessageAt: dm.lastMessageAt || "",
				dateLabel: formatListTime(dm.lastMessageAt),
				unreadCount: Number(dm.unreadCount || 0),
				mentionUnreadCount: Number(dm.mentionUnreadCount || 0),
				source: dm,
			};
		});

		const channelItems = channels.value
			.filter((channel) => channel.isMember)
			.map((channel) =>
				mapChannelItem(
					channel,
					channel.isGeneral
							? t('chat.generalGroup')
							: t('chat.owner', {
								name: channel.ownerDisplayName || t('common.unknown'),
							}),
					uid,
				),
			);

		return [...dmItems, ...channelItems].sort((left, right) => {
				if (left.isGeneral !== right.isGeneral) {
					return left.isGeneral ? -1 : 1;
				}

				const leftTime = left.lastMessageAt
				? new Date(left.lastMessageAt).getTime()
				: 0;
			const rightTime = right.lastMessageAt
				? new Date(right.lastMessageAt).getTime()
				: 0;
			if (leftTime !== rightTime) {
				return rightTime - leftTime;
			}
				return compareLocalized(left.title, right.title);
		});
	});

	const publicGroupItems = computed(() =>
		channels.value
			.filter((channel) => channel.kind === "public" && !channel.isMember)
			.map((channel) =>
					mapChannelItem(channel, t('chat.memberCount', { count: Number(channel.memberCount || 0) })),
			)
				.sort((left, right) => compareLocalized(left.title, right.title)),
	);

	function findConversationSource(kind, roomId) {
		const list = kind === "dm" ? dms.value : channels.value;
		return list.find(
			(item) => item.kind === kind && Number(item.id) === Number(roomId),
		);
	}

	function markConversationRead(kind, roomId) {
		const source = findConversationSource(kind, roomId);
		if (source) {
				source.unreadCount = 0;
				source.mentionUnreadCount = 0;
		}
	}

		function applyConversationActivity({
			kind,
			roomId,
			lastMessageAt,
			lastMessage,
			unreadCount,
			mentionUnreadCount,
		}) {
			const source = findConversationSource(kind, roomId);
			if (!source) {
				return;
			}

			if (lastMessage) {
				source.lastMessage = {
					senderId: lastMessage.senderId ?? lastMessage.sender?.id,
					senderName: lastMessage.senderName || lastMessage.sender?.displayName || lastMessage.sender?.username || '',
					content: lastMessage.content || '',
					attachment: lastMessage.attachment || null,
					attachmentKind: lastMessage.attachmentKind || lastMessage.attachment?.kind || null,
					createdAt: lastMessage.createdAt || lastMessageAt || new Date().toISOString()
				};
			}

			if (lastMessageAt) {
				const currentTime = source.lastMessageAt
					? new Date(source.lastMessageAt).getTime()
					: 0;
				const nextTime = new Date(lastMessageAt).getTime();
				if (!currentTime || nextTime >= currentTime) {
					source.lastMessageAt = lastMessageAt;
				}
			}

			if (unreadCount !== undefined) {
				source.unreadCount = Math.max(0, Number(unreadCount || 0));
			}
			if (mentionUnreadCount !== undefined) {
				source.mentionUnreadCount = Math.max(0, Number(mentionUnreadCount || 0));
			}
		}

	async function refreshSidebar() {
		sidebarLoading.value = true;
		try {
			const payload = await sidebarApi.bootstrap();
			channels.value = payload.channels || [];
			dms.value = payload.dms || [];
			users.value = payload.users || [];
		} finally {
			sidebarLoading.value = false;
		}
	}

	async function joinPublicChannel(channel) {
		await sidebarApi.joinChannel(channel.id);
		const joinedChannel = channels.value.find(
			(item) => item.kind === channel.kind && Number(item.id) === Number(channel.id),
		);
		joinedChannel.isMember = true;
		joinedChannel.myRole = "member";
		joinedChannel.memberCount = Number(joinedChannel.memberCount || 0) + 1;
		return joinedChannel;
	}

	async function openConversation(item) {
		if (item.kind === "dm") {
			selectDm(item.source);
			markConversationRead(item.kind, item.id);
			void sidebarApi.markRoomRead(item.kind, item.id).catch(() => {});
			return;
		}

		applyActiveChannel(item.source);
		markConversationRead(item.kind, item.id);
		void sidebarApi.markRoomRead(item.kind, item.id).catch(() => {});
	}

	return {
		channels,
		dms,
		users,
		sidebarLoading,
		conversationItems,
		publicGroupItems,
		markConversationRead,
		applyConversationActivity,
		refreshSidebar,
		openConversation,
		joinPublicChannel,
	};
}
