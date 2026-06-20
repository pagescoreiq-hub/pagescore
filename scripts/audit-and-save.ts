/**
 * PageScoreIQ — Audit + Save to Cloudflare R2
 *
 * Runs the full 10-module audit for a URL, then uploads the report (JSON + HTML)
 * to Cloudflare R2 and prints the shareable links.
 *
 * Usage:
 *   npx tsx scripts/audit-and-save.ts --url https://example.com
 *   npx tsx scripts/audit-and-save.ts --url https://example.com --keyword "luxury flats" --headline "Book Now"
 *   npx tsx scripts/audit-and-save.ts --url https://example.com --modules 1,3,10
 *   npx tsx scripts/audit-and-save.ts --url https://example.com --no-save   (skip R2, just audit)
 *
 * R2 credentials are read from environment variables — see lib/r2-storage.ts.
 * Put them in a local .env (loaded automatically by tsx) or your shell.
 */

import { chromium } from "playwright";
import { runFullAudit, FullAuditOptions } from "../audit-modules";
import { loadR2ConfigFromEnv, saveReportToR2, renderReportHtml } from "../lib/r2-storage";

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx !== -1 ? args[idx + 1] : undefined;
  };
  const has = (flag: string) => args.includes(flag);

  const url = get("--url");
  if (!url) {
    console.error("❌  --url is required\n");
    console.error(
      "Usage: npx tsx scripts/audit-and-save.ts --url https://yourpage.com [--keyword '...'] [--headline '...'] [--modules 1,3,5] [--no-save]"
    );
    process.exit(1);
  }

  const modulesStr = get("--modules") || get("--module");
  const modules = modulesStr
    ? modulesStr.split(",").map((n) => parseInt(n.trim())).filter((n) => n >= 1 && n <= 10)
    : undefined;

  return {
    url,
    username: get("--username") || "cli",
    adHeadline: get("--headline"),
    primaryKeyword: get("--keyword"),
    declaredUrl: get("--declared-url"),
    safeBrowsingApiKey: get("--safe-browsing-key") || process.env.SAFE_BROWSING_API_KEY,
    psiApiKey: get("--psi-key") || process.env.PSI_API_KEY,
    modules,
    save: !has("--no-save"),
  };
}

async function main() {
  const args = parseArgs();

  console.log("\n🔍  PageScoreIQ — Audit + Save");
  console.log(`    URL : ${args.url}`);
  if (args.modules) console.log(`    Modules : ${args.modules.join(", ")}`);

  // Validate R2 config up front so we fail fast (unless --no-save).
  const r2 = args.save ? loadR2ConfigFromEnv() : null;
  if (args.save && !r2) {
    console.warn(
      "\n⚠️   R2 not configured — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET.\n" +
        "    The audit will still run, but the report will NOT be saved.\n"
    );
  }

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
    console.log("\nLoading page…");
    await page.goto(args.url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(2000);

    const options: FullAuditOptions = {
      url: args.url,
      adHeadline: args.adHeadline,
      primaryKeyword: args.primaryKeyword,
      declaredUrl: args.declaredUrl,
      safeBrowsingApiKey: args.safeBrowsingApiKey,
      psiApiKey: args.psiApiKey,
      modules: args.modules,
    };

    const report = await runFullAudit(page, options);

    console.log(`\n✅  Audit done — Score: ${report.overallScore}/100  Grade: ${report.grade}`);
    console.log(
      `    ${report.summary.pass} passed · ${report.summary.warn} warnings · ${report.summary.fail} failed`
    );

    if (r2) {
      console.log("\n☁️   Rendering PDF + uploading to Cloudflare R2…");
      const reportPage = await context.newPage();
      let pdf: Buffer;
      try {
        await reportPage.setContent(renderReportHtml(report), { waitUntil: "load" });
        pdf = Buffer.from(
          await reportPage.pdf({
            format: "A4",
            printBackground: true,
            margin: { top: "16px", bottom: "16px", left: "16px", right: "16px" },
          })
        );
      } finally {
        await reportPage.close();
      }
      const saved = await saveReportToR2(report, r2, args.username, pdf);
      console.log(`    Saved as: ${saved.key}`);
      console.log(`    ${saved.public ? "Public link:" : "Shareable link (valid 7 days):"}`);
      console.log(`      PDF : ${saved.pdfUrl}`);
    }

    console.log();
  } catch (err: any) {
    console.error(`\n❌  Failed: ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await context.close();
    await browser.close();
  }
}

main();
