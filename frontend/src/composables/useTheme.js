import { ref, watchEffect } from 'vue';

const THEME_KEY = 'edgechat.theme';

export function useTheme() {
  const storedTheme = typeof localStorage !== 'undefined' ? localStorage.getItem(THEME_KEY) : null;
  const isDark = ref(storedTheme === 'dark');

  function applyTheme(dark) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (dark) {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
    } else {
      root.removeAttribute('data-theme');
      root.classList.remove('dark');
    }
  }

  function toggleTheme() {
    isDark.value = !isDark.value;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light');
    }
    applyTheme(isDark.value);
  }

  // 初始应用
  if (storedTheme === null && typeof window !== 'undefined' && window.matchMedia) {
    isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  applyTheme(isDark.value);

  return {
    isDark,
    toggleTheme
  };
}
