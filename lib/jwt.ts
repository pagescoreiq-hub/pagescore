/**
 * PageScoreIQ — minimal JWT (HS256), zero dependencies.
 *
 * Standard `header.payload.signature` JWTs signed with HMAC-SHA256 using Node's
 * built-in crypto — same hand-rolled philosophy as lib/r2-storage.ts. Used for
 * the short-lived ACCESS token sent to API clients. (Refresh tokens are opaque
 * random strings tracked in the user_sessions table, not JWTs.)
 */

import crypto from "crypto";

const ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET || process.env.AUTH_SECRET || "pagescoreiq-dev-access-secret-change-me";

/** Access-token lifetime, e.g. "15m". Override with JWT_ACCESS_TTL_MIN. */
export const ACCESS_TTL_SEC = (parseInt(process.env.JWT_ACCESS_TTL_MIN || "15", 10) || 15) * 60;

export interface JwtPayload {
  sub: string; // user id
  username: string;
  role: string;
  iat: number; // issued-at (seconds)
  exp: number; // expiry (seconds)
  [k: string]: unknown;
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url");
}

function sign(data: string): string {
  return crypto.createHmac("sha256", ACCESS_SECRET).update(data).digest("base64url");
}

/** Issue a signed access token for a user. */
export function signAccessToken(user: { id: string; username: string; role: string }): string {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: "HS256", typ: "JWT" };
  const payload: JwtPayload = {
    sub: user.id,
    username: user.username,
    role: user.role,
    iat: nowSec,
    exp: nowSec + ACCESS_TTL_SEC,
  };
  const head = b64url(JSON.stringify(header));
  const body = b64url(JSON.stringify(payload));
  const sig = sign(`${head}.${body}`);
  return `${head}.${body}.${sig}`;
}

/** Verify an access token. Returns the payload, or null if invalid/expired. */
export function verifyAccessToken(token: unknown): JwtPayload | null {
  if (typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [head, body, sig] = parts;

  const expected = sign(`${head}.${body}`);
  // constant-time compare
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: JwtPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof payload.exp !== "number" || Math.floor(Date.now() / 1000) >= payload.exp) return null;
  return payload;
}

/** Pull a bearer token out of an Authorization header. */
export function bearerFromHeader(header: string | undefined): string | null {
  if (!header) return null;
  const m = header.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}
