import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import test from 'node:test';
import enUS from '../frontend/src/locales/en-US.js';
import zhCN from '../frontend/src/locales/zh-CN.js';
import zhTW from '../frontend/src/locales/zh-TW.js';
import {
  CHINESE_LOCALE,
  detectBrowserLocale,
  ENGLISH_LOCALE,
  formatDate,
  getLocale,
  setLocale,
  t,
  TRADITIONAL_CHINESE_LOCALE
} from '../frontend/src/i18n.js';
import { localizeErrorMessage } from '../frontend/src/localized-error.js';

test('语言运行时仅按需导入当前语言包', async () => {
  const source = await readFile(new URL('../frontend/src/i18n.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /^import .+ from ['"].*locales/m);
  assert.match(source, /\(\) => import\('\.\/locales\/zh-CN\.js'\)/);
  assert.match(source, /\(\) => import\('\.\/locales\/zh-TW\.js'\)/);
  assert.match(source, /\(\) => import\('\.\/locales\/en-US\.js'\)/);
});

test('三种语言包保持相同键集合', () => {
  assert.deepEqual(Object.keys(enUS).sort(), Object.keys(zhCN).sort());
  assert.deepEqual(Object.keys(zhTW).sort(), Object.keys(zhCN).sort());
});

test('简繁中文界面支持插值与未知键回退', async () => {
  await setLocale(CHINESE_LOCALE);
  assert.equal(getLocale(), CHINESE_LOCALE);
  assert.equal(t('chat.memberCount', { count: 3 }), '3 位成员');
  await setLocale(TRADITIONAL_CHINESE_LOCALE);
  assert.equal(t('chat.memberCount', { count: 3 }), '3 位成員');
  assert.equal(t('missing.translation.key'), 'missing.translation.key');
});

test('浏览器语言会区分简繁中文，其余语言默认英文', () => {
  for (const language of ['zh', 'zh-CN', 'zh-Hans-SG', 'zh-MY']) {
    assert.equal(detectBrowserLocale(language), CHINESE_LOCALE);
  }
  for (const language of ['zh-TW', 'zh-Hant-HK', 'zh-MO', 'ZH_hant_tw']) {
    assert.equal(detectBrowserLocale(language), TRADITIONAL_CHINESE_LOCALE);
  }

  for (const language of ['en-US', 'en-HK', 'ms-MY', 'ja-JP', '']) {
    assert.equal(detectBrowserLocale(language), ENGLISH_LOCALE);
  }
});

test('语言切换会持久化选择', async () => {
  const stored = new Map();
  const originalLocalStorage = globalThis.localStorage;
  globalThis.localStorage = {
    getItem: (key) => stored.get(key) ?? null,
    setItem: (key, value) => stored.set(key, value)
  };

  try {
    await setLocale(TRADITIONAL_CHINESE_LOCALE);
    assert.equal(getLocale(), TRADITIONAL_CHINESE_LOCALE);
    assert.equal(stored.get('edgechat.locale'), TRADITIONAL_CHINESE_LOCALE);
    assert.equal(t('auth.signIn'), '登錄');
  } finally {
    await setLocale(CHINESE_LOCALE);
    if (originalLocalStorage === undefined) delete globalThis.localStorage;
    else globalThis.localStorage = originalLocalStorage;
  }
});

test('日期格式跟随当前语言', async () => {
  const value = new Date('2026-08-18T12:00:00.000Z');
  const options = { dateStyle: 'long', timeZone: 'UTC' };

  await setLocale(CHINESE_LOCALE);
  const chinese = formatDate(value, options);
  await setLocale(ENGLISH_LOCALE);
  const english = formatDate(value, options);

  assert.equal(chinese, new Intl.DateTimeFormat(CHINESE_LOCALE, options).format(value));
  assert.equal(english, new Intl.DateTimeFormat(ENGLISH_LOCALE, options).format(value));
  assert.notEqual(chinese, english);
  await setLocale(CHINESE_LOCALE);
});

test('服务端固定与动态错误会按当前语言本地化', async () => {
  await setLocale(ENGLISH_LOCALE);
  assert.equal(localizeErrorMessage('账号或密码错误'), 'Incorrect username or password');
  assert.equal(
    localizeErrorMessage('封禁时长必须是正整数分钟'),
    'Ban duration must be a positive integer number of minutes'
  );
  assert.equal(localizeErrorMessage('文件大小不能超过 16MB'), 'File size cannot exceed 16 MB');

  await setLocale(TRADITIONAL_CHINESE_LOCALE);
  assert.equal(localizeErrorMessage('账号或密码错误'), '賬號或密碼錯誤');
  assert.equal(localizeErrorMessage('文件大小不能超过 16MB'), '文件大小不能超過 16MB');

  await setLocale(CHINESE_LOCALE);
  assert.equal(localizeErrorMessage('账号或密码错误'), '账号或密码错误');
});

test('重置密码与找回密码相关文案与错误在各语言下完整翻译', async () => {
  // 繁体中文
  await setLocale(TRADITIONAL_CHINESE_LOCALE);
  assert.equal(t('auth.forgotPasswordTitle'), '找回密碼');
  assert.equal(t('auth.forgotPasswordSubtitle'), '請輸入您的註冊信箱');
  assert.equal(t('auth.sendResetEmail'), '發送重置郵件');
  assert.equal(t('auth.forgotPasswordSuccess'), '若該信箱已註冊，包含重置連結的郵件將在數分鐘內送達。');
  assert.equal(t('auth.resetPasswordTitle'), '重設密碼');
  assert.equal(t('auth.resetPasswordSubtitle'), '請設定您的新密碼');
  assert.equal(t('auth.newPassword'), '新密碼');
  assert.equal(t('auth.confirmNewPassword'), '確認新密碼');
  assert.equal(t('auth.confirmReset'), '確認重設');
  assert.equal(t('auth.resetPasswordSuccess'), '密碼重設成功，請使用新密碼登入。');
  assert.equal(t('auth.passwordMismatch'), '兩次輸入的密碼不一致');
  assert.equal(t('common.submitting'), '提交中...');
  assert.equal(localizeErrorMessage('邮箱不能为空'), '信箱不能為空');
  assert.equal(localizeErrorMessage('系统未配置发件服务'), '系統未配置發件服務');
  assert.equal(localizeErrorMessage('重置链接无效或已过期'), '重設連結無效或已過期');

  // 英文
  await setLocale(ENGLISH_LOCALE);
  assert.equal(t('auth.forgotPasswordTitle'), 'Forgot Password');
  assert.equal(t('auth.forgotPasswordSubtitle'), 'Please enter your registered email');
  assert.equal(t('auth.sendResetEmail'), 'Send Reset Email');
  assert.equal(t('auth.forgotPasswordSuccess'), 'If the email is registered, an email with a reset link will arrive in a few minutes.');
  assert.equal(t('auth.resetPasswordTitle'), 'Reset Password');
  assert.equal(t('auth.resetPasswordSubtitle'), 'Please set your new password');
  assert.equal(t('auth.newPassword'), 'New Password');
  assert.equal(t('auth.confirmNewPassword'), 'Confirm New Password');
  assert.equal(t('auth.confirmReset'), 'Confirm Reset');
  assert.equal(t('auth.resetPasswordSuccess'), 'Password reset successfully. Please sign in with your new password.');
  assert.equal(t('auth.passwordMismatch'), 'The passwords do not match.');
  assert.equal(t('common.submitting'), 'Submitting...');
  assert.equal(localizeErrorMessage('邮箱不能为空'), 'Email cannot be empty');
  assert.equal(localizeErrorMessage('系统未配置发件服务'), 'Email service is not configured');
  assert.equal(localizeErrorMessage('重置链接无效或已过期'), 'Reset link is invalid or has expired');

  // 恢复默认简体中文
  await setLocale(CHINESE_LOCALE);
  assert.equal(t('auth.forgotPasswordTitle'), '找回密码');
  assert.equal(t('auth.resetPasswordTitle'), '重置密码');
});

test('前端硬编码文案已改为可翻译键', async () => {
  const hardcoded = [
    'frontend/src/utils/conversation-preview.js',
    'frontend/src/pages/RegisterPage.vue',
    'frontend/src/pages/AdminAiPage.vue',
    'frontend/src/components/chat/MessageComposer.vue'
  ];
  const removed = {
    'frontend/src/utils/conversation-preview.js': /'\[加密消息\]'/,
    'frontend/src/pages/RegisterPage.vue': /本站未开放自由注册/,
    'frontend/src/pages/AdminAiPage.vue': /隐藏密钥|常用快捷：|（默认头像）/,
    'frontend/src/components/chat/MessageComposer.vue': /文件大小不能超过 \$\{/
  };
  for (const file of hardcoded) {
    const source = await readFile(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(source, removed[file], `${file} 仍包含硬编码中文界面文案`);
  }
});

test('界面新增文案在三种语言下均有翻译', async () => {
  await setLocale(TRADITIONAL_CHINESE_LOCALE);
  assert.equal(`[${t('messages.encrypted')}]`, '[加密訊息]');
  assert.equal(t('auth.registrationClosed'), '本站未開放自由註冊，請向管理員索取邀請連結。');
  assert.equal(t('ai.showApiKey'), '顯示密鑰');
  assert.equal(t('ai.hideApiKey'), '隱藏密鑰');
  assert.equal(t('ai.presetModels'), '常用快捷：');
  assert.equal(t('ai.defaultAvatar'), '（預設頭像）');
  assert.equal(t('composer.fileTooLarge', { size: 16 }), '檔案大小不能超過 16MB');

  await setLocale(ENGLISH_LOCALE);
  assert.equal(`[${t('messages.encrypted')}]`, '[Encrypted message]');
  assert.equal(
    t('auth.registrationClosed'),
    'Open registration is disabled on this site. Please ask an administrator for an invitation link.'
  );
  assert.equal(t('ai.showApiKey'), 'Show API key');
  assert.equal(t('ai.hideApiKey'), 'Hide API key');
  assert.equal(t('ai.presetModels'), 'Quick presets:');
  assert.equal(t('ai.defaultAvatar'), '(default avatar)');
  assert.equal(t('composer.fileTooLarge', { size: 16 }), 'File size cannot exceed 16 MB');

  await setLocale(CHINESE_LOCALE);
});

test('服务端每一处中文错误文案都能被繁体与英文翻译', async () => {
  // 服务端错误以中文原文为键，缺一条就会在英文/繁体界面直接漏出简体中文。
  const workerRoot = new URL('../worker/src/', import.meta.url);
  const literalPattern = /(?:errorResponse|ApiError)\(\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")/g;
  const han = /[\u4e00-\u9fff]/;

  async function collect(dir) {
    const entries = await readdir(dir, { withFileTypes: true });
    const found = new Set();
    for (const entry of entries) {
      const target = new URL(`${entry.name}${entry.isDirectory() ? '/' : ''}`, dir);
      if (entry.isDirectory()) {
        for (const value of await collect(target)) found.add(value);
      } else if (entry.name.endsWith('.ts')) {
        const source = await readFile(target, 'utf8');
        for (const match of source.matchAll(literalPattern)) {
          const message = match[1] ?? match[2] ?? match[3] ?? '';
          if (han.test(message)) found.add(message);
        }
      }
    }
    return found;
  }

  // 错误映射里的值可能与键完全相同（“接口不存在”简繁同形），所以只看键是否存在，
  // 不能用「翻译结果等于原文」反推缺失。
  async function loadErrorCatalog(locale) {
    const source = await readFile(
      new URL(`../frontend/src/locales/server-errors/${locale}.js`, import.meta.url),
      'utf8'
    );
    const [fixedSection] = source.split('const dynamicErrorTranslations');
    const fixed = new Set(
      [...fixedSection.matchAll(/^\s*\[?\s*['"](.+?)['"]\s*,\s*['"]/gm)].map((match) => match[1])
    );
    const dynamic = [...source.matchAll(/^\s*\[\/(.+?)\/,\s*\(match\)/gm)].map(
      (match) => new RegExp(match[1])
    );
    return { fixed, dynamic };
  }

  const messages = await collect(workerRoot);
  assert.ok(messages.size > 100, `只扫描到 ${messages.size} 条服务端错误文案，检查扫描逻辑`);

  for (const locale of [TRADITIONAL_CHINESE_LOCALE, ENGLISH_LOCALE]) {
    const { fixed, dynamic } = await loadErrorCatalog(locale);
    const missing = [];
    for (const message of messages) {
      if (fixed.has(message)) continue;
      // 模板字面量在运行时会插入数字，按动态规则匹配。
      const probe = message.replaceAll(/\$\{[^}]*\}/g, '5');
      if (dynamic.some((pattern) => pattern.test(probe))) continue;
      missing.push(message);
    }
    assert.deepEqual(missing, [], `${locale} 缺少以下服务端错误翻译：${missing.join(' / ')}`);
  }
});

