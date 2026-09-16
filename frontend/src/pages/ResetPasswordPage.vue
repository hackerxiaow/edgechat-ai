<script setup>
import { ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { resetPassword } from '../api.js';
import { useTheme } from '../composables/useTheme.js';
import LanguageSwitch from '../components/ui/LanguageSwitch.vue';
import { Sun, Moon } from '@lucide/vue';
import { useI18n } from '../i18n.js';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const { isDark, toggleTheme } = useTheme();

const password = ref('');
const confirmPassword = ref('');
const loading = ref(false);
const error = ref('');
const success = ref('');

const token = route.params.token;

async function submit() {
  if (password.value !== confirmPassword.value) {
    error.value = '两次输入的密码不一致';
    return;
  }
  loading.value = true;
  error.value = '';
  try {
    await resetPassword(token, password.value);
    success.value = '密码重置成功，请使用新密码登录。';
    setTimeout(() => {
      router.push('/login');
    }, 2000);
  } catch (err) {
    error.value = err.message;
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
          <Moon v-if="isDark" :size="21" />
          <Sun v-else :size="21" />
        </button>
        <LanguageSwitch />
      </div>
      <div class="login-brand">
        <div class="login-brand-text">
          <h1 class="login-title">重置密码</h1>
          <p class="login-subtitle">请设置您的新密码</p>
        </div>
      </div>

      <p v-if="success" class="login-hint" role="status">{{ success }}</p>
      <p v-if="error" class="login-error" role="alert">{{ error }}</p>

      <form v-if="!success" class="login-form" @submit.prevent="submit">
        <label class="login-field">
          <span class="login-label">新密码</span>
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
          <span class="login-label">确认新密码</span>
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
          {{ loading ? '提交中...' : '确认重置' }}
        </button>
      </form>
    </div>
  </div>
</template>
