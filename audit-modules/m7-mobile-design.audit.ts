/**
 * PageScoreIQ — Module 7: Mobile & Design Compliance (Weight: 5%, Impact: MEDIUM)
 *
 * Over 60% of Google Ads clicks happen on mobile.
 * Google's policy requires a functional, non-intrusive mobile experience.
 *
 * Checks:
 *  - Page is fully mobile responsive
 *  - No intrusive interstitials / popups on mobile
 *  - Viewport meta tag correctly set
 *  - Touch targets (buttons/links) ≥ 44px
 *  - No horizontal scroll on mobile (320px)
 *  - CTA button visible above fold on mobile
 *  - Fonts legible on mobile (≥ 16px body text)
 *  - Form fields usable on mobile keyboard
 */

import { Page } from "playwright";
import { ModuleResult, pass, fail, warn, calcScore } from "./types";

export async function auditMobileDesign(page: Page): Promise<ModuleResult> {
  const items = [];

  // ── 1. Viewport meta tag ──────────────────────────────────────────────────
  const viewportMeta = await page.evaluate(() => {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
    return {
      present: !!meta,
      content: meta?.content || "",
    };
  });

  const viewportContent = viewportMeta.content.toLowerCase();
  if (
    viewportMeta.present &&
    viewportContent.includes("width=device-width") &&
    !viewportContent.includes("user-scalable=no") // user-scalable=no is bad for accessibility
  ) {
    items.push(pass("viewport_meta", "Viewport meta tag correctly set", `Viewport: "${viewportMeta.content}"`));
  } else if (viewportMeta.present) {
    if (viewportContent.includes("user-scalable=no")) {
      items.push(warn("viewport_meta", "Viewport meta tag correctly set", `Viewport has user-scalable=no: "${viewportMeta.content}"`, "Remove user-scalable=no — prevents pinch-to-zoom and fails accessibility requirements."));
    } else {
      items.push(
        fail(
          "viewport_meta",
          "Viewport meta tag correctly set",
          `Viewport content "${viewportMeta.content}" is missing width=device-width.`,
          "Set viewport to: <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">"
        )
      );
    }
  } else {
    items.push(
      fail(
        "viewport_meta",
        "Viewport meta tag correctly set",
        "No viewport meta tag found.",
        "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"> to your <head>. Without it, mobile browsers render at desktop width."
      )
    );
  }

  // ── Switch to mobile viewport for remaining checks ────────────────────────
  const originalViewport = page.viewportSize();
  await page.setViewportSize({ width: 375, height: 812 }); // iPhone 12 dimensions

  // ── 2. Horizontal scroll at 320px ─────────────────────────────────────────
  const scrollData = await page.evaluate(() => {
    const scrollWidth = document.documentElement.scrollWidth;
    const clientWidth = document.documentElement.clientWidth;
    const hasHorizontalScroll = scrollWidth > clientWidth + 5; // 5px tolerance

    // Check for elements causing overflow
    const offendingElements: string[] = [];
    if (hasHorizontalScroll) {
      Array.from(document.querySelectorAll("*")).forEach((el) => {
        const rect = el.getBoundingClientRect();
        if (rect.right > clientWidth + 10) {
          const tag = el.tagName.toLowerCase();
          const cls = el.className?.toString().slice(0, 30) || "";
          offendingElements.push(`${tag}${cls ? "." + cls.split(" ")[0] : ""}`);
        }
      });
    }

    return {
      scrollWidth,
      clientWidth,
      hasHorizontalScroll,
      offendingElements: offendingElements.slice(0, 5),
    };
  });

  if (!scrollData.hasHorizontalScroll) {
    items.push(pass("no_horizontal_scroll", "No horizontal scroll on mobile (320px)", `Page width fits within viewport (${scrollData.clientWidth}px viewport, ${scrollData.scrollWidth}px content).`));
  } else {
    items.push(
      fail(
        "no_horizontal_scroll",
        "No horizontal scroll on mobile (320px)",
        `Horizontal overflow: content is ${scrollData.scrollWidth}px wide in ${scrollData.clientWidth}px viewport.${scrollData.offendingElements.length > 0 ? ` Offending elements: ${scrollData.offendingElements.join(", ")}` : ""}`,
        "Fix overflow issues: use max-width: 100% on images, avoid fixed pixel widths on elements wider than viewport, use responsive flexbox/grid."
      )
    );
  }

  // ── 3. Intrusive interstitials ────────────────────────────────────────────
  const interstitialData = await page.evaluate(() => {
    // Look for full-screen overlays or popups
    const overlays = Array.from(document.querySelectorAll("*")).filter((el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      const isFixed = style.position === "fixed" || style.position === "sticky";
      const isLarge = rect.width > window.innerWidth * 0.8 && rect.height > window.innerHeight * 0.5;
      const isVisible = style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
      return isFixed && isLarge && isVisible;
    });

    const popupSelectors = [
      '[class*="popup"]',
      '[class*="modal"]',
      '[class*="overlay"]',
      '[class*="interstitial"]',
      '[id*="popup"]',
      '[id*="modal"]',
    ];
    const popupElements = popupSelectors.flatMap((sel) => Array.from(document.querySelectorAll(sel))).filter((el) => {
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    });

    return {
      overlayCount: overlays.length,
      popupCount: popupElements.length,
    };
  });

  if (interstitialData.overlayCount > 0) {
    items.push(
      fail(
        "interstitials",
        "No intrusive interstitials / popups on mobile",
        `${interstitialData.overlayCount} full-screen overlay(s) detected on mobile load.`,
        "Remove popups that cover the main content on mobile. Google penalises interstitials that block content immediately on page load."
      )
    );
  } else if (interstitialData.popupCount > 0) {
    items.push(
      warn(
        "interstitials",
        "No intrusive interstitials / popups on mobile",
        `${interstitialData.popupCount} popup/modal element(s) found in DOM (may be hidden).`,
        "Ensure popups don't trigger on page load on mobile. Delay or suppress them. Google's interstitial penalty applies to mobile."
      )
    );
  } else {
    items.push(pass("interstitials", "No intrusive interstitials / popups on mobile", "No full-screen overlays detected on mobile load."));
  }

  // ── 4. Touch targets ≥ 44px ───────────────────────────────────────────────
  const touchTargetData = await page.evaluate(() => {
    const interactiveEls = Array.from(
      document.querySelectorAll("a, button, input[type='submit'], input[type='button'], [role='button'], select")
    );
    const smallTargets = interactiveEls.filter((el) => {
      const rect = el.getBoundingClientRect();
      return (rect.width < 44 || rect.height < 44) && rect.width > 0 && rect.height > 0;
    });
    return { total: interactiveEls.length, small: smallTargets.length };
  });

  if (touchTargetData.small === 0) {
    items.push(pass("touch_targets", "Touch targets (buttons/links) ≥ 44px", `All ${touchTargetData.total} interactive elements meet 44px minimum touch target size.`));
  } else if (touchTargetData.small <= 3) {
    items.push(warn("touch_targets", "Touch targets (buttons/links) ≥ 44px", `${touchTargetData.small} of ${touchTargetData.total} interactive elements are smaller than 44px.`, "Increase button/link size to at least 44×44px. Add padding if necessary."));
  } else {
    items.push(
      warn(
        "touch_targets",
        "Touch targets (buttons/links) ≥ 44px",
        `${touchTargetData.small} of ${touchTargetData.total} interactive elements are below 44px minimum.`,
        "Apply min-height: 44px and min-width: 44px to all interactive elements for mobile usability."
      )
    );
  }

  // ── 5. CTA visible above fold on mobile ───────────────────────────────────
  const ctaAboveFold = await page.evaluate(() => {
    const viewportHeight = window.innerHeight;
    const ctaSelectors = [
      'button[type="submit"]',
      'a[href*="contact"]',
      'a[href*="quote"]',
      'a[href*="get-started"]',
      'a[href*="free"]',
      '[class*="cta"]',
      '[class*="btn-primary"]',
      '[class*="button-primary"]',
    ];
    for (const sel of ctaSelectors) {
      const el = document.querySelector(sel);
      if (el) {
        const rect = el.getBoundingClientRect();
        return { found: true, aboveFold: rect.top < viewportHeight && rect.bottom > 0, top: Math.round(rect.top) };
      }
    }

    // Try any button-like element
    const buttons = Array.from(document.querySelectorAll("button, .btn, .button, input[type='submit']"));
    for (const btn of buttons) {
      const rect = btn.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        return { found: true, aboveFold: rect.top < viewportHeight, top: Math.round(rect.top) };
      }
    }
    return { found: false, aboveFold: false, top: -1 };
  });

  if (!ctaAboveFold.found) {
    items.push(warn("cta_above_fold", "CTA button visible above fold on mobile", "No CTA button detected on page.", "Add a prominent call-to-action button. Place it above the fold (visible without scrolling on mobile)."));
  } else if (ctaAboveFold.aboveFold) {
    items.push(pass("cta_above_fold", "CTA button visible above fold on mobile", "Primary CTA button found above the fold on mobile."));
  } else {
    items.push(
      warn(
        "cta_above_fold",
        "CTA button visible above fold on mobile",
        `CTA button is below the fold on mobile (${ctaAboveFold.top}px from top of viewport).`,
        "Move the primary CTA button higher in the mobile layout so it's visible without scrolling."
      )
    );
  }

  // ── 6. Body font size ≥ 16px ──────────────────────────────────────────────
  const fontData = await page.evaluate(() => {
    const body = document.body;
    if (!body) return { fontSize: 0, legible: false };
    const computedSize = parseFloat(window.getComputedStyle(body).fontSize);
    // Also check paragraph text
    const paragraphs = Array.from(document.querySelectorAll("p, li")).slice(0, 10);
    const smallText = paragraphs.filter((el) => parseFloat(window.getComputedStyle(el).fontSize) < 14).length;
    return { fontSize: computedSize, legible: computedSize >= 16, smallTextCount: smallText };
  });

  if (fontData.legible) {
    items.push(pass("font_size", "Fonts legible on mobile (≥ 16px body text)", `Body font size: ${fontData.fontSize}px — meets 16px minimum.`));
  } else {
    items.push(
      warn(
        "font_size",
        "Fonts legible on mobile (≥ 16px body text)",
        `Body font size: ${fontData.fontSize}px — below 16px recommendation.`,
        "Set base font size to at least 16px: body { font-size: 16px; } — this prevents browsers from auto-zooming on form focus."
      )
    );
  }

  // ── 7. Mobile-responsive layout (no fixed-width containers) ───────────────
  const responsiveCheck = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const fixedWidthEls = Array.from(document.querySelectorAll("*")).filter((el) => {
      const style = window.getComputedStyle(el);
      const width = style.width;
      if (width.endsWith("px")) {
        const px = parseFloat(width);
        return px > viewportWidth + 5;
      }
      return false;
    });
    return { fixedWidthCount: fixedWidthEls.length };
  });

  if (responsiveCheck.fixedWidthCount === 0) {
    items.push(pass("responsive_layout", "Page is fully mobile responsive", "No fixed-width elements wider than viewport detected."));
  } else {
    items.push(
      fail(
        "responsive_layout",
        "Page is fully mobile responsive",
        `${responsiveCheck.fixedWidthCount} element(s) with fixed width exceeding viewport.`,
        "Use responsive CSS: max-width: 100%, flexbox, or CSS grid instead of fixed pixel widths."
      )
    );
  }

  // ── 8. Mobile input types ─────────────────────────────────────────────────
  const formInputData = await page.evaluate(() => {
    const emailInputs = Array.from(document.querySelectorAll("input[type='email']")).length;
    const telInputs = Array.from(document.querySelectorAll("input[type='tel']")).length;
    const numberInputs = Array.from(document.querySelectorAll("input[type='number']")).length;
    const textInputs = Array.from(document.querySelectorAll("input[type='text'], input:not([type])"));

    // Check text inputs that look like email/phone
    const miscTyped = textInputs.filter((el) => {
      const input = el as HTMLInputElement;
      const combined = (input.name + input.id + input.placeholder).toLowerCase();
      return combined.includes("email") || combined.includes("phone") || combined.includes("tel");
    }).length;

    return { emailInputs, telInputs, numberInputs, miscTyped };
  });

  if (formInputData.miscTyped > 0) {
    items.push(
      warn(
        "mobile_inputs",
        "Form fields usable on mobile keyboard",
        `${formInputData.miscTyped} field(s) that appear to be email/phone are using type="text" instead of correct type.`,
        "Use type='email' for email fields and type='tel' for phone fields. This triggers the correct mobile keyboard."
      )
    );
  } else {
    items.push(pass("mobile_inputs", "Form fields usable on mobile keyboard", `Form inputs use correct types. Email inputs: ${formInputData.emailInputs}, Tel inputs: ${formInputData.telInputs}.`));
  }

  // Restore original viewport
  if (originalViewport) {
    await page.setViewportSize(originalViewport);
  }

  return {
    module: "mobile_design",
    moduleNumber: 7,
    moduleName: "Mobile & Design Compliance",
    weight: 5,
    impact: "MEDIUM",
    items,
    score: calcScore(items),
  };
}
