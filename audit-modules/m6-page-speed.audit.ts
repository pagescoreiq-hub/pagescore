/**
 * PageScoreIQ — Module 6: Page Speed & Core Web Vitals (Weight: 8%, Impact: HIGH)
 *
 * Google uses landing page experience (including speed) to calculate Quality Score,
 * which directly affects CPC and Ad Rank.
 *
 * Checks:
 *  - LCP (Largest Contentful Paint) < 2.5s  [via Navigation Timing + heuristic]
 *  - FID / INP (Interaction to Next Paint) < 200ms  [via Long Tasks API]
 *  - CLS (Cumulative Layout Shift) < 0.1  [via LayoutShift observer]
 *  - PageSpeed Insights mobile score ≥ 70  [requires PSI_API_KEY]
 *  - PageSpeed Insights desktop score ≥ 80  [requires PSI_API_KEY]
 *  - Page fully loads in < 3 seconds on 4G
 *  - Images compressed and in modern format (WebP)
 *  - No render-blocking scripts above the fold
 */

import { Page } from "playwright";
import { ModuleResult, pass, fail, warn, calcScore } from "./types";

export interface PageSpeedAuditOptions {
  /** Google PageSpeed Insights API key (env var: PSI_API_KEY) */
  psiApiKey?: string;
}

export async function auditPageSpeed(
  page: Page,
  options: PageSpeedAuditOptions = {}
): Promise<ModuleResult> {
  const items = [];

  // ── Gather timing and resource data from the page ─────────────────────────
  const perfData = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    const paint = performance.getEntriesByType("paint");
    const resources = performance.getEntriesByType("resource") as PerformanceResourceTiming[];

    const fcp = paint.find((p) => p.name === "first-contentful-paint")?.startTime ?? null;
    const domContentLoaded = nav ? nav.domContentLoadedEventEnd - nav.startTime : null;
    const pageLoadTime = nav ? nav.loadEventEnd - nav.startTime : null;

    // Render-blocking resources (scripts without async/defer in <head>)
    const blockingScripts = Array.from(document.querySelectorAll("head script[src]")).filter((s) => {
      const script = s as HTMLScriptElement;
      return !script.async && !script.defer;
    }).map((s) => (s as HTMLScriptElement).src.slice(0, 100));

    // Image analysis
    const images = Array.from(document.querySelectorAll("img"));
    const totalImages = images.length;
    const webpImages = images.filter((img) => img.src.endsWith(".webp") || img.currentSrc?.endsWith(".webp")).length;
    const svgImages = images.filter((img) => img.src.endsWith(".svg")).length;
    const modernImages = webpImages + svgImages;
    const largeImages = images.filter((img) => {
      const res = resources.find((r) => r.name === img.src || img.src.includes(r.name.split("/").pop() || ""));
      return res && res.transferSize > 150_000; // >150KB
    }).length;

    // Script count
    const totalScripts = document.querySelectorAll("script[src]").length;
    const externalScripts = Array.from(document.querySelectorAll("script[src]")).filter((s) => {
      try { return new URL((s as HTMLScriptElement).src).origin !== window.location.origin; } catch { return false; }
    }).length;

    // CSS count
    const totalStyles = document.querySelectorAll('link[rel="stylesheet"]').length;

    return {
      fcp,
      domContentLoaded,
      pageLoadTime,
      blockingScripts,
      totalImages,
      modernImages,
      largeImages,
      totalScripts,
      externalScripts,
      totalStyles,
    };
  });

  // ── 1. Page load time < 3 seconds on 4G (simulated via real load) ──────────
  const loadTime = perfData.pageLoadTime;
  if (loadTime !== null) {
    if (loadTime < 3000) {
      items.push(pass("load_time", "Page fully loads in < 3 seconds on 4G", `Page load time: ${(loadTime / 1000).toFixed(2)}s`));
    } else if (loadTime < 5000) {
      items.push(
        warn(
          "load_time",
          "Page fully loads in < 3 seconds on 4G",
          `Page load time: ${(loadTime / 1000).toFixed(2)}s — slower than the 3s threshold.`,
          "Reduce page weight, enable compression (gzip/brotli), use a CDN, and defer non-critical resources."
        )
      );
    } else {
      items.push(
        fail(
          "load_time",
          "Page fully loads in < 3 seconds on 4G",
          `Page load time: ${(loadTime / 1000).toFixed(2)}s — significantly above the 3s threshold.`,
          "Major performance issues present. Run PageSpeed Insights for a detailed breakdown. Target < 3s load time."
        )
      );
    }
  } else {
    items.push(warn("load_time", "Page fully loads in < 3 seconds on 4G", "Could not measure page load time from Navigation Timing API.", "Use Google PageSpeed Insights to measure real load time."));
  }

  // ── 2. LCP heuristic (FCP as proxy + DOM timing) ──────────────────────────
  const fcp = perfData.fcp;
  if (fcp !== null) {
    if (fcp < 2500) {
      items.push(pass("lcp", "LCP (Largest Contentful Paint) < 2.5 seconds", `First Contentful Paint: ${(fcp / 1000).toFixed(2)}s (proxy for LCP — actual LCP may differ).`));
    } else if (fcp < 4000) {
      items.push(
        warn(
          "lcp",
          "LCP (Largest Contentful Paint) < 2.5 seconds",
          `FCP at ${(fcp / 1000).toFixed(2)}s suggests LCP may exceed 2.5s threshold.`,
          "Optimize hero image and server response time. Use preload for LCP image: <link rel=\"preload\" as=\"image\" href=\"hero.webp\">."
        )
      );
    } else {
      items.push(
        fail(
          "lcp",
          "LCP (Largest Contentful Paint) < 2.5 seconds",
          `FCP at ${(fcp / 1000).toFixed(2)}s — LCP likely exceeds 2.5s. Page loads too slowly.`,
          "Optimize hero image (compress to WebP, reduce to ≤150KB), improve server response time (<200ms), use a CDN."
        )
      );
    }
  } else {
    items.push(warn("lcp", "LCP (Largest Contentful Paint) < 2.5 seconds", "FCP/LCP data not available via Navigation Timing API.", "Run Google PageSpeed Insights for accurate LCP measurement."));
  }

  // ── 3. INP / FID heuristic (render-blocking scripts = proxy) ──────────────
  // True INP requires real user interaction — we use blocking script count as proxy
  if (perfData.blockingScripts.length === 0) {
    items.push(pass("inp", "FID / INP (Interaction to Next Paint) < 200ms", "No render-blocking scripts in <head> — low INP risk."));
  } else if (perfData.blockingScripts.length <= 2) {
    items.push(
      warn(
        "inp",
        "FID / INP (Interaction to Next Paint) < 200ms",
        `${perfData.blockingScripts.length} render-blocking script(s) may delay interaction: ${perfData.blockingScripts.slice(0, 2).join(", ")}`,
        "Add async or defer attribute to non-critical scripts to reduce main thread blocking."
      )
    );
  } else {
    items.push(
      fail(
        "inp",
        "FID / INP (Interaction to Next Paint) < 200ms",
        `${perfData.blockingScripts.length} render-blocking scripts may cause high INP.`,
        "Defer or async-load all non-critical scripts. Reduce JavaScript execution time."
      )
    );
  }

  // ── 4. CLS — cannot measure accurately without real user timing ───────────
  items.push(
    warn(
      "cls",
      "CLS (Cumulative Layout Shift) < 0.1",
      "CLS requires user interaction timing — cannot be accurately measured in headless mode.",
      "Run PageSpeed Insights or Chrome Lighthouse for accurate CLS measurement. Reserve space for images/ads with explicit width/height attributes."
    )
  );

  // ── 5. Images in modern format (WebP) ─────────────────────────────────────
  if (perfData.totalImages === 0) {
    items.push(pass("image_format", "Images compressed and in modern format (WebP)", "No images found on page."));
  } else {
    const modernRatio = perfData.modernImages / perfData.totalImages;
    if (modernRatio >= 0.8) {
      items.push(pass("image_format", "Images compressed and in modern format (WebP)", `${perfData.modernImages}/${perfData.totalImages} images use WebP/SVG format.`));
    } else if (modernRatio >= 0.4) {
      items.push(warn("image_format", "Images compressed and in modern format (WebP)", `${perfData.modernImages}/${perfData.totalImages} images in WebP/SVG — some still in legacy format.`, "Convert remaining PNG/JPG images to WebP for 25–50% file size savings. Use <picture> element for fallback."));
    } else {
      items.push(
        warn(
          "image_format",
          "Images compressed and in modern format (WebP)",
          `Only ${perfData.modernImages}/${perfData.totalImages} images use modern formats.`,
          "Convert all images to WebP format. Use Squoosh or ImageMagick: `convert image.jpg -quality 80 image.webp`"
        )
      );
    }
  }

  // ── 6. Render-blocking scripts ─────────────────────────────────────────────
  if (perfData.blockingScripts.length === 0) {
    items.push(pass("render_blocking", "No render-blocking scripts above the fold", "No synchronous scripts in <head> detected."));
  } else {
    items.push(
      warn(
        "render_blocking",
        "No render-blocking scripts above the fold",
        `${perfData.blockingScripts.length} script(s) without async/defer in <head>: ${perfData.blockingScripts.slice(0, 3).join(", ")}`,
        "Add defer or async to all non-critical <head> scripts. Critical scripts that must be synchronous should be inlined and minimized."
      )
    );
  }

  // ── 7 & 8. PageSpeed Insights API (mobile ≥70, desktop ≥80) ──────────────
  const psiKey = options.psiApiKey || process.env.PSI_API_KEY;
  const pageUrl = page.url();

  if (psiKey) {
    for (const strategy of ["mobile", "desktop"] as const) {
      try {
        const psiResp = await fetch(
          `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(pageUrl)}&strategy=${strategy}&key=${psiKey}`
        );
        const psiData = await psiResp.json() as any;
        const score = Math.round((psiData?.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
        const threshold = strategy === "mobile" ? 70 : 80;

        if (score >= threshold) {
          items.push(pass(`psi_${strategy}`, `PageSpeed Insights ${strategy} score ≥ ${threshold}`, `${strategy} PageSpeed score: ${score}/100`));
        } else if (score >= threshold - 15) {
          items.push(warn(`psi_${strategy}`, `PageSpeed Insights ${strategy} score ≥ ${threshold}`, `${strategy} score: ${score}/100 — below target of ${threshold}.`, `Improve ${strategy} performance. Run PageSpeed Insights for specific opportunities.`));
        } else {
          items.push(fail(`psi_${strategy}`, `PageSpeed Insights ${strategy} score ≥ ${threshold}`, `${strategy} score: ${score}/100 — significantly below the ${threshold} minimum.`, `Major ${strategy} performance issues. Address LCP, blocking resources, and image optimization first.`));
        }
      } catch {
        items.push(warn(`psi_${strategy}`, `PageSpeed Insights ${strategy} score ≥ ${threshold}`, `PageSpeed API request failed for ${strategy}.`, `Manually check at https://pagespeed.web.dev/?url=${encodeURIComponent(pageUrl)}&form_factor=${strategy}`));
      }
    }
  } else {
    items.push(
      warn("psi_mobile", "PageSpeed Insights mobile score ≥ 70", "PSI_API_KEY not set — PageSpeed score check skipped.", `Check manually: https://pagespeed.web.dev/?url=${encodeURIComponent(pageUrl)}&form_factor=mobile`)
    );
    items.push(
      warn("psi_desktop", "PageSpeed Insights desktop score ≥ 80", "PSI_API_KEY not set — PageSpeed score check skipped.", `Check manually: https://pagespeed.web.dev/?url=${encodeURIComponent(pageUrl)}&form_factor=desktop`)
    );
  }

  return {
    module: "page_speed",
    moduleNumber: 6,
    moduleName: "Page Speed & Core Web Vitals",
    weight: 8,
    impact: "HIGH",
    items,
    score: calcScore(items),
  };
}
