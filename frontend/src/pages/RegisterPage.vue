<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api, { registerOpen } from '../api.js';
import store from '../store.js';
import { useCursor } from '../composables/useCursor.js';
import { useI18n } from '../i18n.js';
import LanguageSwitch from '../components/ui/LanguageSwitch.vue';
import { Sun, Moon } from '@lucide/vue';
import { useTheme } from '../composables/useTheme.js';

const route = useRoute();
const { isDark, toggleTheme } = useTheme();
const router = useRouter();
const { t } = useI18n();
const loading = ref(false);
const validating = ref(false);
const error = ref('');
const invite = ref(null);

const form = reactive({
  email: '',
  code: '',
  username: '',
  displayName: '',
  password: '',
  confirmPassword: ''
});

const token = computed(() => String(route.params.token || '').trim());
const isOpenRegistration = computed(() => !token.value);
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
      body: JSON.stringify({ email: form.email, purpose: 'register' })
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
// 后台「运行配置」里的开放注册开关；关闭时无 token 访问只能看到提示。
const openRegistrationEnabled = computed(() => Boolean(store.site.allowOpenRegistration));
const showForm = computed(() => Boolean(invite.value) || (isOpenRegistration.value && openRegistrationEnabled.value));
const openRegistrationClosed = computed(() => isOpenRegistration.value && !openRegistrationEnabled.value);

const usernameInput = ref(null);
const displayNameInput = ref(null);
const passwordInput = ref(null);
const confirmPasswordInput = ref(null);
const usernameCursor = ref(null);
const displayNameCursor = ref(null);
const passwordCursor = ref(null);
const confirmPasswordCursor = ref(null);

useCursor([
  [usernameInput, usernameCursor],
  [displayNameInput, displayNameCursor],
  [passwordInput, passwordCursor],
  [confirmPasswordInput, confirmPasswordCursor]
], invite);

async function loadInvite() {
  if (isOpenRegistration.value) return;

  validating.value = true;
  error.value = '';
  try {
    const payload = await api.getRegisterInvite(token.value);
    invite.value = payload.invite;
    if (payload.site) {
      store.setSite(payload.site);
    }
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    validating.value = false;
  }
}

async function submit() {
  if (form.password !== form.confirmPassword) {
    error.value = t('auth.passwordMismatch');
    return;
  }

  loading.value = true;
  error.value = '';
  try {
    if (isOpenRegistration.value) {
      await registerOpen(form);
    } else {
      await api.registerWithInvite(token.value, form);
    }
    router.push({ name: 'login', query: { registered: '1' } });
  } catch (currentError) {
    error.value = currentError.message;
  } finally {
    loading.value = false;
  }
}

onMounted(() => {
  loadInvite();
});
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

      <p v-if="validating" class="login-info" role="status">{{ t('auth.validatingInvite') }}</p>
      <p v-else-if="invite?.note" class="login-info">{{ t('auth.invitationNote', { note: invite.note }) }}</p>
      <p v-if="openRegistrationClosed" class="login-info" role="status">
        本站未开放自由注册，请向管理员索取邀请链接。
      </p>
      <p v-if="error" class="login-error" role="alert">{{ error }}</p>

      <form v-if="showForm && !error" class="login-form" @submit.prevent="submit">
        <label v-if="isOpenRegistration" class="login-field">
          <span class="login-label">{{ t('auth.email') }}</span>
          <div style="display: flex; gap: 8px;">
            <input v-model.trim="form.email" class="login-input" style="flex: 1;" autocomplete="email" type="email" required />
            <button type="button" class="login-btn" style="width: auto; margin-top: 0; padding: 0 16px;" :disabled="!form.email || sendingCode || countdown > 0" @click="sendCode">
              {{ countdown > 0 ? countdown + 's' : t('auth.getVerificationCode') }}
            </button>
          </div>
        </label>
        
        <label v-if="isOpenRegistration" class="login-field">
          <span class="login-label">{{ t('auth.verificationCode') }}</span>
          <span class="input-wrapper">
            <input v-model.trim="form.code" class="login-input" required type="text" :placeholder="t('auth.codePlaceholder')" />
          </span>
        </label>
        <label class="login-field">
          <span class="login-label">{{ t('auth.username') }}</span>
          <span class="input-wrapper">
            <span ref="usernameCursor" class="custom-cursor"></span>
            <input
              ref="usernameInput"
              v-model.trim="form.username"
              class="login-input"
              autocomplete="username"
              type="text"
            />
          </span>
        </label>

        <label class="login-field">
          <span class="login-label">{{ t('auth.displayName') }}</span>
          <span class="input-wrapper">
            <span ref="displayNameCursor" class="custom-cursor"></span>
            <input
              ref="displayNameInput"
              v-model.trim="form.displayName"
              class="login-input"
              autocomplete="nickname"
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
              autocomplete="new-password"
              type="password"
            />
          </span>
        </label>

        <label class="login-field">
          <span class="login-label">{{ t('auth.confirmPassword') }}</span>
          <span class="input-wrapper">
            <span ref="confirmPasswordCursor" class="custom-cursor"></span>
            <input
              ref="confirmPasswordInput"
              v-model="form.confirmPassword"
              class="login-input"
              autocomplete="new-password"
              type="password"
            />
          </span>
        </label>

        <button class="login-btn" :disabled="loading" type="submit">
          {{ loading ? t('auth.registering') : t('auth.completeRegistration') }}
        </button>
      </form>
      
      <div style="text-align: center; margin-top: 24px;">
        <router-link to="/login" style="color: var(--cool); text-decoration: none; font-size: 0.95rem; font-weight: 500;">{{ t('auth.backToLogin') }}</router-link>
      </div>
    </div>
  </div>
</template>
