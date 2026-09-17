<script setup>
import { ref, watch } from 'vue';
import { MessageSquare, Search, Users, X } from '@lucide/vue';
import UiAvatar from '../ui/Avatar.vue';
import api from '../../api.js';
import { t } from '../../i18n.js';

const props = defineProps({
  active: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'select-room', 'select-message']);

const query = ref('');
const loading = ref(false);
const results = ref({ rooms: [], users: [], messages: [] });
let debounceTimer = null;

watch(query, (val) => {
  const clean = val.trim();
  if (debounceTimer) clearTimeout(debounceTimer);
  if (!clean) {
    results.value = { rooms: [], users: [], messages: [] };
    loading.value = false;
    return;
  }
  loading.value = true;
  debounceTimer = setTimeout(async () => {
    try {
      const data = await api.searchGlobal(clean);
      results.value = data || { rooms: [], users: [], messages: [] };
    } catch {
      results.value = { rooms: [], users: [], messages: [] };
    } finally {
      loading.value = false;
    }
  }, 200);
});

function clear() {
  query.value = '';
  results.value = { rooms: [], users: [], messages: [] };
  emit('close');
}

function handleSelectRoom(room) {
  emit('select-room', room);
}

function handleSelectMessage(item) {
  emit('select-message', item);
}
</script>

<template>
  <div class="global-search-container">
    <div class="global-search-input-wrapper">
      <Search :size="15" class="search-icon" aria-hidden="true" />
      <input
        v-model="query"
        type="text"
        class="global-search-input"
        :placeholder="t('contacts.search')"
        :aria-label="t('contacts.search')"
      />
      <button
        v-if="query"
        type="button"
        class="clear-btn"
        :title="t('common.close')"
        @click="clear"
      >
        <X :size="14" aria-hidden="true" />
      </button>
    </div>

    <!-- 搜索结果列表（仅在有输入时展示） -->
    <div v-if="query.trim()" class="global-search-results">
      <div v-if="loading" class="search-hint">
        {{ t('messages.loading') }}
      </div>

      <template v-else>
        <!-- 群组与联系人 -->
        <div v-if="results.rooms?.length || results.users?.length" class="result-section">
          <div class="section-title">
            <Users :size="13" aria-hidden="true" />
            <span>{{ t('chat.chatsAndContacts') }}</span>
          </div>
          <button
            v-for="room in results.rooms"
            :key="'room-' + room.id"
            type="button"
            class="result-item"
            @click="handleSelectRoom(room)"
          >
            <UiAvatar :src="room.avatarUrl" :fallback="room.name?.[0] || '?'" size="sm" />
            <div class="result-item__meta">
              <span class="result-item__title">{{ room.name }}</span>
              <span class="result-item__subtitle">{{ room.description || t('chat.generalGroup') }}</span>
            </div>
          </button>
          <button
            v-for="user in results.users"
            :key="'user-' + user.id"
            type="button"
            class="result-item"
            @click="handleSelectRoom({ kind: 'dm', id: user.id, otherUser: user })"
          >
            <UiAvatar :src="user.avatarUrl" :fallback="user.displayName?.[0] || '?'" size="sm" />
            <div class="result-item__meta">
              <span class="result-item__title">{{ user.displayName }}</span>
              <span class="result-item__subtitle">@{{ user.username }}</span>
            </div>
          </button>
        </div>

        <!-- 消息命中列表 -->
        <div v-if="results.messages?.length" class="result-section">
          <div class="section-title">
            <MessageSquare :size="13" aria-hidden="true" />
            <span>{{ t('chat.messagesFound') }} ({{ results.messages.length }})</span>
          </div>
          <button
            v-for="item in results.messages"
            :key="'msg-' + item.message.id"
            type="button"
            class="result-item result-item--message"
            @click="handleSelectMessage(item)"
          >
            <UiAvatar
              :src="item.message.sender?.avatarUrl"
              :fallback="item.message.sender?.displayName?.[0] || '?'"
              size="sm"
            />
            <div class="result-item__meta">
              <div class="result-item__header">
                <span class="result-item__title">{{ item.message.sender?.displayName }}</span>
                <span class="result-item__room-tag">{{ item.room.name }}</span>
              </div>
              <p class="result-item__snippet">{{ item.message.content }}</p>
            </div>
          </button>
        </div>

        <div v-if="!results.rooms?.length && !results.users?.length && !results.messages?.length" class="search-hint">
          {{ t('contacts.noResults') }}
        </div>
      </template>
    </div>
  </div>
</template>

<style scoped>
.global-search-container {
  position: relative;
  width: 100%;
}

.global-search-input-wrapper {
  position: relative;
  display: flex;
  align-items: center;
  margin: 0 12px 10px;
}

.search-icon {
  position: absolute;
  left: 12px;
  color: var(--chat-muted, #94a3b8);
  pointer-events: none;
}

.global-search-input {
  width: 100%;
  height: 34px;
  padding: 0 30px 0 34px;
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
  border-radius: 17px;
  background: var(--chat-canvas, #f1f5f9);
  color: var(--chat-ink, inherit);
  font: inherit;
  font-size: 13px;
  outline: none;
  transition: border-color 150ms ease;
}

.global-search-input:focus {
  border-color: var(--chat-accent, #008069);
  background: var(--chat-paper, #ffffff);
}

:root[data-theme='dark'] .global-search-input {
  background: #0f172a;
  border-color: rgba(255, 255, 255, 0.1);
}

.clear-btn {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  border: none;
  border-radius: 50%;
  background: rgba(0, 0, 0, 0.08);
  color: var(--chat-muted, #64748b);
  cursor: pointer;
  padding: 0;
}

.global-search-results {
  position: absolute;
  top: 42px;
  left: 0;
  right: 0;
  z-index: 50;
  max-height: calc(100vh - 160px);
  overflow-y: auto;
  background: var(--surface-solid, #ffffff);
  border-bottom: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
  box-shadow: 0 12px 28px rgba(0, 0, 0, 0.12);
  padding: 6px 0;
}

:root[data-theme='dark'] .global-search-results {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.1);
}

.section-title {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px 4px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--chat-muted, #64748b);
  text-transform: uppercase;
  letter-spacing: 0.03em;
}

.result-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 14px;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.result-item:hover {
  background: var(--chat-hover, rgba(0, 0, 0, 0.04));
}

.result-item__meta {
  flex: 1;
  min-width: 0;
}

.result-item__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.result-item__title {
  font-size: 13.5px;
  font-weight: 500;
  color: var(--chat-ink, inherit);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-item__subtitle {
  display: block;
  font-size: 11.5px;
  color: var(--chat-muted, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.result-item__room-tag {
  font-size: 10.5px;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--chat-hover, rgba(0, 0, 0, 0.06));
  color: var(--chat-muted, #64748b);
  white-space: nowrap;
}

.result-item__snippet {
  margin: 2px 0 0;
  font-size: 12px;
  color: var(--chat-muted, #64748b);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.search-hint {
  padding: 24px 16px;
  text-align: center;
  font-size: 13px;
  color: var(--chat-muted, #94a3b8);
}
</style>
