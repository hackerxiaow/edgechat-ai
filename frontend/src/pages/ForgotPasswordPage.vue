<script setup>
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { forgotPassword } from '../api.js';
import { useTheme } from '../composables/useTheme.js';
import LanguageSwitch from '../components/ui/LanguageSwitch.vue';
import { Sun, Moon } from '@lucide/vue';
import { useI18n, localizeServerError } from '../i18n.js';

const router = useRouter();
const { t } = useI18n();
const { isDark, toggleTheme } = useTheme();

const email = ref('');
const loading = ref(false);
const rawError = ref('');
const isSuccess = ref(false);

const errorMessage = computed(() => {
  return rawError.value ? localizeServerError(rawError.value) : '';
});

async function submit() {
  if (!email.value) return;
  loading.value = true;
  rawError.value = '';
  isSuccess.value = false;
  try {
    await forgotPassword(email.value);
    isSuccess.value = true;
  } catch (err) {
    rawError.value = err.rawMessage || err.message;
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-card-header" style="display: flex; gap: 8px;">
        <button type="button" class="theme-toggle-btn" @click="toggleTheme" :title="isDark ? t('theme.light') : t('theme.dark')">
          <Sun v-if="isDark" :size="21" />
          <Moon v-else :size="21" />
        </button>
        <LanguageSwitch />
      </div>
      <div class="login-brand">
        <div class="login-brand-text">
          <h1 class="login-title">{{ t('auth.forgotPasswordTitle') }}</h1>
          <p class="login-subtitle">{{ t('auth.forgotPasswordSubtitle') }}</p>
        </div>
      </div>

      <p v-if="isSuccess" class="login-hint" role="status">{{ t('auth.forgotPasswordSuccess') }}</p>
      <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>

      <form v-if="!isSuccess" class="login-form" @submit.prevent="submit">
        <label class="login-field">
          <span class="login-label">{{ t('auth.email') }}</span>
          <span class="input-wrapper">
            <input
              v-model.trim="email"
              class="login-input"
              autocomplete="email"
              required
              type="email"
            />
          </span>
        </label>

        <button class="login-btn" :disabled="loading" type="submit">
          {{ loading ? t('common.submitting') : t('auth.sendResetEmail') }}
        </button>
      </form>
      <div style="text-align: center; margin-top: 16px;">
        <router-link to="/login" style="color: var(--cool); text-decoration: none; font-size: 0.9rem;">{{ t('auth.backToLogin') }}</router-link>
      </div>
    </div>
  </div>
</template>
