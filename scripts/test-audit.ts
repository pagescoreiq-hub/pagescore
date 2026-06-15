/**
 * PageScoreIQ — Standalone CLI Audit Test Runner (v2)
 *
 * Runs all 10 audit modules without starting the full NestJS server.
 * Uses npx tsx (no compile step needed).
 *
 * Usage:
 *   npx tsx scripts/test-audit.ts --url https://example.com
 *   npx tsx scripts/test-audit.ts --url https://example.com --keyword "landing page audit" --headline "Audit Your Page Free"
 *   npx tsx scripts/test-audit.ts --url https://example.com --modules 1,3,5
 *   npx tsx scripts/test-audit.ts --url https://example.com --module 1     (single module)
 */

import { chromium } from "playwright";
import { runFullAudit, FullAuditOptions, FullAuditReport } from "../audit-modules";
import type { AuditItem, ModuleResult } from "../audit-modules";

// ─── CLI argument parsing ─────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };

  const url = get("--url");
  if (!url) {
    console.error("❌  --url is required\n");
    console.error(
      "Usage: npx tsx scripts/test-audit.ts --url https://yourpage.com [--headline 'Ad headline'] [--keyword 'primary keyword'] [--modules 1,3,5]"
    );
    process.exit(1);
  }

  const modulesStr = get("--modules") || get("--module");
  const modules = modulesStr
    ? modulesStr.split(",").map((n) => parseInt(n.trim())).filter((n) => n >= 1 && n <= 10)
    : undefined;

  return {
    url,
    adHeadline: get("--headline"),
    primaryKeyword: get("--keyword"),
    declaredUrl: get("--declared-url"),
    safeBrowsingApiKey: get("--safe-browsing-key") || process.env.SAFE_BROWSING_API_KEY,
    psiApiKey: get("--psi-key") || process.env.PSI_API_KEY,
    modules,
  };
}

// ─── Console output helpers ───────────────────────────────────────────────────

const ICONS = { PASS: "✅", FAIL: "❌", WARN: "⚠️ " } as const;
const COLORS = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
};

function c(color: keyof typeof COLORS, text: string) {
  return `${COLORS[color]}${text}${COLORS.reset}`;
}

function scoreBar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  const color = score >= 80 ? "green" : score >= 60 ? "yellow" : "red";
  return `${c(color, bar)} ${c("bold", String(score).padStart(3))}/100`;
}

function gradeColor(grade: string): string {
  if (grade === "A+" || grade === "A") return c("green", grade);
  if (grade === "B") return c("yellow", grade);
  return c("red", grade);
}

function printModule(mod: ModuleResult, index: number): void {
  const passCount = mod.items.filter((i) => i.status === "PASS").length;
  const failCount = mod.items.filter((i) => i.status === "FAIL").length;
  const warnCount = mod.items.filter((i) => i.status === "WARN").length;

  const impactColors: Record<string, keyof typeof COLORS> = {
    CRITICAL: "red",
    HIGH: "yellow",
    MEDIUM: "cyan",
  };
  const impactColor = impactColors[mod.impact] || "dim";

  console.log(
    `\n${c("bold", `Module ${mod.moduleNumber} — ${mod.moduleName}`)} ${c(impactColor, `[${mod.impact}]`)} ${c("dim", `weight: ${mod.weight}%`)}`
  );
  console.log(
    `  Score: ${scoreBar(mod.score)} ${c("dim", `[${passCount}✅ ${warnCount}⚠️  ${failCount}❌]`)}`
  );

  for (const item of mod.items) {
    const icon = ICONS[item.status];
    const statusColor: keyof typeof COLORS =
      item.status === "PASS" ? "green" : item.status === "FAIL" ? "red" : "yellow";
    console.log(`\n  ${icon}  ${c(statusColor, item.label)}`);
    console.log(`       ${c("dim", item.detail)}`);
    if (item.fix && item.status !== "PASS") {
      const lines = item.fix.split("\n");
      console.log(`       ${c("cyan", "Fix:")} ${lines[0]}`);
      lines.slice(1).forEach((l) => console.log(`             ${c("cyan", l)}`));
    }
  }
}

function printReport(report: FullAuditReport): void {
  const line = "═".repeat(60);

  console.log(`\n${c("bold", line)}`);
  console.log(c("bold", "  PageScoreIQ — Full Audit Report"));
  console.log(c("bold", line));
  console.log(`  URL      : ${c("cyan", report.url)}`);
  console.log(`  Audited  : ${c("dim", report.ranAt)}`);
  console.log(`  Modules  : ${report.modules.length}/10`);
  console.log();

  // Print each module
  for (const mod of report.modules) {
    printModule(mod, mod.moduleNumber);
  }

  // ── Score summary ─────────────────────────────────────────────────────────
  console.log(`\n${c("bold", "═".repeat(60))}`);
  console.log(c("bold", "  SCORE BREAKDOWN"));
  console.log(c("bold", "─".repeat(60)));
  for (const mod of report.modules) {
    const impactColors: Record<string, keyof typeof COLORS> = { CRITICAL: "red", HIGH: "yellow", MEDIUM: "cyan" };
    const col = impactColors[mod.impact] || "dim";
    const label = `  M${String(mod.moduleNumber).padStart(2, "0")} ${mod.moduleName}`.padEnd(42);
    console.log(`${c(col, label)} ${scoreBar(mod.score, 10)} ${c("dim", `(${mod.weight}%)`)} `);
  }
  console.log(c("bold", "─".repeat(60)));
  console.log(
    `  ${"Overall Score".padEnd(40)} ${scoreBar(report.overallScore, 10)}`
  );

  // ── Grade badge ────────────────────────────────────────────────────────────
  console.log(`\n  Grade   : ${gradeColor(report.grade)}   ${c("bold", report.verdict)}`);
  console.log(
    `  Summary : ${c("green", `${report.summary.pass} passed`)}  ${c("yellow", `${report.summary.warn} warnings`)}  ${c("red", `${report.summary.fail} failed`)}  ${c("dim", `(${report.summary.total} total checks)`)}`
  );
  console.log(c("bold", "═".repeat(60)));
  console.log();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();

  console.log(c("bold", "\n🔍  PageScoreIQ — 10-Module Audit Engine"));
  console.log(c("dim", `    URL      : ${args.url}`));
  if (args.adHeadline) console.log(c("dim", `    Headline : ${args.adHeadline}`));
  if (args.primaryKeyword) console.log(c("dim", `    Keyword  : ${args.primaryKeyword}`));
  if (args.modules) console.log(c("dim", `    Modules  : ${args.modules.join(", ")}`));
  console.log();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();

  try {
    console.log(c("dim", "Loading page…"));
    const startTime = Date.now();
    await page.goto(args.url, { waitUntil: "load", timeout: 60_000 });
    // Give JS/analytics a moment to settle after load
    await page.waitForTimeout(2000);
    const loadMs = Date.now() - startTime;
    console.log(c("green", `Page loaded in ${(loadMs / 1000).toFixed(2)}s.\n`));

    const auditOptions: FullAuditOptions = {
      url: args.url,
      adHeadline: args.adHeadline,
      primaryKeyword: args.primaryKeyword,
      declaredUrl: args.declaredUrl,
      safeBrowsingApiKey: args.safeBrowsingApiKey,
      psiApiKey: args.psiApiKey,
      modules: args.modules,
    };

    console.log(c("dim", `Running ${args.modules ? args.modules.length : 10} module(s)…`));
    const report = await runFullAudit(page, auditOptions);

    printReport(report);
  } catch (err: any) {
    console.error(c("red", `\n❌  Audit failed: ${err.message}`));
    console.error(err.stack);
    process.exit(1);
  } finally {
    await context.close();
    await browser.close();
  }
}

main();
