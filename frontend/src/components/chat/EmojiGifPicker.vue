<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Film, Image as ImageIcon, Search, Smile, Sticker, X } from '@lucide/vue';
import { t } from '../../i18n.js';

const props = defineProps({
  open: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'select-emoji', 'select-gif', 'select-sticker']);

const activeTab = ref('emoji'); // 'emoji' | 'stickers' | 'gif'
const searchQuery = ref('');
const pickerEl = ref(null);

const EMOJI_CATEGORIES = [
  {
    name: 'Smileys',
    icon: '😀',
    emojis: [
      '😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇',
      '🥰', '😍', '🤩', '😘', '😗', '😚', '😋', '😛', '😜', '🤪', '😝', '🤑', '🤗',
      '🤭', '🤫', '🤔', '🤐', '🤨', '😐', '😑', '😶', '😏', '😒', '🙄', '😬', '🤥',
      '😌', '😔', '😪', '🤤', '😴', '😷', '🤒', '🤕', '🤢', '🤮', '🤧', '🥵', '🥶',
      '🥴', '😵', '🤯', '🤠', '🥳', '😎', '🤓', '🧐', '😕', '😟', '🙁', '😮', '😯',
      '😲', '😳', '🥺', '😦', '😧', '😨', '😰', '😥', '😢', '😭', '😱', '😖', '😣',
      '😞', '😓', '😩', '😫', '🥱', '😤', '😡', '😠', '🤬', '😈', '👿', '💀', '💩'
    ]
  },
  {
    name: 'Gestures',
    icon: '👋',
    emojis: [
      '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙',
      '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏',
      '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶'
    ]
  },
  {
    name: 'Hearts & Vibes',
    icon: '❤️',
    emojis: [
      '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞',
      '💓', '💗', '💖', '💘', '💝', '✨', '🔥', '🎉', '🎊', '🎈', '💯', '🚀', '⭐',
      '🌟', '💫', '💥', '⚡', '🌈', '☀️', '☕', '🍰', '🍕', '🍻', '🥂', '🍀', '🌸'
    ]
  },
  {
    name: 'Animals & Food',
    icon: '🐱',
    emojis: [
      '🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷',
      '🐸', '🐵', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴',
      '🦄', '🐝', '🐛', '🦋', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🍒',
      '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍔', '🍟', '🍕', '🌮', '🍜', '🍣', '🍦'
    ]
  }
];

// 内置精选高频动图（无外部代理阻断风险的轻量高频动图合集）
const CURATED_GIFS = [
  { title: 'Thumbs Up', url: 'https://media.giphy.com/media/111ebonMs90YLu/giphy.gif' },
  { title: 'Clapping', url: 'https://media.giphy.com/media/nbvFVPiEiJH6Q/giphy.gif' },
  { title: 'Cheering', url: 'https://media.giphy.com/media/artj92V8o75VPL7AeQ/giphy.gif' },
  { title: 'Cat Vibe', url: 'https://media.giphy.com/media/jpbnoe3UIa8TU8LM13/giphy.gif' },
  { title: 'Mind Blown', url: 'https://media.giphy.com/media/26ufdipQqU2lhNA4g/giphy.gif' },
  { title: 'Laughing', url: 'https://media.giphy.com/media/10JhviFuU2gWD6/giphy.gif' },
  { title: 'Party', url: 'https://media.giphy.com/media/blSTtZehjAZ8I/giphy.gif' },
  { title: 'Yes', url: 'https://media.giphy.com/media/nXxOjZrbnbRxS/giphy.gif' },
  { title: 'Dance', url: 'https://media.giphy.com/media/DhstvI3CH03DO/giphy.gif' },
  { title: 'Love', url: 'https://media.giphy.com/media/M90mJvfWfd5mbUuULX/giphy.gif' }
];

const TELEGRAM_STICKERS = [
  {
    pack: 'Duck (经典鸭子)',
    stickers: [
      { id: 'duck_thumbs_up', title: '赞', url: '/stickers/duck_thumbs_up.svg' },
      { id: 'duck_heart', title: '爱心', url: '/stickers/duck_heart.svg' },
      { id: 'duck_cool', title: '酷', url: '/stickers/duck_cool.svg' },
      { id: 'duck_party', title: '庆祝', url: '/stickers/duck_party.svg' },
    ]
  },
  {
    pack: 'Pepe (经典佩佩蛙)',
    stickers: [
      { id: 'pepe_happy', title: '开心', url: '/stickers/pepe_happy.svg' },
      { id: 'pepe_cheers', title: '干杯', url: '/stickers/pepe_cheers.svg' },
      { id: 'pepe_thinking', title: '思考', url: '/stickers/pepe_thinking.svg' },
    ]
  },
  {
    pack: 'Cats & Doge (萌宠)',
    stickers: [
      { id: 'cat_love', title: '比心', url: '/stickers/cat_love.svg' },
      { id: 'cat_sleepy', title: '困了', url: '/stickers/cat_sleepy.svg' },
      { id: 'doge_wow', title: '哇塞', url: '/stickers/doge_wow.svg' },
    ]
  }
];

const filteredCategories = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return EMOJI_CATEGORIES;
  return EMOJI_CATEGORIES.map((cat) => ({
    ...cat,
    emojis: cat.emojis.filter((e) => e.includes(q))
  })).filter((cat) => cat.emojis.length > 0);
});

const filteredGifs = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  if (!q) return CURATED_GIFS;
  return CURATED_GIFS.filter((g) => g.title.toLowerCase().includes(q));
});

function handleWindowPointerDown(event) {
  if (props.open && !pickerEl.value?.contains(event.target)) {
    // 忽略点击触发表情按钮自身
    if (event.target.closest('.composer-emoji-trigger')) return;
    emit('close');
  }
}

function handleKeydown(event) {
  if (props.open && event.key === 'Escape') emit('close');
}

onMounted(() => {
  window.addEventListener('pointerdown', handleWindowPointerDown);
  window.addEventListener('keydown', handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener('pointerdown', handleWindowPointerDown);
  window.removeEventListener('keydown', handleKeydown);
});
</script>

<template>
  <div v-if="open" ref="pickerEl" class="emoji-gif-picker" role="dialog">
    <div class="picker-header">
      <div class="picker-tabs" role="tablist">
        <button
          type="button"
          role="tab"
          class="picker-tab"
          :class="{ 'picker-tab--active': activeTab === 'emoji' }"
          @click="activeTab = 'emoji'"
        >
          <Smile :size="15" aria-hidden="true" />
          <span>{{ t('chat.emoji') }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="picker-tab"
          :class="{ 'picker-tab--active': activeTab === 'stickers' }"
          @click="activeTab = 'stickers'"
        >
          <Sticker :size="15" aria-hidden="true" />
          <span>{{ t('chat.stickers') }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="picker-tab"
          :class="{ 'picker-tab--active': activeTab === 'gif' }"
          @click="activeTab = 'gif'"
        >
          <Film :size="15" aria-hidden="true" />
          <span>{{ t('chat.gifs') }}</span>
        </button>
      </div>
      <button
        type="button"
        class="picker-close-btn"
        :title="t('common.close')"
        @click="emit('close')"
      >
        <X :size="16" aria-hidden="true" />
      </button>
    </div>

    <div class="picker-search">
      <Search :size="14" class="picker-search__icon" aria-hidden="true" />
      <input
        v-model="searchQuery"
        type="text"
        class="picker-search__input"
        :placeholder="activeTab === 'emoji' ? t('contacts.search') : t('chat.searchGifs')"
      />
    </div>

    <!-- Emoji 列表 -->
    <div v-if="activeTab === 'emoji'" class="picker-scroll-area">
      <div v-for="cat in filteredCategories" :key="cat.name" class="emoji-category">
        <div class="category-header">
          <span>{{ cat.icon }}</span>
          <span>{{ cat.name }}</span>
        </div>
        <div class="emoji-grid">
          <button
            v-for="emoji in cat.emojis"
            :key="emoji"
            type="button"
            class="emoji-cell"
            @click="emit('select-emoji', emoji)"
          >
            {{ emoji }}
          </button>
        </div>
      </div>
    </div>

    <!-- Telegram 贴纸列表 -->
    <div v-else-if="activeTab === 'stickers'" class="picker-scroll-area stickers-scroll-area">
      <div v-for="pack in TELEGRAM_STICKERS" :key="pack.pack" class="sticker-pack">
        <div class="category-header">
          <span>{{ pack.pack }}</span>
        </div>
        <div class="sticker-grid">
          <button
            v-for="stk in pack.stickers"
            :key="stk.id"
            type="button"
            class="sticker-cell"
            :title="stk.title"
            @click="emit('select-sticker', stk)"
          >
            <img :src="stk.url" :alt="stk.title" loading="lazy" />
          </button>
        </div>
      </div>
    </div>

    <!-- GIF 列表 -->
    <div v-else class="picker-scroll-area gif-scroll-area">
      <div class="gif-grid">
        <button
          v-for="gif in filteredGifs"
          :key="gif.url"
          type="button"
          class="gif-cell"
          :title="gif.title"
          @click="emit('select-gif', gif)"
        >
          <img :src="gif.url" :alt="gif.title" loading="lazy" />
          <span class="gif-cell__title">{{ gif.title }}</span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.emoji-gif-picker {
  position: absolute;
  bottom: calc(100% + 8px);
  left: 12px;
  z-index: 100;
  width: 320px;
  height: 360px;
  display: flex;
  flex-direction: column;
  background: var(--surface-solid, #ffffff);
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.08));
  border-radius: 14px;
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.16), 0 2px 6px rgba(0, 0, 0, 0.06);
  overflow: hidden;
}

:root[data-theme='dark'] .emoji-gif-picker {
  background: #1e293b;
  border-color: rgba(255, 255, 255, 0.1);
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.4);
}

.picker-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px 6px;
  border-bottom: 1px solid var(--chat-line, rgba(0, 0, 0, 0.06));
}

.picker-tabs {
  display: flex;
  align-items: center;
  gap: 4px;
}

.picker-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border: none;
  border-radius: 12px;
  background: transparent;
  color: var(--chat-muted, #64748b);
  font: inherit;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: background 120ms ease, color 120ms ease;
}

.picker-tab:hover {
  background: var(--chat-hover, rgba(0, 0, 0, 0.05));
  color: var(--chat-ink, #0f172a);
}

.picker-tab--active {
  background: var(--chat-selected, rgba(0, 128, 105, 0.12));
  color: var(--chat-accent, #008069);
  font-weight: 600;
}

:root[data-theme='dark'] .picker-tab--active {
  background: rgba(0, 168, 132, 0.2);
  color: #25d366;
}

.picker-close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border: none;
  border-radius: 50%;
  background: transparent;
  color: var(--chat-muted, #64748b);
  cursor: pointer;
}

.picker-close-btn:hover {
  background: var(--chat-hover, rgba(0, 0, 0, 0.05));
}

.picker-search {
  position: relative;
  display: flex;
  align-items: center;
  padding: 6px 10px;
  border-bottom: 1px solid var(--chat-line, rgba(0, 0, 0, 0.06));
}

.picker-search__icon {
  position: absolute;
  left: 18px;
  color: var(--chat-muted, #94a3b8);
  pointer-events: none;
}

.picker-search__input {
  width: 100%;
  height: 28px;
  padding: 0 10px 0 26px;
  border: 1px solid var(--chat-line, rgba(0, 0, 0, 0.1));
  border-radius: 14px;
  background: var(--chat-canvas, #f8fafc);
  color: var(--chat-ink, inherit);
  font: inherit;
  font-size: 12px;
  outline: none;
}

:root[data-theme='dark'] .picker-search__input {
  background: #0f172a;
  border-color: rgba(255, 255, 255, 0.1);
}

.picker-scroll-area {
  flex: 1;
  overflow-y: auto;
  padding: 6px 8px;
}

.category-header {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 4px 4px;
  font-size: 11px;
  font-weight: 600;
  color: var(--chat-muted, #64748b);
  text-transform: uppercase;
}

.emoji-grid {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  gap: 2px;
}

.emoji-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  border: none;
  border-radius: 8px;
  background: transparent;
  font-size: 20px;
  cursor: pointer;
  transition: transform 100ms ease, background-color 100ms ease;
  line-height: 1;
  padding: 0;
}

.emoji-cell:hover {
  transform: scale(1.22);
  background: var(--chat-hover, rgba(0, 0, 0, 0.06));
}

:root[data-theme='dark'] .emoji-cell:hover {
  background: rgba(255, 255, 255, 0.1);
}

.gif-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 6px;
}

.gif-cell {
  position: relative;
  height: 90px;
  border: none;
  border-radius: 8px;
  overflow: hidden;
  padding: 0;
  background: #000;
  cursor: pointer;
}

.gif-cell img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 150ms ease;
}

.gif-cell:hover img {
  transform: scale(1.05);
}

.sticker-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  padding: 4px;
}

.sticker-cell {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 80px;
  border: none;
  border-radius: 8px;
  background: transparent;
  cursor: pointer;
  padding: 4px;
  transition: transform 120ms ease;
}

.sticker-cell:hover {
  transform: scale(1.15);
  background: var(--chat-hover, rgba(0, 0, 0, 0.05));
}

.sticker-cell img {
  max-width: 100%;
  max-height: 100%;
  object-fit: contain;
}

.gif-cell__title {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  padding: 2px 6px;
  background: rgba(0, 0, 0, 0.6);
  color: #ffffff;
  font-size: 10.5px;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
