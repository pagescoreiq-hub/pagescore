/**
 * PageScoreIQ — Postgres connection pool (Supabase).
 *
 * One shared pg.Pool for the whole process. Reads DATABASE_URL (the Supabase
 * "Transaction pooler" URI, port 6543) which is ideal for short, stateless
 * queries. SSL is required by Supabase, so it is enabled automatically for any
 * non-local host.
 *
 * Models (lib/models/*) call `query()` / `withTransaction()` — they never touch
 * the pool directly.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from "pg";

let pool: Pool | null = null;

function isLocal(connectionString: string): boolean {
  return /@(localhost|127\.0\.0\.1|::1)[:/]/.test(connectionString);
}

/** Lazily create the shared pool. Throws a clear error if DATABASE_URL is unset. */
export function getPool(): Pool {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set — add your Supabase connection string to .env / Railway variables."
    );
  }

  pool = new Pool({
    connectionString,
    // Supabase requires TLS. rejectUnauthorized:false avoids local CA-chain issues
    // while still encrypting the connection. Disabled for local Postgres.
    ssl: isLocal(connectionString) ? undefined : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });

  pool.on("error", (err) => {
    console.error("[db] idle client error:", err.message);
  });

  return pool;
}

/** True when a usable DATABASE_URL is configured. */
export function isDbConfigured(): boolean {
  return !!process.env.DATABASE_URL;
}

/** Run a parameterised query. Always use $1, $2… placeholders — never string-concat. */
export function query<T extends QueryResultRow = QueryResultRow>(
  text: string,
  params?: unknown[]
): Promise<QueryResult<T>> {
  return getPool().query<T>(text, params as any[]);
}

/** Run several statements in a single transaction. Rolls back on any throw. */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

/** Cheap connectivity probe for /health. */
export async function pingDb(): Promise<boolean> {
  try {
    await query("select 1");
    return true;
  } catch {
    return false;
  }
}

/** Close the pool (graceful shutdown). */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
