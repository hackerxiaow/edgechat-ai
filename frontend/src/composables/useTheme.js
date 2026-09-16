import { ref } from 'vue';

const THEME_KEY = 'edgechat.theme';

// 模块级单例：所有调用方共享同一份状态，任一处切换后图标与页面同时更新。
const isDark = ref(false);
let initialized = false;

function applyTheme(dark) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.setAttribute('data-theme', dark ? 'dark' : 'light');
  root.classList.toggle('dark', dark);
  if (document.body) document.body.classList.toggle('dark', dark);
}

function readStoredTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === 'dark') return true;
    if (saved === 'light') return false;
  } catch {
    // localStorage 不可用时退回系统偏好。
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function useTheme() {
  if (!initialized) {
    initialized = true;
    isDark.value = readStoredTheme();
    applyTheme(isDark.value);
  }

  function setDark(dark) {
    isDark.value = dark;
    try {
      localStorage.setItem(THEME_KEY, dark ? 'dark' : 'light');
    } catch {
      // 忽略隐私模式下的写入失败，仅影响下次启动的偏好记忆。
    }
    applyTheme(dark);
  }

  function toggleTheme() {
    setDark(!isDark.value);
  }

  return { isDark, setDark, toggleTheme };
}
