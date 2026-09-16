import { dispatchAuthInvalid, getStoredToken } from './auth-storage.js';
import { getEdgeChatServerOrigin, resolveServerUrl } from './capacitor-platform.ts';
import { t } from './i18n.js';
import { localizedError, localizeErrorMessage } from './localized-error.js';
import { getRuntimeFileUrl, isDemoMode, requestRuntime } from './runtime.js';

function buildHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getStoredToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function request(path, options = {}) {
  if (isDemoMode) {
    try {
      return await requestRuntime(path, options);
    } catch (error) {
      throw localizedError(error);
    }
  }

  const response = await fetch(resolveServerUrl(`/api${path}`), {
    ...options,
    headers: buildHeaders(options.headers),
    body:
      options.body instanceof FormData || typeof options.body === 'string'
        ? options.body
        : options.body
          ? JSON.stringify(options.body)
          : undefined
  });

  const contentType = response.headers.get('content-type') || '';
  const payload = contentType.includes('application/json')
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const rawMessage = payload?.error?.message || payload?.error || payload || t('common.requestFailed');
    const error = new Error(localizeErrorMessage(rawMessage));
    error.status = response.status;
    error.payload = payload;
    error.rawMessage = rawMessage;

    if (response.status === 401 && typeof window !== 'undefined') {
      dispatchAuthInvalid(error.message);
    }

    throw error;
  }

  return payload;
}

export default {
  login(credentials) {
    return request('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: credentials
    });
  },
  logout() {
    return request('/auth/logout', { method: 'POST' });
  },
  session() {
    return request('/auth/session');
  },
  getSite() {
    return request('/site');
  },
  changePassword(payload) {
    return request('/auth/change-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateProfile(payload) {
    return request('/me/profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getUsers() {
    return request('/users');
  },
  getContacts(options = {}) {
    return request('/contacts', options);
  },
  getUserProfile(userId, options = {}) {
    return request(`/users/${encodeURIComponent(userId)}/profile`, options);
  },
  bootstrap() {
    return request('/bootstrap');
  },
  getChannels() {
    return request('/channels');
  },
  createGroup(payload) {
    return request('/channels', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  joinChannel(channelId) {
    return request(`/channels/${channelId}/join`, { method: 'POST' });
  },
  getChannelMembers(channelId) {
    return request(`/channels/${channelId}/members`);
  },
  inviteChannelMembers(channelId, userIds) {
    return request(`/channels/${channelId}/invite`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userIds }
    });
  },
  removeChannelMember(channelId, userId) {
    return request(`/channels/${channelId}/members/${userId}`, {
      method: 'DELETE'
    });
  },
  deleteOwnedChannel(channelId) {
    return request(`/channels/${channelId}`, {
      method: 'DELETE'
    });
  },
  updateChannel(channelId, payload) {
    return request(`/channels/${channelId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  getMessages(kind, roomId, before) {
    const query = new URLSearchParams({ kind, roomId: String(roomId) });
    if (before) {
      query.set('before', String(before));
    }
    return request(`/messages?${query.toString()}`);
  },
  getRecentMessages(kind, roomId, limit = 30) {
    const query = new URLSearchParams({ limit: String(limit) });
    return request(
      `/v1/rooms/${encodeURIComponent(kind)}/${Number(roomId)}/messages?${query.toString()}`
    );
  },
  sendRoomMessage(kind, roomId, payload) {
    return request(`/v1/rooms/${encodeURIComponent(kind)}/${Number(roomId)}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  deleteRoomMessage(kind, roomId, messageId) {
    return request(`/v1/rooms/${encodeURIComponent(kind)}/${Number(roomId)}/messages/${Number(messageId)}`, {
      method: 'DELETE'
    });
  },
  syncRoomMessages(kind, roomId, cursor) {
    const query = new URLSearchParams(cursor ? { cursor: String(cursor) } : {});
    return request(`/v1/rooms/${encodeURIComponent(kind)}/${Number(roomId)}/sync?${query.toString()}`);
  },
  sendPresence() {
    return request('/v1/presence', { method: 'POST' });
  },
  setRoomTyping(kind, roomId, typing) {
    return request(`/v1/rooms/${encodeURIComponent(kind)}/${encodeURIComponent(roomId)}/typing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { typing: Boolean(typing) }
    });
  },
  markRoomRead(kind, roomId, messageId) {
    return request('/messages/read', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: {
        kind,
        roomId,
        ...(messageId ? { messageId } : {})
      }
    });
  },
  openDm(userId) {
    return request('/dm/open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { userId }
    });
  },
  listDms() {
    return request('/dm');
  },
  blockUser(userId) {
    return request(`/users/${Number(userId)}/block`, { method: 'PUT' });
  },
  unblockUser(userId) {
    return request(`/users/${Number(userId)}/block`, { method: 'DELETE' });
  },
  uploadFile(file) {
    const form = new FormData();
    form.append('file', file);
    return request('/upload', {
      method: 'POST',
      body: form
    });
  },
  getRoomWebSocketUrl(kind, roomId) {
    const token = getStoredToken();
    const url = new URL(`/api/ws/${kind}/${roomId}`, getEdgeChatServerOrigin());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token || '');
    return url.toString();
  },
  getInboxWebSocketUrl() {
    const token = getStoredToken();
    const url = new URL('/api/inbox/ws', getEdgeChatServerOrigin());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
    url.searchParams.set('token', token || '');
    return url.toString();
  },
  getFileUrl(keyOrUrl) {
    const raw = String(keyOrUrl || '');
    if (!raw) {
      return '';
    }
    if (isDemoMode) {
      return getRuntimeFileUrl(raw);
    }

    // 外置图床的直链是绝对地址，原样返回：它不受本站鉴权保护，也不能拼 /files/。
    if (/^https?:\/\//i.test(raw)) {
      return raw;
    }

    const url = raw.startsWith('/files/')
      ? new URL(resolveServerUrl(raw), getEdgeChatServerOrigin())
      : new URL(resolveServerUrl(`/files/${encodeURIComponent(raw)}`), getEdgeChatServerOrigin());
    const token = getStoredToken();
    if (token) {
      url.searchParams.set('token', token);
    }
    return resolveServerUrl(url.pathname + url.search);
  },
  adminUsers() {
    return request('/admin/users');
  },
  adminOverview() {
    return request('/admin/overview');
  },
  adminMaintenance() {
    return request('/admin/maintenance');
  },
  adminStorageScan(cursor = '') {
    const query = new URLSearchParams();
    if (cursor) {
      query.set('cursor', cursor);
    }
    const suffix = query.size ? `?${query.toString()}` : '';
    return request(`/admin/storage/scan${suffix}`);
  },
  adminSiteSettings() {
    return request('/admin/site-settings');
  },
  adminTelegram() {
    return request('/admin/telegram');
  },
  saveAdminTelegramConfig(payload) {
    return request('/admin/telegram/config', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  createAdminTelegramMapping(payload) {
    return request('/admin/telegram/mappings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateAdminTelegramMapping(mappingId, payload) {
    return request(`/admin/telegram/mappings/${mappingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  deleteAdminTelegramMapping(mappingId) {
    return request(`/admin/telegram/mappings/${mappingId}`, { method: 'DELETE' });
  },
  listAdminRegisterLinks() {
    return request('/admin/register-links');
  },
  createAdminRegisterLink(payload) {
    return request('/admin/register-links', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  revokeAdminRegisterLink(inviteId) {
    return request(`/admin/register-links/${inviteId}`, {
      method: 'DELETE'
    });
  },
  updateAdminSiteSettings(payload) {
    return request('/admin/site-settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  createUser(payload) {
    return request('/admin/users', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  updateUser(userId, payload) {
    return request(`/admin/users/${userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  },
  resetPassword(userId, password) {
    return request(`/admin/users/${userId}/reset-password`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: { password }
    });
  },
  deleteUser(userId) {
    return request(`/admin/users/${userId}`, {
      method: 'DELETE'
    });
  },
  adminChannels() {
    return request('/admin/channels');
  },
  deleteChannel(channelId) {
    return request(`/admin/channels/${channelId}`, {
      method: 'DELETE'
    });
  },
  adminDms() {
    return request('/admin/dms');
  },
  getRegisterInvite(token) {
    return request(`/register-links/${encodeURIComponent(token)}`);
  },
  registerWithInvite(token, payload) {
    return request(`/register-links/${encodeURIComponent(token)}/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: payload
    });
  }
};

export async function registerOpen(data) {
  return request('/api/auth/register-open', {
    method: 'POST',
    body: JSON.stringify(data)
  });
}

export async function forgotPassword(email) {
  return request('/api/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email })
  });
}

export async function resetPassword(token, password) {
  return request('/api/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token, password })
  });
}
