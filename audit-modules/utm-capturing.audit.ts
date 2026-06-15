/**
 * PageScoreIQ — Module: UTM Capturing Audit
 *
 * Checks whether the landing page correctly:
 *  - Preserves UTM parameters in the URL after load
 *  - Captures UTM values into the dataLayer (GTM)
 *  - Passes UTM data into hidden form fields
 *  - Doesn't break or redirect away when UTM params are appended
 *  - Handles all 5 standard UTM parameters
 */

import { Page } from "playwright";
import { AuditItem } from "./form-validation.audit";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface UtmAuditResult {
  module: "utm_capturing";
  items: AuditItem[];
  score: number; // 0–100
}

// ─── Standard UTM parameters ──────────────────────────────────────────────────

const UTM_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

type UtmParam = (typeof UTM_PARAMS)[number];

// Test values injected into the URL during audit
const TEST_UTM_VALUES: Record<UtmParam, string> = {
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "pagescore_test",
  utm_term: "landing+page+audit",
  utm_content: "pagescore_audit_check",
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pass(id: string, label: string, detail: string): AuditItem {
  return { id, label, status: "PASS", detail };
}

function fail(id: string, label: string, detail: string, fix: string): AuditItem {
  return { id, label, status: "FAIL", detail, fix };
}

function warn(id: string, label: string, detail: string, fix: string): AuditItem {
  return { id, label, status: "WARN", detail, fix };
}

function buildUtmUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  for (const [key, value] of Object.entries(TEST_UTM_VALUES)) {
    url.searchParams.set(key, value);
  }
  return url.toString();
}

// ─── Audit function ───────────────────────────────────────────────────────────

export async function auditUtmCapturing(
  page: Page,
  originalUrl: string
): Promise<UtmAuditResult> {
  const items: AuditItem[] = [];

  // ── Step 1: Navigate to URL with injected UTM params ─────────────────────
  const utmUrl = buildUtmUrl(originalUrl);

  let navigationOk = true;
  try {
    const response = await page.goto(utmUrl, {
      waitUntil: "networkidle",
      timeout: 30_000,
    });

    if (!response || response.status() >= 400) {
      navigationOk = false;
      items.push(
        fail(
          "utm_page_loads",
          "Page loads correctly with UTM parameters",
          `Page returned HTTP ${response?.status() ?? "unknown"} when UTM params were appended.`,
          "Ensure your landing page handles arbitrary query string parameters without breaking."
        )
      );
    } else {
      items.push(
        pass(
          "utm_page_loads",
          "Page loads correctly with UTM parameters",
          `Page returned HTTP ${response.status()} with UTM params in the URL.`
        )
      );
    }
  } catch (err) {
    navigationOk = false;
    items.push(
      fail(
        "utm_page_loads",
        "Page loads correctly with UTM parameters",
        `Navigation failed: ${(err as Error).message}`,
        "Investigate server/CDN config — the page must not error when extra query params are present."
      )
    );
  }

  if (!navigationOk) {
    return { module: "utm_capturing", items, score: 0 };
  }

  // ── Step 2: Check URL was not stripped of UTM params (redirect check) ────
  const finalUrl = page.url();
  const finalParsed = new URL(finalUrl);

  const strippedParams: string[] = [];
  const preservedParams: string[] = [];

  for (const param of UTM_PARAMS) {
    const value = finalParsed.searchParams.get(param);
    if (!value || value !== TEST_UTM_VALUES[param as UtmParam]) {
      strippedParams.push(param);
    } else {
      preservedParams.push(param);
    }
  }

  if (strippedParams.length === 0) {
    items.push(
      pass(
        "utm_url_preserved",
        "UTM parameters preserved in URL after page load",
        `All 5 UTM parameters retained: ${preservedParams.join(", ")}.`
      )
    );
  } else if (strippedParams.length < UTM_PARAMS.length) {
    items.push(
      warn(
        "utm_url_preserved",
        "UTM parameters preserved in URL after page load",
        `${strippedParams.length} UTM param(s) were stripped on load: ${strippedParams.join(", ")}.`,
        "Review redirect rules and canonical URL logic — avoid stripping query params. Check .htaccess, Cloudflare page rules, and Next.js redirects config."
      )
    );
  } else {
    items.push(
      fail(
        "utm_url_preserved",
        "UTM parameters preserved in URL after page load",
        "All UTM parameters were removed from the URL after navigation.",
        "Your redirect or canonical logic is stripping query strings. Check Next.js redirects, Cloudflare rules, or server-side redirects."
      )
    );
  }

  // ── Step 3: Check GTM dataLayer for UTM push ─────────────────────────────
  const dataLayerData = await page.evaluate(() => {
    const win = window as Window & {
      dataLayer?: Array<Record<string, unknown>>;
    };
    if (!win.dataLayer || !Array.isArray(win.dataLayer)) return null;

    const utmKeys = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      // Some implementations use camelCase or prefixed keys
      "utmSource",
      "utmMedium",
      "utmCampaign",
      "utmTerm",
      "utmContent",
    ];

    const foundKeys: string[] = [];
    for (const event of win.dataLayer) {
      for (const key of Object.keys(event)) {
        if (utmKeys.includes(key)) foundKeys.push(key);
      }
    }

    return {
      dataLayerExists: true,
      utmKeysFound: [...new Set(foundKeys)],
      totalEvents: win.dataLayer.length,
    };
  });

  if (!dataLayerData) {
    items.push(
      fail(
        "utm_datalayer",
        "GTM dataLayer present and receiving UTM data",
        "window.dataLayer not found — GTM is missing or not loaded.",
        "Install GTM and push UTM parameters to dataLayer on page load:\nwindow.dataLayer = window.dataLayer || [];\nwindow.dataLayer.push({ utm_source: '...', utm_medium: '...' });"
      )
    );
  } else if (dataLayerData.utmKeysFound.length === 0) {
    items.push(
      warn(
        "utm_datalayer",
        "GTM dataLayer present and receiving UTM data",
        `dataLayer found (${dataLayerData.totalEvents} event(s)) but no UTM keys detected inside it.`,
        "Add a custom JavaScript variable or GTM tag to push UTM params to dataLayer:\ndataLayer.push({ event: 'utmCapture', utm_source: new URLSearchParams(location.search).get('utm_source') });"
      )
    );
  } else {
    items.push(
      pass(
        "utm_datalayer",
        "GTM dataLayer present and receiving UTM data",
        `dataLayer has ${dataLayerData.utmKeysFound.length} UTM key(s): ${dataLayerData.utmKeysFound.join(", ")}.`
      )
    );
  }

  // ── Step 4: Check hidden form fields for UTM capture ─────────────────────
  const hiddenUtmFields = await page.evaluate(() => {
    const utmParamNames = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
    ];

    const found: Array<{ name: string; value: string }> = [];

    for (const param of utmParamNames) {
      const selectors = [
        `input[type="hidden"][name="${param}"]`,
        `input[type="hidden"][id="${param}"]`,
        `input[type="hidden"][name*="utm"][name*="${param.replace("utm_", "")}"]`,
      ];

      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (el) {
          found.push({ name: param, value: el.value });
          break;
        }
      }
    }

    return found;
  });

  const populatedHiddenFields = hiddenUtmFields.filter((f) => f.value);
  const emptyHiddenFields = hiddenUtmFields.filter((f) => !f.value);
  const missingHiddenFields = UTM_PARAMS.filter(
    (p) => !hiddenUtmFields.find((f) => f.name === p)
  );

  if (hiddenUtmFields.length === 0) {
    items.push(
      warn(
        "utm_hidden_fields",
        "UTM values captured in hidden form fields",
        "No hidden UTM form fields found on the page.",
        `Add hidden inputs inside your lead form for each UTM param and populate them with JavaScript:\n<input type="hidden" name="utm_source" id="utm_source">\n// JS on load:\ndocument.getElementById('utm_source').value = new URLSearchParams(location.search).get('utm_source') || '';`
      )
    );
  } else if (missingHiddenFields.length > 0) {
    items.push(
      warn(
        "utm_hidden_fields",
        "UTM values captured in hidden form fields",
        `Partial coverage — missing hidden fields for: ${missingHiddenFields.join(", ")}.`,
        `Add hidden inputs for all 5 UTM parameters: ${missingHiddenFields.join(", ")}.`
      )
    );
  } else if (emptyHiddenFields.length > 0) {
    items.push(
      fail(
        "utm_hidden_fields",
        "UTM values captured in hidden form fields",
        `${emptyHiddenFields.length} hidden UTM field(s) exist but have empty values: ${emptyHiddenFields
          .map((f) => f.name)
          .join(", ")}.`,
        "Your JavaScript that populates hidden fields is not running or not reading URL params correctly. Check that the population script runs after DOM is ready and reads URLSearchParams."
      )
    );
  } else {
    items.push(
      pass(
        "utm_hidden_fields",
        "UTM values captured in hidden form fields",
        `${populatedHiddenFields.length} hidden UTM field(s) populated: ${populatedHiddenFields
          .map((f) => `${f.name}="${f.value}"`)
          .join(", ")}.`
      )
    );
  }

  // ── Step 5: Cross-domain redirect strips UTMs ─────────────────────────────
  const originalDomain = new URL(originalUrl).hostname;
  const finalDomain = new URL(finalUrl).hostname;

  if (originalDomain !== finalDomain) {
    items.push(
      fail(
        "utm_cross_domain_redirect",
        "No cross-domain redirect stripping UTM parameters",
        `Page redirected from ${originalDomain} to ${finalDomain} — UTM parameters may be lost.`,
        "Avoid cross-domain redirects. If required, use JavaScript to pass UTM params across: append them to the destination URL before redirecting."
      )
    );
  } else {
    items.push(
      pass(
        "utm_cross_domain_redirect",
        "No cross-domain redirect stripping UTM parameters",
        "Final URL stays on the same domain — no cross-domain redirect detected."
      )
    );
  }

  // ── Step 6: Cookie / localStorage persistence (optional best practice) ───
  const utmStorageCheck = await page.evaluate(() => {
    const params = ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content"];
    const cookieStr = document.cookie;
    const localStr = (() => {
      try { return JSON.stringify(localStorage); } catch { return ""; }
    })();
    const sessionStr = (() => {
      try { return JSON.stringify(sessionStorage); } catch { return ""; }
    })();

    const found: string[] = [];
    for (const p of params) {
      if (cookieStr.includes(p) || localStr.includes(p) || sessionStr.includes(p)) {
        found.push(p);
      }
    }
    return found;
  });

  if (utmStorageCheck.length >= 3) {
    items.push(
      pass(
        "utm_persistence",
        "UTM values persisted across page (cookie/localStorage)",
        `${utmStorageCheck.length} UTM param(s) found in browser storage for cross-page persistence.`
      )
    );
  } else {
    items.push(
      warn(
        "utm_persistence",
        "UTM values persisted across page (cookie/localStorage)",
        "UTM parameters not stored in cookies or localStorage.",
        "Store UTMs in sessionStorage or a first-party cookie on page load so attribution survives multi-step forms and internal page navigations:\nsessionStorage.setItem('utm_source', new URLSearchParams(location.search).get('utm_source') || '');"
      )
    );
  }

  // ── Score ─────────────────────────────────────────────────────────────────
  const failCount = items.filter((i) => i.status === "FAIL").length;
  const warnCount = items.filter((i) => i.status === "WARN").length;
  const total = items.length;
  const score = Math.max(
    0,
    Math.round(((total - failCount - warnCount * 0.5) / total) * 100)
  );

  return { module: "utm_capturing", items, score };
}
