<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Archive, ArchiveRestore, Bell, BellOff, CheckCheck, Mail, Pin, PinOff } from '@lucide/vue';
import { t } from '../../i18n.js';

const props = defineProps({
  open: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  pinned: { type: Boolean, default: false },
  muted: { type: Boolean, default: false },
  archived: { type: Boolean, default: false },
  hasUnread: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'toggle-pin', 'toggle-mute', 'toggle-read', 'toggle-archive']);

const menuEl = ref(null);
const menuStyle = computed(() => ({
  left: `${Math.max(8, Math.min(props.x, window.innerWidth - 190))}px`,
  top: `${Math.max(8, Math.min(props.y, window.innerHeight - 180))}px`
}));

function handleWindowPointerDown(event) {
  if (props.open && !menuEl.value?.contains(event.target)) {
    emit('close');
  }
}

function handleWindowKeydown(event) {
  if (props.open && event.key === 'Escape') {
    emit('close');
  }
}

function closeMenu() {
  if (props.open) emit('close');
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      await nextTick();
      menuEl.value?.querySelector('button')?.focus();
    }
  }
);

onMounted(() => {
  window.addEventListener('pointerdown', handleWindowPointerDown);
  window.addEventListener('keydown', handleWindowKeydown);
  window.addEventListener('resize', closeMenu);
  window.addEventListener('scroll', closeMenu, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleWindowPointerDown);
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('resize', closeMenu);
  window.removeEventListener('scroll', closeMenu, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="menu-fade">
      <div
        v-if="open"
        ref="menuEl"
        class="conversation-context-menu"
        :style="menuStyle"
        role="menu"
        @contextmenu.prevent
      >
        <button type="button" role="menuitem" @click="emit('toggle-pin'); closeMenu()">
          <PinOff v-if="pinned" :size="16" aria-hidden="true" />
          <Pin v-else :size="16" aria-hidden="true" />
          <span>{{ pinned ? t('chat.unpinConversation') : t('chat.pinConversation') }}</span>
        </button>

        <button type="button" role="menuitem" @click="emit('toggle-mute'); closeMenu()">
          <Bell v-if="muted" :size="16" aria-hidden="true" />
          <BellOff v-else :size="16" aria-hidden="true" />
          <span>{{ muted ? t('chat.unmuteCurrent') : t('chat.muteCurrent') }}</span>
        </button>

        <button type="button" role="menuitem" @click="emit('toggle-read'); closeMenu()">
          <CheckCheck v-if="hasUnread" :size="16" aria-hidden="true" />
          <Mail v-else :size="16" aria-hidden="true" />
          <span>{{ hasUnread ? t('chat.markRead') : t('chat.markUnread') }}</span>
        </button>

        <button type="button" role="menuitem" @click="emit('toggle-archive'); closeMenu()">
          <ArchiveRestore v-if="archived" :size="16" aria-hidden="true" />
          <Archive v-else :size="16" aria-hidden="true" />
          <span>{{ archived ? t('chat.unarchiveConversation') : t('chat.archiveConversation') }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.conversation-context-menu {
  position: fixed;
  z-index: 1100;
  width: 180px;
  padding: 6px;
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
  border-radius: 10px;
  background: var(--surface-solid, #ffffff);
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15), 0 1px 3px rgba(0, 0, 0, 0.08);
}

:root[data-theme='dark'] .conversation-context-menu {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.1);
}

.conversation-context-menu button[role='menuitem'] {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--chat-ink, #0f172a);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

:root[data-theme='dark'] .conversation-context-menu button[role='menuitem'] {
  color: #f1f5f9;
}

.conversation-context-menu button[role='menuitem']:hover,
.conversation-context-menu button[role='menuitem']:active {
  background: var(--chat-hover, rgba(0, 0, 0, 0.05));
}

:root[data-theme='dark'] .conversation-context-menu button[role='menuitem']:hover {
  background: rgba(255, 255, 255, 0.08);
}

.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 120ms ease, transform 120ms ease;
  transform-origin: top left;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: scale(0.96);
}
</style>
