import type { AppBindings, SessionUser } from './types.ts';
import { decryptSecretValue, encryptSecretValue } from './encryption.js';
import { ApiError } from './errors.ts';
import { hashOpaqueToken } from './mobile-session.ts';
import { validateSession } from './session.ts';
import { randomToken } from './utils.ts';

export const REALTIME_TICKET_TTL_SECONDS = 60;

export interface RealtimeTicketTarget {
  scope: 'inbox' | 'room';
  roomKind?: string | null;
  roomId?: number | string | null;
}

export interface IssuedRealtimeTicket {
  ticket: string;
  expiresAt: string;
}

export interface ConsumedRealtimeTicket {
  session: SessionUser;
  scope: string;
  roomKind: string;
  roomId: number | null;
}

function ticketContext(tokenHash: string): string {
  return `realtime-ticket:${tokenHash}`;
}

export async function issueRealtimeTicket(
  env: Pick<AppBindings, 'DB'>,
  session: SessionUser | null | undefined,
  target: RealtimeTicketTarget,
): Promise<IssuedRealtimeTicket> {
  if (!session?.deviceSessionId || session.sessionKind !== 'mobile') {
    throw new ApiError('当前会话不支持实时票据', 400, 'mobile_session_required');
  }
  const ticket = randomToken(32);
  const tokenHash = await hashOpaqueToken(ticket);
  const accessTokenCiphertext = await encryptSecretValue(
    env,
    session.token,
    ticketContext(tokenHash)
  );
  const expiresAt = new Date(Date.now() + REALTIME_TICKET_TTL_SECONDS * 1000)
    .toISOString()
    .replace('T', ' ')
    .replace(/\.\d{3}Z$/, '');
  await env.DB.prepare(
    `INSERT INTO realtime_tickets (
       token_hash, access_token_ciphertext, user_id, device_session_id,
       scope, room_kind, room_id, expires_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      tokenHash,
      accessTokenCiphertext,
      Number(session.userId),
      String(session.deviceSessionId),
      target.scope,
      target.roomKind || null,
      target.roomId || null,
      expiresAt
    )
    .run();
  return { ticket, expiresAt: `${expiresAt.replace(' ', 'T')}Z` };
}

interface RealtimeTicketRow {
  access_token_ciphertext: string;
  user_id: number;
  device_session_id: string;
  scope: string;
  room_kind: string | null;
  room_id: number | null;
}

export async function consumeRealtimeTicket(
  env: Pick<AppBindings, 'DB'>,
  ticket: unknown,
): Promise<ConsumedRealtimeTicket | null> {
  const cleanTicket = String(ticket || '').trim();
  if (!cleanTicket) return null;
  const tokenHash = await hashOpaqueToken(cleanTicket);
  const { results } = await env.DB.prepare(
    `UPDATE realtime_tickets
     SET consumed_at = CURRENT_TIMESTAMP
     WHERE token_hash = ?
       AND consumed_at IS NULL
       AND expires_at > CURRENT_TIMESTAMP
     RETURNING access_token_ciphertext, user_id, device_session_id,
               scope, room_kind, room_id`
  )
    .bind(tokenHash)
    .all<RealtimeTicketRow>();
  const row = results[0];
  if (!row) return null;

  const accessToken = await decryptSecretValue(
    env,
    row.access_token_ciphertext,
    ticketContext(tokenHash)
  );
  const auth = await validateSession(env, accessToken);
  if (
    !auth.ok ||
    Number(auth.session.userId) !== Number(row.user_id) ||
    String(auth.session.deviceSessionId || '') !== String(row.device_session_id)
  ) {
    return null;
  }
  return {
    session: auth.session,
    scope: row.scope,
    roomKind: row.room_kind || '',
    roomId: row.room_id === null ? null : Number(row.room_id)
  };
}
