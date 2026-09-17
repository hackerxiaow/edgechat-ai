import { t } from '../i18n.js';
import { messageMarkdownToPlainText } from '../message-markdown.ts';

/**
 * 将附件格式化为友好的标签，如 [图片]、[语音]、[视频]、[附件]
 */
function getAttachmentLabel(attachment, fallbackKind = null) {
  const kind = String(attachment?.kind || fallbackKind || attachment?.mimeType || '').toLowerCase();
  if (kind === 'voice' || kind.startsWith('audio/')) {
    return `[${t('messages.audio')}]`;
  }
  if (kind.startsWith('image/')) {
    return `[${t('messages.photo')}]`;
  }
  if (kind.startsWith('video/')) {
    return `[${t('messages.video')}]`;
  }
  if (kind) {
    return `[${t('messages.attachment')}]`;
  }
  return '';
}

/**
 * 提取并格式化最新消息预览（Telegram Web 风格）
 * 返回 { sender: string, text: string, preview: string } 或 null
 */
export function formatConversationPreview(source, currentUserId) {
  const msg = source?.lastMessage;
  if (!msg) {
    return null;
  }

  // 1. 判断发送者是否是当前用户
  const senderId = msg.senderId ?? msg.sender?.id;
  const isMe = currentUserId && (
    Number(senderId) === Number(currentUserId) ||
    String(senderId) === String(currentUserId)
  );

  let sender = '';
  if (isMe) {
    sender = t('chat.you') || t('messages.you') || '你';
  } else {
    sender = String(msg.senderName || msg.sender?.displayName || msg.sender?.username || '').trim();
  }

  // 2. 提取正文与附件
  const rawContent = String(msg.content || '').trim();
  const isEncrypted = rawContent.startsWith('edgechat:enc:');
  const attachLabel = getAttachmentLabel(msg.attachment, msg.attachmentKind);

  let text = '';
  if (isEncrypted) {
    text = attachLabel || '[加密消息]';
  } else if (rawContent) {
    const plain = messageMarkdownToPlainText(rawContent);
    text = attachLabel ? `${attachLabel} ${plain}` : plain;
  } else if (attachLabel) {
    text = attachLabel;
  }

  if (!text && !sender) {
    return null;
  }

  return {
    sender,
    text: text || '...',
    preview: sender ? `${sender}: ${text || '...'}` : (text || '...')
  };
}
