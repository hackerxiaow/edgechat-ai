<script setup>
import { onMounted, reactive, ref } from 'vue';
import api from '../../api.js';
import store from '../../store.js';
import UiButton from '../ui/Button.vue';
import UiSurface from '../ui/Surface.vue';
import { t } from '../../i18n.js';

/** 与后端 D1 单行上限保持一致：超过这个值写入必然失败，前端先挡住。 */
const MAX_UPLOAD_MB = 1.8;
const BYTES_PER_MB = 1048576;

const loading = ref(false);
const error = ref('');
const saving = ref(false);
const iconUploading = ref(false);
const iconFileInputEl = ref(null);
const siteForm = reactive({
  siteName: 'Edgechat',
  siteIconUrl: '',
  maxFileSizeMb: 1,
  allowedFileTypes: '',
  messageRetentionDays: 7,
  softDeleteRetentionDays: 60,
  orphanUploadRetentionDays: 1,
  gcIntervalMinutes: 60,
  siteOrigins: ''
});

function applySite(site) {
  siteForm.siteName = site?.siteName || 'Edgechat';
  siteForm.siteIconUrl = site?.siteIconUrl || '';
  const bytes = Number(site?.maxFileSize) || BYTES_PER_MB;
  // 保留一位小数，避免 1048576 显示成 1.0000001 之类。
  siteForm.maxFileSizeMb = Math.round((bytes / BYTES_PER_MB) * 10) / 10;
  siteForm.allowedFileTypes = (site?.allowedFileTypes || []).join(', ');
  siteForm.messageRetentionDays = Number(site?.messageRetentionDays) || 7;
  siteForm.softDeleteRetentionDays = Number(site?.softDeleteRetentionDays) || 60;
  siteForm.orphanUploadRetentionDays = Number(site?.orphanUploadRetentionDays) || 1;
  siteForm.gcIntervalMinutes = Number(site?.gcIntervalMinutes) || 60;
  siteForm.siteOrigins = (site?.siteOrigins || []).join(', ');
}

async function loadSiteSettings() {
  loading.value = true;
  error.value = '';
  try {
    const payload = await api.adminSiteSettings();
    applySite(payload.site);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

function openIconPicker() {
  iconFileInputEl.value?.click();
}

async function uploadSiteIcon(event) {
  const file = event.target.files?.[0];
  if (!file) {
    return;
  }

  iconUploading.value = true;
  error.value = '';
  try {
    const payload = await api.uploadFile(file);
    siteForm.siteIconUrl = payload.file.url;
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    iconUploading.value = false;
    event.target.value = '';
  }
}

async function saveSiteSettings() {
  saving.value = true;
  error.value = '';
  try {
    const payload = await api.updateAdminSiteSettings({
      siteName: siteForm.siteName,
      siteIconUrl: siteForm.siteIconUrl,
      maxFileSize: Math.round(Number(siteForm.maxFileSizeMb) * BYTES_PER_MB),
      allowedFileTypes: siteForm.allowedFileTypes,
      messageRetentionDays: Number(siteForm.messageRetentionDays),
      softDeleteRetentionDays: Number(siteForm.softDeleteRetentionDays),
      orphanUploadRetentionDays: Number(siteForm.orphanUploadRetentionDays),
      gcIntervalMinutes: Number(siteForm.gcIntervalMinutes),
      siteOrigins: siteForm.siteOrigins
    });
    applySite(payload.site);
    store.setSite(payload.site);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    saving.value = false;
  }
}

onMounted(loadSiteSettings);
</script>

<template>
  <UiSurface class="panel admin-site-appearance">
    <div class="admin-site-appearance__heading">
      <div>
        <h3 class="panel-title">{{ t('site.appearance.title') }}</h3>
        <p>{{ t('site.appearance.description') }}</p>
      </div>
      <UiButton variant="secondary" size="sm" :disabled="loading" @click="loadSiteSettings">
        {{ loading ? `${t('common.loading')}...` : t('site.reload') }}
      </UiButton>
    </div>

    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <label class="field">
      <span>{{ t('site.name') }}</span>
      <input v-model.trim="siteForm.siteName" :placeholder="t('site.namePlaceholder')" />
    </label>
    <label class="field">
      <span>{{ t('site.iconUrl') }}</span>
      <input v-model.trim="siteForm.siteIconUrl" :placeholder="t('site.iconUrlPlaceholder')" />
    </label>
    <div class="admin-site-preview">
      <div class="admin-site-preview__icon">
        <img v-if="siteForm.siteIconUrl" :src="siteForm.siteIconUrl" :alt="t('site.iconAlt')" />
        <span v-else>{{ siteForm.siteName.slice(0, 1) || 'C' }}</span>
      </div>
      <div class="admin-site-preview__meta">
        <strong>{{ siteForm.siteName || 'Edgechat' }}</strong>
        <span>{{ siteForm.siteIconUrl || t('site.noIconUrl') }}</span>
      </div>
    </div>

    <div class="admin-site-runtime">
      <h4 class="panel-title">{{ t('site.runtime.title') }}</h4>
      <p class="admin-site-runtime__hint">{{ t('site.runtime.description') }}</p>

      <div class="admin-site-runtime__grid">
        <label class="field">
          <span>{{ t('site.runtime.maxFileSize') }}</span>
          <input
            v-model.number="siteForm.maxFileSizeMb"
            type="number"
            min="0.1"
            :max="MAX_UPLOAD_MB"
            step="0.1"
          />
          <small>{{ t('site.runtime.maxFileSizeHint', { max: MAX_UPLOAD_MB }) }}</small>
        </label>

        <label class="field">
          <span>{{ t('site.runtime.gcInterval') }}</span>
          <input v-model.number="siteForm.gcIntervalMinutes" type="number" min="5" max="10080" />
          <small>{{ t('site.runtime.gcIntervalHint') }}</small>
        </label>

        <label class="field">
          <span>{{ t('site.runtime.messageRetention') }}</span>
          <input v-model.number="siteForm.messageRetentionDays" type="number" min="1" max="3650" />
        </label>

        <label class="field">
          <span>{{ t('site.runtime.softDeleteRetention') }}</span>
          <input v-model.number="siteForm.softDeleteRetentionDays" type="number" min="1" max="3650" />
        </label>

        <label class="field">
          <span>{{ t('site.runtime.orphanUploadRetention') }}</span>
          <input
            v-model.number="siteForm.orphanUploadRetentionDays"
            type="number"
            min="1"
            max="3650"
          />
        </label>
      </div>

      <label class="field">
        <span>{{ t('site.runtime.allowedFileTypes') }}</span>
        <input
          v-model.trim="siteForm.allowedFileTypes"
          :placeholder="t('site.runtime.allowedFileTypesPlaceholder')"
        />
        <small>{{ t('site.runtime.allowedFileTypesHint') }}</small>
      </label>

      <label class="field">
        <span>{{ t('site.runtime.siteOrigins') }}</span>
        <input v-model.trim="siteForm.siteOrigins" placeholder="https://chat.example.com" />
        <small>{{ t('site.runtime.siteOriginsHint') }}</small>
      </label>

      <p class="admin-site-runtime__note">{{ t('site.runtime.fixedNote') }}</p>
    </div>

    <div class="inline-actions">
      <input ref="iconFileInputEl" type="file" accept="image/*" hidden @change="uploadSiteIcon" />
      <UiButton variant="secondary" size="sm" :disabled="iconUploading" @click="openIconPicker">
        {{ iconUploading ? t('common.uploading') : t('site.uploadIcon') }}
      </UiButton>
      <UiButton :disabled="saving" @click="saveSiteSettings">
        {{ saving ? t('common.saving') : t('site.save') }}
      </UiButton>
    </div>
  </UiSurface>
</template>

<style scoped src="../../styles/admin/site-appearance.css"></style>
