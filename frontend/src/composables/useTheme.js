import { ref } from 'vue';

const THEME_KEY = 'edgechat.theme';

export function useTheme() {
  const isDark = ref(false);

  function applyTheme(dark) {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    if (dark) {
      root.setAttribute('data-theme', 'dark');
      root.classList.add('dark');
      document.body?.classList.add('dark');
    } else {
      root.removeAttribute('data-theme');
      root.classList.remove('dark');
      document.body?.classList.remove('dark');
    }
  }

  function toggleTheme() {
    isDark.value = !isDark.value;
    try {
      localStorage.setItem(THEME_KEY, isDark.value ? 'dark' : 'light');
    } catch (e) {}
    applyTheme(isDark.value);
  }

  // 初始化
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark') {
      isDark.value = true;
    } else if (saved === 'light') {
      isDark.value = false;
    } else if (typeof window !== 'undefined' && window.matchMedia) {
      isDark.value = window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
  } catch (e) {}
  
  applyTheme(isDark.value);

  return {
    isDark,
    toggleTheme
  };
}
