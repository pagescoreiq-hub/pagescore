/**
 * Website model — data access for the `websites` table.
 *
 * A `website` row IS a saved **Project** (a persistent allocation that occupies
 * one of the plan's project slots). One row per (user, hostname). Auditing a URL
 * does not by itself create a project — projects are created explicitly and are
 * gated by the plan's slot count + monthly add/delete allowance (see
 * lib/subscription.ts). Re-auditing a project consumes the per-project re-audit
 * allowance, tracked here via `reaudits_used` / `reaudit_period_start`.
 */

import { query } from "../db";

export interface Website {
  id: string;
  user_id: string;
  url: string;
  hostname: string;
  reaudits_used: number;
  reaudit_period_start: string | null;
  created_at: string;
  last_audited_at: string | null;
}

/** Find an existing project for this user+hostname, or create one. */
export async function getOrCreateWebsite(input: {
  userId: string;
  url: string;
  hostname: string;
}): Promise<Website> {
  const { rows } = await query<Website>(
    `insert into websites (user_id, url, hostname)
     values ($1, $2, $3)
     on conflict (user_id, hostname)
       do update set url = excluded.url
     returning *`,
    [input.userId, input.url, input.hostname]
  );
  return rows[0];
}

/** Look up a project by user + hostname (null if not saved as a project). */
export async function findWebsiteByHostname(
  userId: string,
  hostname: string
): Promise<Website | null> {
  const { rows } = await query<Website>(
    `select * from websites where user_id = $1 and hostname = $2 limit 1`,
    [userId, hostname]
  );
  return rows[0] ?? null;
}

export async function findWebsiteById(userId: string, id: string): Promise<Website | null> {
  const { rows } = await query<Website>(
    `select * from websites where id = $1 and user_id = $2 limit 1`,
    [id, userId]
  );
  return rows[0] ?? null;
}

/** Number of active project slots in use by this user. */
export async function countProjectsForUser(userId: string): Promise<number> {
  const { rows } = await query<{ count: string }>(
    `select count(*)::text as count from websites where user_id = $1`,
    [userId]
  );
  return parseInt(rows[0]?.count ?? "0", 10);
}

/** Delete a project (frees a slot). Returns true if a row was removed. */
export async function deleteWebsite(userId: string, id: string): Promise<boolean> {
  const { rowCount } = await query(`delete from websites where id = $1 and user_id = $2`, [
    id,
    userId,
  ]);
  return (rowCount ?? 0) > 0;
}

export async function touchLastAudited(websiteId: string): Promise<void> {
  await query(`update websites set last_audited_at = now() where id = $1`, [websiteId]);
}

/**
 * Effective re-audits used for a project in the given billing period. Returns 0
 * when the project's counter belongs to an earlier period (it will reset on the
 * next consume).
 */
export async function getReauditUsage(
  websiteId: string,
  periodStart: string | Date
): Promise<number> {
  const { rows } = await query<{ reaudits_used: number; reaudit_period_start: string | Date | null }>(
    `select reaudits_used, reaudit_period_start from websites where id = $1`,
    [websiteId]
  );
  const row = rows[0];
  if (!row || !row.reaudit_period_start) return 0;
  // pg returns timestamptz as Date objects — compare by epoch value, not identity.
  const stored = new Date(row.reaudit_period_start).getTime();
  const current = new Date(periodStart).getTime();
  return stored === current ? row.reaudits_used : 0;
}

/** Consume one re-audit for a project, resetting the counter on a new period. */
export async function consumeReaudit(
  websiteId: string,
  periodStart: string | Date
): Promise<number> {
  const { rows } = await query<{ reaudits_used: number }>(
    `update websites
        set reaudits_used = case
              when reaudit_period_start is distinct from $2 then 1
              else reaudits_used + 1
            end,
            reaudit_period_start = $2
      where id = $1
      returning reaudits_used`,
    [websiteId, periodStart]
  );
  return rows[0]?.reaudits_used ?? 0;
}

export async function listWebsitesForUser(userId: string): Promise<Website[]> {
  const { rows } = await query<Website>(
    `select * from websites where user_id = $1 order by last_audited_at desc nulls last, created_at desc`,
    [userId]
  );
  return rows;
}
