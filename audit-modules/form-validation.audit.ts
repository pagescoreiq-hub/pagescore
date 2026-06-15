/**
 * PageScoreIQ — Module: Lead Form Validation Audit
 *
 * Checks all lead capture forms on a landing page for:
 *  - Field labels & accessibility
 *  - Correct input types (email, tel, etc.)
 *  - Required attributes & HTML5 validation
 *  - GDPR consent checkbox
 *  - Mobile-friendly input configuration
 *  - Submit button presence & labelling
 */

import { Page } from "playwright";

// ─── Types ───────────────────────────────────────────────────────────────────

export type AuditStatus = "PASS" | "FAIL" | "WARN";

export interface AuditItem {
  id: string;
  label: string;
  status: AuditStatus;
  detail: string;
  fix?: string;
}

export interface FormAuditResult {
  module: "lead_form_validation";
  formsFound: number;
  items: AuditItem[];
  score: number; // 0–100
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function pass(id: string, label: string, detail: string): AuditItem {
  return { id, label, status: "PASS", detail };
}

function fail(id: string, label: string, detail: string, fix: string): AuditItem {
  return { id, label, status: "FAIL", detail, fix };
}

function warn(id: string, label: string, detail: string, fix: string): AuditItem {
  return { id, label, status: "WARN", detail, fix };
}

// ─── Audit function ───────────────────────────────────────────────────────────

export async function auditLeadForm(page: Page): Promise<FormAuditResult> {
  const items: AuditItem[] = [];

  // ── Serialise DOM data to avoid multiple Playwright round-trips ──────────
  const data = await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll("form"));

    return forms.map((form) => {
      const inputs = Array.from(
        form.querySelectorAll("input, select, textarea")
      ).map((el) => {
        const input = el as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
        const id = input.id || "";
        const name = input.name || "";
        const type = (input as HTMLInputElement).type || input.tagName.toLowerCase();
        const required = input.required;
        const placeholder = (input as HTMLInputElement).placeholder || "";
        const pattern = (input as HTMLInputElement).pattern || "";
        const minLength = (input as HTMLInputElement).minLength ?? -1;
        const maxLength = (input as HTMLInputElement).maxLength ?? -1;
        const autocomplete = (input as HTMLInputElement).autocomplete || "";
        const ariaLabel = input.getAttribute("aria-label") || "";
        const ariaDescribedby = input.getAttribute("aria-describedby") || "";

        // Find associated label
        let labelText = "";
        if (id) {
          const labelEl = document.querySelector(`label[for="${id}"]`);
          if (labelEl) labelText = labelEl.textContent?.trim() || "";
        }
        if (!labelText) {
          // label wrapping the input
          const parent = input.closest("label");
          if (parent) labelText = parent.textContent?.trim() || "";
        }

        return {
          id,
          name,
          type,
          required,
          placeholder,
          pattern,
          minLength,
          maxLength,
          autocomplete,
          ariaLabel,
          ariaDescribedby,
          hasLabel: labelText.length > 0,
          labelText,
        };
      });

      const submitButtons = Array.from(
        form.querySelectorAll(
          'button[type="submit"], input[type="submit"], button:not([type])'
        )
      ).map((btn) => ({
        text: btn.textContent?.trim() || (btn as HTMLInputElement).value || "",
        type: btn.getAttribute("type") || "submit",
      }));

      const consentCheckboxes = Array.from(
        form.querySelectorAll('input[type="checkbox"]')
      ).filter((cb) => {
        const label =
          document.querySelector(`label[for="${cb.id}"]`)?.textContent || "";
        const text = (cb.closest("label") || cb.parentElement)?.textContent || "";
        const combined = (label + text).toLowerCase();
        return (
          combined.includes("consent") ||
          combined.includes("agree") ||
          combined.includes("privacy") ||
          combined.includes("gdpr") ||
          combined.includes("terms")
        );
      });

      const action = form.action || "";
      const method = form.method || "get";
      const novalidate = form.hasAttribute("novalidate");

      return {
        action,
        method,
        novalidate,
        inputCount: inputs.filter(
          (i) => !["hidden", "submit", "button", "reset"].includes(i.type)
        ).length,
        inputs,
        submitButtons,
        hasConsentCheckbox: consentCheckboxes.length > 0,
      };
    });
  });

  const formsFound = data.length;

  // ── 1. Form presence ─────────────────────────────────────────────────────
  if (formsFound === 0) {
    items.push(
      fail(
        "form_presence",
        "Lead form present on page",
        "No <form> element found.",
        "Add a lead capture form with CTA. Google Ads requires a functional conversion path."
      )
    );
    return { module: "lead_form_validation", formsFound, items, score: 0 };
  }

  items.push(
    pass(
      "form_presence",
      "Lead form present on page",
      `${formsFound} form(s) detected.`
    )
  );

  // Audit each form
  data.forEach((form, fi) => {
    const prefix = formsFound > 1 ? `Form ${fi + 1}: ` : "";

    // ── 2. Submit button ────────────────────────────────────────────────────
    if (form.submitButtons.length === 0) {
      items.push(
        fail(
          `form_${fi}_submit_button`,
          `${prefix}Submit button present`,
          "No submit button found inside the form.",
          "Add <button type=\"submit\"> or <input type=\"submit\"> inside the form."
        )
      );
    } else {
      const btn = form.submitButtons[0];
      const weakLabels = ["submit", "send", "go", "ok", "click here", "button"];
      if (!btn.text || weakLabels.includes(btn.text.toLowerCase())) {
        items.push(
          warn(
            `form_${fi}_submit_label`,
            `${prefix}Submit button has action-oriented label`,
            `Submit button text is "${btn.text || "(empty)"}".`,
            'Use specific CTA text like "Get Free Audit", "Request a Quote", "Start Today".'
          )
        );
      } else {
        items.push(
          pass(
            `form_${fi}_submit_label`,
            `${prefix}Submit button has action-oriented label`,
            `Button text: "${btn.text}".`
          )
        );
      }
    }

    // ── 3. Field count ──────────────────────────────────────────────────────
    if (form.inputCount > 5) {
      items.push(
        warn(
          `form_${fi}_field_count`,
          `${prefix}Form fields ≤ 5 (conversion best practice)`,
          `${form.inputCount} visible fields detected.`,
          "Reduce fields to maximise conversion rate. Move optional fields to a second step or remove entirely."
        )
      );
    } else {
      items.push(
        pass(
          `form_${fi}_field_count`,
          `${prefix}Form fields ≤ 5`,
          `${form.inputCount} visible field(s) — within best practice range.`
        )
      );
    }

    // ── 4. Per-field checks ─────────────────────────────────────────────────
    const visibleInputs = form.inputs.filter(
      (i) => !["hidden", "submit", "button", "reset", "checkbox", "radio"].includes(i.type)
    );

    // 4a. Labels
    const unlabelled = visibleInputs.filter((i) => !i.hasLabel && !i.ariaLabel);
    if (unlabelled.length > 0) {
      items.push(
        fail(
          `form_${fi}_labels`,
          `${prefix}All fields have visible labels`,
          `${unlabelled.length} field(s) missing labels: ${unlabelled
            .map((i) => i.name || i.id || i.type)
            .join(", ")}.`,
          "Add <label for='fieldId'> or aria-label to every input. Required for accessibility and Google Quality Score."
        )
      );
    } else {
      items.push(
        pass(
          `form_${fi}_labels`,
          `${prefix}All fields have visible labels`,
          "Every visible field has an associated label."
        )
      );
    }

    // 4b. Required attributes on mandatory fields
    const emailInputs = form.inputs.filter((i) => i.type === "email");
    const phoneInputs = form.inputs.filter((i) => i.type === "tel");
    const nameInputs = form.inputs.filter(
      (i) =>
        i.type === "text" &&
        (i.name.toLowerCase().includes("name") ||
          i.id.toLowerCase().includes("name") ||
          i.labelText.toLowerCase().includes("name"))
    );

    const keyFields = [...emailInputs, ...phoneInputs, ...nameInputs];
    const missingRequired = keyFields.filter((i) => !i.required);
    if (missingRequired.length > 0) {
      items.push(
        warn(
          `form_${fi}_required_attrs`,
          `${prefix}Key fields marked as required`,
          `${missingRequired.length} key field(s) missing required attribute: ${missingRequired
            .map((i) => i.name || i.type)
            .join(", ")}.`,
          'Add required attribute to name, email, and phone fields: <input type="email" required>.'
        )
      );
    } else if (keyFields.length > 0) {
      items.push(
        pass(
          `form_${fi}_required_attrs`,
          `${prefix}Key fields marked as required`,
          "Name/email/phone fields all have required attribute."
        )
      );
    }

    // 4c. Correct input types for mobile keyboards
    const emailFields = form.inputs.filter(
      (i) =>
        i.name.toLowerCase().includes("email") ||
        i.id.toLowerCase().includes("email") ||
        i.labelText.toLowerCase().includes("email") ||
        i.placeholder.toLowerCase().includes("email")
    );
    const wrongEmailType = emailFields.filter((i) => i.type !== "email");
    if (wrongEmailType.length > 0) {
      items.push(
        fail(
          `form_${fi}_email_type`,
          `${prefix}Email field uses type="email"`,
          `${wrongEmailType.length} email field(s) not using type="email".`,
          'Change to <input type="email"> for correct mobile keyboard and browser validation.'
        )
      );
    } else if (emailFields.length > 0) {
      items.push(
        pass(
          `form_${fi}_email_type`,
          `${prefix}Email field uses type="email"`,
          'Email field(s) correctly use type="email".'
        )
      );
    }

    const phoneFields = form.inputs.filter(
      (i) =>
        i.name.toLowerCase().includes("phone") ||
        i.name.toLowerCase().includes("tel") ||
        i.id.toLowerCase().includes("phone") ||
        i.id.toLowerCase().includes("tel") ||
        i.labelText.toLowerCase().includes("phone") ||
        i.placeholder.toLowerCase().includes("phone")
    );
    const wrongPhoneType = phoneFields.filter((i) => i.type !== "tel");
    if (wrongPhoneType.length > 0) {
      items.push(
        fail(
          `form_${fi}_phone_type`,
          `${prefix}Phone field uses type="tel"`,
          `${wrongPhoneType.length} phone field(s) not using type="tel".`,
          'Change to <input type="tel"> — triggers numeric keyboard on mobile devices.'
        )
      );
    } else if (phoneFields.length > 0) {
      items.push(
        pass(
          `form_${fi}_phone_type`,
          `${prefix}Phone field uses type="tel"`,
          'Phone field(s) correctly use type="tel".'
        )
      );
    }

    // 4d. Email validation pattern / browser-native
    const emailWithoutValidation = emailInputs.filter(
      (i) => i.type !== "email" && !i.pattern
    );
    if (emailWithoutValidation.length > 0) {
      items.push(
        warn(
          `form_${fi}_email_validation`,
          `${prefix}Email field has validation`,
          "Email field lacks type=email or a pattern attribute.",
          'Use type="email" for built-in browser validation, or add pattern="[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}$".'
        )
      );
    }

    // 4e. novalidate check
    if (form.novalidate) {
      items.push(
        warn(
          `form_${fi}_novalidate`,
          `${prefix}Native HTML5 validation not suppressed`,
          'Form has novalidate attribute — browser-native validation is disabled.',
          "Remove novalidate unless you have a complete custom validation implementation in JavaScript."
        )
      );
    } else {
      items.push(
        pass(
          `form_${fi}_novalidate`,
          `${prefix}Native HTML5 validation not suppressed`,
          "Form uses native browser validation."
        )
      );
    }

    // 4f. autocomplete attributes
    const noAutocomplete = visibleInputs.filter((i) => !i.autocomplete);
    if (noAutocomplete.length > 0) {
      items.push(
        warn(
          `form_${fi}_autocomplete`,
          `${prefix}Fields have autocomplete attributes`,
          `${noAutocomplete.length} field(s) missing autocomplete attribute.`,
          "Add autocomplete values (name, email, tel) to speed up form filling and reduce friction."
        )
      );
    } else {
      items.push(
        pass(
          `form_${fi}_autocomplete`,
          `${prefix}Fields have autocomplete attributes`,
          "All fields have autocomplete set."
        )
      );
    }

    // 4g. GDPR consent checkbox
    if (!form.hasConsentCheckbox) {
      items.push(
        fail(
          `form_${fi}_gdpr_consent`,
          `${prefix}GDPR consent checkbox present`,
          "No consent/privacy checkbox found in form.",
          "Add a required checkbox: \"I agree to the Privacy Policy and consent to being contacted.\" — required per Google Ads policy for data-collection forms."
        )
      );
    } else {
      items.push(
        pass(
          `form_${fi}_gdpr_consent`,
          `${prefix}GDPR consent checkbox present`,
          "Consent checkbox detected in form."
        )
      );
    }

    // 4h. Hidden fields (for UTM capture — informational)
    const hiddenFields = form.inputs.filter((i) => i.type === "hidden");
    const utmHiddenFields = hiddenFields.filter((i) =>
      (i.name + i.id).toLowerCase().includes("utm")
    );
    if (utmHiddenFields.length > 0) {
      items.push(
        pass(
          `form_${fi}_utm_hidden_fields`,
          `${prefix}UTM hidden fields present in form`,
          `${utmHiddenFields.length} hidden UTM field(s) detected: ${utmHiddenFields
            .map((f) => f.name || f.id)
            .join(", ")}.`
        )
      );
    } else {
      items.push(
        warn(
          `form_${fi}_utm_hidden_fields`,
          `${prefix}UTM hidden fields present in form`,
          "No hidden UTM fields found inside the form.",
          "Add hidden inputs for utm_source, utm_medium, utm_campaign, utm_term, utm_content and populate via JavaScript on page load so UTM data is submitted with the lead."
        )
      );
    }
  });

  // ── Score calculation ─────────────────────────────────────────────────────
  const failCount = items.filter((i) => i.status === "FAIL").length;
  const warnCount = items.filter((i) => i.status === "WARN").length;
  const total = items.length;
  const score = Math.max(
    0,
    Math.round(((total - failCount - warnCount * 0.5) / total) * 100)
  );

  return { module: "lead_form_validation", formsFound, items, score };
}
