<script setup>
import { computed, ref, watch } from 'vue';
import api from '../../api.js';
import { useOverlayLifecycle } from '../../composables/useOverlayLifecycle.js';
import { t } from '../../i18n.js';
import { isPreviewableImageAttachment } from './attachment-utils.js';
import { isAudioAttachment } from '../../voice-message.js';
import MediaLightbox from './MediaLightbox.vue';
import VoiceMessage from './VoiceMessage.vue';

const props = defineProps({
  attachment: {
    type: Object,
    required: true
  }
});

const previewOpen = ref(false);
const previewEl = ref(null);
const imageFailed = ref(false);
const isImage = computed(() => isPreviewableImageAttachment(props.attachment));
const isAudio = computed(() => isAudioAttachment(props.attachment));
const displayName = computed(() => props.attachment?.name || t('attachments.fallback'));
const openOriginalLabel = computed(() => t('attachments.openOriginalNamed', { name: displayName.value }));
const attachmentUrl = computed(() => api.getFileUrl(props.attachment?.key || props.attachment?.url));

useOverlayLifecycle({
  open: previewOpen,
  onClose: closePreview,
  focusTarget: previewEl
});

function openPreview() {
  if (!isImage.value || imageFailed.value) {
    return;
  }

  previewOpen.value = true;
}

function closePreview() {
  previewOpen.value = false;
}

watch(
  () => props.attachment?.key || props.attachment?.url,
  () => {
    imageFailed.value = false;
  }
);
</script>

<template>
	  <div class="message-attachment" :class="{ 'message-attachment--image': isImage, 'message-attachment--audio': isAudio }">
	    <VoiceMessage v-if="isAudio" :attachment="attachment" />
	    <template v-else-if="isImage">
      <button
        v-if="!imageFailed"
        type="button"
        class="message-attachment__image-button"
        :aria-label="t('attachments.previewNamed', { name: displayName })"
        @click="openPreview"
      >
        <img
          class="message-attachment__image"
          :src="attachmentUrl"
          :alt="displayName"
          loading="lazy"
          @error="imageFailed = true"
        />
      </button>
      <a
        v-else
        :href="attachmentUrl"
        target="_blank"
        rel="noreferrer"
        class="chat-bubble__attachment message-attachment__file"
      >
        {{ displayName }}
      </a>

      <MediaLightbox
        :show="previewOpen"
        :url="attachmentUrl"
        :title="displayName"
        @close="closePreview"
      />
    </template>

    <a
      v-else
      :href="attachmentUrl"
      target="_blank"
      rel="noreferrer"
      class="chat-bubble__attachment message-attachment__file"
    >
      {{ displayName }}
    </a>
  </div>
</template>
