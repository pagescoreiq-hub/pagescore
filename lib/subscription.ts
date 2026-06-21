/**
 * PageScoreIQ — subscription service (plans, usage, enforcement).
 *
 * Sits on top of the plan/subscription models and encodes the business rules of
 * the five-tier model:
 *
 *   • Every user has exactly one subscription (lazily created on the Free plan).
 *   • Billing periods roll forward automatically (no cron): the first call in a
 *     new period zeroes the period-scoped counters.
 *   • Audits, project add/delete, and per-project re-audits are monthly
 *     allowances; `null` on a plan means unlimited.
 *   • Projects are persistent slots, capped by `plan.max_projects`.
 *   • A `null` limit anywhere means unlimited.
 *
 * Server handlers call the check/consume helpers; they throw SubscriptionError
 * (carrying an HTTP status) when a limit is hit.
 */

import {
  findPlanById,
  listPlans,
  type Plan,
  type PlanFeatures,
  type PlanId,
} from "./models/plan.model";
import {
  findSubscriptionByUserId,
  createSubscription,
  updateSubscriptionPlan,
  resetSubscriptionPeriod,
  incrementUsage,
  type Subscription,
} from "./models/subscription.model";
import {
  findWebsiteByHostname,
  findWebsiteById,
  countProjectsForUser,
  getOrCreateWebsite,
  deleteWebsite,
  getReauditUsage,
  consumeReaudit,
  type Website,
} from "./models/website.model";
import { AUDIT_TYPE_MODULES, type AuditType } from "../audit-modules/types";

/** Thrown for any expected subscription/quota failure; carries an HTTP status. */
export class SubscriptionError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
    this.name = "SubscriptionError";
  }
}

export interface ActiveSubscription {
  subscription: Subscription;
  plan: Plan;
}

/** True when a limit is "unlimited" (stored as null). */
const isUnlimited = (n: number | null): n is null => n === null;

/** Add one calendar month to a date (clamps to month end, e.g. Jan 31 → Feb 28). */
function addMonth(d: Date): Date {
  const next = new Date(d);
  const day = next.getDate();
  next.setMonth(next.getMonth() + 1);
  if (next.getDate() < day) next.setDate(0); // overflowed into the following month
  return next;
}

/**
 * Get the user's subscription + plan, creating a Free one if missing and rolling
 * the billing period forward if it has elapsed.
 */
export async function getActiveSubscription(userId: string): Promise<ActiveSubscription> {
  let subscription =
    (await findSubscriptionByUserId(userId)) ??
    (await createSubscription({ userId, planId: "free" }));

  // Roll any elapsed periods forward, resetting period-scoped counters.
  const now = Date.now();
  if (new Date(subscription.current_period_end).getTime() <= now) {
    let start = new Date(subscription.current_period_end);
    let end = addMonth(start);
    while (end.getTime() <= now) {
      start = end;
      end = addMonth(end);
    }
    subscription = (await resetSubscriptionPeriod(userId, start, end)) ?? subscription;
  }

  const plan = await findPlanById(subscription.plan_id);
  if (!plan) {
    // Plan was removed from the catalog — fall back to Free so the app keeps working.
    const free = await findPlanById("free");
    if (!free) throw new SubscriptionError(500, "No plans are configured.");
    return { subscription, plan: free };
  }
  return { subscription, plan };
}

// ─── feature gating ───────────────────────────────────────────────────────────

export function hasFeature(plan: Plan, key: keyof PlanFeatures): boolean {
  return plan.features[key] === true;
}

export function requireFeature(plan: Plan, key: keyof PlanFeatures, label: string): void {
  if (!hasFeature(plan, key)) {
    throw new SubscriptionError(
      403,
      `${label} is not available on the ${plan.name} plan. Upgrade to unlock it.`,
      "feature_locked"
    );
  }
}

// ─── module gating ────────────────────────────────────────────────────────────

/**
 * Resolve the module numbers that should actually run: the audit-type set,
 * narrowed to the plan's unlocked modules, and (if the caller asked for specific
 * modules) to that request. Throws if nothing remains.
 */
export function resolveAuditModules(
  plan: Plan,
  auditType: AuditType,
  requested?: number[]
): number[] {
  const typeSet = AUDIT_TYPE_MODULES[auditType];
  const base = requested && requested.length ? requested : typeSet;
  const allowed = base.filter((m) => typeSet.includes(m) && plan.modules.includes(m));
  const unique = [...new Set(allowed)].sort((a, b) => a - b);
  if (unique.length === 0) {
    throw new SubscriptionError(
      403,
      `No audit modules are available for this audit on the ${plan.name} plan.`,
      "modules_locked"
    );
  }
  return unique;
}

// ─── audit / re-audit allowance ───────────────────────────────────────────────

export interface AuditAllowance {
  /** The matching saved project, if this URL is one (=> a re-audit). */
  project: Website | null;
  isReaudit: boolean;
}

/**
 * Check whether the user may run an audit for `hostname`. Auditing a saved
 * project is a re-audit (per-project allowance); auditing any other URL draws on
 * the monthly audits pool. Throws SubscriptionError(402) when exhausted.
 */
export async function checkAuditAllowance(
  active: ActiveSubscription,
  userId: string,
  hostname: string
): Promise<AuditAllowance> {
  const { subscription, plan } = active;
  const project = await findWebsiteByHostname(userId, hostname);

  if (project) {
    const limit = plan.monthly_reaudits_per_project;
    if (!isUnlimited(limit)) {
      const used = await getReauditUsage(project.id, subscription.current_period_start);
      if (used >= limit) {
        throw new SubscriptionError(
          402,
          `Monthly re-audit limit reached for this project (${limit}/month on ${plan.name}).`,
          "reaudit_limit"
        );
      }
    }
    return { project, isReaudit: true };
  }

  const limit = plan.monthly_audits;
  if (!isUnlimited(limit) && subscription.audits_used >= limit) {
    throw new SubscriptionError(
      402,
      `Monthly audit limit reached (${limit}/month on ${plan.name}).`,
      "audit_limit"
    );
  }
  return { project: null, isReaudit: false };
}

/** Record one consumed audit/re-audit after a successful run. Best-effort. */
export async function consumeAuditAllowance(
  active: ActiveSubscription,
  userId: string,
  allowance: AuditAllowance
): Promise<void> {
  if (allowance.isReaudit && allowance.project) {
    await consumeReaudit(allowance.project.id, active.subscription.current_period_start);
  } else {
    await incrementUsage(userId, "audits_used");
  }
}

// ─── projects (persistent slots + monthly add/delete allowance) ───────────────

/** Create a saved project, enforcing slot count + monthly add/delete allowance. */
export async function createProjectForUser(
  userId: string,
  input: { url: string; hostname: string }
): Promise<Website> {
  const { subscription, plan } = await getActiveSubscription(userId);

  const existing = await findWebsiteByHostname(userId, input.hostname);
  if (existing) return existing; // idempotent — already a project, no slot consumed

  if (plan.max_projects <= 0) {
    throw new SubscriptionError(
      403,
      `The ${plan.name} plan does not include saved projects. Upgrade to add projects.`,
      "no_projects"
    );
  }
  const inUse = await countProjectsForUser(userId);
  if (inUse >= plan.max_projects) {
    throw new SubscriptionError(
      403,
      `Project limit reached (${plan.max_projects} slots on ${plan.name}). Delete a project to free a slot.`,
      "project_slots"
    );
  }
  const changeLimit = plan.monthly_project_changes;
  if (!isUnlimited(changeLimit) && subscription.project_changes_used >= changeLimit) {
    throw new SubscriptionError(
      402,
      `Monthly project add/delete limit reached (${changeLimit}/month on ${plan.name}).`,
      "project_changes"
    );
  }

  const project = await getOrCreateWebsite({ userId, url: input.url, hostname: input.hostname });
  await incrementUsage(userId, "project_changes_used");
  return project;
}

/** Delete a saved project, consuming one monthly add/delete allowance. */
export async function deleteProjectForUser(userId: string, projectId: string): Promise<void> {
  const { subscription, plan } = await getActiveSubscription(userId);
  const project = await findWebsiteById(userId, projectId);
  if (!project) throw new SubscriptionError(404, "Project not found.", "not_found");

  const changeLimit = plan.monthly_project_changes;
  if (!isUnlimited(changeLimit) && subscription.project_changes_used >= changeLimit) {
    throw new SubscriptionError(
      402,
      `Monthly project add/delete limit reached (${changeLimit}/month on ${plan.name}).`,
      "project_changes"
    );
  }

  await deleteWebsite(userId, projectId);
  await incrementUsage(userId, "project_changes_used");
}

// ─── plan management ──────────────────────────────────────────────────────────

export async function changePlan(userId: string, planId: string): Promise<ActiveSubscription> {
  const plan = await findPlanById(planId);
  if (!plan || !plan.is_active) {
    throw new SubscriptionError(400, `Unknown plan: "${planId}".`, "unknown_plan");
  }
  // Ensure a subscription exists, then switch it (keeps the current period).
  await getActiveSubscription(userId);
  const subscription = await updateSubscriptionPlan(userId, plan.id as PlanId);
  if (!subscription) throw new SubscriptionError(500, "Failed to update subscription.");
  return { subscription, plan };
}

export { listPlans };

// ─── usage summary (for the API) ──────────────────────────────────────────────

export interface UsageSummary {
  plan: {
    id: PlanId;
    name: string;
    rank: number;
    max_projects: number;
    team_members: number;
    modules: number[];
    features: PlanFeatures;
  };
  status: string;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  cancelAtPeriodEnd: boolean;
  usage: {
    audits: { used: number; limit: number | null; remaining: number | null };
    projectChanges: { used: number; limit: number | null; remaining: number | null };
    projects: { used: number; limit: number };
  };
}

export async function getUsageSummary(userId: string): Promise<UsageSummary> {
  const { subscription, plan } = await getActiveSubscription(userId);
  const projectsUsed = await countProjectsForUser(userId);

  const remaining = (used: number, limit: number | null) =>
    isUnlimited(limit) ? null : Math.max(0, limit - used);

  return {
    plan: {
      id: plan.id,
      name: plan.name,
      rank: plan.rank,
      max_projects: plan.max_projects,
      team_members: plan.team_members,
      modules: plan.modules,
      features: plan.features,
    },
    status: subscription.status,
    currentPeriodStart: subscription.current_period_start,
    currentPeriodEnd: subscription.current_period_end,
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
    usage: {
      audits: {
        used: subscription.audits_used,
        limit: plan.monthly_audits,
        remaining: remaining(subscription.audits_used, plan.monthly_audits),
      },
      projectChanges: {
        used: subscription.project_changes_used,
        limit: plan.monthly_project_changes,
        remaining: remaining(subscription.project_changes_used, plan.monthly_project_changes),
      },
      projects: { used: projectsUsed, limit: plan.max_projects },
    },
  };
}
