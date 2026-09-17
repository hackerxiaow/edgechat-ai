<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronDown, ChevronUp, Search, X } from '@lucide/vue';
import { t } from '../../i18n.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  messages: { type: Array, default: () => [] }
});

const emit = defineEmits(['close', 'jump']);

const inputEl = ref(null);
const query = ref('');
const currentIndex = ref(0);

const matches = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (!q) return [];
  // 倒序匹配（最新的消息排在前面，符合聊天习惯）
  return props.messages
    .filter((m) => String(m.content || '').toLowerCase().includes(q))
    .reverse();
});

watch(() => props.show, async (shown) => {
  if (shown) {
    currentIndex.value = 0;
    await nextTick();
    inputEl.value?.focus();
  } else {
    query.value = '';
    currentIndex.value = 0;
  }
});

watch(matches, (newMatches) => {
  if (newMatches.length > 0) {
    currentIndex.value = 0;
    emit('jump', newMatches[0].id);
  }
});

function jumpToNext() {
  if (!matches.value.length) return;
  currentIndex.value = (currentIndex.value + 1) % matches.value.length;
  emit('jump', matches.value[currentIndex.value].id);
}

function jumpToPrev() {
  if (!matches.value.length) return;
  currentIndex.value = (currentIndex.value - 1 + matches.value.length) % matches.value.length;
  emit('jump', matches.value[currentIndex.value].id);
}

function handleKeydown(event) {
  if (event.key === 'Escape') {
    emit('close');
  } else if (event.key === 'Enter') {
    if (event.shiftKey) {
      jumpToPrev();
    } else {
      jumpToNext();
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <Transition name="search-slide">
    <div v-if="show" class="in-chat-search-bar">
      <div class="in-chat-search-bar__inner">
        <Search :size="16" class="search-icon" aria-hidden="true" />
        <input
          ref="inputEl"
          v-model="query"
          type="text"
          class="search-input"
          :placeholder="t('chat.searchInChat')"
          :aria-label="t('chat.searchInChat')"
        />
        <div v-if="query.trim()" class="search-counter">
          <span v-if="matches.length">{{ currentIndex + 1 }} / {{ matches.length }}</span>
          <span v-else class="search-counter--empty">{{ t('chat.noMatch') }}</span>
        </div>
        <div class="search-nav">
          <button
            type="button"
            class="nav-btn"
            :disabled="!matches.length"
            :title="t('chat.prevMatch')"
            :aria-label="t('chat.prevMatch')"
            @click="jumpToPrev"
          >
            <ChevronUp :size="18" aria-hidden="true" />
          </button>
          <button
            type="button"
            class="nav-btn"
            :disabled="!matches.length"
            :title="t('chat.nextMatch')"
            :aria-label="t('chat.nextMatch')"
            @click="jumpToNext"
          >
            <ChevronDown :size="18" aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          class="close-btn"
          :title="t('common.close')"
          :aria-label="t('common.close')"
          @click="emit('close')"
        >
          <X :size="18" aria-hidden="true" />
        </button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.in-chat-search-bar {
  position: relative;
  z-index: 20;
  background: var(--chat-paper, #ffffff);
  border-bottom: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
  padding: 8px 18px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

:root[data-theme='dark'] .in-chat-search-bar {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.08);
}

.in-chat-search-bar__inner {
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 940px;
  margin: 0 auto;
}

.search-icon {
  color: var(--chat-muted, #94a3b8);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  height: 34px;
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.12));
  border-radius: 17px;
  padding: 0 14px;
  background: var(--chat-canvas, #f8fafc);
  color: var(--chat-ink, inherit);
  font: inherit;
  font-size: 13.5px;
  outline: none;
  transition: border-color 150ms ease;
}

.search-input:focus {
  border-color: var(--chat-accent, #008069);
}

:root[data-theme='dark'] .search-input {
  background: #0f172a;
  border-color: rgba(255, 255, 255, 0.12);
}

.search-counter {
  font-size: 12px;
  color: var(--chat-muted, #64748b);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
  padding: 0 4px;
}

.search-counter--empty {
  color: var(--chat-danger, #e53935);
}

.search-nav {
  display: flex;
  align-items: center;
  gap: 2px;
}

.nav-btn,
.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--chat-muted, #64748b);
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.nav-btn:hover:not(:disabled),
.close-btn:hover {
  background: var(--chat-hover, rgba(0, 0, 0, 0.05));
  color: var(--chat-ink, #0f172a);
}

.nav-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

.search-slide-enter-active,
.search-slide-leave-active {
  transition: transform 150ms ease, opacity 150ms ease;
}

.search-slide-enter-from,
.search-slide-leave-to {
  transform: translateY(-100%);
  opacity: 0;
}
</style>
