<script setup>
import { computed, ref, watch } from 'vue';

const props = defineProps({
  content: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['preview']);

const failedUrls = ref(new Set());

watch(() => props.content, () => {
  failedUrls.value = new Set();
});

function sanitizeMediaUrl(raw) {
  if (!raw) return '';
  let url = String(raw).trim().replace(/[)\]>,;.]+$/, '');
  try {
    const parsed = new URL(url);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      return parsed.href;
    }
  } catch {
    return '';
  }
  return '';
}

const MARKDOWN_IMG_REGEX = /!\[.*?\]\((https?:\/\/[^\s)]+)\)/g;
const DIRECT_IMG_REGEX = /(https?:\/\/[^\s]+(?:\.gif|\.png|\.jpg|\.jpeg|\.webp)(?:\?[^\s]+)?)/gi;
const GIPHY_TENOR_REGEX = /(https?:\/\/(?:media\d*\.giphy\.com|c\.tenor\.com|media\.tenor\.com)\/[^\s]+)/gi;

const imageUrls = computed(() => {
  const text = String(props.content || '');
  if (!text) return [];

  const urls = new Set();

  // 1. 提取 Markdown 格式的图片，提取后从文本中剔除，避免被后续普通 URL 正则重复抓取
  let remainingText = text.replace(MARKDOWN_IMG_REGEX, (_match, url) => {
    const clean = sanitizeMediaUrl(url);
    if (clean) urls.add(clean);
    return ' ';
  });

  // 2. 从剩余文本提取常规图片格式直链
  remainingText = remainingText.replace(DIRECT_IMG_REGEX, (url) => {
    const clean = sanitizeMediaUrl(url);
    if (clean) urls.add(clean);
    return ' ';
  });

  // 3. 提取 Giphy / Tenor 等常见动图直链
  remainingText.replace(GIPHY_TENOR_REGEX, (url) => {
    const clean = sanitizeMediaUrl(url);
    if (clean) urls.add(clean);
    return ' ';
  });

  return [...urls];
});

const visibleUrls = computed(() =>
  imageUrls.value.filter((url) => !failedUrls.value.has(url))
);

function handleImageError(url) {
  const next = new Set(failedUrls.value);
  next.add(url);
  failedUrls.value = next;
}
</script>

<template>
  <div v-if="visibleUrls.length" class="inline-media-preview">
    <div
      v-for="url in visibleUrls"
      :key="url"
      class="inline-media-card"
      @click="emit('preview', url)"
    >
      <img
        :src="url"
        alt="GIF"
        loading="lazy"
        class="inline-media-img"
        @error="handleImageError(url)"
      />
    </div>
  </div>
</template>

<style scoped>
.inline-media-preview {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 6px;
  margin-bottom: 4px;
}

.inline-media-card {
  display: inline-block;
  max-width: min(340px, 100%);
  border-radius: 10px;
  overflow: hidden;
  cursor: pointer;
  background: rgba(0, 0, 0, 0.05);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
  transition: transform 120ms ease, box-shadow 120ms ease;
}

.inline-media-card:hover {
  transform: scale(1.02);
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.inline-media-img {
  display: block;
  max-width: 100%;
  max-height: 240px;
  object-fit: contain;
  border-radius: 10px;
}
</style>
