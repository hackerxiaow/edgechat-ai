<script setup>
import { computed, ref, toRef } from 'vue';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import { t } from '../../i18n.js';
import UiAvatar from '../ui/Avatar.vue';

const props = defineProps({
  show: { type: Boolean, default: false },
  users: { type: Array, default: () => [] },
  openingUserId: { type: Number, default: null },
  error: { type: String, default: '' }
});

const emit = defineEmits(['close', 'open-dm', 'create-group']);
const search = ref('');
const rootEl = ref(null);

useOverlayLifecycle({
  open: toRef(props, 'show'),
  onClose: () => emit('close'),
  focusTarget: rootEl
});

const filteredUsers = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return props.users;
  return props.users.filter((user) =>
    user.username?.toLowerCase().includes(query)
    || user.displayName?.toLowerCase().includes(query)
  );
});
</script>

<template>
  <Teleport to="body">
    <Transition name="add-conversation-fade">
      <div v-if="show" class="add-conversation-overlay" @click.self="emit('close')">
        <section
          ref="rootEl"
          class="add-conversation-dialog"
          role="dialog"
          aria-modal="true"
          :aria-label="t('chat.addPeople')"
          tabindex="-1"
        >
          <header class="add-conversation-header">
            <div class="add-conversation-title-wrap">
              <h2 class="add-conversation-title">{{ t('chat.addPeople') }}</h2>
              <p class="add-conversation-subtitle">{{ t('chat.addPeopleSubtitle') }}</p>
            </div>
            <button type="button" class="add-conversation-close" :aria-label="t('common.close')" @click="emit('close')">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="M18 6 6 18M6 6l12 12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
          </header>

          <p v-if="error" class="add-conversation-error" role="alert">{{ error }}</p>

          <div class="add-conversation-choices" role="list">
            <button
              type="button"
              class="add-conversation-choice add-conversation-choice--active"
              role="listitem"
            >
              <div class="add-conversation-choice__icon add-conversation-choice__icon--dm" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div class="add-conversation-choice__body">
                <strong class="add-conversation-choice__title">{{ t('chat.startDirectConversation') }}</strong>
                <span class="add-conversation-choice__desc">{{ t('chat.startDirectConversationDesc') }}</span>
              </div>
              <svg class="add-conversation-choice__arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>

            <button
              type="button"
              class="add-conversation-choice"
              role="listitem"
              @click="emit('create-group')"
            >
              <div class="add-conversation-choice__icon add-conversation-choice__icon--group" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  <path d="M20 8v6M23 11h-6" />
                </svg>
              </div>
              <div class="add-conversation-choice__body">
                <strong class="add-conversation-choice__title">{{ t('chat.createGroupChat') }}</strong>
                <span class="add-conversation-choice__desc">{{ t('chat.createGroupChatDesc') }}</span>
              </div>
              <svg class="add-conversation-choice__arrow" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <path d="m9 18 6-6-6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
            </button>
          </div>

          <div class="add-conversation-dm-section">
            <h3 class="add-conversation-section-title">{{ t('chat.chooseContacts') }}</h3>
            <label class="add-conversation-search">
              <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                <circle cx="11" cy="11" r="8" fill="none" stroke="currentColor" stroke-width="2" />
                <path d="m21 21-4.35-4.35" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
              </svg>
              <input
                v-model="search"
                type="search"
                :placeholder="t('chat.searchUsers')"
                autocomplete="off"
              />
            </label>

            <ul class="add-conversation-users" role="list">
              <li v-for="user in filteredUsers" :key="user.id" class="add-conversation-user-item">
                <button
                  type="button"
                  class="add-conversation-user-btn"
                  :disabled="openingUserId === user.id"
                  @click="emit('open-dm', user)"
                >
                  <UiAvatar :src="user.avatarUrl" :fallback="user.displayName?.[0] || user.username?.[0] || '?'" />
                  <div class="add-conversation-user-info">
                    <strong class="add-conversation-user-name">{{ user.displayName || user.username }}</strong>
                    <span class="add-conversation-user-handle">@{{ user.username }}</span>
                  </div>
                  <span v-if="openingUserId === user.id" class="add-conversation-opening">{{ t('common.opening') }}</span>
                </button>
              </li>
              <li v-if="filteredUsers.length === 0" class="add-conversation-empty">
                {{ t('chat.noMatchingUsers') }}
              </li>
            </ul>
          </div>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.add-conversation-overlay {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  background: rgba(11, 20, 26, 0.48);
  backdrop-filter: blur(4px);
}

.add-conversation-dialog {
  width: min(440px, 100%);
  max-height: calc(100dvh - 32px);
  display: flex;
  flex-direction: column;
  background: var(--surface-primary, #ffffff);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(11, 20, 26, 0.2);
  overflow: hidden;
  outline: none;
}

.add-conversation-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  padding: 20px 20px 12px;
}

.add-conversation-title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary, #111b21);
}

.add-conversation-subtitle {
  margin: 4px 0 0;
  font-size: 13px;
  color: var(--text-secondary, #667781);
}

.add-conversation-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: var(--text-secondary, #667781);
  cursor: pointer;
}

.add-conversation-close:hover {
  background: var(--surface-hover, #f0f2f5);
  color: var(--text-primary, #111b21);
}

.add-conversation-close svg {
  width: 20px;
  height: 20px;
}

.add-conversation-error {
  margin: 0 20px 12px;
  padding: 8px 12px;
  border-radius: 8px;
  background: #fef3f2;
  color: #b42318;
  font-size: 13px;
}

.add-conversation-choices {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 0 16px 12px;
}

.add-conversation-choice {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  padding: 12px 14px;
  border: 1px solid var(--border-light, #e9edef);
  border-radius: 12px;
  background: var(--surface-primary, #ffffff);
  color: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 150ms, border-color 150ms;
}

.add-conversation-choice:hover {
  background: var(--surface-hover, #f5f7f8);
  border-color: var(--border-medium, #d1d7db);
}

.add-conversation-choice--active {
  border-color: var(--color-primary, #00a884);
  background: var(--surface-active, #f0faf6);
}

.add-conversation-choice__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  border-radius: 10px;
  flex-shrink: 0;
}

.add-conversation-choice__icon svg {
  width: 22px;
  height: 22px;
}

.add-conversation-choice__icon--dm {
  background: #e7f8f3;
  color: #00a884;
}

.add-conversation-choice__icon--group {
  background: #eef2ff;
  color: #4f46e5;
}

.add-conversation-choice__body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.add-conversation-choice__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #111b21);
}

.add-conversation-choice__desc {
  font-size: 12px;
  color: var(--text-secondary, #667781);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.add-conversation-choice__arrow {
  width: 18px;
  height: 18px;
  color: var(--text-muted, #8696a0);
  flex-shrink: 0;
}

.add-conversation-dm-section {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  padding: 12px 16px 16px;
  border-top: 1px solid var(--border-light, #e9edef);
}

.add-conversation-section-title {
  margin: 0 0 8px;
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--text-secondary, #667781);
}

.add-conversation-search {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--surface-search, #f0f2f5);
  margin-bottom: 8px;
}

.add-conversation-search svg {
  width: 16px;
  height: 16px;
  color: var(--text-secondary, #667781);
  flex-shrink: 0;
}

.add-conversation-search input {
  flex: 1;
  min-width: 0;
  border: 0;
  background: transparent;
  font-size: 14px;
  color: var(--text-primary, #111b21);
  outline: none;
}

.add-conversation-users {
  list-style: none;
  margin: 0;
  padding: 0;
  overflow-y: auto;
  flex: 1;
  max-height: 200px;
}

.add-conversation-user-item {
  margin: 0;
}

.add-conversation-user-btn {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 8px 8px;
  border: 0;
  border-radius: 8px;
  background: transparent;
  color: inherit;
  cursor: pointer;
  text-align: left;
}

.add-conversation-user-btn:hover {
  background: var(--surface-hover, #f5f7f8);
}

.add-conversation-user-info {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.add-conversation-user-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary, #111b21);
}

.add-conversation-user-handle {
  font-size: 12px;
  color: var(--text-secondary, #667781);
}

.add-conversation-opening {
  font-size: 12px;
  color: var(--color-primary, #00a884);
}

.add-conversation-empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--text-secondary, #667781);
}

.add-conversation-fade-enter-active {
  transition: opacity 200ms ease-out;
}
.add-conversation-fade-leave-active {
  transition: opacity 150ms ease-in;
}
.add-conversation-fade-enter-from,
.add-conversation-fade-leave-to {
  opacity: 0;
}

@media (max-width: 480px) {
  .add-conversation-overlay {
    align-items: flex-end;
    padding: 0;
  }
  .add-conversation-dialog {
    width: 100%;
    max-height: 85dvh;
    border-radius: 16px 16px 0 0;
  }
}
</style>
