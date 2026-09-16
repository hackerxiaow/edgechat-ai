<script setup>
import { computed, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import store from '../store.js';
import { useCursor } from '../composables/useCursor.js';
import { useI18n } from '../i18n.js';
import LanguageSwitch from '../components/ui/LanguageSwitch.vue';
import { Sun, Moon } from '@lucide/vue';
import { useTheme } from '../composables/useTheme.js';
import { getStoredNativeServerOrigin, isCapacitorAndroid } from '../capacitor-platform.ts';
import { readLoginSubmission } from '../login-submission.ts';

const route = useRoute();
const { isDark, toggleTheme } = useTheme();
const router = useRouter();
const { t } = useI18n();
const loading = ref(false);
const error = ref('');
const form = reactive({
  serverOrigin: getStoredNativeServerOrigin(),
  account: '',
  password: '',
  email: '',
  code: ''
});
const loginMethod = ref('password');
const sendingCode = ref(false);
const countdown = ref(0);

async function sendCode() {
  if (!form.email || sendingCode.value || countdown.value > 0) return;
  sendingCode.value = true;
  error.value = '';
  try {
    const res = await fetch('/api/auth/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email, purpose: 'login' })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error);
    countdown.value = 60;
    const timer = setInterval(() => {
      countdown.value--;
      if (countdown.value <= 0) clearInterval(timer);
    }, 1000);
  } catch (err) {
    error.value = err.message;
  } finally {
    sendingCode.value = false;
  }
}
const registered = computed(() => route.query.registered === '1');

const usernameInput = ref(null);
const passwordInput = ref(null);
const serverInput = ref(null);
const usernameCursor = ref(null);
const passwordCursor = ref(null);
const serverCursor = ref(null);

useCursor([
  [serverInput, serverCursor],
  [usernameInput, usernameCursor],
  [passwordInput, passwordCursor]
]);

async function submit(event) {
  loading.value = true;
  error.value = '';
  try {
    // Android WebView 的自动填充不一定触发 input 事件，提交时以输入框当前值为准。
    const serverOrigin = form.serverOrigin;
    const credentials = loginMethod.value === 'code' 
      ? { method: 'code', email: form.email, code: form.code }
      : { method: 'password', account: form.account, password: form.password };
    if (isCapacitorAndroid) {
      await store.configureNativeServer(serverOrigin);
    }
    await store.login(credentials);
    router.push('/');
  } catch (currentError) {
    error.value = currentError.message === 'native_server_https_required'
      ? t('auth.serverHttpsRequired')
      : currentError.message === 'native_server_unavailable'
        ? t('auth.serverUnavailable')
        : currentError.message;
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
        <img class="login-logo" src="/logo.svg" alt="" width="64" height="64" />
        <div class="login-brand-text">
          <h1 class="login-title">{{ store.site.siteName }}</h1>
          <p class="login-subtitle">{{ t('auth.welcomeBack') }}</p>
        </div>
      </div>

      <p v-if="registered" class="login-hint" role="status">{{ t('auth.registerSuccess') }}</p>

      
      <form class="login-form" @submit.prevent="submit">
        
        <div class="auth-tabs" style="display: flex; gap: 16px; margin-bottom: 8px; justify-content: center;">
          <button type="button" :class="['auth-tab', { active: loginMethod === 'password' }]" @click="loginMethod = 'password'">密码登录</button>
          <button type="button" :class="['auth-tab', { active: loginMethod === 'code' }]" @click="loginMethod = 'code'">验证码登录</button>
        </div>

        <template v-if="loginMethod === 'password'">
          <label class="login-field">
            <span class="login-label">用户名 / 邮箱</span>
            <span class="input-wrapper">
              <input v-model.trim="form.account" class="login-input" autocomplete="username" required type="text" />
            </span>
          </label>

          <label class="login-field">
            <span class="login-label">{{ t('auth.password') }}</span>
            <span class="input-wrapper">
              <input v-model="form.password" class="login-input" autocomplete="current-password" required type="password" />
            </span>
          </label>
        </template>

        <template v-else>
          <label class="login-field">
            <span class="login-label">邮箱</span>
            <div style="display: flex; gap: 8px;">
              <input v-model.trim="form.email" class="login-input" style="flex: 1;" autocomplete="email" required type="email" />
              <button type="button" class="login-btn" style="width: auto; margin-top: 0; padding: 0 16px;" :disabled="!form.email || sendingCode || countdown > 0" @click="sendCode">
                {{ countdown > 0 ? countdown + 's' : '获取验证码' }}
              </button>
            </div>
          </label>

          <label class="login-field">
            <span class="login-label">验证码</span>
            <span class="input-wrapper">
              <input v-model.trim="form.code" class="login-input" required type="text" placeholder="6位数字" />
            </span>
          </label>
        </template>

        <button class="login-btn" :disabled="loading" type="submit">
          {{ loading ? t('auth.signingIn') : t('auth.signIn') }}
        </button>

        <div style="display: flex; justify-content: space-between; margin-top: 16px; font-size: 0.9rem;">
          <router-link to="/forgot-password" style="color: var(--cool); text-decoration: none;">忘记密码？</router-link>
          <router-link to="/register" style="color: var(--cool); text-decoration: none;">注册账号</router-link>
        </div>

        <p v-if="error" class="login-error" role="alert">{{ error }}</p>
      </form>

    </div>
  </div>
</template>
