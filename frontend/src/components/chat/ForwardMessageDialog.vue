<script setup>
import { computed, ref, watch } from 'vue';
import { Search, X } from '@lucide/vue';
import UiAvatar from '../ui/Avatar.vue';
import UiButton from '../ui/Button.vue';
import { t } from '../../i18n.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  conversationItems: { type: Array, default: () => [] },
  forwarding: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'forward']);

const searchQuery = ref('');
const selectedRoom = ref(null);

watch(() => props.show, (shown) => {
  if (shown) {
    searchQuery.value = '';
    selectedRoom.value = null;
  }
});

const filteredItems = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  if (!query) return props.conversationItems;
  return props.conversationItems.filter((item) => {
    const name = String(item.title || item.name || '').toLowerCase();
    return name.includes(query);
  });
});

function handleClose() {
  if (!props.forwarding) emit('close');
}

function selectItem(item) {
  selectedRoom.value = item;
}

function handleConfirm() {
  if (selectedRoom.value && !props.forwarding) {
    emit('forward', selectedRoom.value);
  }
}
</script>

<template>
  <Teleport to="body">
    <Transition name="dialog-fade">
      <div v-if="show" class="forward-dialog-mask" @click.self="handleClose">
        <div class="forward-dialog" role="dialog" :aria-label="t('chat.forwardTo')">
          <header class="forward-dialog__header">
            <h3>{{ t('chat.forwardTo') }}</h3>
            <button
              type="button"
              class="forward-dialog__close"
              :title="t('common.close')"
              :aria-label="t('common.close')"
              @click="handleClose"
            >
              <X :size="20" aria-hidden="true" />
            </button>
          </header>

          <div class="forward-dialog__search">
            <Search :size="16" class="search-icon" aria-hidden="true" />
            <input
              v-model="searchQuery"
              type="text"
              class="search-input"
              :placeholder="t('contacts.searchPlaceholder')"
            />
          </div>

          <div class="forward-dialog__list">
            <button
              v-for="item in filteredItems"
              :key="item.key"
              type="button"
              class="forward-item"
              :class="{ 'forward-item--selected': selectedRoom?.key === item.key }"
              @click="selectItem(item)"
            >
              <UiAvatar
                :src="item.avatarUrl"
                :fallback="(item.title || item.name)?.[0] || '?'"
                size="sm"
              />
              <div class="forward-item__meta">
                <span class="forward-item__name">{{ item.title || item.name }}</span>
                <span v-if="item.isDm" class="forward-item__badge">{{ t('chat.dm') }}</span>
              </div>
            </button>
            <div v-if="!filteredItems.length" class="forward-dialog__empty">
              {{ t('contacts.noResults') }}
            </div>
          </div>

          <footer class="forward-dialog__footer">
            <UiButton variant="secondary" size="sm" @click="handleClose">
              {{ t('common.cancel') }}
            </UiButton>
            <UiButton
              variant="primary"
              size="sm"
              :disabled="!selectedRoom || forwarding"
              @click="handleConfirm"
            >
              {{ forwarding ? t('common.creating') : t('chat.forwardConfirm') }}
            </UiButton>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.forward-dialog-mask {
  position: fixed;
  inset: 0;
  z-index: 1050;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.45);
  backdrop-filter: blur(2px);
  padding: 16px;
}

.forward-dialog {
  width: min(420px, 100%);
  max-height: min(560px, 85vh);
  display: flex;
  flex-direction: column;
  background: var(--surface-solid, #ffffff);
  border-radius: 14px;
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.2);
  overflow: hidden;
}

:root[data-theme='dark'] .forward-dialog {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.1);
  color: #f1f5f9;
}

.forward-dialog__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px 12px;
  border-bottom: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
}

.forward-dialog__header h3 {
  margin: 0;
  font-size: 17px;
  font-weight: 600;
}

.forward-dialog__close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--chat-muted, #64748b);
  cursor: pointer;
}

.forward-dialog__close:hover {
  background: var(--chat-hover, rgba(0, 0, 0, 0.05));
  color: var(--chat-ink, #0f172a);
}

.forward-dialog__search {
  position: relative;
  display: flex;
  align-items: center;
  padding: 10px 16px;
  border-bottom: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
}

.search-icon {
  position: absolute;
  left: 28px;
  color: var(--chat-muted, #94a3b8);
  pointer-events: none;
}

.search-input {
  width: 100%;
  height: 36px;
  padding: 0 12px 0 36px;
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.12));
  border-radius: 18px;
  background: var(--chat-canvas, #f8fafc);
  color: var(--chat-ink, inherit);
  font: inherit;
  font-size: 13.5px;
  outline: none;
}

.search-input:focus {
  border-color: var(--chat-accent, #008069);
}

:root[data-theme='dark'] .search-input {
  background: #0f172a;
  border-color: rgba(255, 255, 255, 0.12);
}

.forward-dialog__list {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.forward-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 12px;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

.forward-item:hover {
  background: var(--chat-hover, rgba(0, 0, 0, 0.04));
}

.forward-item.forward-item--selected {
  background: var(--chat-selected, rgba(0, 128, 105, 0.12));
}

.forward-item__meta {
  display: flex;
  align-items: center;
  gap: 6px;
  flex: 1;
  min-width: 0;
}

.forward-item__name {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.forward-item__badge {
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 10px;
  background: var(--chat-line, rgba(0, 0, 0, 0.06));
  color: var(--chat-muted, #64748b);
}

.forward-dialog__empty {
  padding: 32px 16px;
  text-align: center;
  color: var(--chat-muted, #94a3b8);
  font-size: 14px;
}

.forward-dialog__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 8px;
  padding: 12px 16px;
  border-top: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
}

.dialog-fade-enter-active,
.dialog-fade-leave-active {
  transition: opacity 150ms ease;
}

.dialog-fade-enter-from,
.dialog-fade-leave-to {
  opacity: 0;
}
</style>
