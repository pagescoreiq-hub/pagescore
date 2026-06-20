/**
 * Website model — data access for the `websites` table.
 *
 * One row per (user, hostname). `getOrCreate` upserts so repeated audits of the
 * same site reuse the same website row and refresh `last_audited_at`.
 */

import { query } from "../db";

export interface Website {
  id: string;
  user_id: string;
  url: string;
  hostname: string;
  created_at: string;
  last_audited_at: string | null;
}

/** Find an existing website for this user+hostname, or create one. */
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

export async function touchLastAudited(websiteId: string): Promise<void> {
  await query(`update websites set last_audited_at = now() where id = $1`, [websiteId]);
}

export async function listWebsitesForUser(userId: string): Promise<Website[]> {
  const { rows } = await query<Website>(
    `select * from websites where user_id = $1 order by last_audited_at desc nulls last, created_at desc`,
    [userId]
  );
  return rows;
}
