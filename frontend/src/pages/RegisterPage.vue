<script setup>
import { computed, onMounted, reactive, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import api from '../api.js';
import store from '../store.js';
import { useCursor } from '../composables/useCursor.js';
import { useI18n } from '../i18n.js';
import LanguageSwitch from '../components/ui/LanguageSwitch.vue';

const route = useRoute();
const router = useRouter();
const { t } = useI18n();
const loading = ref(false);
const validating = ref(false);
const error = ref('');
const invite = ref(null);

const form = reactive({
  username: '',
  displayName: '',
  password: '',
  confirmPassword: ''
});

const token = computed(() => String(route.params.token || '').trim());

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
    await api.registerWithInvite(token.value, form);
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
    <LanguageSwitch class="login-language-switch" />
    <div class="login-card">
      <div class="login-brand">
        <img class="login-logo" src="/logo.svg" alt="" width="46" height="46" />
        <div class="login-brand-text">
          <h1 class="login-title">{{ store.site.siteName }}</h1>
          <p class="login-subtitle">{{ t('auth.welcomeBack') }}</p>
        </div>
      </div>

      <p v-if="validating" class="login-info" role="status">{{ t('auth.validatingInvite') }}</p>
      <p v-else-if="invite?.note" class="login-info">{{ t('auth.invitationNote', { note: invite.note }) }}</p>
      <p v-if="error" class="login-error" role="alert">{{ error }}</p>

      <form v-if="invite && !error" class="login-form" @submit.prevent="submit">
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
    </div>
  </div>
</template>
