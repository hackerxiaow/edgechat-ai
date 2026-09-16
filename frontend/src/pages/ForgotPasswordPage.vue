<script setup>
import { ref } from 'vue';
import { useRouter } from 'vue-router';
import { forgotPassword } from '../api.js';
import { useTheme } from '../composables/useTheme.js';
import LanguageSwitch from '../components/ui/LanguageSwitch.vue';
import { Sun, Moon } from '@lucide/vue';
import { useI18n } from '../i18n.js';

const router = useRouter();
const { t } = useI18n();
const { isDark, toggleTheme } = useTheme();

const email = ref('');
const loading = ref(false);
const error = ref('');
const success = ref('');

async function submit() {
  if (!email.value) return;
  loading.value = true;
  error.value = '';
  success.value = '';
  try {
    await forgotPassword(email.value);
    success.value = '如果该邮箱已注册，包含重置链接的邮件将在几分钟内送达。';
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
          <h1 class="login-title">找回密码</h1>
          <p class="login-subtitle">请输入您的注册邮箱</p>
        </div>
      </div>

      <p v-if="success" class="login-hint" role="status">{{ success }}</p>
      <p v-if="error" class="login-error" role="alert">{{ error }}</p>

      <form v-if="!success" class="login-form" @submit.prevent="submit">
        <label class="login-field">
          <span class="login-label">邮箱</span>
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
          {{ loading ? '提交中...' : '发送重置邮件' }}
        </button>
      </form>
      <div style="text-align: center; margin-top: 16px;">
        <router-link to="/login" style="color: var(--cool); text-decoration: none; font-size: 0.9rem;">返回登录</router-link>
      </div>
    </div>
  </div>
</template>
