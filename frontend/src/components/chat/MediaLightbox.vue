<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { ChevronLeft, ChevronRight, Download, RotateCcw, X, ZoomIn, ZoomOut } from '@lucide/vue';
import { t } from '../../i18n.js';

const props = defineProps({
  show: { type: Boolean, default: false },
  url: { type: String, default: '' },
  title: { type: String, default: '' },
  hasPrev: { type: Boolean, default: false },
  hasNext: { type: Boolean, default: false }
});

const emit = defineEmits(['close', 'prev', 'next']);

const scale = ref(1);

watch(() => props.show, (shown) => {
  if (shown) {
    scale.value = 1;
  }
});

watch(() => props.url, () => {
  scale.value = 1;
});

function zoomIn() {
  scale.value = Math.min(scale.value + 0.25, 3.5);
}

function zoomOut() {
  scale.value = Math.max(scale.value - 0.25, 0.5);
}

function resetZoom() {
  scale.value = 1;
}

function handleKeydown(event) {
  if (!props.show) return;
  if (event.key === 'Escape') {
    emit('close');
  } else if (event.key === 'ArrowLeft' && props.hasPrev) {
    emit('prev');
  } else if (event.key === 'ArrowRight' && props.hasNext) {
    emit('next');
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
  <Teleport to="body">
    <Transition name="lightbox-fade">
      <div v-if="show" class="media-lightbox" role="dialog" aria-modal="true" @click.self="emit('close')">
        <!-- 顶栏工具条 -->
        <header class="media-lightbox__toolbar">
          <span class="media-lightbox__title">{{ title || t('attachments.fallback') }}</span>
          <div class="media-lightbox__actions">
            <button type="button" class="toolbar-btn" :title="t('chat.zoomIn')" @click="zoomIn">
              <ZoomIn :size="18" aria-hidden="true" />
            </button>
            <button type="button" class="toolbar-btn" :title="t('chat.zoomOut')" @click="zoomOut">
              <ZoomOut :size="18" aria-hidden="true" />
            </button>
            <button type="button" class="toolbar-btn" :title="t('common.retry')" @click="resetZoom">
              <RotateCcw :size="16" aria-hidden="true" />
            </button>
            <a
              class="toolbar-btn"
              :href="url"
              target="_blank"
              download
              rel="noreferrer"
              :title="t('chat.download')"
            >
              <Download :size="18" aria-hidden="true" />
            </a>
            <button type="button" class="toolbar-btn toolbar-btn--close" :title="t('common.close')" @click="emit('close')">
              <X :size="20" aria-hidden="true" />
            </button>
          </div>
        </header>

        <!-- 左右翻页按钮 -->
        <button
          v-if="hasPrev"
          type="button"
          class="lightbox-nav-btn lightbox-nav-btn--prev"
          :title="t('chat.prevMatch')"
          @click="emit('prev')"
        >
          <ChevronLeft :size="32" aria-hidden="true" />
        </button>

        <button
          v-if="hasNext"
          type="button"
          class="lightbox-nav-btn lightbox-nav-btn--next"
          :title="t('chat.nextMatch')"
          @click="emit('next')"
        >
          <ChevronRight :size="32" aria-hidden="true" />
        </button>

        <!-- 图片展示区 -->
        <div class="media-lightbox__content" @click.self="emit('close')">
          <img
            class="media-lightbox__img"
            :src="url"
            :alt="title"
            :style="{ transform: `scale(${scale})` }"
          />
        </div>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.media-lightbox {
  position: fixed;
  inset: 0;
  z-index: 2000;
  display: flex;
  flex-direction: column;
  background: rgba(0, 0, 0, 0.88);
  backdrop-filter: blur(8px);
  user-select: none;
}

.media-lightbox__toolbar {
  position: relative;
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0.6) 0%, transparent 100%);
  color: #ffffff;
}

.media-lightbox__title {
  font-size: 14px;
  font-weight: 500;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.media-lightbox__actions {
  display: flex;
  align-items: center;
  gap: 8px;
}

.toolbar-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.12);
  color: #ffffff;
  cursor: pointer;
  text-decoration: none;
  transition: background 150ms ease, transform 150ms ease;
}

.toolbar-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: scale(1.05);
}

.toolbar-btn--close:hover {
  background: rgba(229, 57, 53, 0.8);
}

.lightbox-nav-btn {
  position: absolute;
  top: 50%;
  transform: translateY(-50%);
  z-index: 10;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  border: none;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.1);
  color: #ffffff;
  cursor: pointer;
  transition: background 150ms ease, transform 150ms ease;
}

.lightbox-nav-btn:hover {
  background: rgba(255, 255, 255, 0.25);
  transform: translateY(-50%) scale(1.1);
}

.lightbox-nav-btn--prev {
  left: 20px;
}

.lightbox-nav-btn--next {
  right: 20px;
}

.media-lightbox__content {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  padding: 20px;
}

.media-lightbox__img {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 4px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5);
  transition: transform 180ms ease;
}

.lightbox-fade-enter-active,
.lightbox-fade-leave-active {
  transition: opacity 150ms ease;
}

.lightbox-fade-enter-from,
.lightbox-fade-leave-to {
  opacity: 0;
}
</style>
