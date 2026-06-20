/**
 * Session model — data access for the `user_sessions` table.
 *
 * Each row is one active refresh token. We store only the SHA-256 *hash* of the
 * refresh token, so a database leak never exposes usable tokens. Verifying a
 * refresh token means hashing the incoming token and looking up the hash.
 */

import { query } from "../db";

export interface UserSession {
  id: string;
  user_id: string;
  refresh_token_hash: string;
  user_agent: string | null;
  ip: string | null;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export async function createSession(input: {
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
  userAgent?: string | null;
  ip?: string | null;
}): Promise<UserSession> {
  const { rows } = await query<UserSession>(
    `insert into user_sessions (user_id, refresh_token_hash, expires_at, user_agent, ip)
     values ($1, $2, $3, $4, $5)
     returning *`,
    [
      input.userId,
      input.refreshTokenHash,
      input.expiresAt.toISOString(),
      input.userAgent ?? null,
      input.ip ?? null,
    ]
  );
  return rows[0];
}

/** Find a live (not revoked, not expired) session by its token hash. */
export async function findLiveSessionByHash(refreshTokenHash: string): Promise<UserSession | null> {
  const { rows } = await query<UserSession>(
    `select * from user_sessions
     where refresh_token_hash = $1
       and revoked_at is null
       and expires_at > now()
     limit 1`,
    [refreshTokenHash]
  );
  return rows[0] ?? null;
}

/** Revoke a single session by its token hash (logout). */
export async function revokeSessionByHash(refreshTokenHash: string): Promise<void> {
  await query(
    `update user_sessions set revoked_at = now()
     where refresh_token_hash = $1 and revoked_at is null`,
    [refreshTokenHash]
  );
}

/** Revoke every active session for a user (logout everywhere). */
export async function revokeAllSessions(userId: string): Promise<void> {
  await query(
    `update user_sessions set revoked_at = now()
     where user_id = $1 and revoked_at is null`,
    [userId]
  );
}
