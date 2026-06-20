/**
 * User model — data access for the `users` table.
 *
 * Plain pg queries (no ORM). Password hashing lives in lib/auth.ts; this module
 * only stores/reads the already-hashed value.
 */

import { query } from "../db";

export interface User {
  id: string;
  username: string;
  email: string;
  password_hash: string;
  role: "user" | "admin";
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** A user safe to return to clients (no password hash). */
export type PublicUser = Omit<User, "password_hash">;

export function toPublicUser(u: User): PublicUser {
  const { password_hash, ...rest } = u;
  return rest;
}

export async function createUser(input: {
  username: string;
  email: string;
  passwordHash: string;
  role?: "user" | "admin";
}): Promise<User> {
  const { rows } = await query<User>(
    `insert into users (username, email, password_hash, role)
     values ($1, $2, $3, coalesce($4, 'user'))
     returning *`,
    [input.username, input.email, input.passwordHash, input.role ?? null]
  );
  return rows[0];
}

export async function findUserByEmail(email: string): Promise<User | null> {
  const { rows } = await query<User>(
    `select * from users where email = $1 limit 1`,
    [email.trim().toLowerCase()]
  );
  return rows[0] ?? null;
}

export async function findUserByUsername(username: string): Promise<User | null> {
  const { rows } = await query<User>(
    `select * from users where username = $1 limit 1`,
    [username]
  );
  return rows[0] ?? null;
}

export async function findUserById(id: string): Promise<User | null> {
  const { rows } = await query<User>(`select * from users where id = $1 limit 1`, [id]);
  return rows[0] ?? null;
}
