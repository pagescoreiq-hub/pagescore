/**
 * Subscription model — data access for the `subscriptions` table.
 *
 * One row per user. Holds the current plan, billing period, and the
 * period-scoped usage counters. Period rolling + enforcement live in
 * lib/subscription.ts; this module is pure persistence.
 */

import { query } from "../db";
import type { PlanId } from "./plan.model";

export type SubscriptionStatus = "active" | "trialing" | "past_due" | "canceled";

export interface Subscription {
  id: string;
  user_id: string;
  plan_id: PlanId;
  status: SubscriptionStatus;
  current_period_start: string;
  current_period_end: string;
  cancel_at_period_end: boolean;
  audits_used: number;
  project_changes_used: number;
  created_at: string;
  updated_at: string;
}

export async function findSubscriptionByUserId(userId: string): Promise<Subscription | null> {
  const { rows } = await query<Subscription>(
    `select * from subscriptions where user_id = $1 limit 1`,
    [userId]
  );
  return rows[0] ?? null;
}

/** Create a subscription (defaults to the Free plan). Period = now → now + 1 month. */
export async function createSubscription(input: {
  userId: string;
  planId?: PlanId;
}): Promise<Subscription> {
  const { rows } = await query<Subscription>(
    `insert into subscriptions (user_id, plan_id)
     values ($1, coalesce($2, 'free'))
     on conflict (user_id) do nothing
     returning *`,
    [input.userId, input.planId ?? null]
  );
  // on conflict → row already existed; fetch it.
  if (rows[0]) return rows[0];
  return (await findSubscriptionByUserId(input.userId))!;
}

/** Switch the plan, keeping the existing billing period and counters. */
export async function updateSubscriptionPlan(
  userId: string,
  planId: PlanId
): Promise<Subscription | null> {
  const { rows } = await query<Subscription>(
    `update subscriptions
        set plan_id = $2, status = 'active', updated_at = now()
      where user_id = $1
      returning *`,
    [userId, planId]
  );
  return rows[0] ?? null;
}

/** Roll the billing period forward and zero the period-scoped counters. */
export async function resetSubscriptionPeriod(
  userId: string,
  newPeriodStart: Date,
  newPeriodEnd: Date
): Promise<Subscription | null> {
  const { rows } = await query<Subscription>(
    `update subscriptions
        set current_period_start = $2,
            current_period_end   = $3,
            audits_used = 0,
            project_changes_used = 0,
            updated_at = now()
      where user_id = $1
      returning *`,
    [userId, newPeriodStart.toISOString(), newPeriodEnd.toISOString()]
  );
  return rows[0] ?? null;
}

/** Atomically bump a usage counter and return the new row. */
export async function incrementUsage(
  userId: string,
  field: "audits_used" | "project_changes_used",
  by = 1
): Promise<Subscription | null> {
  const { rows } = await query<Subscription>(
    `update subscriptions
        set ${field} = ${field} + $2, updated_at = now()
      where user_id = $1
      returning *`,
    [userId, by]
  );
  return rows[0] ?? null;
}
