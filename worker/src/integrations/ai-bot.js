import { submitExternalMessage } from '../external-message-submission.js';
import { encryptMessageContent } from '../encryption.js';

const AI_API_URL = 'https://api.seurl.eu.org/v1/chat/completions';
const AI_API_KEY = 'sk_cf_2781e99f40f74df98c51a4592ab7ad95';
const AI_MODEL = 'gemini/gemini-3.6-flash-high';

export async function processAiBotResponse(channelRoom, { room, message }) {
  let aiMessageId = null;
  try {
    // 忽略 AI 自身发出的消息，避免死循环
    if (message.source === 'ai' || message.sender?.displayName === 'ZeroClaw' || message.sender?.username === 'zeroclaw') {
      return;
    }

    const userText = String(message.content || '').trim();
    if (!userText) return;

    // 1. 先向房间插入一条初始占位消息，获取正式 ID
    const initialPayload = {
      content: '...',
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

    const submission = await submitExternalMessage(channelRoom.env, { room, payload: initialPayload });
    const aiMessage = submission.message;
    aiMessageId = aiMessage.id;

    // 广播初始占位消息，前端直接渲染出气泡
    if (channelRoom.broadcast) {
      await channelRoom.broadcast(submission.packet);
    }

    // 2. 发起请求
    const res = await fetch(AI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${AI_API_KEY}`
      },
      body: JSON.stringify({
        model: AI_MODEL,
        stream: true,
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

    if (!res.ok || !res.body) {
      const errText = await res.text();
      console.error('AI gateway streaming error:', res.status, errText);
      await channelRoom.env.DB.prepare(
        'UPDATE messages SET content = ? WHERE id = ?'
      ).bind('AI 调用失败: ' + errText, aiMessageId).run();
      return;
    }

    // 3. 读取 SSE 流并实时推送到房间
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let accumulatedContent = '';
    let buffer = '';
    let isFirstChunk = true;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data:')) continue;
        const dataStr = trimmed.slice(5).trim();
        if (dataStr === '[DONE]') continue;

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            accumulatedContent += delta;
            
            if (channelRoom.broadcast) {
              const streamPacket = JSON.stringify({
                protocolVersion: 1,
                type: 'message_stream',
                messageId: aiMessageId,
                delta: delta,
                replace: isFirstChunk
              });
              isFirstChunk = false;
              await channelRoom.broadcast(streamPacket);
            }
          }
        } catch (e) {
          // ignore chunk parse errors
        }
      }
    }

    // 4. 流式结束，更新 D1 数据库并广播最终状态
    if (accumulatedContent) {
      const encrypted = await encryptMessageContent(channelRoom.env, accumulatedContent, {
        channelId: room.id,
        senderContext: 'ai:zeroclaw'
      });
      await channelRoom.env.DB.prepare(
        'UPDATE messages SET content = ? WHERE id = ?'
      ).bind(encrypted, aiMessageId).run();

      const finalMessage = {
        ...aiMessage,
        content: accumulatedContent
      };
      if (channelRoom.broadcast) {
        const finalPacket = JSON.stringify({
          protocolVersion: 1,
          type: 'message_updated',
          message: finalMessage
        });
        await channelRoom.broadcast(finalPacket);
      }
      if (channelRoom.runMessageProjections) {
        channelRoom.runMessageProjections(room, finalMessage, submission.replyToSenderId);
      }
    }
  } catch (err) {
    console.error('Failed to process streaming AI bot response:', err);
    if (aiMessageId) {
      try {
        await channelRoom.env.DB.prepare(
          'UPDATE messages SET content = ? WHERE id = ?'
        ).bind('AI 处理异常: ' + String(err?.message || err), aiMessageId).run();
      } catch (e) {}
    }
  }
}
