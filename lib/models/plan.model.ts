/**
 * Plan model — data access for the `plans` table (the tier catalog).
 *
 * Plans are seeded by the subscriptions migration. This module only reads them;
 * limits/features are interpreted by lib/subscription.ts.
 */

import { query } from "../db";

export type PlanId = "free" | "freelancer" | "agency" | "enterprise" | "ultimate";

export type RestApiAccess = "none" | "limited" | "full";

/** Feature-flag blob stored in `plans.features` (jsonb). */
export interface PlanFeatures {
  bulk_csv: boolean;
  audit_type_selector: boolean;
  pdf_export: boolean;
  white_label_pdf: boolean;
  shareable_links: boolean;
  scheduled_email_reports: boolean;
  ai_assistance: boolean;
  client_workspaces: boolean;
  rbac: boolean;
  monitoring_mode: boolean;
  monitoring_triggers: ("manual" | "scheduled")[];
  monitoring_frequencies: ("daily" | "weekly" | "custom")[];
  gsc_ga4: boolean;
  zoho_crm: boolean;
  slack_alerts: boolean;
  rest_api: RestApiAccess;
  zapier_webhooks: boolean;
  support: string;
  uptime_sla: string;
  onboarding: boolean;
}

export interface Plan {
  id: PlanId;
  name: string;
  rank: number;
  max_projects: number;
  /** null = unlimited */
  monthly_audits: number | null;
  /** null = unlimited */
  monthly_project_changes: number | null;
  /** null = unlimited */
  monthly_reaudits_per_project: number | null;
  team_members: number;
  /** audit module numbers unlocked on a Full Audit */
  modules: number[];
  features: PlanFeatures;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export async function findPlanById(id: string): Promise<Plan | null> {
  const { rows } = await query<Plan>(`select * from plans where id = $1 limit 1`, [id]);
  return rows[0] ?? null;
}

/** All active plans, cheapest → most expensive (for a pricing page). */
export async function listPlans(): Promise<Plan[]> {
  const { rows } = await query<Plan>(
    `select * from plans where is_active = true order by rank asc`
  );
  return rows;
}
