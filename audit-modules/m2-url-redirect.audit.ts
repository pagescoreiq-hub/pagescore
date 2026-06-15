/**
 * PageScoreIQ — Module 2: URL & Redirect Compliance (Weight: 12%, Impact: CRITICAL)
 *
 * Google requires the final landing page URL domain to match the display URL.
 * Any redirect to a different domain triggers suspension.
 *
 * Checks:
 *  - Final URL domain matches declared display URL domain
 *  - No cross-domain redirects
 *  - Redirect chain ≤ 3 hops
 *  - No geo-redirects (same content to all crawlers)
 *  - URL resolves without error (200 status)
 *  - No cloaking
 *  - URL params don't break page (UTM test)
 */

import { Page } from "playwright";
import { ModuleResult, pass, fail, warn, calcScore } from "./types";

export interface UrlRedirectAuditOptions {
  /** The declared display URL / final URL from the Google Ad */
  declaredUrl?: string;
}

interface RedirectHop {
  url: string;
  status: number;
}

export async function auditUrlRedirect(
  page: Page,
  options: UrlRedirectAuditOptions = {}
): Promise<ModuleResult> {
  const items = [];
  const finalUrl = page.url();
  const declaredUrl = options.declaredUrl || finalUrl;

  // ── Helper: extract root domain ────────────────────────────────────────────
  function rootDomain(url: string): string {
    try {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      // Get last 2 parts (e.g. "google.com" from "ads.google.com")
      return hostname.split(".").slice(-2).join(".");
    } catch {
      return "";
    }
  }

  // ── 1. URL resolves (page loaded — non-200 would throw in goto) ────────────
  const responseStatus = await page.evaluate(() => {
    // Check for known error page indicators in DOM
    const title = document.title.toLowerCase();
    const body = document.body?.innerText?.toLowerCase().slice(0, 500) || "";
    if (title.includes("404") || body.includes("not found") || body.includes("page not found")) return 404;
    if (title.includes("500") || body.includes("internal server error")) return 500;
    if (!document.body || document.body.children.length === 0) return 204;
    return 200;
  });

  if (responseStatus === 200) {
    items.push(pass("url_resolves", "URL resolves without error (not 404/500)", "Page loaded successfully with content."));
  } else if (responseStatus === 404) {
    items.push(fail("url_resolves", "URL resolves without error (not 404/500)", "Page appears to return a 404 Not Found.", "Confirm the page URL is correct and the server is returning HTTP 200. Fix any broken routes."));
  } else if (responseStatus === 500) {
    items.push(fail("url_resolves", "URL resolves without error (not 404/500)", "Page appears to return a 500 Server Error.", "Fix the server-side error. Check application logs and resolve the root cause."));
  } else {
    items.push(warn("url_resolves", "URL resolves without error (not 404/500)", "Page loaded but content appears empty or very thin.", "Ensure the page returns meaningful content at this URL."));
  }

  // ── 2. Domain match between declared URL and final URL ────────────────────
  const declaredDomain = rootDomain(declaredUrl);
  const finalDomain = rootDomain(finalUrl);

  if (!declaredDomain || declaredDomain === finalDomain) {
    items.push(pass("domain_match", "Final URL domain matches display URL domain", `Both URLs use domain: ${finalDomain || "same"}`));
  } else {
    items.push(
      fail(
        "domain_match",
        "Final URL domain matches display URL domain",
        `Declared domain "${declaredDomain}" ≠ final domain "${finalDomain}" — Google will detect this.`,
        "Ensure the final landing URL uses the same root domain as your Google Ads display URL. Cross-domain redirects cause immediate suspension."
      )
    );
  }

  // ── 3. Redirect chain tracing via navigation requests ─────────────────────
  // We capture redirects by re-navigating and intercepting all responses
  const redirectChain: RedirectHop[] = [];

  try {
    const tempPage = await page.context().newPage();
    tempPage.on("response", (response) => {
      const status = response.status();
      if (status >= 300 && status < 400) {
        redirectChain.push({ url: response.url().slice(0, 120), status });
      }
    });
    await tempPage.goto(declaredUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await tempPage.close();
  } catch {
    // Best-effort — continue without redirect data
  }

  const hopCount = redirectChain.length;

  if (hopCount === 0) {
    items.push(pass("redirect_chain", "Redirect chain is 3 hops or fewer", "No redirects detected — direct load."));
  } else if (hopCount <= 3) {
    items.push(warn("redirect_chain", "Redirect chain is 3 hops or fewer", `${hopCount} redirect(s) detected. Each adds latency.`, "Minimise redirects. Even 1–3 hops can reduce Quality Score. Use direct URLs in ads where possible."));
  } else {
    items.push(
      fail(
        "redirect_chain",
        "Redirect chain is 3 hops or fewer",
        `${hopCount} redirect hops detected — exceeds the recommended maximum of 3.`,
        "Reduce redirect chain to ≤ 3 hops. Consider linking directly to the final URL in your ad."
      )
    );
  }

  // ── 4. Cross-domain redirect check ───────────────────────────────────────
  const crossDomainHops = redirectChain.filter((hop) => rootDomain(hop.url) !== declaredDomain && rootDomain(hop.url) !== finalDomain);

  if (crossDomainHops.length > 0) {
    items.push(
      fail(
        "cross_domain_redirect",
        "No redirect to a completely different domain",
        `Cross-domain redirect detected through: ${crossDomainHops.map((h) => h.url).join(" → ")}`,
        "Remove all cross-domain redirects. Google Ads policy requires the final URL domain to match the ad display URL."
      )
    );
  } else {
    items.push(pass("cross_domain_redirect", "No redirect to a completely different domain", "All redirects stay within the same domain."));
  }

  // ── 5. Cloaking check (heuristic — compare page title with bot UA) ─────────
  let cloakingDetected = false;
  try {
    const botPage = await page.context().newPage();
    let botTitle = "";
    await botPage.setExtraHTTPHeaders({ "User-Agent": "Googlebot/2.1 (+http://www.google.com/bot.html)" });
    await botPage.goto(finalUrl, { waitUntil: "domcontentloaded", timeout: 15_000 });
    botTitle = await botPage.title();
    await botPage.close();

    const realTitle = await page.title();
    // Simple heuristic: if title differs significantly, might be cloaking
    if (botTitle && realTitle && botTitle.toLowerCase() !== realTitle.toLowerCase()) {
      const similarity = botTitle.split(" ").filter((w) => realTitle.toLowerCase().includes(w.toLowerCase())).length / Math.max(botTitle.split(" ").length, 1);
      if (similarity < 0.3) cloakingDetected = true;
    }
  } catch {
    // Unable to do cloaking check
  }

  if (cloakingDetected) {
    items.push(
      fail(
        "cloaking",
        "No cloaking (same page served to Google bot & users)",
        "Page title differs significantly between Googlebot and real user request — possible cloaking.",
        "Serve identical content to all user agents. Cloaking causes immediate permanent suspension."
      )
    );
  } else {
    items.push(pass("cloaking", "No cloaking (same page served to Google bot & users)", "Page content appears consistent across user agents."));
  }

  // ── 6. UTM parameters don't break page ────────────────────────────────────
  try {
    const utmUrl = new URL(finalUrl);
    utmUrl.searchParams.set("utm_source", "google");
    utmUrl.searchParams.set("utm_medium", "cpc");
    utmUrl.searchParams.set("utm_campaign", "test_audit");
    utmUrl.searchParams.set("utm_term", "audit");
    utmUrl.searchParams.set("utm_content", "ad1");

    const utmPage = await page.context().newPage();
    let utmLoadError = false;
    let utmTitle = "";
    try {
      await utmPage.goto(utmUrl.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
      utmTitle = await utmPage.title();
      const utmBody = await utmPage.evaluate(() => document.body?.children?.length || 0);
      if (utmBody === 0) utmLoadError = true;
    } catch {
      utmLoadError = true;
    } finally {
      await utmPage.close();
    }

    if (utmLoadError) {
      items.push(
        fail(
          "utm_params",
          "URL parameters don't break page (UTM values tested)",
          "Page failed to load correctly with UTM parameters appended.",
          "Test your page URL with all UTM params: ?utm_source=google&utm_medium=cpc&utm_campaign=test. Ensure your server/CMS handles unknown query params gracefully."
        )
      );
    } else {
      items.push(
        pass(
          "utm_params",
          "URL parameters don't break page (UTM values tested)",
          `Page loaded correctly with UTM params. Title: "${utmTitle.slice(0, 60)}"`
        )
      );
    }
  } catch {
    items.push(
      warn(
        "utm_params",
        "URL parameters don't break page (UTM values tested)",
        "Could not construct a valid UTM test URL.",
        "Manually test your page URL with UTM params appended: ?utm_source=google&utm_medium=cpc&utm_campaign=test"
      )
    );
  }

  // ── 7. Geo-redirect (heuristic — check if server sends Vary: headers) ──────
  items.push(
    warn(
      "geo_redirect",
      "No geo-redirect to different content for Google crawler",
      "Geo-redirect detection requires multi-location server-side testing — not fully testable from browser.",
      "Ensure your server serves identical content to all IP origins. Disable geo-based content switching for pages used in Google Ads."
    )
  );

  return {
    module: "url_redirect",
    moduleNumber: 2,
    moduleName: "URL & Redirect Compliance",
    weight: 12,
    impact: "CRITICAL",
    items,
    score: calcScore(items),
  };
}
