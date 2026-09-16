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
  username: '',
  password: ''
});
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
    const submitted = new FormData(event.currentTarget);
    const { serverOrigin, credentials } = readLoginSubmission(submitted);
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
        <button type="button" class="login-language-switch" @click="toggleTheme" :title="isDark ? t('theme.light') : t('theme.dark')">
          <Moon v-if="isDark" :size="21" />
          <Sun v-else :size="21" />
        </button>
        <LanguageSwitch class="login-language-switch" />
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
        <label v-if="isCapacitorAndroid" class="login-field">
          <span class="login-label">{{ t('auth.serverOrigin') }}</span>
          <span class="input-wrapper">
            <span ref="serverCursor" class="custom-cursor"></span>
            <input
              ref="serverInput"
              v-model.trim="form.serverOrigin"
              class="login-input"
              autocomplete="url"
              inputmode="url"
              name="serverOrigin"
              required
              type="url"
            />
          </span>
        </label>

        <label class="login-field">
          <span class="login-label">{{ t('auth.account') }}</span>
          <span class="input-wrapper">
            <span ref="usernameCursor" class="custom-cursor"></span>
            <input
              ref="usernameInput"
              v-model.trim="form.username"
              class="login-input"
              autocomplete="username"
              name="username"
              required
              type="text"
            />
          </span>
        </label>

        <label class="login-field">
          <span class="login-label">{{ t('auth.password') }}</span>
          <span class="input-wrapper">
            <span ref="passwordCursor" class="custom-cursor"></span>
            <input
              ref="passwordInput"
              v-model="form.password"
              class="login-input"
              autocomplete="current-password"
              name="password"
              required
              type="password"
            />
          </span>
        </label>

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
