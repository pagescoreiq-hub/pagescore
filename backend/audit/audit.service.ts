/**
 * PageScoreIQ — AuditService (NestJS)
 *
 * Manages the Playwright browser lifecycle and runs the full 10-module
 * PageScoreIQ audit against any landing page URL.
 *
 * Inject this service into any NestJS module that needs to trigger audits.
 */

import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { chromium, Browser, BrowserContext, Page } from "playwright";
import {
  runFullAudit,
  FullAuditOptions,
  FullAuditReport,
} from "../../audit-modules";

// ─── DTOs ─────────────────────────────────────────────────────────────────────

export interface RunAuditDto {
  /** Full landing page URL to audit */
  url: string;
  /** Optional: primary campaign keyword (used for H1 alignment check) */
  primaryKeyword?: string;
  /** Optional: ad headline (used for H1/ad alignment check) */
  adHeadline?: string;
  /** Optional: declared display URL from the ad (defaults to url) */
  declaredUrl?: string;
  /** Optional: restrict to specific module numbers (1–10) */
  modules?: number[];
}

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class AuditService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AuditService.name);
  private browser: Browser | null = null;

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  async onModuleInit(): Promise<void> {
    this.logger.log("Launching Chromium browser for audit engine…");
    this.browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    this.logger.log("Chromium ready — PageScoreIQ audit engine online.");
  }

  async onModuleDestroy(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.logger.log("Chromium closed.");
    }
  }

  // ── Core audit runner (all 10 modules) ─────────────────────────────────────

  async runFullAudit(dto: RunAuditDto): Promise<FullAuditReport> {
    if (!this.browser) {
      throw new Error("Browser not initialised. Check AuditService lifecycle.");
    }

    const context: BrowserContext = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      javaScriptEnabled: true,
      ignoreHTTPSErrors: false,
    });

    const page: Page = await context.newPage();

    // Block ad/analytics noise from slowing audit (not needed for our checks)
    await page.route(
      /doubleclick\.net|googlesyndication|adservice\.google/,
      (route) => route.abort()
    );

    try {
      this.logger.log(`Starting full 10-module audit: ${dto.url}`);
      await page.goto(dto.url, { waitUntil: "networkidle", timeout: 45_000 });

      const options: FullAuditOptions = {
        url: dto.url,
        adHeadline: dto.adHeadline,
        primaryKeyword: dto.primaryKeyword,
        declaredUrl: dto.declaredUrl ?? dto.url,
        safeBrowsingApiKey: process.env.SAFE_BROWSING_API_KEY,
        psiApiKey: process.env.PSI_API_KEY,
        modules: dto.modules,
      };

      const report = await runFullAudit(page, options);

      this.logger.log(
        `Audit complete for ${dto.url} — Score: ${report.overallScore}/100, Grade: ${report.grade}`
      );

      return report;
    } finally {
      await context.close();
    }
  }

  // ── Convenience: run a single module by number ─────────────────────────────

  async runSingleModule(dto: RunAuditDto & { moduleNumber: number }) {
    return this.runFullAudit({ ...dto, modules: [dto.moduleNumber] });
  }

  // ── Private helper ─────────────────────────────────────────────────────────

  private async _withPage<T>(
    url: string,
    fn: (page: Page) => Promise<T>
  ): Promise<T> {
    if (!this.browser) throw new Error("Browser not ready.");
    const context = await this.browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "networkidle", timeout: 45_000 });
      return await fn(page);
    } finally {
      await context.close();
    }
  }
}
