/**
 * Audit history model — data access for the `audit_history` table.
 *
 * Each row is one completed audit run. The full report JSON is stored here
 * (it used to live in R2); R2 now only holds the PDF.
 */

import { query } from "../db";

export type AuditTypeValue = "lp" | "website";

export interface AuditRecord {
  id: string;
  user_id: string;
  website_id: string;
  url: string;
  audit_type: AuditTypeValue;
  overall_score: number;
  grade: string;
  verdict: string | null;
  summary: unknown;
  report: unknown;
  pdf_key: string | null;
  pdf_url: string | null;
  created_at: string;
}

export async function createAuditRecord(input: {
  userId: string;
  websiteId: string;
  url: string;
  auditType: AuditTypeValue;
  overallScore: number;
  grade: string;
  verdict?: string | null;
  summary?: unknown;
  report?: unknown;
  pdfKey?: string | null;
  pdfUrl?: string | null;
}): Promise<AuditRecord> {
  const { rows } = await query<AuditRecord>(
    `insert into audit_history
       (user_id, website_id, url, audit_type, overall_score, grade, verdict, summary, report, pdf_key, pdf_url)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     returning *`,
    [
      input.userId,
      input.websiteId,
      input.url,
      input.auditType,
      input.overallScore,
      input.grade,
      input.verdict ?? null,
      input.summary != null ? JSON.stringify(input.summary) : null,
      input.report != null ? JSON.stringify(input.report) : null,
      input.pdfKey ?? null,
      input.pdfUrl ?? null,
    ]
  );
  return rows[0];
}

/** Recent audits for a user (newest first), without the heavy report JSON. */
export async function listAuditsForUser(
  userId: string,
  limit = 50
): Promise<Omit<AuditRecord, "report">[]> {
  const { rows } = await query<Omit<AuditRecord, "report">>(
    `select id, user_id, website_id, url, audit_type, overall_score, grade, verdict, summary, pdf_key, pdf_url, created_at
       from audit_history
      where user_id = $1
      order by created_at desc
      limit $2`,
    [userId, limit]
  );
  return rows;
}
