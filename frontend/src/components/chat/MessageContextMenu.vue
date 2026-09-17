<script setup>
import { CheckSquare, Copy, Forward, Link, Pencil, Pin, PinOff, Reply, Trash2 } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { t } from '../../i18n.js';

const QUICK_EMOJIS = ['👍', '❤️', '🔥', '😂', '👏', '🎉'];

const props = defineProps({
  open: { type: Boolean, default: false },
  x: { type: Number, default: 0 },
  y: { type: Number, default: 0 },
  canPin: { type: Boolean, default: false },
  canDelete: { type: Boolean, default: false },
  canCopy: { type: Boolean, default: false },
  canEdit: { type: Boolean, default: false },
  pinned: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'copy', 'copy-link', 'reply', 'pin', 'unpin', 'delete', 'react', 'edit', 'forward', 'select']);

const menuEl = ref(null);
const itemCount = computed(() =>
  4 + // reply, forward, select, copy-link
  Number(props.canEdit) +
  Number(props.canCopy) +
  Number(props.canPin) +
  Number(props.canDelete)
);

const menuHeight = computed(() => 56 + itemCount.value * 38 + 16);

const menuStyle = computed(() => ({
  left: `${Math.max(8, Math.min(props.x, window.innerWidth - 210))}px`,
  top: `${Math.max(8, Math.min(props.y, window.innerHeight - menuHeight.value))}px`
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

function closeOpenMenu() {
  if (props.open) {
    emit('close');
  }
}

function onEmojiClick(emoji) {
  emit('react', emoji);
  emit('close');
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
  window.addEventListener('resize', closeOpenMenu);
  window.addEventListener('scroll', closeOpenMenu, true);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleWindowPointerDown);
  window.removeEventListener('keydown', handleWindowKeydown);
  window.removeEventListener('resize', closeOpenMenu);
  window.removeEventListener('scroll', closeOpenMenu, true);
});
</script>

<template>
  <Teleport to="body">
    <Transition name="message-menu">
      <div
        v-if="open"
        ref="menuEl"
        class="message-context-menu"
        :style="menuStyle"
        role="menu"
        :aria-label="t('messages.actions')"
        @contextmenu.prevent
      >
        <!-- Telegram Web 风格的顶部快捷 Emoji 栏 -->
        <div class="message-context-menu__quick-reactions">
          <button
            v-for="emoji in QUICK_EMOJIS"
            :key="emoji"
            type="button"
            class="quick-emoji-btn"
            :title="emoji"
            @click="onEmojiClick(emoji)"
          >
            {{ emoji }}
          </button>
        </div>

        <div class="message-context-menu__divider" />

        <button type="button" role="menuitem" @click="emit('reply')">
          <Reply :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ t('messages.reply') }}</span>
        </button>

        <button v-if="canEdit" type="button" role="menuitem" @click="emit('edit')">
          <Pencil :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ t('chat.editMessage') }}</span>
        </button>

        <button v-if="canCopy" type="button" role="menuitem" @click="emit('copy')">
          <Copy :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ t('messages.copyMarkdown') }}</span>
        </button>

        <button type="button" role="menuitem" @click="emit('copy-link')">
          <Link :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ t('chat.copyLink') }}</span>
        </button>

        <button type="button" role="menuitem" @click="emit('forward')">
          <Forward :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ t('chat.forward') }}</span>
        </button>

        <button
          v-if="canPin"
          type="button"
          role="menuitem"
          @click="emit(pinned ? 'unpin' : 'pin')"
        >
          <PinOff v-if="pinned" :size="16" :stroke-width="1.8" aria-hidden="true" />
          <Pin v-else :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ pinned ? t('messages.unpin') : t('messages.pin') }}</span>
        </button>

        <button type="button" role="menuitem" @click="emit('select')">
          <CheckSquare :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ t('chat.selectMessages') }}</span>
        </button>

        <button
          v-if="canDelete"
          class="message-context-menu__danger"
          type="button"
          role="menuitem"
          @click="emit('delete')"
        >
          <Trash2 :size="16" :stroke-width="1.8" aria-hidden="true" />
          <span>{{ t('messages.delete') }}</span>
        </button>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.message-context-menu {
  position: fixed;
  z-index: 1000;
  width: 200px;
  padding: 6px;
  border: 1px solid rgba(11, 20, 26, 0.08);
  border-radius: 10px;
  background: var(--surface-solid, #ffffff);
  box-shadow: 0 4px 16px rgba(11, 20, 26, 0.16), 0 1px 3px rgba(11, 20, 26, 0.08);
}

:root[data-theme='dark'] .message-context-menu {
  background: #202b36;
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
}

.message-context-menu__quick-reactions {
  display: flex;
  align-items: center;
  justify-content: space-around;
  padding: 4px 2px 6px;
  gap: 2px;
}

.quick-emoji-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: transparent;
  font-size: 18px;
  cursor: pointer;
  transition: transform 120ms ease, background-color 120ms ease;
  padding: 0;
  line-height: 1;
}

.quick-emoji-btn:hover {
  transform: scale(1.25);
  background: rgba(0, 0, 0, 0.06);
}

:root[data-theme='dark'] .quick-emoji-btn:hover {
  background: rgba(255, 255, 255, 0.1);
}

.message-context-menu__divider {
  height: 1px;
  margin: 4px 4px 6px;
  background: rgba(11, 20, 26, 0.08);
}

:root[data-theme='dark'] .message-context-menu__divider {
  background: rgba(255, 255, 255, 0.08);
}

.message-context-menu button[role='menuitem'] {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  min-height: 36px;
  padding: 0 10px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: var(--chat-ink, #111b21);
  font: inherit;
  font-size: 13.5px;
  text-align: left;
  cursor: pointer;
  transition: background 120ms ease;
}

:root[data-theme='dark'] .message-context-menu button[role='menuitem'] {
  color: #e4ecf2;
}

.message-context-menu button[role='menuitem'].message-context-menu__danger {
  color: #e53935;
}

.message-context-menu button[role='menuitem']:hover,
.message-context-menu button[role='menuitem']:active {
  background: var(--chat-hover, #f5f6f6);
}

:root[data-theme='dark'] .message-context-menu button[role='menuitem']:hover {
  background: rgba(255, 255, 255, 0.08);
}

.message-context-menu button:focus-visible {
  outline: 2px solid var(--chat-accent, #008069);
  outline-offset: -2px;
}

.message-menu-enter-active,
.message-menu-leave-active {
  transition: opacity 100ms ease, transform 100ms ease;
  transform-origin: top left;
}

.message-menu-enter-from,
.message-menu-leave-to {
  opacity: 0;
  transform: scale(0.96);
}

@media (prefers-reduced-motion: reduce) {
  .message-menu-enter-active,
  .message-menu-leave-active {
    transition: none;
  }
}
</style>
