<script setup>
import { computed } from 'vue';

const props = defineProps({
  reactions: {
    type: Array,
    default: () => []
  },
  currentUserId: {
    type: Number,
    default: 0
  }
});

const emit = defineEmits(['toggle']);

function isReactedByMe(reaction) {
  return Array.isArray(reaction.users) &&
    reaction.users.some((u) => Number(u.id) === Number(props.currentUserId));
}

function reactionTooltip(reaction) {
  if (!Array.isArray(reaction.users) || !reaction.users.length) {
    return reaction.emoji;
  }
  const names = reaction.users.map((u) => u.displayName || 'User');
  if (names.length <= 4) {
    return names.join(', ');
  }
  return `${names.slice(0, 3).join(', ')} +${names.length - 3}`;
}
</script>

<template>
  <div v-if="reactions?.length" class="message-reactions">
    <button
      v-for="item in reactions"
      :key="item.emoji"
      type="button"
      class="reaction-pill"
      :class="{ 'reaction-pill--reacted': isReactedByMe(item) }"
      :title="reactionTooltip(item)"
      @click.stop="emit('toggle', item.emoji)"
    >
      <span class="reaction-emoji">{{ item.emoji }}</span>
      <span class="reaction-count">{{ item.count }}</span>
    </button>
  </div>
</template>

<style scoped>
.message-reactions {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 5px;
  margin-bottom: 2px;
}

.reaction-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 7px;
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
  border-radius: 12px;
  background: var(--chat-paper, rgba(255, 255, 255, 0.8));
  color: var(--chat-ink, #0f172a);
  font-size: 12px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  user-select: none;
  transition: transform 120ms ease, background-color 120ms ease, border-color 120ms ease;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}

.reaction-pill:hover {
  transform: scale(1.08);
  background: var(--chat-hover, rgba(0, 0, 0, 0.05));
}

.reaction-pill:active {
  transform: scale(0.96);
}

.message-reactions .reaction-pill--reacted {
  background: var(--chat-selected, rgba(0, 128, 105, 0.15));
  border-color: var(--chat-accent, #008069);
  color: var(--chat-accent, #008069);
}

:root[data-theme='dark'] .reaction-pill {
  background: rgba(255, 255, 255, 0.08);
  border-color: rgba(255, 255, 255, 0.12);
  color: #f1f5f9;
}

:root[data-theme='dark'] .message-reactions .reaction-pill--reacted {
  background: rgba(0, 168, 132, 0.25);
  border-color: rgba(0, 168, 132, 0.6);
  color: #25d366;
}

.reaction-emoji {
  font-size: 13px;
  line-height: 1;
}

.reaction-count {
  font-size: 11.5px;
  font-variant-numeric: tabular-nums;
  opacity: 0.9;
}
</style>
