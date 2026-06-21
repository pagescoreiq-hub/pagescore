/**
 * PageScoreIQ — subscriptions & plan catalog.
 *
 * Adds the five-tier subscription model (Free · Freelancer · Agency · Enterprise
 * · Ultimate). Plans live in the `plans` table (seeded below) so limits/features
 * can be edited without a redeploy and surfaced on a pricing page. Each user has
 * exactly one row in `subscriptions` holding their current plan, billing period,
 * and the period-scoped usage counters that reset every cycle.
 *
 * Also:
 *   • makes audit_history.website_id NULLABLE — an audit no longer has to be
 *     saved as a Project (Free tier has 0 project slots, so its audits are not
 *     tracked as projects).
 *   • adds per-project re-audit counters to `websites` (the Project table).
 *   • backfills every existing user with a Free subscription.
 *
 * NOTE on limit semantics (mirrors Subscription Plans v1.0):
 *   - monthly_audits / monthly_project_changes / monthly_reaudits_per_project:
 *     NULL means "unlimited" (Ultimate tier).
 *   - `modules` is the set of audit module numbers unlocked on a Full Audit.
 *     Free is restricted to 5 fixed modules; all paid tiers unlock all 12.
 */

/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
exports.shorthands = undefined;

const ALL_MODULES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const FREE_MODULES = [1, 5, 6, 7, 10]; // Security + the 4 shared modules

/**
 * Canonical plan catalog. Seeded into `plans`. Anything not a column lives in the
 * `features` jsonb blob so the shape can grow without further migrations.
 */
const PLANS = [
  {
    id: "free",
    name: "Free",
    rank: 0,
    max_projects: 0,
    monthly_audits: 15,
    monthly_project_changes: 0,
    monthly_reaudits_per_project: 0,
    team_members: 1,
    modules: FREE_MODULES,
    features: {
      bulk_csv: false,
      audit_type_selector: true,
      pdf_export: false,
      white_label_pdf: false,
      shareable_links: false,
      scheduled_email_reports: false,
      ai_assistance: false,
      client_workspaces: false,
      rbac: false,
      monitoring_mode: false,
      monitoring_triggers: [], // 'manual' | 'scheduled'
      monitoring_frequencies: [], // 'daily' | 'weekly' | 'custom'
      gsc_ga4: false,
      zoho_crm: false,
      slack_alerts: false,
      rest_api: "none", // 'none' | 'limited' | 'full'
      zapier_webhooks: false,
      support: "help_docs",
      uptime_sla: "best_effort",
      onboarding: false,
    },
  },
  {
    id: "freelancer",
    name: "Freelancer",
    rank: 1,
    max_projects: 10,
    monthly_audits: 100,
    monthly_project_changes: 3,
    monthly_reaudits_per_project: 5,
    team_members: 2,
    modules: ALL_MODULES,
    features: {
      bulk_csv: true,
      audit_type_selector: true,
      pdf_export: true,
      white_label_pdf: false,
      shareable_links: false,
      scheduled_email_reports: false,
      ai_assistance: false,
      client_workspaces: false,
      rbac: false,
      monitoring_mode: true,
      monitoring_triggers: ["manual"],
      monitoring_frequencies: [],
      gsc_ga4: true,
      zoho_crm: false,
      slack_alerts: false,
      rest_api: "none",
      zapier_webhooks: false,
      support: "email",
      uptime_sla: "99.5",
      onboarding: false,
    },
  },
  {
    id: "agency",
    name: "Agency",
    rank: 2,
    max_projects: 35,
    monthly_audits: 500,
    monthly_project_changes: 10,
    monthly_reaudits_per_project: 10,
    team_members: 5,
    modules: ALL_MODULES,
    features: {
      bulk_csv: true,
      audit_type_selector: true,
      pdf_export: true,
      white_label_pdf: true,
      shareable_links: true,
      scheduled_email_reports: true,
      ai_assistance: true,
      client_workspaces: true,
      rbac: true,
      monitoring_mode: true,
      monitoring_triggers: ["manual", "scheduled"],
      monitoring_frequencies: ["daily", "weekly"],
      gsc_ga4: true,
      zoho_crm: true,
      slack_alerts: true,
      rest_api: "limited",
      zapier_webhooks: false,
      support: "priority",
      uptime_sla: "99.9",
      onboarding: true,
    },
  },
  {
    id: "enterprise",
    name: "Enterprise",
    rank: 3,
    max_projects: 70,
    monthly_audits: 1000,
    monthly_project_changes: 30,
    monthly_reaudits_per_project: 20,
    team_members: 10,
    modules: ALL_MODULES,
    features: {
      bulk_csv: true,
      audit_type_selector: true,
      pdf_export: true,
      white_label_pdf: true,
      shareable_links: true,
      scheduled_email_reports: true,
      ai_assistance: true,
      client_workspaces: true,
      rbac: true,
      monitoring_mode: true,
      monitoring_triggers: ["manual", "scheduled"],
      monitoring_frequencies: ["daily", "weekly"],
      gsc_ga4: true,
      zoho_crm: true,
      slack_alerts: true,
      rest_api: "full",
      zapier_webhooks: true,
      support: "dedicated_csm",
      uptime_sla: "99.99",
      onboarding: true,
    },
  },
  {
    id: "ultimate",
    name: "Ultimate",
    rank: 4,
    max_projects: 100,
    monthly_audits: null, // unlimited
    monthly_project_changes: null, // unlimited
    monthly_reaudits_per_project: null, // unlimited
    team_members: 20,
    modules: ALL_MODULES,
    features: {
      bulk_csv: true,
      audit_type_selector: true,
      pdf_export: true,
      white_label_pdf: true,
      shareable_links: true,
      scheduled_email_reports: true,
      ai_assistance: true,
      client_workspaces: true,
      rbac: true,
      monitoring_mode: true,
      monitoring_triggers: ["manual", "scheduled"],
      monitoring_frequencies: ["daily", "weekly", "custom"],
      gsc_ga4: true,
      zoho_crm: true,
      slack_alerts: true,
      rest_api: "full",
      zapier_webhooks: true,
      support: "dedicated_csm_sla",
      uptime_sla: "99.99",
      onboarding: true,
    },
  },
];

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.up = (pgm) => {
  const createdAt = { type: "timestamptz", notNull: true, default: pgm.func("now()") };

  // ── plans (the tier catalog) ────────────────────────────────────────────────
  pgm.createTable("plans", {
    id: { type: "text", primaryKey: true }, // 'free' | 'freelancer' | ...
    name: { type: "text", notNull: true },
    rank: { type: "integer", notNull: true }, // ordering / tier comparison
    max_projects: { type: "integer", notNull: true },
    monthly_audits: { type: "integer" }, // null = unlimited
    monthly_project_changes: { type: "integer" }, // null = unlimited
    monthly_reaudits_per_project: { type: "integer" }, // null = unlimited
    team_members: { type: "integer", notNull: true, default: 1 },
    modules: { type: "jsonb", notNull: true, default: "[]" }, // unlocked module numbers
    features: { type: "jsonb", notNull: true, default: "{}" }, // feature flags blob
    is_active: { type: "boolean", notNull: true, default: true },
    created_at: createdAt,
    updated_at: createdAt,
  });

  // Seed the five tiers. pgm.sql takes raw SQL, so build the literals by hand
  // (values are static and trusted, but escape quotes defensively anyway).
  const lit = (v) => (v === null || v === undefined ? "null" : `'${String(v).replace(/'/g, "''")}'`);
  const jlit = (v) => `'${JSON.stringify(v).replace(/'/g, "''")}'::jsonb`;
  for (const p of PLANS) {
    pgm.sql(
      `insert into plans
         (id, name, rank, max_projects, monthly_audits, monthly_project_changes,
          monthly_reaudits_per_project, team_members, modules, features)
       values (${lit(p.id)}, ${lit(p.name)}, ${p.rank}, ${p.max_projects},
               ${p.monthly_audits ?? "null"}, ${p.monthly_project_changes ?? "null"},
               ${p.monthly_reaudits_per_project ?? "null"}, ${p.team_members},
               ${jlit(p.modules)}, ${jlit(p.features)})`
    );
  }

  // ── subscriptions (one per user) ────────────────────────────────────────────
  pgm.createTable("subscriptions", {
    id: { type: "uuid", primaryKey: true, default: pgm.func("gen_random_uuid()") },
    user_id: { type: "uuid", notNull: true, references: "users", onDelete: "CASCADE" },
    plan_id: { type: "text", notNull: true, references: "plans", onDelete: "RESTRICT" },
    status: { type: "text", notNull: true, default: "active" }, // active|trialing|past_due|canceled
    current_period_start: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    current_period_end: {
      type: "timestamptz",
      notNull: true,
      default: pgm.func("now() + interval '1 month'"),
    },
    cancel_at_period_end: { type: "boolean", notNull: true, default: false },
    // period-scoped usage counters (reset each billing cycle)
    audits_used: { type: "integer", notNull: true, default: 0 },
    project_changes_used: { type: "integer", notNull: true, default: 0 },
    created_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
    updated_at: { type: "timestamptz", notNull: true, default: pgm.func("now()") },
  });
  pgm.addConstraint("subscriptions", "subscriptions_user_unique", { unique: ["user_id"] });
  pgm.addConstraint("subscriptions", "subscriptions_status_check", {
    check: "status in ('active','trialing','past_due','canceled')",
  });
  pgm.createIndex("subscriptions", "plan_id");

  // ── websites become "Projects": add per-project re-audit tracking ───────────
  pgm.addColumns("websites", {
    reaudits_used: { type: "integer", notNull: true, default: 0 },
    reaudit_period_start: { type: "timestamptz" }, // which billing period reaudits_used counts
  });

  // ── an audit no longer requires a saved Project ─────────────────────────────
  pgm.alterColumn("audit_history", "website_id", { notNull: false });

  // ── backfill: every existing user gets a Free subscription ───────────────────
  pgm.sql(
    `insert into subscriptions (user_id, plan_id)
       select u.id, 'free'
         from users u
    left join subscriptions s on s.user_id = u.id
        where s.id is null`
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
exports.down = (pgm) => {
  // NOTE: re-adding NOT NULL on website_id will fail if any audit rows have a
  // null website_id (audits not tied to a project). Reattach a placeholder is
  // out of scope for a rollback — drop such rows only when rolling back.
  pgm.sql("delete from audit_history where website_id is null");
  pgm.alterColumn("audit_history", "website_id", { notNull: true });

  pgm.dropColumns("websites", ["reaudits_used", "reaudit_period_start"]);
  pgm.dropTable("subscriptions");
  pgm.dropTable("plans");
};
