import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const indexHtml = readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
const chatPage = readFileSync(
	new URL("../frontend/src/pages/ChatPage.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");
const attachmentStyles = readFileSync(
	new URL("../frontend/src/styles/chat-attachments.css", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");
const mobileDrawer = readFileSync(
	new URL("../frontend/src/components/chat/MobileNavigationDrawer.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");
const conversationList = readFileSync(
	new URL("../frontend/src/components/chat/ConversationList.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");
const messageComposer = readFileSync(
	new URL("../frontend/src/components/chat/MessageComposer.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");
const demoNavigator = readFileSync(
	new URL("../frontend/src/components/demo/DemoNavigator.vue", import.meta.url),
	"utf8",
).replaceAll("\r\n", "\n");

function getStyleRule(source, selector) {
	const marker = `${selector} {`;
	const start = source.indexOf(marker);
	assert.notEqual(start, -1, `聊天页缺少样式规则：${selector}`);
	const end = source.indexOf("}", start + marker.length);
	assert.notEqual(end, -1, `聊天页样式规则未闭合：${selector}`);
	return source.slice(start, end + 1);
}

test("聊天界面使用原始控件尺寸铺满整个视口", () => {
	const layout = getStyleRule(chatPage, ".chat-layout");
	assert.match(layout, /width:\s*100%;/);
	assert.match(layout, /height:\s*var\(--chat-viewport-height,\s*100dvh\);/);
	assert.match(layout, /position:\s*fixed;/);
	assert.match(layout, /top:\s*var\(--chat-viewport-offset-top,\s*0px\);/);
	assert.match(layout, /overflow:\s*hidden;/);
	assert.match(indexHtml, /interactive-widget=resizes-content/);
	assert.doesNotMatch(chatPage, /--chat-interface-scale/);
	assert.doesNotMatch(chatPage, /zoom\s*:/);
	assert.doesNotMatch(chatPage, /width:\s*80%;/);
	assert.doesNotMatch(chatPage, /height:\s*80vh;/);
});

test("移动端附件预览不会挤出发送按钮", () => {
	assert.match(messageComposer, /\.composer-attachment\s*{[^}]*min-width:\s*0;/s);
	assert.match(messageComposer, /\.composer-row\s*{[^}]*min-width:\s*0;/s);
	assert.match(messageComposer, /\.composer-btn,\s*\.composer-send\s*{[^}]*flex-shrink:\s*0;/s);
	assert.match(attachmentStyles, /\.pending-attachment\s*{[^}]*width:\s*100%;[^}]*min-width:\s*0;/s);
	assert.match(attachmentStyles, /\.pending-attachment__name\s*{[^}]*min-width:\s*0;[^}]*text-overflow:\s*ellipsis;/s);
});

test("移动端前台滚动区允许纵向触摸滑动", () => {
	assert.match(conversationList, /\.sidebar-list\s*{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s);
	assert.match(chatPage, /\.chat-messages\s*{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s);
	assert.match(mobileDrawer, /\.mobile-navigation-drawer\s*{[^}]*overflow-y:\s*auto;[^}]*touch-action:\s*pan-y;/s);
});

test("移动端聊天页只显示会话列表或当前聊天中的一个视图", () => {
	assert.match(chatPage, /'chat-layout--mobile-list': isMobileViewport && mobileView === 'list'/);
	assert.match(chatPage, /'chat-layout--mobile-chat': isMobileViewport && mobileView === 'chat'/);
	assert.match(
		chatPage,
		/\.chat-layout--mobile-list \.chat-main,\s*\.chat-layout--mobile-chat \.left-sidebar\s*{\s*display:\s*none;/s,
	);
	assert.match(chatPage, /class="chat-header__back"/);
	assert.match(chatPage, /@click="returnToMobileConversationList"/);
});

test("移动端主要操作保留四十四像素触控区域且文字发送按钮可自然扩展", () => {
	assert.match(chatPage, /\.mobile-menu-action\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
	assert.match(chatPage, /\.chat-header__back\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
	assert.match(chatPage, /\.chat-header__button\s*{[^}]*width:\s*44px;[^}]*height:\s*44px;/s);
	assert.match(messageComposer, /\.composer-btn,\s*\.composer-send\s*{[^}]*height:\s*44px;/s);
	assert.match(messageComposer, /\.composer-send\s*{[^}]*width:\s*auto;[^}]*min-width:\s*(?:44|[5-9]\d)px;/s);
	assert.match(messageComposer, /\.composer-send\s*{[^}]*white-space:\s*nowrap;/s);
	assert.match(messageComposer, /font-size:\s*16px;/);
});

test("窄屏演示导航避开输入区和聊天覆盖层", () => {
	assert.match(
		demoNavigator,
		/bottom:\s*calc\(116px \+ env\(safe-area-inset-bottom\)\);/,
	);
	for (const selector of [
		"body:has(.room-management-layer) .demo-navigator",
		"body:has(.composer-rich-editor) .demo-navigator",
		"body:has(.composer-reply) .demo-navigator",
	]) {
		assert.ok(demoNavigator.includes(selector), `演示导航缺少避让规则：${selector}`);
	}
});

test("聊天侧栏跟随全屏根节点且不污染后台根节点", () => {
	for (const selector of [
		".left-sidebar",
		".right-sidebar",
		".room-management-sidebar",
	]) {
		assert.match(getStyleRule(chatPage, selector), /height:\s*100%;/);
	}

	assert.doesNotMatch(chatPage, /(?:html|body|#app|\.admin-page)\s*{[^}]*zoom:/s);
});

	test("桌面端管理后台入口在图标下方显示文字", () => {
		assert.match(chatPage, /class="right-sidebar-action right-sidebar-action--admin tooltip"/);
		assert.match(chatPage, /<span class="right-sidebar-action__label">\{\{ t\('nav\.admin'\) \}\}<\/span>/);
	assert.match(chatPage, /\.right-sidebar-action--admin\s*{[^}]*flex-direction:\s*column;/s);
		assert.match(chatPage, /\.right-sidebar-action__label\s*{[^}]*font-size:\s*11px;/s);
});

	test("会话列表顶栏用语言切换取代 GitHub 链接并复用相同按钮尺寸", () => {
		const langSwitch = chatPage.indexOf('<LanguageSwitch class="header-language-switch" />');
		const addConversation = chatPage.indexOf(':title="t(\'chat.addPeople\')"');
		assert.notEqual(langSwitch, -1);
		// 语言切换在「添加人员」左侧，两者同处 .sidebar-header-actions。
		assert.ok(langSwitch < addConversation);
		// 语言切换就位于会话列表顶栏的动作区里（允许中间夹注释）。
		assert.match(
			chatPage,
			/<div class="sidebar-header-actions">[\s\S]*?<LanguageSwitch class="header-language-switch" \/>/,
		);
		// GitHub 入口已从顶栏移走，仅保留在移动端导航抽屉里。
		assert.doesNotMatch(chatPage, /href="https:\/\/github\.com\/aozorae\/Edgechat"/);
		assert.doesNotMatch(chatPage, /src="\/github\.svg"/);

		// 必须走 :deep()，否则父组件的 data-v 只落在子组件根元素上，样式匹配不到内部按钮。
		const languageSwitchButton = getStyleRule(chatPage, ".header-language-switch :deep(.language-switch)");
		assert.match(languageSwitchButton, /width:\s*var\(--chat-control\);/);
		assert.match(languageSwitchButton, /height:\s*var\(--chat-control\);/);
		assert.match(languageSwitchButton, /border:\s*none;/);
		assert.match(languageSwitchButton, /border-radius:\s*50%;/);

		const headerAction = getStyleRule(chatPage, ".header-action");
		assert.match(headerAction, /flex:\s*0 0 var\(--chat-control\);/);
		assert.match(headerAction, /width:\s*var\(--chat-control\);/);
		assert.match(headerAction, /height:\s*var\(--chat-control\);/);
	});

	test("语言切换入口唯一且常驻，移动端保持可达", () => {
		assert.doesNotMatch(chatPage, /right-sidebar-action--language/);
		assert.match(chatPage, /<LanguageSwitch class="chat-header__language-switch" \/>/);
		// 空状态里不再额外放一个语言切换，只在会话列表顶栏保留常驻入口。
		assert.doesNotMatch(chatPage, /chat-empty__language-switch|empty-language-switch/);
		assert.doesNotMatch(chatPage, /mobile-language-switch/);
		// 深浅色切换只保留右侧导航栏那一处，避免同一屏出现两个。
		assert.equal((chatPage.match(/class="header-action"[\s\S]{0,200}?toggleTheme/g) || []).length, 0);
	});

test("聊天页面通过专用组件编排会话列表和消息输入区", () => {
	assert.match(chatPage, /<ConversationList/);
	assert.match(chatPage, /:is-room-muted="isRoomMuted"/);
	assert.match(chatPage, /<MessageComposer/);
	assert.match(chatPage, /v-model="composerText"/);
	assert.match(chatPage, /@upload="uploadAttachment"/);
});

test("消息输入区常驻独立的文字发送和语音按钮", () => {
	assert.match(messageComposer, /class="[^"]*composer-voice[^"]*"[\s\S]*class="composer-send"/);
	assert.match(messageComposer, /class="composer-send"[\s\S]*\{\{ t\('chat\.send'\) \}\}/);
	assert.doesNotMatch(
		messageComposer,
		/v-(?:if|else-if)="[^"]*modelValue[^"]*"[^>]*class="composer-(?:voice|send)"/,
	);
});

test("输入法 Enter 不发送，原生权限拒绝可打开设置且设置失败有专用错误", () => {
	assert.match(
		messageComposer,
		/if \(composing\.value \|\| event\.isComposing \|\| event\.keyCode === 229\) return;/,
	);
	assert.match(messageComposer, /@compositionstart="composing = true"/);
	assert.match(messageComposer, /@compositionend="composing = false"/);
	assert.match(messageComposer, /error\?\.message === "native_microphone_permission_denied"/);
	assert.match(messageComposer, /showPermissionSettings\.value = isCapacitorAndroid && permissionDenied;/);
	assert.match(messageComposer, /recordingError\.value = t\("voice\.settingsFailed"\);/);
});
