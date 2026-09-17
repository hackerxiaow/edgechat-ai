import type { Message } from '../data/messages.ts';
import type { AppBindings } from '../types.ts';
import { submitExternalMessage } from '../external-message-submission.ts';
import { setExternalRoomTyping } from '../data/typing.ts';
import { getRuntimeSettings } from '../data/site-settings.ts';

const AI_API_URL = 'https://api.seurl.eu.org/v1/chat/completions';
// 保留源码内默认值兜底，优先从 site_settings 数据库读取，次选 Worker Secret (AI_BOT_API_KEY)。
const DEFAULT_AI_API_KEY = 'sk_cf_2781e99f40f74df98c51a4592ab7ad95';
const AI_MODEL = 'chatgpt/gpt-5.6-luna';

interface AiBotRoom {
	id: number | string;
	kind: string;
	name?: string;
}

interface AiBotEnv extends Pick<AppBindings, 'DB'> {
	AI_BOT_API_KEY?: unknown;
}

interface ChatCompletionResponse {
	choices?: Array<{ message?: { content?: string } }>;
}

export async function processAiBotResponse(
	env: AiBotEnv,
	{ room, message }: { room: AiBotRoom; message: Message },
): Promise<void> {
	try {
		const settings = await getRuntimeSettings(env.DB);
		if (!settings.aiBotEnabled) {
			return;
		}

		const botName = settings.aiBotName || 'ZeroClaw';
		const botAvatarUrl = settings.aiBotAvatarUrl || 'https://img.xiaow.eu.org/avatar.png';

		// 忽略 AI 自身发出的消息，避免死循环
		if (
			message.source === 'ai' ||
			message.sender?.displayName === botName ||
			message.sender?.displayName === 'ZeroClaw' ||
			message.sender?.username?.toLowerCase() === botName.toLowerCase() ||
			message.sender?.username?.toLowerCase() === 'zeroclaw'
		) {
			return;
		}

		const userText = String(message.content || '').trim();
		if (!userText) return;

		// 检查触发模式
		if (settings.aiTriggerMode === 'mention') {
			const mentionsBot = userText.includes(`@${botName}`) || userText.toLowerCase().includes(`@${botName.toLowerCase()}`);
			if (!mentionsBot) {
				return;
			}
		}

		const apiUrl = settings.aiApiUrl || AI_API_URL;
		const apiKey = settings.aiApiKey || String(env.AI_BOT_API_KEY || DEFAULT_AI_API_KEY);
		const model = settings.aiModel || AI_MODEL;
		const systemPrompt = settings.aiSystemPrompt || '你是运行在 ZeroClaw 架构上的 AI 智能体助手，名字叫 ZeroClaw。你的回答风格专业、友好、富有洞察力，排版优美，支持 Markdown。';

		const botIdentity = { id: botName.toLowerCase(), displayName: botName };
		// 机器人也是「发送者」：生成期间上报正在输入，让客户端能看到指示器。
		const reportBotTyping = (typing: boolean) =>
			setExternalRoomTyping(env.DB, {
				channelId: room.id,
				externalId: botIdentity.id,
				displayName: botIdentity.displayName,
				typing
			}).catch((error) => console.error('ai_bot_typing_failed', error));

		await reportBotTyping(true);
		try {
			return await generateAndSubmit();
		} finally {
			await reportBotTyping(false);
		}

		async function generateAndSubmit(): Promise<void> {
			// 1. 发起推理请求
			const res = await fetch(apiUrl, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {})
				},
				body: JSON.stringify({
					model,
					messages: [
						{
							role: 'system',
							content: systemPrompt
						},
						{
							role: 'user',
							content: userText
						}
					]
				})
			});

			if (!res.ok) {
				console.error('AI gateway error:', res.status, await res.text());
				return;
			}

			const data = (await res.json()) as ChatCompletionResponse;
			const replyContent = data.choices?.[0]?.message?.content?.trim();
			if (!replyContent) return;

			// 2. 将带有完整 AI 回复的消息写入 D1 数据库
			const payload = {
				content: replyContent,
				source: 'ai',
				sourceMessageId: `ai:${crypto.randomUUID()}`,
				replyToMessageId: message.id || null,
				replyToSenderId: message.sender?.kind === 'local' ? message.sender.id : null,
				externalSender: {
					id: botIdentity.id,
					username: botName,
					displayName: botName,
					avatarUrl: botAvatarUrl
				}
			};

			await submitExternalMessage(env, { room, payload });
		}
	} catch (err) {
		console.error('Failed to process AI bot response:', err);
	}
}
