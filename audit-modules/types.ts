/**
 * PageScoreIQ — Shared Audit Types
 *
 * Used by all 10 audit modules for consistent typing.
 */

export type AuditStatus = "PASS" | "FAIL" | "WARN";

export interface AuditItem {
  id: string;
  label: string;
  status: AuditStatus;
  detail: string;
  fix?: string;
}

export interface ModuleResult {
  /** Unique module key */
  module: string;
  /** Module number 1–10 */
  moduleNumber: number;
  /** Module display name */
  moduleName: string;
  /** Percentage weight in the overall composite score */
  weight: number;
  /** Module impact level */
  impact: "CRITICAL" | "HIGH" | "MEDIUM";
  /** Audit checklist results */
  items: AuditItem[];
  /** Module score 0–100 */
  score: number;
}

// ─── Score weight map (must sum to 100) ──────────────────────────────────────

export const MODULE_WEIGHTS: Record<number, number> = {
  1: 15, // Security & Malware
  2: 12, // URL & Redirect Compliance
  3: 12, // Tracking & Tag Verification
  4: 12, // Content & Ad Policy
  5: 8,  // Page Structure & Headings
  6: 8,  // Page Speed & Core Web Vitals
  7: 5,  // Mobile & Design
  8: 5,  // Legal & Privacy
  9: 8,  // Conversion & UX Quality
  10: 15, // HTML & Form Validation
};

// ─── Dual audit types (Landing Page vs Website) ──────────────────────────────
//
// The user picks an audit purpose; each runs only its relevant modules with
// purpose-specific weights (PRD v2.0 §3 & §5). Both weight maps sum to 100.

export type AuditType = "lp" | "website";

/** Which module numbers run for each audit type. */
export const AUDIT_TYPE_MODULES: Record<AuditType, number[]> = {
  lp:      [1, 2, 3, 4, 5, 6, 7, 9, 10],          // 9 modules · LP-focused
  website: [1, 5, 6, 7, 8, 10, 11, 12],           // 8 modules · site health
};

/** Per-type scoring weights, keyed by module number (each map sums to 100). */
export const AUDIT_TYPE_WEIGHTS: Record<AuditType, Record<number, number>> = {
  lp: {
    1: 10,  // Security & Malware
    2: 14,  // URL & Redirect Compliance
    3: 14,  // Tracking & Tag Verification
    4: 14,  // Content & Ad Policy
    5: 8,   // Page Structure & Headings
    6: 8,   // Page Speed & Core Web Vitals
    7: 6,   // Mobile & Design Compliance
    9: 10,  // Conversion & UX Quality
    10: 16, // HTML & Form Validation
  },
  website: {
    1: 12,  // Security & Malware
    5: 10,  // Page Structure & Headings
    6: 10,  // Page Speed & Core Web Vitals
    7: 8,   // Mobile & Design Compliance
    8: 10,  // Legal & Privacy Compliance
    10: 14, // HTML & Form Validation
    11: 18, // Technical SEO
    12: 18, // Domain & Server Health
  },
};

export const DEFAULT_AUDIT_TYPE: AuditType = "lp";

/** Narrow an arbitrary value to a valid AuditType (defaults to "lp"). */
export function normalizeAuditType(value: unknown): AuditType {
  return value === "website" ? "website" : "lp";
}

// ─── Helpers (shared by all modules) ─────────────────────────────────────────

export function pass(id: string, label: string, detail: string): AuditItem {
  return { id, label, status: "PASS", detail };
}

export function fail(id: string, label: string, detail: string, fix: string): AuditItem {
  return { id, label, status: "FAIL", detail, fix };
}

export function warn(id: string, label: string, detail: string, fix: string): AuditItem {
  return { id, label, status: "WARN", detail, fix };
}

/** Score = (passes + warns*0.5) / total * 100 */
export function calcScore(items: AuditItem[]): number {
  if (items.length === 0) return 0;
  const fails = items.filter((i) => i.status === "FAIL").length;
  const warns = items.filter((i) => i.status === "WARN").length;
  return Math.max(0, Math.round(((items.length - fails - warns * 0.5) / items.length) * 100));
}
