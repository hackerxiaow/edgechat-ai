<script setup>
import { computed, ref } from 'vue';
import { Download, ExternalLink, FileText, Image as ImageIcon, Link as LinkIcon, Users, X } from '@lucide/vue';
import UiAvatar from '../ui/Avatar.vue';
import UiBadge from '../ui/Badge.vue';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';
import { t } from '../../i18n.js';
import { isPreviewableImageAttachment } from './attachment-utils.js';

const props = defineProps({
  room: {
    type: Object,
    default: null
  },
  members: {
    type: Array,
    default: () => []
  },
  messages: {
    type: Array,
    default: () => []
  },
  loading: {
    type: Boolean,
    default: false
  },
  canManage: {
    type: Boolean,
    default: false
  },
  inviteUserId: {
    type: String,
    default: ''
  },
  availableInviteUsers: {
    type: Array,
    default: () => []
  },
  inviteSubmitting: {
    type: Boolean,
    default: false
  }
});

const emit = defineEmits(['close', 'update:inviteUserId', 'invite', 'remove-member', 'delete-group', 'open-profile', 'open-media']);

const activeTab = ref('members'); // 'members' | 'media' | 'files' | 'links'

const LINK_REGEX = /(https?:\/\/[^\s<>"'，。！？]+)/gi;

// 提取共享图片与动图
const sharedMedia = computed(() => {
  const list = [];
  for (const msg of props.messages) {
    if (msg.attachment && isPreviewableImageAttachment(msg.attachment)) {
      list.push({
        id: msg.id,
        url: msg.attachment.url || `/files/${encodeURIComponent(msg.attachment.key)}`,
        title: msg.attachment.name || 'Image'
      });
    }
    // 检查正文中包含的 GIF / 贴纸 / 图片直链
    const text = String(msg.content || '');
    const imgMatches = text.match(/(https?:\/\/[^\s)]+(?:\.gif|\.png|\.jpg|\.jpeg|\.webp)|\/stickers\/[^\s)]+\.(?:svg|webp|png))/gi);
    if (imgMatches) {
      for (const url of imgMatches) {
        list.push({ id: `${msg.id}-${url}`, url, title: 'GIF / Sticker' });
      }
    }
  }
  return list.reverse();
});

// 提取共享文件
const sharedFiles = computed(() => {
  const list = [];
  for (const msg of props.messages) {
    if (msg.attachment && !isPreviewableImageAttachment(msg.attachment) && msg.attachment.kind !== 'voice') {
      list.push({
        id: msg.id,
        name: msg.attachment.name || 'File',
        size: msg.attachment.size || 0,
        type: msg.attachment.type || '',
        url: msg.attachment.url || `/files/${encodeURIComponent(msg.attachment.key)}`
      });
    }
  }
  return list.reverse();
});

// 提取共享链接
const sharedLinks = computed(() => {
  const list = [];
  for (const msg of props.messages) {
    const text = String(msg.content || '');
    const matches = text.match(LINK_REGEX);
    if (matches) {
      for (const url of matches) {
        if (!url.match(/\.(?:gif|png|jpg|jpeg|webp)$/i)) {
          list.push({ id: `${msg.id}-${url}`, url });
        }
      }
    }
  }
  return list.reverse();
});

function formatFileSize(bytes) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
</script>

<template>
  <UiSurface v-if="room && room.kind !== 'dm'" tone="soft" class="chat-member-panel">
    <div class="chat-member-panel__header">
      <div class="window-heading">
        <h1 style="font-size: 1.1rem">{{ room.name }}</h1>
        <p>{{ loading ? t('common.syncing') : t('chat.memberCount', { count: members.length }) }}</p>
      </div>

      <div class="chat-member-panel__actions">
        <UiBadge variant="secondary">{{ room.myRole === 'owner' ? t('members.owner') : t('members.member') }}</UiBadge>
        <UiButton v-if="canManage && !room.isGeneral" variant="destructive" size="sm" @click="emit('delete-group')">
          {{ t('group.delete') }}
        </UiButton>
        <button type="button" class="chat-member-panel__close" :aria-label="t('chat.closeMembers')" @click="emit('close')">
          <X :size="20" aria-hidden="true" />
        </button>
      </div>
    </div>

    <!-- Telegram Web 风格的四分类抽屉标签 -->
    <div class="panel-tabs-bar" role="tablist">
      <button
        type="button"
        role="tab"
        class="panel-tab"
        :class="{ 'panel-tab--active': activeTab === 'members' }"
        @click="activeTab = 'members'"
      >
        <Users :size="14" aria-hidden="true" />
        <span>{{ t('chat.members') }} ({{ members.length }})</span>
      </button>
      <button
        type="button"
        role="tab"
        class="panel-tab"
        :class="{ 'panel-tab--active': activeTab === 'media' }"
        @click="activeTab = 'media'"
      >
        <ImageIcon :size="14" aria-hidden="true" />
        <span>{{ t('chat.sharedMedia') }} ({{ sharedMedia.length }})</span>
      </button>
      <button
        type="button"
        role="tab"
        class="panel-tab"
        :class="{ 'panel-tab--active': activeTab === 'files' }"
        @click="activeTab = 'files'"
      >
        <FileText :size="14" aria-hidden="true" />
        <span>{{ t('chat.sharedFiles') }} ({{ sharedFiles.length }})</span>
      </button>
      <button
        type="button"
        role="tab"
        class="panel-tab"
        :class="{ 'panel-tab--active': activeTab === 'links' }"
        @click="activeTab = 'links'"
      >
        <LinkIcon :size="14" aria-hidden="true" />
        <span>{{ t('chat.sharedLinks') }} ({{ sharedLinks.length }})</span>
      </button>
    </div>

    <!-- 成员列表面板 -->
    <template v-if="activeTab === 'members'">
      <div class="member-chip-list">
        <div v-for="member in members" :key="member.id" class="member-chip">
          <button type="button" class="profile-avatar-trigger" :aria-label="t('profile.view', { name: member.displayName })" @click="emit('open-profile', member)">
            <UiAvatar :src="member.avatarUrl" :fallback="member.displayName" size="sm" />
          </button>
          <div class="member-chip__text">
            <strong>
              <span
                class="member-chip__presence"
                :class="{ 'member-chip__presence--online': member.online }"
                :title="member.online ? t('members.online') : t('members.offline')"
                :aria-label="member.online ? t('members.online') : t('members.offline')"
                role="status"
              ></span>
              {{ member.displayName }}
            </strong>
            <span>@{{ member.username }}</span>
          </div>
          <div class="member-chip__actions">
            <UiBadge :variant="member.role === 'owner' ? 'warm' : 'secondary'">
              {{ member.role === 'owner' ? t('members.owner') : t('members.member') }}
            </UiBadge>
            <UiButton
              v-if="canManage && !room.isGeneral && member.role !== 'owner'"
              variant="secondary"
              size="sm"
              @click="emit('remove-member', member)"
            >
              {{ t('common.remove') }}
            </UiButton>
          </div>
        </div>
      </div>

      <div v-if="canManage && !room.isGeneral" class="chat-member-panel__actions">
        <select
          class="ui-input"
          :value="inviteUserId"
          @change="emit('update:inviteUserId', $event.target.value)"
        >
          <option value="">{{ t('members.selectInvitee') }}</option>
          <option v-for="user in availableInviteUsers" :key="`invite-${user.id}`" :value="user.id">
            {{ user.displayName }} @{{ user.username }}
          </option>
        </select>
        <UiButton :disabled="inviteSubmitting || !inviteUserId" @click="emit('invite')">
          {{ inviteSubmitting ? t('members.inviting') : t('members.invite') }}
        </UiButton>
      </div>
    </template>

    <!-- 共享媒体相册网格 -->
    <template v-else-if="activeTab === 'media'">
      <div v-if="sharedMedia.length" class="shared-media-grid">
        <button
          v-for="item in sharedMedia"
          :key="item.id"
          type="button"
          class="shared-media-cell"
          :title="item.title"
          @click="emit('open-media', item.url, item.title)"
        >
          <img :src="item.url" :alt="item.title" loading="lazy" />
        </button>
      </div>
      <div v-else class="shared-empty">{{ t('chat.noSharedMedia') }}</div>
    </template>

    <!-- 共享文件列表 -->
    <template v-else-if="activeTab === 'files'">
      <div v-if="sharedFiles.length" class="shared-files-list">
        <div v-for="file in sharedFiles" :key="file.id" class="shared-file-item">
          <FileText :size="24" class="file-icon" aria-hidden="true" />
          <div class="file-info">
            <span class="file-name">{{ file.name }}</span>
            <span class="file-size">{{ formatFileSize(file.size) }}</span>
          </div>
          <a :href="file.url" target="_blank" download class="file-download-btn" :title="t('chat.download')">
            <Download :size="16" aria-hidden="true" />
          </a>
        </div>
      </div>
      <div v-else class="shared-empty">{{ t('chat.noSharedFiles') }}</div>
    </template>

    <!-- 共享链接列表 -->
    <template v-else-if="activeTab === 'links'">
      <div v-if="sharedLinks.length" class="shared-links-list">
        <a
          v-for="link in sharedLinks"
          :key="link.id"
          :href="link.url"
          target="_blank"
          rel="noopener noreferrer"
          class="shared-link-item"
        >
          <LinkIcon :size="18" class="link-icon" aria-hidden="true" />
          <span class="link-url">{{ link.url }}</span>
          <ExternalLink :size="14" class="link-arrow" aria-hidden="true" />
        </a>
      </div>
      <div v-else class="shared-empty">{{ t('chat.noSharedLinks') }}</div>
    </template>
  </UiSurface>
</template>

<style scoped>
.panel-tabs-bar {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 6px 14px 10px;
  border-bottom: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
  overflow-x: auto;
  scrollbar-width: none;
}

.panel-tabs-bar::-webkit-scrollbar {
  display: none;
}

.panel-tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border: none;
  border-radius: 10px;
  background: transparent;
  color: var(--chat-muted, #64748b);
  font: inherit;
  font-size: 11.5px;
  font-weight: 500;
  white-space: nowrap;
  cursor: pointer;
  transition: background-color 120ms ease, color 120ms ease;
}

.panel-tab:hover {
  background: var(--chat-hover, rgba(0, 0, 0, 0.05));
  color: var(--chat-ink, #0f172a);
}

.panel-tab--active {
  background: var(--chat-selected, rgba(0, 128, 105, 0.12));
  color: var(--chat-accent, #008069);
  font-weight: 600;
}

:root[data-theme='dark'] .panel-tab--active {
  background: rgba(0, 168, 132, 0.2);
  color: #25d366;
}

.member-chip__presence {
  display: inline-block;
  width: 8px;
  height: 8px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--chat-line, #d0d7de);
  vertical-align: middle;
}

.member-chip__presence--online {
  background: var(--chat-online, #34d399);
}

.chat-member-panel__close {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  height: 44px;
  margin: -8px -8px -8px 0;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: #54656f;
  touch-action: manipulation;
}

.chat-member-panel__close:hover,
.chat-member-panel__close:active {
  background: rgba(0, 0, 0, 0.06);
}

.shared-media-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 4px;
  padding: 10px;
}

.shared-media-cell {
  position: relative;
  aspect-ratio: 1;
  border: none;
  border-radius: 6px;
  overflow: hidden;
  padding: 0;
  background: rgba(0, 0, 0, 0.05);
  cursor: pointer;
}

.shared-media-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 150ms ease;
}

.shared-media-cell:hover img {
  transform: scale(1.08);
}

.shared-files-list,
.shared-links-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 10px;
}

.shared-file-item,
.shared-link-item {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--chat-paper, rgba(255, 255, 255, 0.6));
  color: inherit;
  text-decoration: none;
}

:root[data-theme='dark'] .shared-file-item,
:root[data-theme='dark'] .shared-link-item {
  background: rgba(255, 255, 255, 0.05);
}

.file-icon,
.link-icon {
  color: var(--chat-accent, #008069);
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
}

.file-name {
  display: block;
  font-size: 13px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.file-size {
  font-size: 11px;
  color: var(--chat-muted, #64748b);
}

.file-download-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: var(--chat-hover, rgba(0, 0, 0, 0.05));
  color: var(--chat-muted, #64748b);
}

.link-url {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.link-arrow {
  color: var(--chat-muted, #94a3b8);
  flex-shrink: 0;
}

.shared-empty {
  padding: 40px 16px;
  text-align: center;
  color: var(--chat-muted, #94a3b8);
  font-size: 13px;
}
</style>
