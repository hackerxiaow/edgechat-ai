const fs = require('fs');

let css = `/* Hallmark · macrostructure: Workbench · tone: calm utility
 * 聊天工作区现在已与前台登录页完全打通玻璃拟态设计语言
 */
:root {
  --chat-paper: var(--surface-2);
  --chat-canvas: transparent;
  --chat-rail: var(--surface-1);
  --chat-hover: var(--surface-0);
  --chat-selected: rgba(90, 143, 203, 0.15);
  --chat-pressed: rgba(90, 143, 203, 0.25);
  --chat-outgoing: var(--surface-0);
  --chat-ink: var(--text);
  --chat-muted: var(--text-soft);
  --chat-subtle: var(--text-faint);
  --chat-line: var(--line-soft);
  --chat-accent: var(--cool);
  --chat-accent-hover: #2b65a0;
  --chat-accent-pressed: #1e4b7a;
  --chat-danger: var(--danger);
  --chat-danger-soft: var(--danger-soft);
  --chat-disabled: var(--surface-0);
  --chat-online: #34d399;
  --chat-scrollbar: rgba(136, 146, 160, 0.35);
  --chat-scrim: rgba(0, 0, 0, 0.4);
  --chat-shadow: var(--shadow-sm);
  --chat-shadow-panel: var(--shadow-lg);
  
  --chat-font: var(--font-sans, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif);
  --chat-font-heading: system-ui, "PingFang SC", "Microsoft YaHei", sans-serif;
  --chat-control: 44px;
  --chat-radius: 12px;
  --chat-space-xs: 4px;
  --chat-space-sm: 8px;
  --chat-space-md: 12px;
  --chat-space-lg: 16px;
  --chat-space-xl: 24px;
}

/* 暗黑模式主题覆盖 */
html[data-theme="dark"],
html.dark,
[data-theme="dark"] {
  --chat-paper: var(--surface-2) !important;
  --chat-canvas: transparent !important;
  --chat-rail: var(--surface-1) !important;
  --chat-hover: var(--surface-0) !important;
  --chat-selected: rgba(74, 142, 208, 0.2) !important;
  --chat-pressed: rgba(74, 142, 208, 0.3) !important;
  --chat-outgoing: var(--surface-0) !important;
  --chat-ink: var(--text) !important;
  --chat-muted: var(--text-soft) !important;
  --chat-subtle: var(--text-faint) !important;
  --chat-line: var(--line-soft) !important;
  --chat-accent: var(--cool) !important;
  --chat-accent-hover: #5b9ce2 !important;
  --chat-accent-pressed: #7cb6ec !important;
  --chat-danger: var(--danger) !important;
  --chat-danger-soft: var(--danger-soft) !important;
  --chat-disabled: var(--surface-0) !important;
  --chat-online: #34d399 !important;
  --chat-scrollbar: rgba(255, 255, 255, 0.16) !important;
  --chat-scrim: rgba(0, 0, 0, 0.7) !important;
  --chat-shadow: var(--shadow-sm) !important;
  --chat-shadow-panel: var(--shadow-lg) !important;
  
  --surface-primary: var(--surface-2) !important;
  --surface-secondary: var(--surface-1) !important;
  --surface-hover: var(--surface-0) !important;
  --surface-active: var(--surface-0) !important;
  --surface-search: var(--surface-0) !important;
  --text-primary: var(--text) !important;
  --text-secondary: var(--text-soft) !important;
  --text-muted: var(--text-faint) !important;
  --border-light: var(--line-soft) !important;
  --border-medium: var(--line-soft) !important;
  color-scheme: dark !important;
}

html[data-theme="dark"] body,
html.dark body {
  background-color: transparent !important;
  color: var(--text) !important;
}

/* 对话框与面板透明毛玻璃化 */
.room-dialog,
.add-conversation-dialog {
  background: var(--surface-2) !important;
  backdrop-filter: var(--blur-lg) !important;
  -webkit-backdrop-filter: var(--blur-lg) !important;
  border: 1px solid var(--line-soft) !important;
  color: var(--text) !important;
}

.room-dialog h2,
.add-conversation-title {
  color: var(--text) !important;
}

.room-dialog__input,
.add-conversation-search {
  background: var(--surface-0) !important;
  border-color: var(--line-soft) !important;
  color: var(--text) !important;
}

.room-dialog__secondary,
.add-conversation-choice {
  background: var(--surface-1) !important;
  border-color: var(--line-soft) !important;
  color: var(--text) !important;
}

.room-dialog__secondary:hover,
.add-conversation-choice:hover {
  background: var(--surface-0) !important;
}

/* Chat Layout 全局透明，让 base.css 的 Telegram 暗纹透出来 */
.chat-layout {
  background-color: transparent !important;
}

html[data-theme="dark"] .chat-layout,
html.dark .chat-layout {
  background-color: transparent !important;
}

/* 侧边栏和头部毛玻璃化 */
.left-sidebar,
.right-sidebar,
.sidebar-header,
.chat-header,
.composer-form {
  background-color: var(--surface-2) !important;
  backdrop-filter: var(--blur-md) !important;
  -webkit-backdrop-filter: var(--blur-md) !important;
  border-color: var(--line-soft) !important;
  color: var(--text) !important;
}

html[data-theme="dark"] .left-sidebar,
html.dark .left-sidebar,
html[data-theme="dark"] .right-sidebar,
html.dark .right-sidebar,
html[data-theme="dark"] .sidebar-header,
html.dark .sidebar-header,
html[data-theme="dark"] .chat-header,
html.dark .chat-header,
html[data-theme="dark"] .composer-form,
html.dark .composer-form {
  background-color: var(--surface-2) !important;
  backdrop-filter: var(--blur-md) !important;
  -webkit-backdrop-filter: var(--blur-md) !important;
  border-color: var(--line-soft) !important;
  color: var(--text) !important;
}

/* 聊天气泡 */
.chat-bubble {
  background-color: var(--surface-2) !important;
  color: var(--text) !important;
  backdrop-filter: var(--blur-md) !important;
  -webkit-backdrop-filter: var(--blur-md) !important;
  border: 1px solid var(--line-soft) !important;
  box-shadow: var(--shadow-sm) !important;
}

.chat-bubble--own {
  background-color: var(--cool) !important;
  color: #ffffff !important;
  border: none !important;
}

html[data-theme="dark"] .chat-bubble,
html.dark .chat-bubble {
  background-color: var(--surface-1) !important;
  color: var(--text) !important;
  border-color: var(--line-soft) !important;
}

html[data-theme="dark"] .chat-bubble--own,
html.dark .chat-bubble--own {
  background-color: var(--cool) !important;
  color: #ffffff !important;
  border: none !important;
}

/* 输入框区域 */
.composer-textarea {
  background-color: var(--surface-0) !important;
  color: var(--text) !important;
  border-color: var(--line-soft) !important;
}

html[data-theme="dark"] .composer-textarea,
html.dark .composer-textarea {
  background-color: var(--surface-0) !important;
  color: var(--text) !important;
  border-color: var(--line-soft) !important;
}
`;

fs.writeFileSync('frontend/src/styles/chat-theme.css', css, 'utf8');
console.log('chat-theme.css rewritten');
