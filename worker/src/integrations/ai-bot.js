import { submitExternalMessage } from '../external-message-submission.js';

const AI_API_URL = 'https://api.seurl.eu.org/v1/chat/completions';
const AI_API_KEY = 'sk_cf_2781e99f40f74df98c51a4592ab7ad95';
const AI_MODEL = 'gemini/gemini-3.6-flash-high';

export async function processAiBotResponse(env, { room, message }) {
  try {
    // 忽略 AI 自身发出的消息，避免死循环
    if (message.source === 'ai' || message.sender?.displayName === 'ZeroClaw' || message.sender?.username === 'zeroclaw') {
      return;
    }

    const userText = String(message.content || '').trim();
    if (!userText) return;

    // 1. 发起推理请求（直连 AI 网关，gemini-3.6 仅需 ~300ms 即可完成生成）
    const res = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          {
            role: 'system',
            content: '你是运行在 ZeroClaw 架构上的 AI 智能体助手，名字叫 ZeroClaw。你的回答风格专业、友好、富有洞察力，排版优美，支持 Markdown。'
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

    const data = await res.json();
    const replyContent = data.choices?.[0]?.message?.content?.trim();
    if (!replyContent) return;

    // 2. 将带有完整 AI 回复的消息写入 D1 数据库（触发 record_message_created_event）
    const payload = {
      content: replyContent,
      source: 'ai',
      sourceMessageId: `ai:${crypto.randomUUID()}`,
      replyToMessageId: message.id || null,
      replyToSenderId: message.sender?.kind === 'local' ? message.sender.id : null,
      externalSender: {
        id: 'zeroclaw',
        username: 'ZeroClaw',
        displayName: 'ZeroClaw',
        avatarUrl: 'https://img.xiaow.eu.org/avatar.png'
      }
    };

    // 纯 D1 部署没有实时推送，客户端轮询同步游标即可拿到这条回复。
    await submitExternalMessage(env, { room, payload });
  } catch (err) {
    console.error('Failed to process AI bot response:', err);
  }
}
