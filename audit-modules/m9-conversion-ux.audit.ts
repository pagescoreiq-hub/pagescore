/**
 * PageScoreIQ — Module 9: Conversion & UX Quality (Weight: 8%, Impact: MEDIUM)
 *
 * A page that passes policy checks but converts poorly still wastes ad spend.
 * This module checks conversion readiness and UX quality.
 *
 * Checks:
 *  - Clear primary CTA button present above fold
 *  - CTA text is action-oriented (not just 'Submit')
 *  - Form fields minimal (≤ 5 fields)
 *  - Thank-you / confirmation page link with conversion tag
 *  - Trust signals present (reviews, logos, certifications)
 *  - No exit-blocking scripts that prevent back navigation
 *  - Page is free of broken images or broken links
 *  - Social proof (rating, count) visible
 */

import { Page } from "playwright";
import { ModuleResult, pass, fail, warn, calcScore } from "./types";

const WEAK_CTA_LABELS = new Set(["submit", "send", "go", "ok", "click here", "button", "next", "continue", "enter"]);

const STRONG_CTA_PATTERNS = [
  /get.*(free|quote|started|demo|trial)/i,
  /start.*(free|now|today)/i,
  /request.*(quote|demo|callback)/i,
  /book.*(free|now|call|demo)/i,
  /claim.*(offer|discount|trial)/i,
  /download.*(free|now|guide)/i,
  /sign.up/i,
  /try.*(free|now)/i,
  /contact.*(us|now)/i,
  /learn.more/i,
  /schedule/i,
  /register/i,
];

export async function auditConversionUx(page: Page): Promise<ModuleResult> {
  const items = [];
  const viewportHeight = (await page.evaluate(() => window.innerHeight)) ?? 800;

  // ── 1 & 2. CTA presence and quality ──────────────────────────────────────
  const ctaData = await page.evaluate((vh: number) => {
    const ctaSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'a.btn', 'a.button', '.btn-primary', '.cta-button', '.cta',
      '[class*="cta"]', '[class*="btn-primary"]', '[class*="button--primary"]',
      'button', 'a[href]',
    ];

    let primaryCta: { text: string; aboveFold: boolean; top: number } | null = null;
    const allCtaTexts: string[] = [];

    for (const sel of ctaSelectors) {
      const elements = Array.from(document.querySelectorAll(sel));
      for (const el of elements) {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        const text = ((el as HTMLElement).innerText || (el as HTMLInputElement).value || "").trim();
        if (!text || text.length > 80) continue;
        allCtaTexts.push(text);
        if (!primaryCta) {
          primaryCta = { text, aboveFold: rect.top < vh, top: Math.round(rect.top) };
        }
      }
      if (primaryCta) break;
    }

    return { primaryCta, allCtaTexts: allCtaTexts.slice(0, 10) };
  }, viewportHeight);

  if (!ctaData.primaryCta) {
    items.push(fail("cta_present", "Clear primary CTA button present above fold", "No CTA button detected.", "Add a prominent CTA button above the fold. It should be the first action a user sees."));
    items.push(warn("cta_text", "CTA text is action-oriented (not just 'Submit')", "No CTA found to evaluate.", "Use action-oriented text like 'Get Free Quote', 'Start Today', 'Book a Demo'."));
  } else {
    const cta = ctaData.primaryCta;
    if (cta.aboveFold) {
      items.push(pass("cta_present", "Clear primary CTA button present above fold", `CTA found above fold: "${cta.text.slice(0, 60)}"`));
    } else {
      items.push(
        warn(
          "cta_present",
          "Clear primary CTA button present above fold",
          `Primary CTA "${cta.text.slice(0, 60)}" is ${cta.top}px from top — below the fold.`,
          "Move the primary CTA above the fold. Users should see it without scrolling."
        )
      );
    }

    // CTA text quality
    const ctaLower = cta.text.toLowerCase().trim();
    const isWeak = WEAK_CTA_LABELS.has(ctaLower);
    const isStrong = STRONG_CTA_PATTERNS.some((p) => p.test(cta.text));

    if (isStrong) {
      items.push(pass("cta_text", "CTA text is action-oriented (not just 'Submit')", `Strong CTA text: "${cta.text}"`));
    } else if (isWeak) {
      items.push(warn("cta_text", "CTA text is action-oriented (not just 'Submit')", `Weak CTA text: "${cta.text}"`, "Replace generic text with specific action: 'Get Free Quote', 'Start Today', 'Book Free Demo'."));
    } else {
      items.push(warn("cta_text", "CTA text is action-oriented (not just 'Submit')", `CTA text "${cta.text}" — verify it communicates clear value.`, "Use benefit-driven CTA text: 'Get My Free Quote' outperforms 'Submit' by 2–3x."));
    }
  }

  // ── 3. Form field count ───────────────────────────────────────────────────
  const formData = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll("form"));
    const counts = forms.map((form) => ({
      count: Array.from(form.querySelectorAll("input, select, textarea")).filter(
        (el) => !["hidden", "submit", "button", "reset"].includes((el as HTMLInputElement).type)
      ).length,
    }));
    return { formCount: forms.length, fieldCounts: counts };
  });

  if (formData.formCount === 0) {
    items.push(warn("form_fields", "Form fields are minimal (≤ 5 fields)", "No forms found on page.", "Add a lead capture form for conversion tracking."));
  } else {
    const maxFields = Math.max(...formData.fieldCounts.map((f) => f.count));
    if (maxFields <= 5) {
      items.push(pass("form_fields", "Form fields are minimal (≤ 5 fields)", `${maxFields} visible field(s) — within optimal range.`));
    } else {
      items.push(
        warn(
          "form_fields",
          "Form fields are minimal (≤ 5 fields)",
          `${maxFields} visible form fields — exceeds 5-field best practice.`,
          "Reduce to ≤ 5 fields. Ask only what's needed to qualify the lead. Move optional fields to step 2."
        )
      );
    }
  }

  // ── 4. Thank-you page link ─────────────────────────────────────────────────
  const tyPageData = await page.evaluate(() => {
    const allLinks = Array.from(document.querySelectorAll("a")).map((a) => a.href?.toLowerCase() || "");
    const hasThankYouLink = allLinks.some(
      (href) =>
        href.includes("thank") ||
        href.includes("thankyou") ||
        href.includes("thank-you") ||
        href.includes("success") ||
        href.includes("confirmed") ||
        href.includes("confirmation")
    );

    // Check form actions
    const formActions = Array.from(document.querySelectorAll("form")).map(
      (f) => f.action?.toLowerCase() || ""
    );
    const formRedirectsToTy = formActions.some(
      (a) => a.includes("thank") || a.includes("success") || a.includes("confirm")
    );

    return { hasThankYouLink: hasThankYouLink || formRedirectsToTy };
  });

  if (tyPageData.hasThankYouLink) {
    items.push(warn("thankyou_page", "Thank-you / confirmation page with conversion tag", "Thank-you page reference found. Verify conversion tag fires on that page.", "Confirm GA4 purchase/lead event and Google Ads conversion tag fire when the thank-you page loads."));
  } else {
    items.push(
      fail(
        "thankyou_page",
        "Thank-you / confirmation page with conversion tag",
        "No thank-you or success page link/action found.",
        "Set up a /thank-you page that loads after form submission. Place your GA4 conversion event and Google Ads conversion tag on this page."
      )
    );
  }

  // ── 5. Trust signals ──────────────────────────────────────────────────────
  const trustData = await page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() || "";
    const hasReviews = text.includes("review") || text.includes("testimonial") || text.includes("what our customers") || text.includes("what clients say");
    const hasRatings = text.match(/\d+(\.\d+)?\s*(star|\/5|out of 5|rating)/i) !== null;
    const hasCertLogos = document.querySelectorAll('[class*="trust"], [class*="badge"], [class*="award"], [class*="certif"], [class*="partner"]').length > 0;
    const hasGoogleReview = text.includes("google reviews") || text.includes("trustpilot") || text.includes("clutch");
    return { hasReviews, hasRatings, hasCertLogos, hasGoogleReview };
  });

  const trustSignalCount = [trustData.hasReviews, trustData.hasRatings, trustData.hasCertLogos, trustData.hasGoogleReview].filter(Boolean).length;

  if (trustSignalCount >= 2) {
    items.push(pass("trust_signals", "Trust signals present (reviews, logos, certifications)", "Multiple trust signals detected (reviews, ratings, or badge elements)."));
  } else if (trustSignalCount === 1) {
    items.push(warn("trust_signals", "Trust signals present (reviews, logos, certifications)", "Only one type of trust signal detected.", "Add testimonials, star ratings, client logos, or third-party review badges (Google, Trustpilot, Clutch)."));
  } else {
    items.push(warn("trust_signals", "Trust signals present (reviews, logos, certifications)", "No trust signals detected.", "Add customer testimonials, star ratings, partner logos, or certification badges. Trust signals improve conversion rate by 10–30%."));
  }

  // ── 6. Exit-blocking scripts ──────────────────────────────────────────────
  const exitBlockData = await page.evaluate(() => {
    const scriptTexts = Array.from(document.querySelectorAll("script:not([src])")).map((s) => s.textContent || "");
    const combined = scriptTexts.join(" ");
    const hasBeforeUnload = combined.includes("beforeunload") || combined.includes("onbeforeunload");
    const hasHistoryBlock = combined.includes("history.pushState") && combined.includes("popstate");
    return { hasBeforeUnload, hasHistoryBlock };
  });

  if (exitBlockData.hasBeforeUnload || exitBlockData.hasHistoryBlock) {
    items.push(
      fail(
        "exit_blocking",
        "No exit-blocking scripts that prevent back navigation",
        `Exit-blocking script detected (${exitBlockData.hasBeforeUnload ? "beforeunload handler" : ""}${exitBlockData.hasHistoryBlock ? " history manipulation" : ""}).`,
        "Remove beforeunload event handlers and history manipulation that trap users. This violates Google Ads policy and frustrates users."
      )
    );
  } else {
    items.push(pass("exit_blocking", "No exit-blocking scripts that prevent back navigation", "No exit-blocking scripts detected."));
  }

  // ── 7. Broken images ─────────────────────────────────────────────────────
  const brokenImages = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll("img"));
    return imgs
      .filter((img) => !img.complete || img.naturalWidth === 0)
      .map((img) => img.src?.slice(0, 80) || "no-src")
      .slice(0, 5);
  });

  if (brokenImages.length === 0) {
    items.push(pass("broken_images", "Page is free of broken images or broken links", "No broken images detected."));
  } else {
    items.push(
      fail(
        "broken_images",
        "Page is free of broken images or broken links",
        `${brokenImages.length} broken image(s) detected: ${brokenImages.join(", ")}`,
        "Fix all broken images. Broken images signal a poorly maintained page to Google and damage user trust."
      )
    );
  }

  // ── 8. Social proof ────────────────────────────────────────────────────────
  const socialProofData = await page.evaluate(() => {
    const text = document.body?.innerText?.toLowerCase() || "";
    // Look for customer count, star ratings, review counts
    const hasCount = /\d{2,}[\s,+]*(customers|clients|businesses|companies|users|reviews|projects)/i.test(text);
    const hasStars = /[1-5]\s*(star|\/5|\.\d\s*star)/i.test(text) || !!document.querySelector('[class*="star"], [class*="rating"]');
    const hasReviewCount = /\d+\s*(reviews|ratings|testimonials)/i.test(text);
    return { hasCount, hasStars, hasReviewCount };
  });

  const hasSocialProof = socialProofData.hasCount || socialProofData.hasStars || socialProofData.hasReviewCount;

  if (hasSocialProof) {
    items.push(pass("social_proof", "Social proof (rating, count) visible", "Social proof detected (customer count, star rating, or review count)."));
  } else {
    items.push(
      warn(
        "social_proof",
        "Social proof (rating, count) visible",
        "No customer count, star rating, or review count detected.",
        "Add visible social proof: '500+ clients', '4.9/5 stars', or '200+ reviews'. Social proof near CTAs increases conversion by 15–20%."
      )
    );
  }

  return {
    module: "conversion_ux",
    moduleNumber: 9,
    moduleName: "Conversion & UX Quality",
    weight: 8,
    impact: "MEDIUM",
    items,
    score: calcScore(items),
  };
}
