import type { Hono } from 'hono';
import type { AppEnv } from '../types.ts';
import { hashPassword } from '../auth.ts';
import { listAdminChannels } from '../data/channels.ts';
import { listAdminDms } from '../data/dm-queries.ts';
import { ensureGeneralChannelMembership } from '../data/general-channel.ts';
import {
  createRegistrationInvite,
  listActiveRegistrationInvites,
  MAX_INVITE_USES,
  revokeRegistrationInvite
} from '../data/registration-invites.ts';
import { getSiteSettings, updateSiteSettings } from '../data/site-settings.ts';
import { isR2ObjectUnavailableError } from '../data/uploaded-files.ts';
import { listAdminUsers, listStorageOwners, type StorageOwner } from '../data/users.ts';
import { ApiError } from '../errors.ts';
import { summarizeUploadedFiles, type UploadedFileStatRow } from '../storage-statistics.ts';
import { errorResponse, parseJsonRequest, randomToken } from '../utils.ts';
import { banExpiryFromMinutes } from '../user-status.ts';

interface StorageScanResponse {
  items: unknown;
  scannedObjects: number;
  truncated: boolean;
  cursor: string | null;
  /** 仅在首页（无 cursor）返回，避免分页时重复下发全量用户。 */
  users?: StorageOwner[];
}

export function registerAdminRoutes(app: Hono<AppEnv>) {
  app.get('/api/admin/storage/scan', async (c) => {
    // D1 单存储：附件正文就在 uploaded_files 里，按归属一次聚合即可，无需分页游标。
    const { results } = await c.env.DB.prepare(
      `SELECT owner_user_id,
              COUNT(*) AS object_count,
              COALESCE(SUM(size), 0) AS bytes,
              MAX(created_at) AS latest_uploaded_at
       FROM uploaded_files
       GROUP BY owner_user_id
       ORDER BY bytes DESC`
    ).all<UploadedFileStatRow>();

    const response: StorageScanResponse = {
      items: summarizeUploadedFiles(results),
      scannedObjects: results.reduce((total, row) => total + Number(row.object_count || 0), 0),
      truncated: false,
      cursor: null,
      users: await listStorageOwners(c.env.DB)
    };

    c.header('Cache-Control', 'private, no-store');
    return c.json(response);
  });

  app.get('/api/admin/overview', async (c) => {
    const [users, channels, dms, site] = await Promise.all([
      listAdminUsers(c.env.DB),
      // overview 没有头像字段，显式关闭 projection，避免悄然扩大既有响应 interface。
      listAdminChannels(c.env.DB, { includeAvatar: false }),
      listAdminDms(c.env.DB),
      getSiteSettings(c.env.DB)
    ]);

    return c.json({
      site,
      users,
      channels,
      dms
    });
  });

  app.get('/api/admin/site-settings', async (c) => {
    const site = await getSiteSettings(c.env.DB);
    return c.json({ site });
  });

  app.patch('/api/admin/site-settings', async (c) => {
    const payload = await parseJsonRequest(c.req.raw);
    const siteName = String(payload.siteName || '').trim();
    const siteIconUrl = String(payload.siteIconUrl || '').trim();

    if (!siteName) {
      return errorResponse('站点名称不能为空');
    }

    try {
      const site = await updateSiteSettings(c.env.DB, {
        siteName,
        siteIconUrl,
        siteOrigin: new URL(c.req.url).origin
      });
      return c.json({ site });
    } catch (error) {
      if (isR2ObjectUnavailableError(error)) {
        return errorResponse('站点图标文件不存在或正在清理，请重新上传');
      }
      throw error;
    }
  });

  app.get('/api/admin/register-links', async (c) => {
    const invites = await listActiveRegistrationInvites(c.env.DB);
    return c.json({ invites });
  });

  app.post('/api/admin/register-links', async (c) => {
    const session = c.get('session');
    const payload = await parseJsonRequest(c.req.raw);
    const note = String(payload.note || '').trim();
    const maxUses = Number(payload.maxUses ?? 1);

    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_INVITE_USES) {
      return errorResponse(`可使用次数必须是 1 到 ${MAX_INVITE_USES} 之间的整数`);
    }

    const token = randomToken(24);
    const invite = await createRegistrationInvite(c.env.DB, {
      token,
      note,
      maxUses,
      createdBy: session.userId,
      creatorDisplayName: session.displayName
    });

    return c.json({
      invite
    });
  });

  app.delete('/api/admin/register-links/:inviteId', async (c) => {
    const inviteId = Number(c.req.param('inviteId'));
    if (!Number.isFinite(inviteId)) {
      return errorResponse('注册链接不存在', 404);
    }

    await revokeRegistrationInvite(c.env.DB, inviteId);

    return c.json({ ok: true });
  });

  app.get('/api/admin/users', async (c) => {
    const users = await listAdminUsers(c.env.DB);
    return c.json({ users });
  });

  app.post('/api/admin/users', async (c) => {
    const payload = await parseJsonRequest(c.req.raw);
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const displayName = String(payload.displayName || username).trim();

    if (!username || !password) {
      return errorResponse('用户名和密码不能为空');
    }

    const hashed = await hashPassword(password);
    const result = await c.env.DB.prepare(
      `INSERT INTO users (
         username,
         display_name,
         password_hash,
         password_salt
       ) VALUES (?, ?, ?, ?)`
    )
      .bind(username, displayName, hashed.hash, hashed.salt)
      .run()
      .catch((error: unknown) => {
        if (String((error as { message?: unknown })?.message).includes('UNIQUE')) {
          throw new ApiError('用户名已存在');
        }
        throw error;
      });

    const createdUserId = Number(result.meta.last_row_id ?? 0);
    await ensureGeneralChannelMembership(c.env.DB, createdUserId);

    return c.json({
      user: {
        id: createdUserId,
        username,
        displayName,
        isDisabled: false,
        isPermanentlyDisabled: false,
        disabledUntil: null
      }
    });
  });

  app.patch('/api/admin/users/:userId', async (c) => {
    const userId = Number(c.req.param('userId'));
    const payload = await parseJsonRequest(c.req.raw);
    const updatesBanState = typeof payload.isDisabled === 'boolean';

    if (updatesBanState) {
      const durationMinutes = payload.banDurationMinutes == null
        ? null
        : Number(payload.banDurationMinutes);
      if (payload.isDisabled && durationMinutes !== null
        && (!Number.isInteger(durationMinutes) || durationMinutes < 1)) {
        return errorResponse('封禁时长必须是正整数分钟');
      }

      const isPermanentlyDisabled = payload.isDisabled && durationMinutes === null;
      const disabledUntil = payload.isDisabled && durationMinutes !== null
        ? banExpiryFromMinutes(durationMinutes)
        : null;
      await c.env.DB.prepare(
        `UPDATE users
         SET is_disabled = ?,
             disabled_until = ?,
             display_name = COALESCE(?, display_name),
             session_version = session_version + 1,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND deleted_at IS NULL`
      )
        .bind(isPermanentlyDisabled ? 1 : 0, disabledUntil, payload.displayName || null, userId)
        .run();
    } else {
      await c.env.DB.prepare(
        `UPDATE users
         SET display_name = COALESCE(?, display_name),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ?
           AND deleted_at IS NULL`
      )
        .bind(payload.displayName || null, userId)
        .run();
    }

    return c.json({ ok: true });
  });

  app.post('/api/admin/users/:userId/reset-password', async (c) => {
    const userId = Number(c.req.param('userId'));
    const payload = await parseJsonRequest(c.req.raw);
    const password = String(payload.password || '');
    if (!password) {
      return errorResponse('新密码不能为空');
    }

    const hashed = await hashPassword(password);
    await c.env.DB.prepare(
      `UPDATE users
       SET password_hash = ?,
            password_salt = ?,
            session_version = session_version + 1,
            updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND deleted_at IS NULL`
    )
      .bind(hashed.hash, hashed.salt, userId)
      .run();

    return c.json({ ok: true });
  });

  app.delete('/api/admin/users/:userId', async (c) => {
    const userId = Number(c.req.param('userId'));
    await c.env.DB.prepare(
      `UPDATE users
       SET deleted_at = CURRENT_TIMESTAMP,
            is_disabled = 1,
            disabled_until = NULL,
            session_version = session_version + 1,
            updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
      .bind(userId)
      .run();

    return c.json({ ok: true });
  });

}
