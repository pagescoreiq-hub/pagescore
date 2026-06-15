/**
 * PageScoreIQ — Module 10: HTML & Form Validation (Weight: 15%, Impact: CRITICAL)
 *
 * A landing page can pass content and design checks but still fail technically.
 * Broken HTML breaks tag rendering; a broken form means zero conversions.
 *
 * Checks:
 *  - Page passes W3C HTML validation (no critical errors)
 *  - DOCTYPE declared correctly
 *  - <html> tag has lang attribute
 *  - All <img> tags have alt attributes
 *  - No duplicate element IDs in DOM
 *  - Form has a valid action URL (not 404 / blank)
 *  - Required fields enforce validation (client-side)
 *  - Email field validates email format
 *  - Phone field validates phone format
 *  - Form submission reaches thank-you / success page
 *  - Form submission fires conversion tag
 *  - Error messages display clearly on invalid input
 *  - Spam protection present (CAPTCHA / honeypot)
 *  - No JavaScript console errors on page load
 */

import { Page } from "playwright";
import { ModuleResult, pass, fail, warn, calcScore } from "./types";

export async function auditHtmlForm(page: Page): Promise<ModuleResult> {
  const items = [];

  // ── Collect JS console errors during page load ────────────────────────────
  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text().slice(0, 120));
  });

  const htmlData = await page.evaluate(() => {
    const html = document.documentElement;

    // ── DOCTYPE ──────────────────────────────────────────────────────────────
    const doctype = document.doctype;
    const doctypeOk = !!doctype && doctype.name?.toLowerCase() === "html";

    // ── HTML lang attribute ──────────────────────────────────────────────────
    const htmlLang = html.getAttribute("lang") || "";

    // ── Image alt attributes ────────────────────────────────────────────────
    const allImgs = Array.from(document.querySelectorAll("img"));
    const imgsWithoutAlt = allImgs.filter((img) => !img.hasAttribute("alt")).map((img) => img.src?.split("/").pop()?.slice(0, 40) || "no-src");
    const imgsWithEmptyAlt = allImgs.filter((img) => img.hasAttribute("alt") && img.alt === "" && !img.getAttribute("role")).length;

    // ── Duplicate IDs ────────────────────────────────────────────────────────
    const allIds = Array.from(document.querySelectorAll("[id]")).map((el) => el.id);
    const idCounts: Record<string, number> = {};
    allIds.forEach((id) => { idCounts[id] = (idCounts[id] || 0) + 1; });
    const duplicateIds = Object.entries(idCounts).filter(([, count]) => count > 1).map(([id]) => id);

    // ── Form analysis ────────────────────────────────────────────────────────
    const forms = Array.from(document.querySelectorAll("form")).map((form) => {
      const action = form.getAttribute("action") || "";
      const method = form.method || "get";
      const novalidate = form.hasAttribute("novalidate");

      const inputs = Array.from(form.querySelectorAll("input, select, textarea"));
      const visibleInputs = inputs.filter((i) => !["hidden", "submit", "button", "reset"].includes((i as HTMLInputElement).type));
      const requiredInputs = visibleInputs.filter((i) => (i as HTMLInputElement).required);
      const emailInputs = inputs.filter((i) => (i as HTMLInputElement).type === "email");
      const telInputs = inputs.filter((i) => (i as HTMLInputElement).type === "tel");

      // Error message elements
      const errorElements = Array.from(form.querySelectorAll(
        '[class*="error"], [class*="invalid"], [class*="validation"], .help-block, .field-error, .form-error, [aria-invalid], [role="alert"]'
      )).length;

      // Spam protection
      const hasCaptcha = !!form.querySelector('[class*="captcha"], [class*="recaptcha"], [data-sitekey], .g-recaptcha, iframe[src*="recaptcha"]');
      const hasHoneypot = Array.from(form.querySelectorAll('input[type="text"]')).some((input) => {
        const style = window.getComputedStyle(input as Element);
        return style.display === "none" || style.visibility === "hidden" || style.opacity === "0" || (input as HTMLInputElement).tabIndex === -1;
      });

      // Thank-you redirect detection
      const actionIsThankYou = action.toLowerCase().includes("thank") || action.toLowerCase().includes("success") || action.toLowerCase().includes("confirm");

      return {
        action,
        method,
        novalidate,
        visibleInputCount: visibleInputs.length,
        requiredCount: requiredInputs.length,
        emailInputCount: emailInputs.length,
        telInputCount: telInputs.length,
        errorElementCount: errorElements,
        hasCaptcha,
        hasHoneypot,
        actionIsThankYou,
        hasValidAction: action.startsWith("http") || action.startsWith("/") || action.startsWith("?"),
      };
    });

    // ── Critical HTML issues (simplified — full W3C requires API) ────────────
    const htmlString = document.documentElement.outerHTML;
    const unclosedDivs = (htmlString.match(/<div/g) || []).length - (htmlString.match(/<\/div>/g) || []).length;
    const unclosedPs = (htmlString.match(/<p(?:\s|>)/g) || []).length - (htmlString.match(/<\/p>/g) || []).length;

    return {
      doctypeOk,
      htmlLang,
      totalImages: allImgs.length,
      imgsWithoutAlt,
      imgsWithEmptyAlt,
      duplicateIds,
      forms,
      unclosedDivs: Math.abs(unclosedDivs),
      unclosedPs: Math.abs(unclosedPs),
    };
  });

  // ── 1. W3C HTML validation (heuristic — full W3C requires API call) ────────
  const htmlIssues = htmlData.unclosedDivs + htmlData.unclosedPs;
  if (htmlIssues === 0) {
    items.push(warn("w3c_validation", "Page passes W3C HTML validation (no critical errors)", "Basic structural checks passed. Run W3C Validator for full validation.", `Verify at https://validator.w3.org/nu/?doc=${encodeURIComponent(page.url())}`));
  } else {
    items.push(
      fail(
        "w3c_validation",
        "Page passes W3C HTML validation (no critical errors)",
        `Structural HTML issues detected: ~${htmlData.unclosedDivs} div mismatch, ~${htmlData.unclosedPs} paragraph mismatch.`,
        `Fix HTML structure. Validate at https://validator.w3.org/nu/?doc=${encodeURIComponent(page.url())}`
      )
    );
  }

  // ── 2. DOCTYPE ────────────────────────────────────────────────────────────
  if (htmlData.doctypeOk) {
    items.push(pass("doctype", "DOCTYPE declared correctly", "<!DOCTYPE html> present and correct."));
  } else {
    items.push(warn("doctype", "DOCTYPE declared correctly", "DOCTYPE missing or incorrect.", "Add <!DOCTYPE html> as the very first line of your HTML document."));
  }

  // ── 3. HTML lang attribute ────────────────────────────────────────────────
  if (htmlData.htmlLang) {
    items.push(pass("html_lang", "<html> tag has lang attribute set", `lang="${htmlData.htmlLang}" — correct.`));
  } else {
    items.push(warn("html_lang", "<html> tag has lang attribute set", "HTML tag missing lang attribute.", "Add lang='en' (or relevant locale) to <html>: <html lang=\"en\">"));
  }

  // ── 4. Image alt attributes ────────────────────────────────────────────────
  if (htmlData.imgsWithoutAlt.length === 0) {
    items.push(pass("img_alt", "All <img> tags have alt attributes", `All ${htmlData.totalImages} image(s) have alt attributes.`));
  } else {
    items.push(
      warn(
        "img_alt",
        "All <img> tags have alt attributes",
        `${htmlData.imgsWithoutAlt.length} of ${htmlData.totalImages} image(s) missing alt: ${htmlData.imgsWithoutAlt.slice(0, 3).join(", ")}`,
        "Add descriptive alt attributes to all images: <img src=\"hero.jpg\" alt=\"Professional office team\">. Required for accessibility and SEO."
      )
    );
  }

  // ── 5. Duplicate element IDs ───────────────────────────────────────────────
  if (htmlData.duplicateIds.length === 0) {
    items.push(pass("duplicate_ids", "No duplicate element IDs in DOM", "All element IDs are unique."));
  } else {
    items.push(
      warn(
        "duplicate_ids",
        "No duplicate element IDs in DOM",
        `${htmlData.duplicateIds.length} duplicate ID(s): ${htmlData.duplicateIds.slice(0, 5).join(", ")}`,
        "Ensure all id attributes are unique across the page. Duplicate IDs break JavaScript selectors and tag manager references."
      )
    );
  }

  // ── Form checks ───────────────────────────────────────────────────────────
  if (htmlData.forms.length === 0) {
    items.push(warn("form_action", "Form has a valid action URL (not 404 / blank)", "No forms found on page.", "Add a lead capture form with a valid action URL."));
    items.push(warn("required_fields", "Required fields enforce validation (client-side)", "No forms found.", ""));
    items.push(warn("email_validation", "Email field validates email format", "No forms found.", ""));
    items.push(warn("phone_validation", "Phone field validates phone format", "No forms found.", ""));
    items.push(warn("form_submission", "Form submission reaches thank-you / success page", "No forms found.", ""));
    items.push(warn("conversion_tag", "Form submission fires conversion tag", "No forms found.", ""));
    items.push(warn("error_messages", "Error messages display clearly on invalid input", "No forms found.", ""));
    items.push(warn("spam_protection", "Spam protection present (CAPTCHA / honeypot)", "No forms found.", ""));
  } else {
    const form = htmlData.forms[0]; // Audit primary form

    // ── 6. Form action URL ──────────────────────────────────────────────────
    if (form.hasValidAction) {
      items.push(pass("form_action", "Form has a valid action URL (not 404 / blank)", `Form action: "${form.action.slice(0, 80)}"`));
    } else if (!form.action) {
      items.push(warn("form_action", "Form has a valid action URL (not 404 / blank)", "Form has no action attribute — relies on JavaScript submission.", "If using JavaScript form handling, ensure the handler is working. Add action as fallback."));
    } else {
      items.push(fail("form_action", "Form has a valid action URL (not 404 / blank)", `Invalid form action: "${form.action.slice(0, 60)}"`, "Set form action to a working endpoint: <form action='/submit-lead' method='POST'>"));
    }

    // ── 7. Required fields ──────────────────────────────────────────────────
    if (form.novalidate) {
      items.push(fail("required_fields", "Required fields enforce validation (client-side)", "Form has novalidate — browser validation disabled.", "Remove novalidate or implement complete custom validation in JavaScript."));
    } else if (form.requiredCount > 0) {
      items.push(pass("required_fields", "Required fields enforce validation (client-side)", `${form.requiredCount} of ${form.visibleInputCount} field(s) marked as required.`));
    } else {
      items.push(fail("required_fields", "Required fields enforce validation (client-side)", "No required fields found in form.", "Add required attribute to mandatory fields (name, email, phone)."));
    }

    // ── 8. Email validation ─────────────────────────────────────────────────
    if (form.emailInputCount > 0) {
      items.push(pass("email_validation", "Email field validates email format", `${form.emailInputCount} email field(s) with type='email' (browser validation active).`));
    } else {
      items.push(
        fail(
          "email_validation",
          "Email field validates email format",
          "No email input with type='email' found.",
          "Use <input type='email'> for email fields to get built-in browser format validation."
        )
      );
    }

    // ── 9. Phone validation ─────────────────────────────────────────────────
    if (form.telInputCount > 0) {
      items.push(warn("phone_validation", "Phone field validates phone format", `${form.telInputCount} tel field(s) found. Add pattern attribute for format validation.`, "Add pattern='[0-9]{10}' or similar to enforce format, plus a visible hint."));
    } else {
      items.push(warn("phone_validation", "Phone field validates phone format", "No telephone input with type='tel' found.", "Use <input type='tel'> for phone fields. Add pattern attribute for format validation."));
    }

    // ── 10. Form submission → thank-you page ──────────────────────────────
    if (form.actionIsThankYou) {
      items.push(pass("form_submission", "Form submission reaches thank-you / success page", "Form action points to a thank-you/success page."));
    } else {
      items.push(
        fail(
          "form_submission",
          "Form submission reaches thank-you / success page",
          "Form action doesn't point to an obvious thank-you page.",
          "Redirect to /thank-you after form submission. This is where your conversion tag must fire."
        )
      );
    }

    // ── 11. Conversion tag on thank-you ──────────────────────────────────
    items.push(
      warn(
        "conversion_tag",
        "Form submission fires conversion tag",
        "Conversion tag firing on form submission requires testing through the actual submission flow.",
        "Test by completing the form and verifying GA4 event + Google Ads conversion tag fires on the thank-you page via GTM Preview."
      )
    );

    // ── 12. Error messages ────────────────────────────────────────────────
    if (form.errorElementCount > 0) {
      items.push(pass("error_messages", "Error messages display clearly on invalid input", `${form.errorElementCount} error/validation message element(s) found in form.`));
    } else {
      items.push(
        warn(
          "error_messages",
          "Error messages display clearly on invalid input",
          "No inline error message elements detected in form.",
          "Add error message elements near each field: <span class='field-error' role='alert'>Please enter a valid email.</span>"
        )
      );
    }

    // ── 13. Spam protection ────────────────────────────────────────────────
    if (form.hasCaptcha) {
      items.push(pass("spam_protection", "Spam protection present (CAPTCHA / honeypot)", "reCAPTCHA or CAPTCHA element detected."));
    } else if (form.hasHoneypot) {
      items.push(pass("spam_protection", "Spam protection present (CAPTCHA / honeypot)", "Honeypot field detected — a lightweight spam protection method."));
    } else {
      items.push(
        warn(
          "spam_protection",
          "Spam protection present (CAPTCHA / honeypot)",
          "No CAPTCHA or honeypot field detected in form.",
          "Add Google reCAPTCHA v3 (invisible) or a honeypot hidden field to block spam submissions."
        )
      );
    }
  }

  // ── 14. JS console errors ─────────────────────────────────────────────────
  // Give a brief pause to collect any async errors
  await page.waitForTimeout(500);

  const filteredErrors = consoleErrors.filter(
    (e) =>
      !e.includes("favicon") &&
      !e.includes("analytics") &&
      !e.includes("gtm") &&
      !e.includes("clarity")
  );

  if (filteredErrors.length === 0) {
    items.push(pass("console_errors", "No JavaScript console errors on page load", "No critical JS errors detected during page load."));
  } else {
    items.push(
      warn(
        "console_errors",
        "No JavaScript console errors on page load",
        `${filteredErrors.length} JS console error(s): ${filteredErrors.slice(0, 2).join(" | ")}`,
        "Fix JavaScript errors — they can break form submission scripts and tracking tags."
      )
    );
  }

  return {
    module: "html_form",
    moduleNumber: 10,
    moduleName: "HTML & Form Validation",
    weight: 15,
    impact: "CRITICAL",
    items,
    score: calcScore(items),
  };
}
