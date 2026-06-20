/**
 * PageScoreIQ — Module 11: Technical SEO (Weight: 18%, Website audit only)
 *
 * PRD v2.0 §4 — 12 checklist items. DOM checks run in the page; sitemap, robots,
 * favicon and broken-link probes use fetch() against the site origin.
 */

import { Page } from "playwright";
import { ModuleResult, AuditItem, pass, fail, warn, calcScore } from "./types";

/** GET a URL, following redirects, with a short timeout. Returns null on error. */
async function probe(url: string, method: "GET" | "HEAD" = "GET"): Promise<Response | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(url, {
      method,
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "PageScoreIQ-Bot/2.0 (+technical-seo)" },
    });
    clearTimeout(t);
    return res;
  } catch {
    return null;
  }
}

export async function auditTechnicalSeo(page: Page): Promise<ModuleResult> {
  const items: AuditItem[] = [];
  const pageUrl = page.url();
  const origin = (() => {
    try { return new URL(pageUrl).origin; } catch { return pageUrl; }
  })();

  // ── DOM-derived signals ─────────────────────────────────────────────────────
  // NOTE: only inline anonymous callbacks inside page.evaluate — a *named*
  // arrow/function here would be wrapped by esbuild's __name helper, which does
  // not exist in the browser context and throws at runtime.
  const dom = await page.evaluate(() => {
    const metaMap: Record<string, string | null> = {};
    document.querySelectorAll("meta[name], meta[property]").forEach((m) => {
      const key = m.getAttribute("name") || m.getAttribute("property");
      if (key && !(key in metaMap)) metaMap[key] = m.getAttribute("content");
    });

    const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute("href") || null;

    const jsonLd = Array.from(document.querySelectorAll('script[type="application/ld+json"]')).map(
      (s) => s.textContent || ""
    );

    const og = {
      title: metaMap["og:title"] || null,
      image: metaMap["og:image"] || null,
      description: metaMap["og:description"] || null,
    };
    const twitterCard = metaMap["twitter:card"] || null;

    const hreflangs = Array.from(document.querySelectorAll('link[rel="alternate"][hreflang]')).map(
      (l) => l.getAttribute("hreflang")
    );
    const htmlLang = document.documentElement.getAttribute("lang");

    const favicon =
      document.querySelector('link[rel~="icon"]')?.getAttribute("href") || null;

    const relNext = document.querySelector('link[rel="next"]')?.getAttribute("href") || null;
    const relPrev = document.querySelector('link[rel="prev"]')?.getAttribute("href") || null;

    const origin = location.origin;
    const internalLinks = Array.from(document.querySelectorAll("a[href]"))
      .map((a) => (a as HTMLAnchorElement).href)
      .filter((h) => {
        try { return new URL(h).origin === origin && !h.includes("#"); } catch { return false; }
      });

    return {
      metaDescription: metaMap["description"] || null,
      canonical,
      jsonLd,
      og,
      twitterCard,
      hreflangs,
      htmlLang,
      favicon,
      relNext,
      relPrev,
      internalLinks: Array.from(new Set(internalLinks)).slice(0, 25),
    };
  });

  // ── 1. Meta description present and 150–160 chars ───────────────────────────
  if (!dom.metaDescription) {
    items.push(fail("meta_description", "Meta description present and within 150–160 characters",
      "No meta description tag found.",
      "Add a <meta name=\"description\"> of 150–160 characters summarising the page."));
  } else {
    const len = dom.metaDescription.trim().length;
    if (len >= 150 && len <= 160) {
      items.push(pass("meta_description", "Meta description present and within 150–160 characters",
        `Meta description is ${len} characters.`));
    } else {
      items.push(warn("meta_description", "Meta description present and within 150–160 characters",
        `Meta description is ${len} characters (recommended 150–160).`,
        len < 150 ? "Expand the description toward 150–160 characters." : "Trim the description to 160 characters or fewer."));
    }
  }

  // ── 2. Canonical tag ────────────────────────────────────────────────────────
  if (!dom.canonical) {
    items.push(fail("canonical", "Canonical tag present and points to correct URL",
      "No <link rel=\"canonical\"> found.",
      "Add a canonical link pointing to this page's preferred URL."));
  } else {
    let sameHost = false;
    try { sameHost = new URL(dom.canonical, pageUrl).host === new URL(pageUrl).host; } catch {}
    if (sameHost) {
      items.push(pass("canonical", "Canonical tag present and points to correct URL",
        `Canonical: ${dom.canonical}`));
    } else {
      items.push(warn("canonical", "Canonical tag present and points to correct URL",
        `Canonical points to a different host: ${dom.canonical}`,
        "Confirm the canonical URL is intentional; it usually should match this domain."));
    }
  }

  // ── 3. XML sitemap ──────────────────────────────────────────────────────────
  const sitemapRes = await probe(`${origin}/sitemap.xml`);
  if (sitemapRes && sitemapRes.ok) {
    items.push(pass("sitemap", "XML sitemap exists and is accessible (/sitemap.xml)",
      `Sitemap returned HTTP ${sitemapRes.status}.`));
  } else {
    items.push(fail("sitemap", "XML sitemap exists and is accessible (/sitemap.xml)",
      sitemapRes ? `/sitemap.xml returned HTTP ${sitemapRes.status}.` : "/sitemap.xml could not be reached.",
      "Publish an XML sitemap at /sitemap.xml and reference it in robots.txt."));
  }

  // ── 4. robots.txt ───────────────────────────────────────────────────────────
  const robotsRes = await probe(`${origin}/robots.txt`);
  if (robotsRes && robotsRes.ok) {
    const body = await robotsRes.text().catch(() => "");
    const blocksAll = /(^|\n)\s*disallow:\s*\/\s*$/im.test(body);
    if (blocksAll) {
      items.push(fail("robots", "Robots.txt exists and doesn't block critical resources",
        "robots.txt contains \"Disallow: /\" — the whole site is blocked from crawlers.",
        "Remove the blanket Disallow: / rule so search engines can crawl the site."));
    } else {
      items.push(pass("robots", "Robots.txt exists and doesn't block critical resources",
        "robots.txt present and does not block the entire site."));
    }
  } else {
    items.push(warn("robots", "Robots.txt exists and doesn't block critical resources",
      robotsRes ? `/robots.txt returned HTTP ${robotsRes.status}.` : "/robots.txt could not be reached.",
      "Add a robots.txt at the site root (an empty one is fine) and link your sitemap."));
  }

  // ── 5. Structured data (JSON-LD) ────────────────────────────────────────────
  if (dom.jsonLd.length === 0) {
    items.push(warn("schema", "Structured data / Schema markup validates (JSON-LD)",
      "No JSON-LD structured data found.",
      "Add JSON-LD (e.g. Organization, WebSite, BreadcrumbList) to enable rich results."));
  } else {
    let validCount = 0;
    for (const block of dom.jsonLd) {
      try { JSON.parse(block); validCount++; } catch { /* invalid */ }
    }
    if (validCount === dom.jsonLd.length) {
      items.push(pass("schema", "Structured data / Schema markup validates (JSON-LD)",
        `${validCount} JSON-LD block(s) found and parse as valid JSON.`));
    } else {
      items.push(fail("schema", "Structured data / Schema markup validates (JSON-LD)",
        `${dom.jsonLd.length - validCount} of ${dom.jsonLd.length} JSON-LD block(s) failed to parse.`,
        "Fix the malformed JSON-LD so it parses; validate with the Rich Results Test."));
    }
  }

  // ── 6. Open Graph tags ──────────────────────────────────────────────────────
  const ogMissing = ["title", "image", "description"].filter((k) => !(dom.og as any)[k]);
  if (ogMissing.length === 0) {
    items.push(pass("open_graph", "Open Graph tags present (og:title, og:image, og:description)",
      "All core Open Graph tags present."));
  } else {
    items.push(warn("open_graph", "Open Graph tags present (og:title, og:image, og:description)",
      `Missing Open Graph tag(s): ${ogMissing.map((k) => "og:" + k).join(", ")}.`,
      "Add the missing og: tags so shared links render with a title, image and description."));
  }

  // ── 7. Twitter Card ─────────────────────────────────────────────────────────
  if (dom.twitterCard) {
    items.push(pass("twitter_card", "Twitter Card tags present", `twitter:card = ${dom.twitterCard}`));
  } else {
    items.push(warn("twitter_card", "Twitter Card tags present",
      "No twitter:card meta tag found.",
      "Add twitter:card (e.g. \"summary_large_image\") plus twitter:title/description/image."));
  }

  // ── 8. Broken internal links (sample) ───────────────────────────────────────
  const sample = dom.internalLinks.slice(0, 10);
  if (sample.length === 0) {
    items.push(warn("broken_internal_links", "No broken internal links (404s within the site)",
      "No internal links found to test.",
      "Add internal links to help crawlers discover other pages."));
  } else {
    const results = await Promise.all(sample.map((u) => probe(u, "HEAD")));
    const broken = sample.filter((_u, i) => {
      const r = results[i];
      return !r || r.status >= 400;
    });
    if (broken.length === 0) {
      items.push(pass("broken_internal_links", "No broken internal links (404s within the site)",
        `Checked ${sample.length} internal link(s); none returned 4xx/5xx.`));
    } else {
      items.push(fail("broken_internal_links", "No broken internal links (404s within the site)",
        `${broken.length}/${sample.length} sampled internal link(s) returned an error, e.g. ${broken[0]}`,
        "Fix or remove the broken internal links."));
    }
  }

  // ── 9. Orphaned pages (cannot be judged from a single page) ─────────────────
  items.push(warn("orphaned_pages", "No orphaned pages (unlinked from anywhere on site)",
    "Orphaned-page detection requires a full-site crawl, which a single-page audit cannot perform.",
    "Run a site-wide crawl (or compare sitemap URLs against internally linked URLs) to find orphans."));

  // ── 10. Hreflang ────────────────────────────────────────────────────────────
  if (dom.hreflangs.length === 0) {
    items.push(pass("hreflang", "Hreflang tags correct (for multi-language sites)",
      "No hreflang tags — not applicable for a single-language site."));
  } else {
    const hasSelf = !!dom.htmlLang && dom.hreflangs.some((h) => (h || "").toLowerCase().startsWith(dom.htmlLang!.toLowerCase().slice(0, 2)));
    if (hasSelf) {
      items.push(pass("hreflang", "Hreflang tags correct (for multi-language sites)",
        `${dom.hreflangs.length} hreflang tag(s) present, including this page's language.`));
    } else {
      items.push(warn("hreflang", "Hreflang tags correct (for multi-language sites)",
        `${dom.hreflangs.length} hreflang tag(s) found but none clearly match this page's language (${dom.htmlLang || "unknown"}).`,
        "Ensure every hreflang cluster includes a self-referencing tag and an x-default."));
    }
  }

  // ── 11. Favicon ─────────────────────────────────────────────────────────────
  const faviconUrl = dom.favicon ? new URL(dom.favicon, pageUrl).href : `${origin}/favicon.ico`;
  const favRes = await probe(faviconUrl, "HEAD");
  if (favRes && favRes.ok) {
    items.push(pass("favicon", "Favicon present and loads correctly", `Favicon loads (HTTP ${favRes.status}).`));
  } else {
    items.push(warn("favicon", "Favicon present and loads correctly",
      dom.favicon ? "Declared favicon did not load." : "No favicon link and /favicon.ico not found.",
      "Add a <link rel=\"icon\"> and ensure the file is reachable."));
  }

  // ── 12. Pagination (rel=next/prev) ──────────────────────────────────────────
  if (!dom.relNext && !dom.relPrev) {
    items.push(pass("pagination", "Pagination tags correct (rel=next/prev, if applicable)",
      "No paginated sequence detected — rel=next/prev not required."));
  } else {
    items.push(pass("pagination", "Pagination tags correct (rel=next/prev, if applicable)",
      `Pagination hints present (${dom.relNext ? "rel=next " : ""}${dom.relPrev ? "rel=prev" : ""}).`));
  }

  return {
    module: "technical_seo",
    moduleNumber: 11,
    moduleName: "Technical SEO",
    weight: 18,
    impact: "HIGH",
    items,
    score: calcScore(items),
  };
}
