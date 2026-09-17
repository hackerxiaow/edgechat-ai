<script setup>
import { computed, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { resetPassword } from '../api.js';
import { useTheme } from '../composables/useTheme.js';
import LanguageSwitch from '../components/ui/LanguageSwitch.vue';
import { Sun, Moon } from '@lucide/vue';
import { useI18n, localizeServerError } from '../i18n.js';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { isDark, toggleTheme } = useTheme();

const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const rawError = ref('');
const passwordMismatch = ref(false);
const isSuccess = ref(false);

const errorMessage = computed(() => {
  if (passwordMismatch.value) {
    return t('auth.passwordMismatch');
  }
  return rawError.value ? localizeServerError(rawError.value) : '';
});

const token = route.params.token;

async function submit() {
  passwordMismatch.value = false;
  rawError.value = '';
  if (password.value !== confirmPassword.value) {
    passwordMismatch.value = true;
    return;
  }
  loading.value = true;
  try {
    await resetPassword(token, password.value);
    isSuccess.value = true;
    setTimeout(() => {
      router.push('/login');
    }, 2000);
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
          <h1 class="login-title">{{ t('auth.resetPasswordTitle') }}</h1>
          <p class="login-subtitle">{{ t('auth.resetPasswordSubtitle') }}</p>
        </div>
      </div>

      <p v-if="isSuccess" class="login-hint" role="status">{{ t('auth.resetPasswordSuccess') }}</p>
      <p v-if="errorMessage" class="login-error" role="alert">{{ errorMessage }}</p>

      <form v-if="!isSuccess" class="login-form" @submit.prevent="submit">
        <label class="login-field">
          <span class="login-label">{{ t('auth.newPassword') }}</span>
          <span class="input-wrapper">
            <input
              v-model="password"
              class="login-input"
              autocomplete="new-password"
              required
              type="password"
            />
          </span>
        </label>
        <label class="login-field">
          <span class="login-label">{{ t('auth.confirmNewPassword') }}</span>
          <span class="input-wrapper">
            <input
              v-model="confirmPassword"
              class="login-input"
              autocomplete="new-password"
              required
              type="password"
            />
          </span>
        </label>

        <button class="login-btn" :disabled="loading" type="submit">
          {{ loading ? t('common.submitting') : t('auth.confirmReset') }}
        </button>
      </form>
      <div style="text-align: center; margin-top: 16px;">
        <router-link to="/login" style="color: var(--cool); text-decoration: none; font-size: 0.9rem;">{{ t('auth.backToLogin') }}</router-link>
      </div>
    </div>
  </div>
</template>
