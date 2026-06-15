/**
 * PageScoreIQ - Audit Module Index (v2)
 *
 * All 10 audit modules + full composite runner.
 *
 * Module weights (sum to 100%):
 *   1  Security & Malware        15%  CRITICAL
 *   2  URL & Redirect            12%  CRITICAL
 *   3  Tracking & Tags           12%  HIGH
 *   4  Content & Ad Policy       12%  CRITICAL
 *   5  Page Structure             8%  HIGH
 *   6  Page Speed & CWV           8%  HIGH
 *   7  Mobile & Design            5%  MEDIUM
 *   8  Legal & Privacy            5%  HIGH
 *   9  Conversion & UX            8%  MEDIUM
 *  10  HTML & Form Validation    15%  CRITICAL
 */

import { Page } from "playwright";

// Shared types
export type { AuditStatus, AuditItem, ModuleResult } from "./types";
export { MODULE_WEIGHTS } from "./types";

// Individual module runners
export { auditSecurityMalware } from "./m1-security-malware.audit";
export { auditUrlRedirect } from "./m2-url-redirect.audit";
export { auditTrackingTags } from "./m3-tracking-tags.audit";
export { auditContentPolicy } from "./m4-content-policy.audit";
export { auditPageStructure } from "./m5-page-structure.audit";
export { auditPageSpeed } from "./m6-page-speed.audit";
export { auditMobileDesign } from "./m7-mobile-design.audit";
export { auditLegalPrivacy } from "./m8-legal-privacy.audit";
export { auditConversionUx } from "./m9-conversion-ux.audit";
export { auditHtmlForm } from "./m10-html-form.audit";

// Legacy exports (backward compatibility)
export { auditLeadForm } from "./form-validation.audit";
export { auditUtmCapturing } from "./utm-capturing.audit";
export { auditHtmlStructure } from "./html-structure.audit";
export type { FormAuditResult } from "./form-validation.audit";
export type { UtmAuditResult } from "./utm-capturing.audit";
export type { HtmlStructureAuditResult, HtmlStructureAuditOptions } from "./html-structure.audit";

import type { ModuleResult } from "./types";

// Full audit options
export interface FullAuditOptions {
  url: string;
  adHeadline?: string;
  primaryKeyword?: string;
  declaredUrl?: string;
  safeBrowsingApiKey?: string;
  psiApiKey?: string;
  modules?: number[];
}

export type GradeLabel = "A+" | "A" | "B" | "C" | "D" | "F";

export interface FullAuditReport {
  url: string;
  ranAt: string;
  overallScore: number;
  grade: GradeLabel;
  verdict: string;
  modules: ModuleResult[];
  summary: { pass: number; warn: number; fail: number; total: number; };
}

// Grade scale
function toGrade(score: number): { grade: GradeLabel; verdict: string } {
  if (score >= 90) return { grade: "A+", verdict: "Safe to launch - minimal risk of suspension." };
  if (score >= 80) return { grade: "A",  verdict: "Good - fix warnings before scaling spend." };
  if (score >= 70) return { grade: "B",  verdict: "Proceed with caution - some issues present." };
  if (score >= 60) return { grade: "C",  verdict: "High risk - fix critical items before launch." };
  return { grade: score >= 50 ? "D" : "F", verdict: "DO NOT LAUNCH - campaign will likely be suspended." };
}

// Full 10-module audit runner
export async function runFullAudit(
  page: Page,
  options: FullAuditOptions
): Promise<FullAuditReport> {
  const { auditSecurityMalware } = await import("./m1-security-malware.audit");
  const { auditUrlRedirect } = await import("./m2-url-redirect.audit");
  const { auditTrackingTags } = await import("./m3-tracking-tags.audit");
  const { auditContentPolicy } = await import("./m4-content-policy.audit");
  const { auditPageStructure } = await import("./m5-page-structure.audit");
  const { auditPageSpeed } = await import("./m6-page-speed.audit");
  const { auditMobileDesign } = await import("./m7-mobile-design.audit");
  const { auditLegalPrivacy } = await import("./m8-legal-privacy.audit");
  const { auditConversionUx } = await import("./m9-conversion-ux.audit");
  const { auditHtmlForm } = await import("./m10-html-form.audit");

  const enabled = new Set(options.modules ?? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const results: ModuleResult[] = [];

  if (enabled.has(1)) results.push(await auditSecurityMalware(page, { safeBrowsingApiKey: options.safeBrowsingApiKey }));
  if (enabled.has(2)) results.push(await auditUrlRedirect(page, { declaredUrl: options.declaredUrl ?? options.url }));
  if (enabled.has(3)) results.push(await auditTrackingTags(page));
  if (enabled.has(4)) results.push(await auditContentPolicy(page, { primaryKeyword: options.primaryKeyword, adHeadline: options.adHeadline }));
  if (enabled.has(5)) results.push(await auditPageStructure(page, { primaryKeyword: options.primaryKeyword, adHeadline: options.adHeadline }) as ModuleResult);
  if (enabled.has(6)) results.push(await auditPageSpeed(page, { psiApiKey: options.psiApiKey }));
  if (enabled.has(7)) results.push(await auditMobileDesign(page));
  if (enabled.has(8)) results.push(await auditLegalPrivacy(page));
  if (enabled.has(9)) results.push(await auditConversionUx(page));
  if (enabled.has(10)) results.push(await auditHtmlForm(page));

  const totalWeight = results.reduce((sum, m) => sum + m.weight, 0);
  const overallScore = Math.round(results.reduce((sum, m) => sum + m.score * (m.weight / totalWeight), 0));
  const allItems = results.flatMap((m) => m.items);
  const summary = {
    pass: allItems.filter((i) => i.status === "PASS").length,
    warn: allItems.filter((i) => i.status === "WARN").length,
    fail: allItems.filter((i) => i.status === "FAIL").length,
    total: allItems.length,
  };
  const { grade, verdict } = toGrade(overallScore);

  return { url: options.url, ranAt: new Date().toISOString(), overallScore, grade, verdict, modules: results, summary };
}

// Legacy 3-module runner (backward compatibility)
export interface PageValidationAuditOptions {
  url: string;
  adHeadline?: string;
  primaryKeyword?: string;
}
export interface PageValidationAuditResults {
  url: string;
  ranAt: string;
  compositeScore: number;
  formValidation: import("./form-validation.audit").FormAuditResult;
  utmCapturing: import("./utm-capturing.audit").UtmAuditResult;
  htmlStructure: import("./html-structure.audit").HtmlStructureAuditResult;
}

export async function runPageValidationAudit(
  page: Page,
  options: PageValidationAuditOptions
): Promise<PageValidationAuditResults> {
  const { auditLeadForm } = await import("./form-validation.audit");
  const { auditUtmCapturing } = await import("./utm-capturing.audit");
  const { auditHtmlStructure } = await import("./html-structure.audit");
  const [formResult, htmlResult] = await Promise.all([
    auditLeadForm(page),
    auditHtmlStructure(page, { adHeadline: options.adHeadline, primaryKeyword: options.primaryKeyword }),
  ]);
  const utmResult = await auditUtmCapturing(page, options.url);
  const compositeScore = Math.round(formResult.score * 0.4 + utmResult.score * 0.25 + htmlResult.score * 0.35);
  return { url: options.url, ranAt: new Date().toISOString(), formValidation: formResult, utmCapturing: utmResult, htmlStructure: htmlResult, compositeScore };
}
