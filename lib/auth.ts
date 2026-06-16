/**
 * PageScoreIQ — minimal hardcoded-admin authentication.
 *
 * A single admin account guards the dashboard and the audit API. Credentials
 * default to the hardcoded values below but can be overridden with environment
 * variables (recommended for production):
 *
 *   ADMIN_EMAIL      default "admin@pagescore.com"
 *   ADMIN_PASSWORD   default "admin"
 *   AUTH_SECRET      HMAC secret used to sign session cookies (set a long random
 *                    string in Railway → Variables; a dev fallback is used if unset)
 *
 * Sessions are stateless: the cookie carries "<email>|<expiry>" plus an HMAC
 * signature, so no server-side store is needed. Tampering invalidates the HMAC.
 */

import crypto from "crypto";

export const SESSION_COOKIE = "psiq_session";

const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "admin@pagescore.com").trim().toLowerCase();
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";
const SECRET = process.env.AUTH_SECRET || "pagescoreiq-dev-secret-change-me";
const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

/** Constant-time check of the submitted email + password. */
export function checkCredentials(email: unknown, password: unknown): boolean {
  if (typeof email !== "string" || typeof password !== "string") return false;
  const emailOk = safeEqual(email.trim().toLowerCase(), ADMIN_EMAIL);
  const passOk = safeEqual(password, ADMIN_PASSWORD);
  return emailOk && passOk;
}

/** Build a signed, expiring session token for the admin. */
export function createSessionToken(): string {
  const exp = Date.now() + SESSION_TTL_MS;
  const payload = `${ADMIN_EMAIL}|${exp}`;
  const sig = sign(payload);
  return Buffer.from(payload).toString("base64url") + "." + sig;
}

/** Verify a session token: valid signature and not expired. */
export function verifySessionToken(token: unknown): boolean {
  if (typeof token !== "string" || !token.includes(".")) return false;
  const [b64, sig] = token.split(".");
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return false;
  }
  if (!safeEqual(sign(payload), sig)) return false;

  const [, expStr] = payload.split("|");
  const exp = parseInt(expStr, 10);
  return Number.isFinite(exp) && Date.now() < exp;
}

/** Parse a raw Cookie header into a name→value map. */
export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/** Cookie string that sets the session (HttpOnly, SameSite=Lax). */
export function buildSetCookie(token: string): string {
  const maxAge = Math.floor(SESSION_TTL_MS / 1000);
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${maxAge}`;
}

/** Cookie string that clears the session. */
export function buildClearCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`;
}

// ─── internals ────────────────────────────────────────────────────────────────

function sign(payload: string): string {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
