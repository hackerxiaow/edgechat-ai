<script setup>
import { computed } from 'vue';

const props = defineProps({
  content: {
    type: String,
    default: ''
  }
});

const emit = defineEmits(['preview']);

// 匹配 Markdown 图片格式 ![](url) 以及常见动图/图床 URL
const MARKDOWN_IMG_REGEX = /!\[(.*?)\]\((https?:\/\/[^\s)]+)\)/g;
const DIRECT_IMG_REGEX = /(https?:\/\/[^\s]+(?:\.gif|\.png|\.jpg|\.jpeg|\.webp)(?:\?[^\s]+)?)/gi;
const GIPHY_TENOR_REGEX = /(https?:\/\/(?:media\d*\.giphy\.com|c\.tenor\.com|media\.tenor\.com)\/[^\s]+)/gi;

const imageUrls = computed(() => {
  const text = String(props.content || '');
  const urls = new Set();

  let match;
  while ((match = MARKDOWN_IMG_REGEX.exec(text)) !== null) {
    if (match[2]) urls.add(match[2]);
  }
  while ((match = DIRECT_IMG_REGEX.exec(text)) !== null) {
    if (match[1]) urls.add(match[1]);
  }
  while ((match = GIPHY_TENOR_REGEX.exec(text)) !== null) {
    if (match[1]) urls.add(match[1]);
  }

  return [...urls];
});
</script>

<template>
  <div v-if="imageUrls.length" class="inline-media-preview">
    <div
      v-for="url in imageUrls"
      :key="url"
      class="inline-media-card"
      @click="emit('preview', url)"
    >
      <img
        :src="url"
        alt="GIF"
        loading="lazy"
        class="inline-media-img"
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
