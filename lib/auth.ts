/**
 * PageScoreIQ — authentication service (DB-backed, JWT).
 *
 * Replaces the old single hardcoded-admin/cookie scheme. Now:
 *   • Users live in Postgres (users table); passwords hashed with scrypt.
 *   • Login/register return a short-lived ACCESS token (JWT, see lib/jwt.ts)
 *     plus a long-lived opaque REFRESH token tracked in user_sessions.
 *   • Clients send `Authorization: Bearer <access>` on every protected request.
 *
 * Environment:
 *   JWT_ACCESS_SECRET    signs access tokens (falls back to AUTH_SECRET)
 *   JWT_ACCESS_TTL_MIN   access lifetime in minutes (default 15)
 *   REFRESH_TTL_DAYS     refresh lifetime in days   (default 30)
 */

import crypto from "crypto";
import { promisify } from "util";
import {
  User,
  PublicUser,
  toPublicUser,
  createUser,
  findUserByEmail,
  findUserById,
  findUserByUsername,
} from "./models/user.model";
import {
  createSession,
  findLiveSessionByHash,
  revokeSessionByHash,
} from "./models/session.model";
import { signAccessToken, ACCESS_TTL_SEC } from "./jwt";

const scrypt = promisify(crypto.scrypt) as (
  password: string,
  salt: string,
  keylen: number
) => Promise<Buffer>;

const REFRESH_TTL_DAYS = parseInt(process.env.REFRESH_TTL_DAYS || "30", 10) || 30;
const REFRESH_TTL_MS = REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Thrown for any expected auth failure; carries an HTTP status. */
export class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number; // access-token lifetime, seconds
}

export interface AuthResult extends AuthTokens {
  user: PublicUser;
}

// ─── password hashing (scrypt) ────────────────────────────────────────────────

/** Hash a password → "scrypt$<saltHex>$<hashHex>". */
async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

/** Constant-time verify of a password against a stored "scrypt$salt$hash". */
async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hashHex) return false;
  const derived = await scrypt(password, salt, 64);
  const expected = Buffer.from(hashHex, "hex");
  return derived.length === expected.length && crypto.timingSafeEqual(derived, expected);
}

// ─── refresh tokens (opaque random, hash stored) ──────────────────────────────

function newRefreshToken(): { token: string; hash: string } {
  const token = crypto.randomBytes(48).toString("base64url");
  const hash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, hash };
}

function hashRefreshToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

async function issueTokens(
  user: User,
  meta?: { userAgent?: string | null; ip?: string | null }
): Promise<AuthTokens> {
  const accessToken = signAccessToken(user);
  const { token: refreshToken, hash } = newRefreshToken();
  await createSession({
    userId: user.id,
    refreshTokenHash: hash,
    expiresAt: new Date(Date.now() + REFRESH_TTL_MS),
    userAgent: meta?.userAgent,
    ip: meta?.ip,
  });
  return { accessToken, refreshToken, expiresIn: ACCESS_TTL_SEC };
}

// ─── validation ───────────────────────────────────────────────────────────────

const USERNAME_RE = /^[a-zA-Z0-9_.-]{3,30}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── public API ───────────────────────────────────────────────────────────────

/** Self-service registration. Returns the new user plus tokens (auto-login). */
export async function register(
  input: { username?: unknown; email?: unknown; password?: unknown },
  meta?: { userAgent?: string | null; ip?: string | null }
): Promise<AuthResult> {
  const username = typeof input.username === "string" ? input.username.trim() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";

  if (!USERNAME_RE.test(username)) {
    throw new AuthError(400, "Username must be 3–30 chars (letters, numbers, . _ -).");
  }
  if (!EMAIL_RE.test(email)) throw new AuthError(400, "A valid email is required.");
  if (password.length < 8) throw new AuthError(400, "Password must be at least 8 characters.");

  if (await findUserByEmail(email)) throw new AuthError(409, "That email is already registered.");
  if (await findUserByUsername(username)) throw new AuthError(409, "That username is taken.");

  const passwordHash = await hashPassword(password);
  let user: User;
  try {
    user = await createUser({ username, email, passwordHash });
  } catch (e: any) {
    // Unique-violation race (two requests at once)
    if (e?.code === "23505") throw new AuthError(409, "That username or email is already taken.");
    throw e;
  }

  const tokens = await issueTokens(user, meta);
  return { user: toPublicUser(user), ...tokens };
}

/** Email + password login. */
export async function login(
  input: { email?: unknown; password?: unknown },
  meta?: { userAgent?: string | null; ip?: string | null }
): Promise<AuthResult> {
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const password = typeof input.password === "string" ? input.password : "";
  if (!email || !password) throw new AuthError(400, "Email and password are required.");

  const user = await findUserByEmail(email);
  // Verify even when the user is missing to keep timing roughly constant.
  const ok = user
    ? await verifyPassword(password, user.password_hash)
    : await verifyPassword(password, "scrypt$0$0").then(() => false);

  if (!user || !ok) throw new AuthError(401, "Invalid email or password.");
  if (!user.is_active) throw new AuthError(403, "This account is disabled.");

  const tokens = await issueTokens(user, meta);
  return { user: toPublicUser(user), ...tokens };
}

/**
 * Exchange a valid refresh token for a new token pair (rotation): the old
 * refresh token is revoked and a fresh one is issued.
 */
export async function refresh(
  refreshToken: unknown,
  meta?: { userAgent?: string | null; ip?: string | null }
): Promise<AuthResult> {
  if (typeof refreshToken !== "string" || !refreshToken) {
    throw new AuthError(401, "Missing refresh token.");
  }
  const hash = hashRefreshToken(refreshToken);
  const session = await findLiveSessionByHash(hash);
  if (!session) throw new AuthError(401, "Session expired — please sign in again.");

  const user = await findUserById(session.user_id);
  if (!user || !user.is_active) throw new AuthError(401, "Account unavailable.");

  // Rotate: kill the presented token, mint a new pair.
  await revokeSessionByHash(hash);
  const tokens = await issueTokens(user, meta);
  return { user: toPublicUser(user), ...tokens };
}

/** Log out: revoke the given refresh token's session. */
export async function logout(refreshToken: unknown): Promise<void> {
  if (typeof refreshToken === "string" && refreshToken) {
    await revokeSessionByHash(hashRefreshToken(refreshToken));
  }
}

/** Look up the current user from an access-token payload's subject. */
export async function getUserById(id: string): Promise<PublicUser | null> {
  const u = await findUserById(id);
  return u ? toPublicUser(u) : null;
}
