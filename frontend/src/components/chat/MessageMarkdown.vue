<script setup lang="ts">
import { computed } from "vue";
import { renderMessageMarkdown } from "../../message-markdown.ts";
import type { MessageMention } from "../../mentions.ts";

const props = defineProps<{
	content: string;
	mentions?: MessageMention[];
	currentUserId?: number;
	/** 打字机显现中：在正文末尾补一个内联光标。 */
	streaming?: boolean;
}>();

const renderedContent = computed(() => {
	const html = renderMessageMarkdown(props.content, props.mentions || [], props.currentUserId);
	// 光标内联在正文末尾，且**始终占位**：它若作为本组件的兄弟节点，块级容器会把它挤到
	// 下一行（实测气泡高 +23px）；即便内联，显现时凭空出现也会让高度变化约 7px。
	// 常驻占位、只切换可见性，两种状态下气泡高度完全一致，底部对齐的头像就不会抖。
	const idle = props.streaming ? '' : ' message-stream-caret--idle';
	return `${html}<span class="message-stream-caret${idle}" aria-hidden="true"></span>`;
});

function stopLinkGesture(event: Event) {
	if ((event.target as Element | null)?.closest("a")) event.stopPropagation();
}
</script>

<template>
	<!-- 最终 HTML 已由固定 Markdown 配置生成，并经过 DOMPurify 最小白名单净化。 -->
	<div
		class="message-markdown"
		@pointerdown="stopLinkGesture"
		@contextmenu="stopLinkGesture"
		v-html="renderedContent"
	></div>
</template>

<style scoped>
.message-markdown {
	min-width: 0;
	color: var(--chat-ink);
	font-size: 15px;
	line-height: 1.6;
	overflow-wrap: anywhere;
}

/* 显现光标：v-html 注入的节点带不上 scoped 属性，需要 :deep。 */
.message-markdown :deep(.message-stream-caret) {
	display: inline-block;
	width: 2px;
	height: 1.05em;
	margin-left: 1px;
	background: currentColor;
	vertical-align: text-bottom;
	animation: markdown-caret-blink 1100ms steps(1, end) infinite;
}

/* 未在显现时保留占位但不可见，避免气泡高度在显现开始/结束的瞬间发生变化。 */
.message-markdown :deep(.message-stream-caret--idle) {
	visibility: hidden;
	animation: none;
}

@keyframes markdown-caret-blink {
	0%, 50% { opacity: 1; }
	51%, 100% { opacity: 0; }
}

@media (prefers-reduced-motion: reduce) {
	.message-markdown :deep(.message-stream-caret) {
		animation: none;
		opacity: 0.8;
	}
}

/* 为气泡右下角的绝对定位时间戳保留稳定空间（HH:MM:SS 比原来的 HH:MM 宽）。 */
.message-markdown::after {
	content: "";
	display: inline-block;
	width: 4em;
	height: 0;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:first-child) {
	margin-top: 0;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:last-child) {
	margin-bottom: 0;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(p) {
	margin: 0 0 0.45em;
	white-space: pre-wrap;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:is(h1, h2, h3, h4, h5, h6)) {
	margin: 0.45em 0 0.25em;
	font-size: 1.08em;
	line-height: 1.3;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:is(ul, ol, blockquote)) {
	margin: 0.35em 0;
	padding-left: 1.5em;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(blockquote) {
	padding: 0.15em 0 0.15em 0.75em;
	border-left: 3px solid rgba(0, 128, 105, 0.42);
	color: #54656f;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(pre) {
	max-width: 100%;
	margin: 0.45em 0;
	padding: 8px 10px;
	overflow-x: auto;
	border-radius: 5px;
	background: rgba(11, 20, 26, 0.08);
	white-space: pre;
	-webkit-overflow-scrolling: touch;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(code) {
	font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
	font-size: 0.9em;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:not(pre) > code) {
	padding: 0.08em 0.3em;
	border-radius: 3px;
	background: rgba(11, 20, 26, 0.08);
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(table) {
	display: block;
	max-width: 100%;
	margin: 0.45em 0;
	overflow-x: auto;
	border-collapse: collapse;
	-webkit-overflow-scrolling: touch;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(:is(th, td)) {
	padding: 4px 7px;
	border: 1px solid rgba(84, 101, 111, 0.3);
	white-space: nowrap;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-mention) {
	color: #168758;
	font-weight: 650;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-mention--self) {
	padding: 1px 3px;
	border-radius: 4px;
	background: rgba(22, 135, 88, 0.14);
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-link) {
	color: #006aa6;
	text-decoration: none;
	overflow-wrap: anywhere;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-link:hover) {
	text-decoration: underline;
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-image-link)::before {
	content: "[";
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-image-link)::after {
	content: "]";
}

/* biome-ignore lint/correctness/noUnknownPseudoClass: Vue deep selector */
.message-markdown :deep(.message-image-syntax) {
	white-space: pre-wrap;
}
</style>
