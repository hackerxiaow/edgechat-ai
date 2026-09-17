<script setup>
import { AlertCircle, Bot, CheckCircle, Eye, EyeOff, RefreshCw, Save, Sparkles } from '@lucide/vue';
import { onMounted, reactive, ref } from 'vue';
import api from '../api.js';
import UiButton from '../components/ui/Button.vue';
import UiSurface from '../components/ui/Surface.vue';
import { t } from '../i18n.js';

const loading = ref(false);
const saving = ref(false);
const testing = ref(false);
const showApiKey = ref(false);
const error = ref('');
const success = ref('');
const testResult = ref(null);

const aiForm = reactive({
  enabled: true,
  apiUrl: '',
  apiKey: '',
  model: '',
  triggerMode: 'all',
  botName: '',
  botAvatarUrl: '',
  systemPrompt: ''
});

const presetModels = [
  'chatgpt/gpt-5.6-luna',
  'gpt-4o-mini',
  'gpt-4o',
  'gemini-2.5-flash',
  'claude-3-5-sonnet'
];

function applyConfig(config) {
  if (!config) return;
  aiForm.enabled = Boolean(config.enabled);
  aiForm.apiUrl = config.apiUrl || '';
  aiForm.apiKey = config.apiKey || '';
  aiForm.model = config.model || '';
  aiForm.triggerMode = config.triggerMode || 'all';
  aiForm.botName = config.botName || 'ZeroClaw';
  aiForm.botAvatarUrl = config.botAvatarUrl || '';
  aiForm.systemPrompt = config.systemPrompt || '';
}

async function loadConfig() {
  loading.value = true;
  error.value = '';
  testResult.value = null;
  try {
    const payload = await api.adminAiBot();
    applyConfig(payload.config);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

async function saveConfig() {
  saving.value = true;
  error.value = '';
  success.value = '';
  try {
    const payload = await api.saveAdminAiBotConfig({
      enabled: aiForm.enabled,
      apiUrl: aiForm.apiUrl,
      apiKey: aiForm.apiKey,
      model: aiForm.model,
      triggerMode: aiForm.triggerMode,
      botName: aiForm.botName,
      botAvatarUrl: aiForm.botAvatarUrl,
      systemPrompt: aiForm.systemPrompt
    });
    applyConfig(payload.config);
    success.value = t('ai.saved');
    setTimeout(() => {
      if (success.value === t('ai.saved')) success.value = '';
    }, 3500);
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    saving.value = false;
  }
}

async function runConnectionTest() {
  testing.value = true;
  testResult.value = null;
  try {
    const res = await api.testAdminAiBot({
      apiUrl: aiForm.apiUrl,
      apiKey: aiForm.apiKey,
      model: aiForm.model
    });
    testResult.value = res;
  } catch (err) {
    testResult.value = { ok: false, error: err.message };
  } finally {
    testing.value = false;
  }
}

function selectPresetModel(modelName) {
  aiForm.model = modelName;
}

onMounted(loadConfig);
</script>

<template>
  <div class="admin-section admin-ai-page">
    <header class="admin-section__header">
      <div class="admin-section__heading">
        <h2>{{ t('ai.title') }}</h2>
        <p>{{ t('ai.description') }}</p>
      </div>
      <UiButton variant="secondary" :disabled="loading" @click="loadConfig">
        <RefreshCw :size="16" aria-hidden="true" :class="{ 'admin-spin': loading }" />
        {{ t('common.refresh') }}
      </UiButton>
    </header>

    <div class="admin-section__body">
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <p v-if="success" class="success-text" role="status">{{ success }}</p>

      <!-- 1. 运行状态与总开关 -->
      <UiSurface class="panel ai-status-panel">
        <div class="ai-panel-heading">
          <div>
            <h3 class="panel-title">{{ t('ai.status') }}</h3>
            <p class="muted">{{ t('ai.enableBotHint') }}</p>
          </div>
          <span class="ai-status-badge" :class="{ 'ai-status-badge--online': aiForm.enabled }">
            {{ aiForm.enabled ? t('ai.enabled') : t('ai.disabled') }}
          </span>
        </div>

        <div class="ai-switch-row">
          <label class="telegram-switch">
            <input v-model="aiForm.enabled" type="checkbox" />
            <span aria-hidden="true"></span>
            <span class="telegram-switch__label"><strong>{{ t('ai.enableBot') }}</strong></span>
          </label>
        </div>
      </UiSurface>

      <!-- 2. 网关与模型连接 -->
      <UiSurface class="panel ai-connection-panel">
        <div class="ai-panel-heading">
          <div>
            <h3 class="panel-title">{{ t('ai.connectionSettings') }}</h3>
            <p class="muted">{{ t('ai.connectionDescription') }}</p>
          </div>
        </div>

        <div class="ai-form-grid">
          <label class="field">
            <span>{{ t('ai.apiUrl') }}</span>
            <input
              v-model.trim="aiForm.apiUrl"
              type="text"
              autocomplete="off"
              :placeholder="t('ai.apiUrlPlaceholder')"
            />
            <small class="field-hint">{{ t('ai.apiUrlHint') }}</small>
          </label>

          <label class="field">
            <span>{{ t('ai.apiKey') }}</span>
            <div class="ai-password-input-wrap">
              <input
                v-model.trim="aiForm.apiKey"
                :type="showApiKey ? 'text' : 'password'"
                autocomplete="off"
                :placeholder="t('ai.apiKeyPlaceholder')"
              />
              <button
                type="button"
                class="ai-password-toggle"
                :title="showApiKey ? t('ai.hideApiKey') : t('ai.showApiKey')"
                @click="showApiKey = !showApiKey"
              >
                <EyeOff v-if="showApiKey" :size="16" />
                <Eye v-else :size="16" />
              </button>
            </div>
            <small class="field-hint">{{ t('ai.apiKeyHint') }}</small>
          </label>

          <div class="field">
            <span>{{ t('ai.model') }}</span>
            <input
              v-model.trim="aiForm.model"
              type="text"
              autocomplete="off"
              :placeholder="t('ai.modelPlaceholder')"
            />
            <div class="ai-preset-chips">
              <span class="ai-chips-label">{{ t('ai.presetModels') }}</span>
              <button
                v-for="preset in presetModels"
                :key="preset"
                type="button"
                class="ai-preset-chip"
                :class="{ 'ai-preset-chip--active': aiForm.model === preset }"
                @click="selectPresetModel(preset)"
              >
                {{ preset }}
              </button>
            </div>
            <small class="field-hint">{{ t('ai.modelHint') }}</small>
          </div>

          <label class="field">
            <span>{{ t('ai.triggerMode') }}</span>
            <select v-model="aiForm.triggerMode" class="ai-select">
              <option value="all">{{ t('ai.triggerModeAll') }}</option>
              <option value="mention">{{ t('ai.triggerModeMention') }}</option>
            </select>
            <small class="field-hint">{{ t('ai.triggerModeHint') }}</small>
          </label>
        </div>

        <!-- 连通性测试区 -->
        <div class="ai-test-section">
          <div class="ai-test-actions">
            <UiButton
              type="button"
              variant="secondary"
              size="sm"
              :disabled="testing || !aiForm.apiUrl || !aiForm.model"
              @click="runConnectionTest"
            >
              <Sparkles :size="15" aria-hidden="true" :class="{ 'admin-spin': testing }" />
              {{ testing ? t('ai.testing') : t('ai.testConnection') }}
            </UiButton>
          </div>

          <div v-if="testResult" class="ai-test-result" :class="{ 'ai-test-result--ok': testResult.ok, 'ai-test-result--err': !testResult.ok }">
            <component :is="testResult.ok ? CheckCircle : AlertCircle" :size="18" class="ai-test-result-icon" />
            <div class="ai-test-result-body">
              <div v-if="testResult.ok" class="ai-test-success-text">
                {{ t('ai.testSuccess', { latency: testResult.latencyMs, reply: testResult.reply }) }}
              </div>
              <div v-else class="ai-test-fail-text">
                {{ t('ai.testFailed', { error: testResult.error }) }}
              </div>
            </div>
          </div>
        </div>
      </UiSurface>

      <!-- 3. 形象与人设设定 -->
      <UiSurface class="panel ai-persona-panel">
        <div class="ai-panel-heading">
          <div>
            <h3 class="panel-title">{{ t('ai.personaSettings') }}</h3>
            <p class="muted">{{ t('ai.personaDescription') }}</p>
          </div>
        </div>

        <div class="ai-form-grid">
          <label class="field">
            <span>{{ t('ai.botName') }}</span>
            <input
              v-model.trim="aiForm.botName"
              type="text"
              :placeholder="t('ai.botNamePlaceholder')"
            />
          </label>

          <label class="field">
            <span>{{ t('ai.botAvatarUrl') }}</span>
            <input
              v-model.trim="aiForm.botAvatarUrl"
              type="text"
              :placeholder="t('ai.botAvatarUrlPlaceholder')"
            />
          </label>
        </div>

        <!-- 头像预览 -->
        <div class="ai-avatar-preview-box">
          <div class="ai-avatar-img-wrap">
            <img v-if="aiForm.botAvatarUrl" :src="aiForm.botAvatarUrl" :alt="aiForm.botName" />
            <Bot v-else :size="24" />
          </div>
          <div class="ai-avatar-preview-meta">
            <strong>{{ aiForm.botName || 'ZeroClaw' }}</strong>
            <span>{{ aiForm.botAvatarUrl || t('ai.defaultAvatar') }}</span>
          </div>
        </div>

        <!-- 人设提示词 -->
        <label class="field ai-prompt-field">
          <span>{{ t('ai.systemPrompt') }}</span>
          <textarea
            v-model="aiForm.systemPrompt"
            rows="4"
            class="ai-prompt-textarea"
            :placeholder="t('ai.systemPromptPlaceholder')"
          ></textarea>
        </label>
      </UiSurface>

      <!-- 底部全局保存按钮 -->
      <div class="ai-footer-actions">
        <UiButton :disabled="saving" size="md" @click="saveConfig">
          <Save :size="16" />
          {{ saving ? t('common.saving') : t('common.save') }}
        </UiButton>
      </div>
    </div>
  </div>
</template>

<style scoped>
.admin-ai-page {
  max-width: 1120px;
}

.ai-panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--admin-space-sm);
  margin-bottom: var(--admin-space-sm);
}

.ai-panel-heading p {
  margin: var(--admin-space-3xs) 0 0;
}

.ai-status-badge {
  flex: 0 0 auto;
  padding: 5px 9px;
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--admin-radius-control);
  background: var(--admin-active);
  color: var(--admin-muted);
  font-size: 0.75rem;
  font-weight: 700;
}

.ai-status-badge--online {
  border-color: var(--admin-success);
  background: var(--admin-success-bg);
  color: var(--admin-success);
}

.ai-switch-row {
  padding-top: var(--admin-space-2xs);
}

.ai-form-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: var(--admin-space-sm);
}

.field-hint {
  color: var(--admin-muted);
  font-size: 0.72rem;
  margin-top: var(--admin-space-3xs);
}

.ai-select {
  width: 100%;
  height: 38px;
  padding: 0 var(--admin-space-xs);
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--admin-radius-control);
  background: var(--admin-control-bg);
  color: var(--admin-text);
  font-size: 0.88rem;
  outline: none;
}

.ai-password-input-wrap {
  display: flex;
  align-items: center;
  position: relative;
}

.ai-password-input-wrap input {
  width: 100%;
  padding-right: 36px;
}

.ai-password-toggle {
  position: absolute;
  right: 8px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--admin-muted);
  cursor: pointer;
  padding: 4px;
}

.ai-password-toggle:hover {
  color: var(--admin-text);
}

.ai-preset-chips {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 6px;
}

.ai-chips-label {
  font-size: 0.72rem;
  color: var(--admin-muted);
}

.ai-preset-chip {
  padding: 2px 7px;
  background: var(--admin-active);
  border: 1px solid var(--admin-border);
  border-radius: var(--admin-radius-pill, 12px);
  font-size: 0.7rem;
  color: var(--admin-muted);
  cursor: pointer;
  transition: all 0.15s ease;
}

.ai-preset-chip:hover {
  border-color: var(--admin-primary);
  color: var(--admin-text);
}

.ai-preset-chip--active {
  background: var(--admin-primary-bg, rgba(59, 130, 246, 0.1));
  border-color: var(--admin-primary);
  color: var(--admin-primary);
}

.ai-test-section {
  margin-top: var(--admin-space-sm);
  padding-top: var(--admin-space-sm);
  border-top: 1px solid var(--admin-border);
}

.ai-test-actions {
  display: flex;
  align-items: center;
  gap: var(--admin-space-xs);
}

.ai-test-result {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-top: var(--admin-space-xs);
  padding: 10px 14px;
  border-radius: var(--admin-radius-control);
  font-size: 0.84rem;
  line-height: 1.4;
}

.ai-test-result--ok {
  background: var(--admin-success-bg);
  border: 1px solid var(--admin-success);
  color: var(--admin-success);
}

.ai-test-result--err {
  background: var(--admin-error-bg, rgba(239, 68, 68, 0.1));
  border: 1px solid var(--admin-error, #ef4444);
  color: var(--admin-error, #ef4444);
}

.ai-test-result-icon {
  flex-shrink: 0;
  margin-top: 2px;
}

.ai-test-result-body {
  flex: 1;
  word-break: break-word;
}

.ai-avatar-preview-box {
  display: flex;
  align-items: center;
  gap: var(--admin-space-sm);
  padding: var(--admin-space-xs);
  margin-top: var(--admin-space-xs);
  margin-bottom: var(--admin-space-sm);
  border: 1px dashed var(--admin-border-strong);
  border-radius: var(--admin-radius-control);
  background: var(--admin-subtle-bg, rgba(0, 0, 0, 0.02));
}

.ai-avatar-img-wrap {
  width: 44px;
  height: 44px;
  border-radius: 50%;
  overflow: hidden;
  background: var(--admin-active);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  border: 1px solid var(--admin-border);
}

.ai-avatar-img-wrap img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.ai-avatar-preview-meta {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 0.8rem;
  overflow: hidden;
}

.ai-avatar-preview-meta strong {
  color: var(--admin-text);
}

.ai-avatar-preview-meta span {
  color: var(--admin-muted);
  font-size: 0.74rem;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.ai-prompt-field {
  margin-top: var(--admin-space-xs);
}

.ai-prompt-textarea {
  width: 100%;
  padding: var(--admin-space-xs);
  border: 1px solid var(--admin-border-strong);
  border-radius: var(--admin-radius-control);
  background: var(--admin-control-bg);
  color: var(--admin-text);
  font-family: inherit;
  font-size: 0.88rem;
  line-height: 1.5;
  resize: vertical;
  outline: none;
}

.ai-footer-actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--admin-space-xs);
}
</style>
