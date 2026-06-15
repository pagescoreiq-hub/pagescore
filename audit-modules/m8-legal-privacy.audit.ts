/**
 * PageScoreIQ — Module 8: Legal & Privacy Compliance (Weight: 5%, Impact: HIGH)
 *
 * Google Ads requires landing pages to have clear privacy policies and
 * legal disclosures, especially for data-collection pages.
 *
 * Checks:
 *  - Privacy Policy link present and accessible
 *  - Terms & Conditions link present
 *  - Cookie consent banner present (GDPR)
 *  - Form includes data consent checkbox
 *  - No collection of sensitive data without disclosure
 *  - Contact information / business address visible
 *  - Disclaimer for regulated industries (Finance, Health)
 */

import { Page } from "playwright";
import { ModuleResult, pass, fail, warn, calcScore } from "./types";

export async function auditLegalPrivacy(page: Page): Promise<ModuleResult> {
  const items = [];

  const legalData = await page.evaluate(() => {
    const allText = document.body?.innerText?.toLowerCase() || "";
    const allLinks = Array.from(document.querySelectorAll("a")).map((a) => ({
      text: a.innerText.toLowerCase().trim(),
      href: a.href?.toLowerCase() || "",
    }));

    // ── Privacy Policy ──────────────────────────────────────────────────────
    const privacyLink = allLinks.find(
      (l) =>
        l.text.includes("privacy") ||
        l.href.includes("privacy") ||
        l.text.includes("datenschutz") || // German
        l.text.includes("privacidad") // Spanish
    );

    // ── Terms & Conditions ──────────────────────────────────────────────────
    const termsLink = allLinks.find(
      (l) =>
        l.text.includes("terms") ||
        l.text.includes("conditions") ||
        l.text.includes("t&c") ||
        l.href.includes("terms") ||
        l.href.includes("tos")
    );

    // ── Cookie consent banner ────────────────────────────────────────────────
    const cookieSelectors = [
      '[class*="cookie"]',
      '[id*="cookie"]',
      '[class*="consent"]',
      '[id*="consent"]',
      '[class*="gdpr"]',
      '[id*="gdpr"]',
      '[class*="cookie-banner"]',
      '[class*="cookie-notice"]',
    ];
    const cookieBannerPresent = cookieSelectors.some((sel) => {
      const el = document.querySelector(sel);
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none";
    });

    // Also check for OneTrust, CookieYes, Cookiebot, etc.
    const knownCmpScripts = Array.from(document.querySelectorAll("script[src]")).some((s) => {
      const src = (s as HTMLScriptElement).src.toLowerCase();
      return src.includes("onetrust") || src.includes("cookieyes") || src.includes("cookiebot") || src.includes("quantcast") || src.includes("didomi");
    });

    // ── Data collection disclaimer ───────────────────────────────────────────
    const hasForms = document.querySelectorAll("form").length > 0;
    const hasConsentText = allText.includes("consent") || allText.includes("agree to our") || allText.includes("privacy policy");

    // ── Sensitive data fields without disclosure ─────────────────────────────
    const inputs = Array.from(document.querySelectorAll("input"));
    const sensitiveFields = inputs.filter((i) => {
      const combined = (i.name + i.id + i.placeholder).toLowerCase();
      return /ssn|social.security|passport|credit.card|card.number|cvv|bank.account/.test(combined);
    });
    const sensitiveFieldsWithoutDisclosure = sensitiveFields.length > 0 && !hasConsentText;

    // ── Contact information ──────────────────────────────────────────────────
    const phonePattern = /(\+?\d[\d\s\-().]{7,}\d)/;
    const emailPattern = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    const hasContactInfo = phonePattern.test(document.body?.innerText || "") || emailPattern.test(document.body?.innerText || "");

    // ── Regulated industry disclaimer ────────────────────────────────────────
    const regulatedTerms = [
      // Finance
      "investment", "financial advice", "returns", "interest rate", "loan", "mortgage", "insurance",
      // Health
      "medical advice", "treatment", "cure", "diagnose", "prescription", "supplement",
    ];
    const hasRegulatedContent = regulatedTerms.some((term) => allText.includes(term));
    const hasDisclaimer = allText.includes("disclaimer") || allText.includes("not financial advice") || allText.includes("not medical advice") || allText.includes("consult") || allText.includes("professional advice");

    return {
      privacyLink: privacyLink ? { text: privacyLink.text, href: privacyLink.href.slice(0, 80) } : null,
      termsLink: termsLink ? { text: termsLink.text, href: termsLink.href.slice(0, 80) } : null,
      cookieBannerPresent: cookieBannerPresent || knownCmpScripts,
      hasForms,
      hasConsentText,
      sensitiveFieldsWithoutDisclosure,
      sensitiveFieldCount: sensitiveFields.length,
      hasContactInfo,
      hasRegulatedContent,
      hasDisclaimer,
    };
  });

  // ── 1. Privacy Policy link ────────────────────────────────────────────────
  if (legalData.privacyLink) {
    items.push(pass("privacy_policy", "Privacy Policy link present and accessible", `Privacy Policy link found: "${legalData.privacyLink.text}" → ${legalData.privacyLink.href}`));
  } else {
    items.push(
      fail(
        "privacy_policy",
        "Privacy Policy link present and accessible",
        "No Privacy Policy link found on page.",
        "Add a visible Privacy Policy link, ideally in the footer. Required by Google Ads for any page collecting user data."
      )
    );
  }

  // ── 2. Terms & Conditions ─────────────────────────────────────────────────
  if (legalData.termsLink) {
    items.push(warn("terms_conditions", "Terms & Conditions link present", `T&C link found: "${legalData.termsLink.text}" → ${legalData.termsLink.href}`, ""));
    items.pop();
    items.push(pass("terms_conditions", "Terms & Conditions link present", `T&C link found: "${legalData.termsLink.text}"`));
  } else {
    items.push(
      warn(
        "terms_conditions",
        "Terms & Conditions link present",
        "No Terms & Conditions link found.",
        "Add a T&C link in the footer, especially important for e-commerce and service businesses."
      )
    );
  }

  // ── 3. Cookie consent banner (GDPR) ──────────────────────────────────────
  if (legalData.cookieBannerPresent) {
    items.push(pass("cookie_consent", "Cookie consent banner present (GDPR)", "Cookie consent mechanism detected (banner element or CMP script)."));
  } else {
    items.push(
      fail(
        "cookie_consent",
        "Cookie consent banner present (GDPR)",
        "No cookie consent banner or CMP (OneTrust, CookieYes, Cookiebot) detected.",
        "Implement a GDPR-compliant cookie consent banner for EU traffic. Required by law and tied to Consent Mode v2 for Google Ads."
      )
    );
  }

  // ── 4. Form data consent checkbox ────────────────────────────────────────
  if (!legalData.hasForms) {
    items.push(pass("form_consent", "Form includes data consent checkbox", "No forms found on page — consent checkbox not required."));
  } else if (legalData.hasConsentText) {
    items.push(pass("form_consent", "Form includes data consent checkbox", "Consent text or checkbox detected on page with form."));
  } else {
    items.push(
      fail(
        "form_consent",
        "Form includes data consent checkbox",
        "Form present but no consent/privacy checkbox or disclosure text found.",
        "Add a required consent checkbox to all forms: \"I agree to the Privacy Policy and consent to being contacted.\""
      )
    );
  }

  // ── 5. Sensitive data without disclosure ──────────────────────────────────
  if (legalData.sensitiveFieldsWithoutDisclosure) {
    items.push(
      fail(
        "sensitive_data",
        "No collection of sensitive data without disclosure",
        `${legalData.sensitiveFieldCount} sensitive field(s) (SSN, credit card, etc.) found without consent/privacy disclosure.`,
        "Add clear data collection disclosure for all sensitive fields. State what data is collected and how it will be used."
      )
    );
  } else {
    items.push(pass("sensitive_data", "No collection of sensitive data without disclosure", "No undisclosed sensitive data collection detected."));
  }

  // ── 6. Contact information / NAP ──────────────────────────────────────────
  if (legalData.hasContactInfo) {
    items.push(warn("contact_nap", "Contact information / business address visible", "Contact details detected on page.", "Ensure Name, Address, and Phone (NAP) are all visible. Consistency with Google Business Profile improves trust."));
  } else {
    items.push(
      warn(
        "contact_nap",
        "Contact information / business address visible",
        "No phone or email contact details detected.",
        "Display NAP (Name, Address, Phone) on all landing pages. Required for Google Ads trust compliance."
      )
    );
  }

  // ── 7. Regulated industry disclaimer ──────────────────────────────────────
  if (legalData.hasRegulatedContent) {
    if (legalData.hasDisclaimer) {
      items.push(pass("regulated_disclaimer", "Disclaimer for regulated industries (Finance, Health)", "Regulated content detected with appropriate disclaimer text present."));
    } else {
      items.push(
        fail(
          "regulated_disclaimer",
          "Disclaimer for regulated industries (Finance, Health)",
          "Regulated industry terms detected (finance/health) but no disclaimer found.",
          "Add required disclaimers: For finance — 'This is not financial advice. Past performance is not indicative of future results.' For health — 'Consult a qualified healthcare professional before making medical decisions.'"
        )
      );
    }
  } else {
    items.push(pass("regulated_disclaimer", "Disclaimer for regulated industries (Finance, Health)", "No regulated industry content detected — disclaimer not required."));
  }

  return {
    module: "legal_privacy",
    moduleNumber: 8,
    moduleName: "Legal & Privacy Compliance",
    weight: 5,
    impact: "HIGH",
    items,
    score: calcScore(items),
  };
}
