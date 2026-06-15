/**
 * PageScoreIQ — Module 4: Content & Ad Policy Compliance (Weight: 12%, Impact: CRITICAL)
 *
 * Google requires landing page content to be directly relevant to the ad.
 * Misleading content, prohibited products, or content mismatch causes disapproval.
 *
 * Checks:
 *  - Ad headline matches / aligns with page H1
 *  - Landing page offer matches ad offer
 *  - No prohibited content
 *  - No countdown timers with fake urgency
 *  - No auto-play audio or intrusive video
 *  - Business name / brand clearly visible
 *  - Contact details visible
 *  - No keyword stuffing or hidden text
 *  - Page language matches ad
 */

import { Page } from "playwright";
import { ModuleResult, pass, fail, warn, calcScore } from "./types";

export interface ContentPolicyAuditOptions {
  /** Primary campaign keyword from the ad */
  primaryKeyword?: string;
  /** Ad headline text */
  adHeadline?: string;
}

const PROHIBITED_CONTENT_TERMS = [
  // Weapons
  "buy guns", "buy firearms", "ammunition for sale", "silencer",
  // Gambling
  "online casino", "sports betting", "place your bets",
  // Adult
  "xxx", "adult videos", "pornography",
  // Drugs
  "buy weed", "buy marijuana", "buy cocaine",
];

export async function auditContentPolicy(
  page: Page,
  options: ContentPolicyAuditOptions = {}
): Promise<ModuleResult> {
  const items = [];

  const contentData = await page.evaluate(() => {
    // ── Headlines ──────────────────────────────────────────────────────────
    const h1s = Array.from(document.querySelectorAll("h1")).map((h) => h.innerText.trim());

    // ── Page text ──────────────────────────────────────────────────────────
    const bodyText = document.body?.innerText || "";
    const bodyTextLower = bodyText.toLowerCase();

    // ── Brand / business name ──────────────────────────────────────────────
    const logoPresent = document.querySelectorAll('img[class*="logo"], img[id*="logo"], [class*="logo"] img, [class*="brand"] img').length > 0;
    const companyNameInHeader = !!document.querySelector("header");

    // ── Contact information ────────────────────────────────────────────────
    const phonePattern = /(\+?\d[\d\s\-().]{7,}\d)/;
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const addressPattern = /\d+\s+\w+\s+(street|st|avenue|ave|road|rd|lane|ln|drive|dr|blvd|boulevard)/i;

    const hasPhone = phonePattern.test(bodyText);
    const hasEmail = emailPattern.test(bodyText);
    const hasAddress = addressPattern.test(bodyText);

    // ── Countdown timers ──────────────────────────────────────────────────
    const countdownElements = document.querySelectorAll(
      '[class*="countdown"], [class*="timer"], [id*="countdown"], [id*="timer"]'
    );
    const hasCountdown = countdownElements.length > 0;

    // ── Auto-play media ────────────────────────────────────────────────────
    const autoPlayVideos = Array.from(document.querySelectorAll("video")).filter(
      (v) => v.autoplay && !v.muted
    );
    const autoPlayAudio = Array.from(document.querySelectorAll("audio")).filter((a) => a.autoplay);
    const hasAutoPlayMedia = autoPlayVideos.length > 0 || autoPlayAudio.length > 0;

    // ── Hidden text ────────────────────────────────────────────────────────
    const hiddenElements = Array.from(document.querySelectorAll("*")).filter((el) => {
      const style = window.getComputedStyle(el);
      const text = (el as HTMLElement).innerText?.trim();
      return (
        text &&
        text.length > 20 &&
        (style.color === style.backgroundColor ||
          style.fontSize === "0px" ||
          style.opacity === "0" ||
          (style.position === "absolute" &&
            (parseInt(style.left) < -900 || parseInt(style.top) < -900)))
      );
    });
    const hasHiddenText = hiddenElements.length > 0;

    // ── Page language ──────────────────────────────────────────────────────
    const htmlLang = document.documentElement.lang || "";

    return {
      h1s,
      bodyTextLower: bodyTextLower.slice(0, 3000),
      logoPresent,
      companyNameInHeader,
      hasPhone,
      hasEmail,
      hasAddress,
      hasCountdown,
      hasAutoPlayMedia,
      hasHiddenText,
      htmlLang,
    };
  });

  // ── 1. Ad headline vs H1 alignment ────────────────────────────────────────
  const { adHeadline, primaryKeyword } = options;

  if (adHeadline && contentData.h1s.length > 0) {
    const h1 = contentData.h1s[0].toLowerCase();
    const hl = adHeadline.toLowerCase();
    // Check for meaningful word overlap (exclude stopwords)
    const stopwords = new Set(["the", "a", "an", "in", "on", "at", "to", "for", "of", "and", "or", "is", "are", "with"]);
    const hlWords = hl.split(/\s+/).filter((w) => w.length > 2 && !stopwords.has(w));
    const matchedWords = hlWords.filter((w) => h1.includes(w));
    const overlapRatio = hlWords.length > 0 ? matchedWords.length / hlWords.length : 0;

    if (overlapRatio >= 0.5) {
      items.push(pass("headline_match", "Ad headline matches or aligns with page H1", `Good alignment. H1: "${contentData.h1s[0].slice(0, 80)}" vs Ad: "${adHeadline.slice(0, 80)}"`));
    } else {
      items.push(
        fail(
          "headline_match",
          "Ad headline matches or aligns with page H1",
          `Low alignment between H1 ("${contentData.h1s[0].slice(0, 60)}") and ad headline ("${adHeadline.slice(0, 60)}").`,
          "Align the H1 with your primary keyword and ad copy. Users expect to land on content that matches the ad they clicked."
        )
      );
    }
  } else if (adHeadline) {
    items.push(fail("headline_match", "Ad headline matches or aligns with page H1", "No H1 found — cannot compare with ad headline.", "Add an H1 that matches your ad headline and primary keyword."));
  } else {
    items.push(warn("headline_match", "Ad headline matches or aligns with page H1", "No ad headline provided — alignment check skipped.", "Provide --headline flag to enable ad-to-H1 alignment check."));
  }

  // ── 2. Landing page offer matches ad (heuristic) ──────────────────────────
  if (primaryKeyword) {
    const kwLower = primaryKeyword.toLowerCase();
    const kwWords = kwLower.split(/\s+/).filter((w) => w.length > 2);
    const matchedInBody = kwWords.filter((w) => contentData.bodyTextLower.includes(w)).length;
    const ratio = kwWords.length > 0 ? matchedInBody / kwWords.length : 0;

    if (ratio >= 0.6) {
      items.push(pass("offer_match", "Landing page offer matches ad offer exactly", `Primary keyword "${primaryKeyword}" well-represented in page content.`));
    } else {
      items.push(
        fail(
          "offer_match",
          "Landing page offer matches ad offer exactly",
          `Keyword "${primaryKeyword}" poorly represented on page (${Math.round(ratio * 100)}% word match).`,
          "Ensure the CTA, offer, and product described on the landing page exactly match what the ad promises."
        )
      );
    }
  } else {
    items.push(warn("offer_match", "Landing page offer matches ad offer exactly", "No primary keyword provided — offer match check skipped.", "Provide --keyword flag to enable keyword relevance check."));
  }

  // ── 3. Prohibited content ─────────────────────────────────────────────────
  const prohibitedFound = PROHIBITED_CONTENT_TERMS.filter((term) =>
    contentData.bodyTextLower.includes(term.toLowerCase())
  );

  if (prohibitedFound.length > 0) {
    items.push(
      fail(
        "prohibited_content",
        "No prohibited content (adult, gambling, weapons, etc.)",
        `Potentially prohibited terms found: "${prohibitedFound.join('", "')}".`,
        "Review Google Ads content policy at https://support.google.com/adspolicy/. Remove or restructure prohibited content."
      )
    );
  } else {
    items.push(pass("prohibited_content", "No prohibited content (adult, gambling, weapons, etc.)", "No obvious prohibited content keywords detected."));
  }

  // ── 4. Countdown timers with fake urgency ─────────────────────────────────
  if (contentData.hasCountdown) {
    items.push(
      warn(
        "countdown_timers",
        "No countdown timers with fake urgency",
        "Countdown timer element(s) detected on page.",
        "If the countdown does not reflect a real, verifiable deadline, remove it. Google Ads policy prohibits misleading scarcity tactics."
      )
    );
  } else {
    items.push(pass("countdown_timers", "No countdown timers with fake urgency", "No countdown timer elements detected."));
  }

  // ── 5. Auto-play audio / intrusive video ──────────────────────────────────
  if (contentData.hasAutoPlayMedia) {
    items.push(
      warn(
        "autoplay_media",
        "No auto-play audio or intrusive video",
        "Auto-playing unmuted audio or video detected.",
        "Disable auto-play or ensure video is muted by default. Auto-play audio violates Google Ads landing page policy."
      )
    );
  } else {
    items.push(pass("autoplay_media", "No auto-play audio or intrusive video", "No unmuted auto-play media detected."));
  }

  // ── 6. Business name / brand visible ──────────────────────────────────────
  if (contentData.logoPresent || contentData.companyNameInHeader) {
    items.push(warn("brand_visible", "Business name / brand clearly visible", "Brand elements detected (logo or header). Verify branding is clear and above fold.", "Ensure your logo and company name are prominent and visible above the fold on all devices."));
  } else {
    items.push(
      warn(
        "brand_visible",
        "Business name / brand clearly visible",
        "No logo or branded header element detected.",
        "Add your logo and company name above the fold. Google Ads requires clear business identification."
      )
    );
  }

  // ── 7. Contact details visible ────────────────────────────────────────────
  const contactCount = [contentData.hasPhone, contentData.hasEmail, contentData.hasAddress].filter(Boolean).length;

  if (contactCount >= 2) {
    items.push(pass("contact_visible", "Contact details visible (phone, email, address)", `${contactCount} contact method(s) found (phone: ${contentData.hasPhone}, email: ${contentData.hasEmail}, address: ${contentData.hasAddress}).`));
  } else if (contactCount === 1) {
    items.push(
      warn(
        "contact_visible",
        "Contact details visible (phone, email, address)",
        "Only one contact method detected.",
        "Display at least 2 contact methods (phone + email recommended). Required by Google Ads for trust and policy compliance."
      )
    );
  } else {
    items.push(
      warn(
        "contact_visible",
        "Contact details visible (phone, email, address)",
        "No phone, email, or address detected on page.",
        "Add real contact information. Google Ads policy requires businesses to be clearly identifiable and contactable."
      )
    );
  }

  // ── 8. Hidden text / keyword stuffing ────────────────────────────────────
  if (contentData.hasHiddenText) {
    items.push(
      fail(
        "hidden_text",
        "No keyword stuffing or hidden text on page",
        "Hidden text elements detected (text with same colour as background, or positioned off-screen).",
        "Remove all hidden text immediately. Google treats this as deceptive and will suspend campaigns and potentially blacklist the domain."
      )
    );
  } else {
    items.push(pass("hidden_text", "No keyword stuffing or hidden text on page", "No obviously hidden text elements detected."));
  }

  // ── 9. Page language matches ad ────────────────────────────────────────────
  if (!contentData.htmlLang) {
    items.push(
      fail(
        "page_language",
        "Page is in the same language as the ad",
        "HTML <html> tag has no lang attribute — cannot verify language.",
        "Add lang attribute to <html> tag: <html lang=\"en\"> (or relevant locale). Required for Google policy and accessibility."
      )
    );
  } else {
    items.push(
      pass(
        "page_language",
        "Page is in the same language as the ad",
        `Page declares language: "${contentData.htmlLang}". Verify this matches your ad campaign language setting.`
      )
    );
  }

  return {
    module: "content_policy",
    moduleNumber: 4,
    moduleName: "Content & Ad Policy Compliance",
    weight: 12,
    impact: "CRITICAL",
    items,
    score: calcScore(items),
  };
}
