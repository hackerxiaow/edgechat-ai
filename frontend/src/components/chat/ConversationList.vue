<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import { AtSign, BellOff, Pin } from '@lucide/vue';
import { t } from '../../i18n.js';
import UiAvatar from '../ui/Avatar.vue';
import ConversationContextMenu from './ConversationContextMenu.vue';

const props = defineProps({
	items: {
		type: Array,
		default: () => [],
	},
	activeKey: {
		type: String,
		default: '',
	},
	loading: {
		type: Boolean,
		default: false,
	},
	isRoomMuted: {
		type: Function,
		default: () => false,
	},
	drafts: {
		type: Object,
		default: () => ({}),
	},
});

const emit = defineEmits(['select', 'toggle-mute', 'mark-read', 'mark-unread']);

const activeFolder = ref('all');
const pinnedKeys = ref(new Set());
const archivedKeys = ref(new Set());

// 菜单状态
const menuState = ref({
	open: false,
	x: 0,
	y: 0,
	item: null,
});

onMounted(() => {
	try {
		const storedPinned = localStorage.getItem('edgechat_pinned_rooms');
		if (storedPinned) pinnedKeys.value = new Set(JSON.parse(storedPinned));
		const storedArchived = localStorage.getItem('edgechat_archived_rooms');
		if (storedArchived) archivedKeys.value = new Set(JSON.parse(storedArchived));
	} catch {}
});

function savePinned() {
	try {
		localStorage.setItem('edgechat_pinned_rooms', JSON.stringify([...pinnedKeys.value]));
	} catch {}
}

function saveArchived() {
	try {
		localStorage.setItem('edgechat_archived_rooms', JSON.stringify([...archivedKeys.value]));
	} catch {}
}

function togglePin(item) {
	if (!item?.key) return;
	const next = new Set(pinnedKeys.value);
	if (next.has(item.key)) {
		next.delete(item.key);
	} else {
		next.add(item.key);
	}
	pinnedKeys.value = next;
	savePinned();
}

function toggleArchive(item) {
	if (!item?.key) return;
	const next = new Set(archivedKeys.value);
	if (next.has(item.key)) {
		next.delete(item.key);
	} else {
		next.add(item.key);
	}
	archivedKeys.value = next;
	saveArchived();
}

const totalUnreadCount = computed(() =>
	props.items.reduce((sum, item) => sum + (Number(item.unreadCount) || 0), 0),
);

const filteredAndSortedItems = computed(() => {
	const filtered = props.items.filter((item) => {
		const isArchived = archivedKeys.value.has(item.key);
		if (activeFolder.value !== 'archived' && isArchived) return false;
		if (activeFolder.value === 'archived') return isArchived;
		if (activeFolder.value === 'groups') return item.kind !== 'dm';
		if (activeFolder.value === 'dms') return item.kind === 'dm';
		if (activeFolder.value === 'unread') return item.unreadCount > 0;
		return true;
	});

	return filtered.sort((left, right) => {
		const leftPinned = pinnedKeys.value.has(left.key);
		const rightPinned = pinnedKeys.value.has(right.key);
		if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
		if (left.isGeneral !== right.isGeneral) return left.isGeneral ? -1 : 1;
		return (right.lastMessageAt || '').localeCompare(left.lastMessageAt || '');
	});
});

function openContextMenu(event, item) {
	menuState.value = {
		open: true,
		x: event.clientX,
		y: event.clientY,
		item,
	};
}

function closeContextMenu() {
	menuState.value.open = false;
	menuState.value.item = null;
}
</script>

<template>
	<div class="sidebar-section sidebar-list">
		<!-- Telegram Web 风格的会话文件夹标签栏 -->
		<div class="folder-tabs-bar" role="tablist">
			<button
				type="button"
				role="tab"
				class="folder-tab"
				:class="{ 'folder-tab--active': activeFolder === 'all' }"
				:aria-selected="activeFolder === 'all'"
				@click="activeFolder = 'all'"
			>
				{{ t('chat.folderAll') }}
			</button>
			<button
				type="button"
				role="tab"
				class="folder-tab"
				:class="{ 'folder-tab--active': activeFolder === 'groups' }"
				:aria-selected="activeFolder === 'groups'"
				@click="activeFolder = 'groups'"
			>
				{{ t('chat.folderGroups') }}
			</button>
			<button
				type="button"
				role="tab"
				class="folder-tab"
				:class="{ 'folder-tab--active': activeFolder === 'dms' }"
				:aria-selected="activeFolder === 'dms'"
				@click="activeFolder = 'dms'"
			>
				{{ t('chat.folderDms') }}
			</button>
			<button
				type="button"
				role="tab"
				class="folder-tab"
				:class="{ 'folder-tab--active': activeFolder === 'unread' }"
				:aria-selected="activeFolder === 'unread'"
				@click="activeFolder = 'unread'"
			>
				<span>{{ t('chat.folderUnread') }}</span>
				<span v-if="totalUnreadCount > 0" class="folder-unread-dot">
					{{ totalUnreadCount > 99 ? '99+' : totalUnreadCount }}
				</span>
			</button>
			<button
				v-if="archivedKeys.size"
				type="button"
				role="tab"
				class="folder-tab"
				:class="{ 'folder-tab--active': activeFolder === 'archived' }"
				:aria-selected="activeFolder === 'archived'"
				@click="activeFolder = 'archived'"
			>
				{{ t('chat.archivedChats') }}
			</button>
		</div>

		<div v-if="loading" class="sidebar-hint">
			{{ t("chat.loadingConversations") }}
		</div>
		<div v-else-if="!filteredAndSortedItems.length" class="sidebar-hint">
			{{ t("chat.noConversations") }}
		</div>
		<button
			v-for="item in filteredAndSortedItems"
			:key="item.key"
			type="button"
			class="sidebar-item"
			:class="{
				'sidebar-item--active': activeKey === item.key,
				'sidebar-item--unread': item.unreadCount > 0,
				'sidebar-item--pinned': pinnedKeys.has(item.key)
			}"
			:aria-current="activeKey === item.key ? 'true' : undefined"
			:title="item.title"
			@click="emit('select', item)"
			@contextmenu.prevent="openContextMenu($event, item)"
		>
			<UiAvatar
				:src="item.avatarUrl"
				:fallback="item.fallback?.[0] || '?'"
				size="sm"
			/>
			<div class="sidebar-label-group">
				<div class="sidebar-item__top">
					<div class="sidebar-item__title-wrap">
						<strong>{{ item.title }}</strong>
						<span
							v-if="isRoomMuted(item)"
							class="sidebar-muted-pill"
							:title="t('chat.muted')"
							:aria-label="t('chat.muted')"
						>
							<BellOff :size="11" aria-hidden="true" />
						</span>
					</div>
					<div class="sidebar-item__time-group">
						<Pin v-if="pinnedKeys.has(item.key)" :size="12" class="sidebar-pin-icon" aria-hidden="true" />
						<span class="sidebar-item__time">{{ item.dateLabel }}</span>
					</div>
				</div>
				<div class="sidebar-item__bottom">
					<p class="sidebar-item__preview">
						<template v-if="drafts[item.key]">
							<span class="sidebar-item__draft">{{ t('chat.draft') }}: </span>
							<span class="sidebar-item__draft-text">{{ drafts[item.key] }}</span>
						</template>
						<template v-else-if="item.lastMessageSender">
							<span class="sidebar-item__sender">{{ item.lastMessageSender }}: </span>
							<span class="sidebar-item__text">{{ item.lastMessageText }}</span>
						</template>
						<span v-else class="sidebar-item__text">{{ item.subtitle }}</span>
					</p>
					<span v-if="item.mentionUnreadCount > 0" class="sidebar-mention-badge">
						<AtSign :size="13" aria-hidden="true" />
						{{ t("chat.mentionedMe") }}
					</span>
					<span
						v-if="item.unreadCount > 0"
						class="sidebar-unread-badge"
						:class="{ 'sidebar-unread-badge--muted': isRoomMuted(item) }"
					>
						{{ item.unreadCount > 99 ? "99+" : item.unreadCount }}
					</span>
				</div>
			</div>
		</button>

		<!-- 会话右键菜单 -->
		<ConversationContextMenu
			:open="menuState.open"
			:x="menuState.x"
			:y="menuState.y"
			:pinned="menuState.item ? pinnedKeys.has(menuState.item.key) : false"
			:muted="menuState.item ? isRoomMuted(menuState.item) : false"
			:archived="menuState.item ? archivedKeys.has(menuState.item.key) : false"
			:has-unread="menuState.item ? menuState.item.unreadCount > 0 : false"
			@close="closeContextMenu"
			@toggle-pin="togglePin(menuState.item)"
			@toggle-mute="emit('toggle-mute', menuState.item)"
			@toggle-read="menuState.item?.unreadCount > 0 ? emit('mark-read', menuState.item) : emit('mark-unread', menuState.item)"
			@toggle-archive="toggleArchive(menuState.item)"
		/>
	</div>
</template>

<style scoped>
.sidebar-list {
	flex: 1;
	min-height: 0;
	overflow-y: auto;
	overflow-x: hidden;
	padding: 0 0 8px;
	scrollbar-gutter: stable;
	touch-action: pan-y;
}

.folder-tabs-bar {
	display: flex;
	align-items: center;
	gap: 4px;
	padding: 4px 12px 8px;
	overflow-x: auto;
	scrollbar-width: none;
}

.folder-tabs-bar::-webkit-scrollbar {
	display: none;
}

.folder-tab {
	display: inline-flex;
	align-items: center;
	gap: 4px;
	padding: 4px 10px;
	border: none;
	border-radius: 14px;
	background: transparent;
	color: var(--chat-muted, #64748b);
	font: inherit;
	font-size: 12px;
	font-weight: 500;
	white-space: nowrap;
	cursor: pointer;
	transition: background-color 150ms ease, color 150ms ease;
}

.folder-tab:hover {
	background: var(--chat-hover, rgba(0, 0, 0, 0.05));
	color: var(--chat-ink, #0f172a);
}

.folder-tab--active {
	background: var(--chat-selected, rgba(0, 128, 105, 0.12));
	color: var(--chat-accent, #008069);
	font-weight: 600;
}

:root[data-theme='dark'] .folder-tab--active {
	background: rgba(0, 168, 132, 0.2);
	color: #25d366;
}

.folder-unread-dot {
	font-size: 10px;
	font-weight: 700;
	padding: 0 5px;
	border-radius: 8px;
	background: var(--chat-accent, #008069);
	color: #ffffff;
	line-height: 14px;
}

.sidebar-list::-webkit-scrollbar {
	width: 4px;
}

.sidebar-list::-webkit-scrollbar-thumb {
	border-radius: 2px;
	background: var(--chat-scrollbar);
}

.sidebar-hint {
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 24px 8px;
	color: var(--chat-subtle);
	font-size: 13px;
}

.sidebar-item {
	display: flex;
	align-items: center;
	gap: 12px;
	width: calc(100% - 24px);
	min-height: 80px;
	margin: 2px 12px;
	padding: 12px;
	border: none;
	border-radius: 12px;
	background: transparent;
	cursor: pointer;
	text-align: left;
	touch-action: manipulation;
	transition: background 150ms;
}

.sidebar-item:hover {
	background: var(--chat-hover);
}

.sidebar-item:active {
	background: rgba(0, 0, 0, 0.08);
}

.sidebar-item--active,
.sidebar-item--active:hover {
	background: var(--chat-selected);
	box-shadow: inset 3px 0 var(--chat-accent);
}

.sidebar-item:focus-visible {
	outline: 2px solid var(--chat-accent);
	outline-offset: -2px;
}

.sidebar-item :deep(.ui-avatar) {
	flex-shrink: 0;
	width: 44px;
	height: 44px;
	border-radius: 50%;
	box-shadow: none;
}

.sidebar-label-group {
	flex: 1;
	min-width: 0;
}

.sidebar-item__top {
	display: flex;
	align-items: center;
	justify-content: space-between;
	gap: 8px;
}

.sidebar-item__time-group {
	display: flex;
	align-items: center;
	gap: 4px;
	flex-shrink: 0;
}

.sidebar-pin-icon {
	color: var(--chat-muted, #64748b);
}

.sidebar-item__title-wrap {
	display: flex;
	align-items: center;
	gap: 6px;
	min-width: 0;
	overflow: hidden;
}

.sidebar-muted-pill {
	display: inline-flex;
	align-items: center;
	justify-content: center;
	flex-shrink: 0;
	padding: 2px 4px;
	border-radius: 4px;
	background: rgba(0, 0, 0, 0.05);
	color: var(--chat-muted);
}

:root[data-theme='dark'] .sidebar-muted-pill {
	background: rgba(255, 255, 255, 0.08);
}

.sidebar-item__top strong {
	overflow: hidden;
	color: var(--chat-ink);
	font-size: 15px;
	font-weight: 500;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sidebar-item__time {
	flex-shrink: 0;
	color: var(--chat-muted);
	font-size: 12px;
	font-variant-numeric: tabular-nums;
}

.sidebar-item__bottom {
	display: flex;
	align-items: center;
	gap: 8px;
	min-width: 0;
	margin-top: 6px;
}

.sidebar-item__preview {
	flex: 1;
	min-width: 0;
	margin: 0;
	overflow: hidden;
	color: var(--chat-muted);
	font-size: 13px;
	text-overflow: ellipsis;
	white-space: nowrap;
}

.sidebar-item__draft {
	font-weight: 600;
	color: var(--chat-danger, #e53935);
}

.sidebar-item__draft-text {
	color: var(--chat-ink);
}

.sidebar-item__sender {
	font-weight: 600;
	color: var(--chat-ink);
}

.sidebar-item--active .sidebar-item__sender {
	color: inherit;
}

.sidebar-item .sidebar-unread-badge--muted {
	background: var(--chat-muted);
	opacity: 0.85;
}

.sidebar-item--unread .sidebar-item__preview {
	color: var(--chat-ink);
}

.sidebar-item--unread .sidebar-item__top strong {
	font-weight: 700;
}

.sidebar-item--unread .sidebar-item__time {
	color: var(--chat-accent);
	font-weight: 600;
}

.sidebar-unread-badge {
	display: inline-flex;
	flex-shrink: 0;
	align-items: center;
	justify-content: center;
	min-width: 22px;
	height: 22px;
	padding: 0 6px;
	border-radius: 999px;
	background: var(--chat-accent);
	color: var(--chat-paper);
	font-size: 11px;
	font-variant-numeric: tabular-nums;
	font-weight: 700;
	line-height: 1;
}

.sidebar-mention-badge {
	display: inline-flex;
	flex: 0 0 auto;
	align-items: center;
	gap: 2px;
	color: var(--chat-danger);
	font-size: 11px;
	font-weight: 700;
	white-space: nowrap;
}

@media (max-width: 960px) {
	.sidebar-list {
		padding-bottom: max(8px, env(safe-area-inset-bottom));
		overscroll-behavior: contain;
		scrollbar-gutter: auto;
	}

	.sidebar-item {
		width: 100%;
		min-height: 80px;
		margin: 0;
		padding: 11px max(16px, env(safe-area-inset-right)) 11px
			max(16px, env(safe-area-inset-left));
		border-radius: 0;
		position: relative;
	}

	.sidebar-item + .sidebar-item::before {
		content: "";
		position: absolute;
		top: 0;
		right: 16px;
		left: 72px;
		height: 1px;
		background: var(--chat-line);
	}
}

@media (prefers-reduced-motion: reduce) {
	.sidebar-item {
		transition: none;
	}
}
</style>
