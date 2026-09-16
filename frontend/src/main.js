import { useTheme } from './composables/useTheme.js';
import { createApp } from 'vue';
import App from './App.vue';
import router from './router.js';
import store from './store.js';
import { registerEdgeChatWebMcp } from './webmcp.ts';
import {
  installCapacitorIntegration,
  queueNativeRoomTarget
} from './capacitor-platform.ts';
import './styles/base.css';
import './styles.css';
import './styles-liquid.css';
import './styles/tokens.css';
import './styles/layout.css';
import './styles/ui.css';
import './styles/admin.css';
import './styles/chat.css';
import './styles/chat-messages.css';
import './styles/chat-attachments.css';
import './styles/chat-theme.css';
// 认证页（登录/注册）共用视觉，放在最后以确保覆盖 tokens.css 里遗留的同名选择器。
import './styles/auth.css';
import { initLiquidGlass } from './liquid-glass.js';
import { initializeI18n } from './i18n.js';

// 应用自定义背景（写到 html，见 base.css 中底图承载位置的说明）
const customBg = localStorage.getItem('customBackground');
if (customBg) {
  document.documentElement.style.background = customBg;
}

initializeI18n().then(() => store.initialize()).finally(() => {
  useTheme();
  const app = createApp(App);
  app.use(router);
  app.mount('#app');
  void registerEdgeChatWebMcp();
  void installCapacitorIntegration({
    async onOpenRoom(target) {
      await router.push('/');
      queueNativeRoomTarget(target);
    }
  });

  // 初始化 Liquid Glass 效果
  setTimeout(initLiquidGlass, 100);
});
