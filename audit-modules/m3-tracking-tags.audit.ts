/**
 * PageScoreIQ — Module 3: Tracking & Tag Verification (Weight: 12%, Impact: HIGH)
 *
 * Without proper tracking, Google Ads can't measure conversions.
 * Some markets require Consent Mode v2 to avoid policy violations.
 *
 * Checks:
 *  - Google Tag Manager container present
 *  - GTM container fires (window.google_tag_manager populated)
 *  - Google Ads conversion tag
 *  - GA4 base tag firing
 *  - Google Ads remarketing tag
 *  - Consent Mode v2 signals (EU/EEA campaigns)
 *  - No duplicate GTM containers
 *  - Enhanced Conversions dataLayer
 */

import { Page } from "playwright";
import { ModuleResult, pass, fail, warn, calcScore } from "./types";

export async function auditTrackingTags(page: Page): Promise<ModuleResult> {
  const items = [];

  const tagData = await page.evaluate(() => {
    // ── Detect GTM ──────────────────────────────────────────────────────────
    const allScripts = Array.from(document.querySelectorAll("script")).map(
      (s) => s.src || s.textContent || ""
    );
    const allScriptText = allScripts.join(" ");

    // GTM snippet patterns
    const gtmContainerIds = (allScriptText.match(/GTM-[A-Z0-9]+/g) || []);
    const uniqueGtmIds = [...new Set(gtmContainerIds)];
    const gtmPresent = uniqueGtmIds.length > 0;

    // GTM fired (object present in window)
    const gtmFired = !!(
      (window as any).google_tag_manager &&
      Object.keys((window as any).google_tag_manager).some((k) => k.startsWith("GTM-"))
    );

    // ── Detect GA4 ──────────────────────────────────────────────────────────
    const ga4Ids = (allScriptText.match(/G-[A-Z0-9]+/g) || []);
    const ga4Present = ga4Ids.length > 0;
    const ga4Fired = !!(window as any).gtag || !!(window as any).ga;

    // ── Detect Google Ads conversion / remarketing ──────────────────────────
    const awIds = (allScriptText.match(/AW-[0-9]+/g) || []);
    const adsTagPresent = awIds.length > 0;
    const conversionEventPresent = allScriptText.includes("gtag('event', 'conversion")
      || allScriptText.includes('gtag("event","conversion')
      || allScriptText.includes('send_to.*AW-');
    const remarketingPresent = adsTagPresent || allScriptText.includes("googleadservices.com/pagead/conversion") || allScriptText.includes("remarketing");

    // ── Detect Consent Mode v2 ──────────────────────────────────────────────
    const dataLayer: any[] = (window as any).dataLayer || [];
    const consentDefault = dataLayer.some(
      (entry) => entry[0] === "consent" && entry[1] === "default"
    );
    const consentUpdate = dataLayer.some(
      (entry) => entry[0] === "consent" && entry[1] === "update"
    );
    const consentModePresent = consentDefault || allScriptText.includes("gtag('consent'") || allScriptText.includes('gtag("consent"');

    // ── Enhanced Conversions dataLayer ──────────────────────────────────────
    const enhancedConversionsPresent = dataLayer.some(
      (entry) => entry.email || entry.phone_number || entry.sha256_email_address
    ) || allScriptText.includes("sha256") || allScriptText.includes("enhanced_conversion");

    // ── Duplicate GTM check ─────────────────────────────────────────────────
    const gtmSnippetCount = (allScriptText.match(/googletagmanager\.com\/gtm\.js/g) || []).length;
    const hasDuplicateGtm = gtmSnippetCount > 1 || uniqueGtmIds.length > 1;

    return {
      gtmPresent,
      gtmFired,
      uniqueGtmIds,
      hasDuplicateGtm,
      gtmSnippetCount,
      ga4Present,
      ga4Fired,
      ga4Ids: [...new Set(ga4Ids)],
      adsTagPresent,
      awIds: [...new Set(awIds)],
      conversionEventPresent,
      remarketingPresent,
      consentModePresent,
      consentDefault,
      consentUpdate,
      enhancedConversionsPresent,
      dataLayerLength: dataLayer.length,
    };
  });

  // ── 1. GTM container present ──────────────────────────────────────────────
  if (tagData.gtmPresent) {
    items.push(pass("gtm_present", "Google Tag Manager (GTM) container present", `GTM container(s) found: ${tagData.uniqueGtmIds.join(", ")}`));
  } else {
    items.push(
      fail(
        "gtm_present",
        "Google Tag Manager (GTM) container present",
        "No GTM container ID (GTM-XXXXXX) found on page.",
        "Add the GTM snippet to both <head> and <body> of your page. Get it from tagmanager.google.com."
      )
    );
  }

  // ── 2. GTM fires correctly ────────────────────────────────────────────────
  if (tagData.gtmFired) {
    items.push(pass("gtm_fired", "GTM container fires correctly", "window.google_tag_manager object is populated — GTM is active."));
  } else if (tagData.gtmPresent) {
    items.push(
      warn(
        "gtm_fired",
        "GTM container fires correctly",
        "GTM snippet found but window.google_tag_manager not populated — may be blocked or deferred.",
        "Verify in GTM Preview mode / Tag Assistant. Check for script blockers or async loading issues."
      )
    );
  } else {
    items.push(fail("gtm_fired", "GTM container fires correctly", "GTM not present — cannot verify firing.", "Install GTM first."));
  }

  // ── 3. Google Ads conversion tag ─────────────────────────────────────────
  if (tagData.adsTagPresent && tagData.conversionEventPresent) {
    items.push(pass("ads_conversion", "Google Ads conversion tag present", `Ads conversion tag found (${tagData.awIds.join(", ")}) with conversion event.`));
  } else if (tagData.adsTagPresent) {
    items.push(
      warn(
        "ads_conversion",
        "Google Ads conversion tag present",
        `Google Ads tag (${tagData.awIds.join(", ")}) found but no conversion event detected on this page.`,
        "Add a gtag('event','conversion',{...}) call or configure a conversion action in GTM that fires on your thank-you page."
      )
    );
  } else {
    items.push(
      fail(
        "ads_conversion",
        "Google Ads conversion tag present",
        "No Google Ads conversion tag (AW-XXXXXXXXX) found on page.",
        "Add Google Ads conversion tracking via GTM. Without it, Google Ads cannot optimize for conversions."
      )
    );
  }

  // ── 4. GA4 base tag ───────────────────────────────────────────────────────
  if (tagData.ga4Present) {
    items.push(
      warn(
        "ga4_tag",
        "GA4 base tag present and firing",
        `GA4 measurement ID found (${tagData.ga4Ids.join(", ")}). Firing status: ${tagData.ga4Fired ? "active" : "unclear"}.`,
        tagData.ga4Fired ? "" : "Verify GA4 config tag fires on all pages using GTM Preview or GA4 DebugView."
      )
    );
    if (tagData.ga4Fired) {
      // Replace the warn with a pass
      items.pop();
      items.push(pass("ga4_tag", "GA4 base tag present and firing", `GA4 tag (${tagData.ga4Ids.join(", ")}) found and window.gtag is active.`));
    }
  } else {
    items.push(
      warn(
        "ga4_tag",
        "GA4 base tag present and firing",
        "No GA4 measurement ID (G-XXXXXXXXXX) found.",
        "Deploy GA4 configuration tag via GTM. GA4 is required for audience building and conversion insights."
      )
    );
  }

  // ── 5. Google Ads remarketing tag ─────────────────────────────────────────
  if (tagData.remarketingPresent) {
    items.push(warn("remarketing_tag", "Google Ads Remarketing tag present", "Remarketing / Ads tag signals detected.", "Verify RLSA audience lists are being populated in Google Ads → Audience Manager."));
  } else {
    items.push(
      warn(
        "remarketing_tag",
        "Google Ads Remarketing tag present",
        "No Google Ads remarketing tag detected.",
        "Add the Google Ads global site tag or configure a remarketing tag in GTM to build RLSA audiences."
      )
    );
  }

  // ── 6. Consent Mode v2 ───────────────────────────────────────────────────
  if (tagData.consentModePresent) {
    items.push(pass("consent_mode", "Consent Mode v2 implemented (EU/EEA campaigns)", `Consent mode signals detected. Default: ${tagData.consentDefault}, Update: ${tagData.consentUpdate}.`));
  } else {
    items.push(
      fail(
        "consent_mode",
        "Consent Mode v2 implemented (EU/EEA campaigns)",
        "No Consent Mode v2 signals (gtag('consent', 'default', ...)) found.",
        "Implement Consent Mode v2 if serving EU/EEA traffic. Required by Google Ads policy from March 2024. Use a CMP like CookieYes or OneTrust that supports Consent Mode v2."
      )
    );
  }

  // ── 7. No duplicate GTM containers ───────────────────────────────────────
  if (tagData.hasDuplicateGtm) {
    items.push(
      warn(
        "duplicate_gtm",
        "No duplicate GTM containers",
        `${tagData.uniqueGtmIds.length} unique GTM ID(s) / ${tagData.gtmSnippetCount} snippet(s) — duplicates detected.`,
        "Remove duplicate GTM installations. Multiple GTM containers cause double-firing of tags and inflated conversion counts."
      )
    );
  } else {
    items.push(pass("duplicate_gtm", "No duplicate GTM containers", "Single GTM container detected — no duplicates."));
  }

  // ── 8. Enhanced Conversions dataLayer ─────────────────────────────────────
  if (tagData.enhancedConversionsPresent) {
    items.push(pass("enhanced_conversions", "Enhanced Conversions data layer present", "Enhanced conversion data (hashed user data) detected in dataLayer."));
  } else {
    items.push(
      warn(
        "enhanced_conversions",
        "Enhanced Conversions data layer present",
        "No hashed user data detected in dataLayer on this page.",
        "Push hashed email/phone to dataLayer on conversion: dataLayer.push({event:'purchase', sha256_email_address:'...'}) for Enhanced Conversions."
      )
    );
  }

  return {
    module: "tracking_tags",
    moduleNumber: 3,
    moduleName: "Tracking & Tag Verification",
    weight: 12,
    impact: "HIGH",
    items,
    score: calcScore(items),
  };
}
