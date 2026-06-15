/**
 * PageScoreIQ — Module: HTML Structure Audit
 *
 * Maps directly to Module 5 (Page Structure & Heading Tags) from the
 * PageScoreIQ audit checklist, plus essential <head> meta checks.
 *
 * Checks:
 *  - Single H1 present, no duplicates
 *  - H1 keyword alignment (compares against ad headline if provided)
 *  - Heading hierarchy (no H1→H3 jump, H2s present)
 *  - <title> tag present & non-generic
 *  - Meta description present & within character limits
 *  - Viewport meta tag
 *  - Sufficient page content (≥ 300 words)
 *  - Open Graph / social meta (WARN level)
 *  - Canonical tag present
 *  - Lang attribute on <html>
 *  - No keyword stuffing (hidden text)
 */

import { Page } from "playwright";
import { AuditItem } from "./form-validation.audit";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HtmlStructureAuditResult {
  module: "html_structure";
  items: AuditItem[];
  score: number; // 0–100
  summary: {
    h1Count: number;
    h2Count: number;
    h3Count: number;
    titleText: string;
    metaDescriptionLength: number;
    wordCount: number;
  };
}

export interface HtmlStructureAuditOptions {
  /** Primary keyword or ad headline to check H1 alignment against */
  adHeadline?: string;
  /** Campaign keyword for H1 relevance check */
  primaryKeyword?: string;
}

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

function normalise(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9\s]/g, "").trim();
}

function countWords(text: string): number {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0).length;
}

// ─── Audit function ───────────────────────────────────────────────────────────

export async function auditHtmlStructure(
  page: Page,
  options: HtmlStructureAuditOptions = {}
): Promise<HtmlStructureAuditResult> {
  const items: AuditItem[] = [];

  // ── Collect all DOM data in one evaluate call ─────────────────────────────
  const dom = await page.evaluate(() => {
    // Headings
    const h1Els = Array.from(document.querySelectorAll("h1"));
    const h2Els = Array.from(document.querySelectorAll("h2"));
    const h3Els = Array.from(document.querySelectorAll("h3"));
    const h4Els = Array.from(document.querySelectorAll("h4"));

    const headingOrder: { tag: string; text: string }[] = [];
    document.querySelectorAll("h1,h2,h3,h4,h5,h6").forEach((el) => {
      headingOrder.push({ tag: el.tagName, text: el.textContent?.trim() || "" });
    });

    // Title
    const titleEl = document.querySelector("title");
    const titleText = titleEl?.textContent?.trim() || "";

    // Meta description
    const metaDesc =
      (document.querySelector('meta[name="description"]') as HTMLMetaElement)
        ?.content || "";

    // Viewport
    const viewportMeta =
      (document.querySelector('meta[name="viewport"]') as HTMLMetaElement)
        ?.content || "";

    // Canonical
    const canonical =
      (document.querySelector('link[rel="canonical"]') as HTMLLinkElement)
        ?.href || "";

    // Lang
    const htmlLang = document.documentElement.lang || "";

    // Open Graph
    const ogTitle =
      (document.querySelector('meta[property="og:title"]') as HTMLMetaElement)
        ?.content || "";
    const ogDescription =
      (
        document.querySelector(
          'meta[property="og:description"]'
        ) as HTMLMetaElement
      )?.content || "";

    // Word count (body text, excluding scripts and styles)
    const bodyClone = document.body.cloneNode(true) as HTMLElement;
    bodyClone
      .querySelectorAll("script, style, noscript, svg, img")
      .forEach((el) => el.remove());
    const bodyText = bodyClone.textContent || "";

    // Hidden text check — elements with visibility:hidden, display:none, opacity:0
    // but NOT meta/script/style elements. Checks if they have substantial text.
    const hiddenElements = Array.from(
      document.querySelectorAll("*:not(meta):not(script):not(style):not(noscript)")
    ).filter((el) => {
      const style = window.getComputedStyle(el);
      return (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0" ||
        style.fontSize === "0px" ||
        style.color === "rgb(255, 255, 255)" // white on white — classic keyword stuffing
      );
    });

    const hiddenTextLength = hiddenElements.reduce(
      (acc, el) => acc + (el.textContent?.trim().length || 0),
      0
    );

    return {
      h1Texts: h1Els.map((el) => el.textContent?.trim() || ""),
      h2Count: h2Els.length,
      h3Count: h3Els.length,
      h4Count: h4Els.length,
      headingOrder,
      titleText,
      metaDesc,
      viewportMeta,
      canonical,
      htmlLang,
      ogTitle,
      ogDescription,
      bodyText,
      hiddenTextLength,
    };
  });

  const wordCount = countWords(dom.bodyText);
  const h1Count = dom.h1Texts.length;

  // ── 1. Single H1 ─────────────────────────────────────────────────────────
  if (h1Count === 0) {
    items.push(
      fail(
        "h1_present",
        "Exactly one H1 tag present",
        "No H1 heading found on the page.",
        "Add a single <h1> that contains your primary keyword and matches your ad headline. H1 is critical for Google Quality Score."
      )
    );
  } else if (h1Count > 1) {
    items.push(
      fail(
        "h1_present",
        "Exactly one H1 tag present",
        `${h1Count} H1 tags found: "${dom.h1Texts.join('", "')}".`,
        'Remove all but one H1. Having multiple H1s dilutes keyword signal and confuses Google\'s relevance assessment.'
      )
    );
  } else {
    items.push(
      pass(
        "h1_present",
        "Exactly one H1 tag present",
        `H1: "${dom.h1Texts[0]}".`
      )
    );
  }

  // ── 2. H1 keyword alignment ───────────────────────────────────────────────
  if (h1Count === 1) {
    const h1Norm = normalise(dom.h1Texts[0]);

    if (options.primaryKeyword) {
      const kwNorm = normalise(options.primaryKeyword);
      if (h1Norm.includes(kwNorm)) {
        items.push(
          pass(
            "h1_keyword",
            "H1 contains primary campaign keyword",
            `H1 "${dom.h1Texts[0]}" contains keyword "${options.primaryKeyword}".`
          )
        );
      } else {
        items.push(
          fail(
            "h1_keyword",
            "H1 contains primary campaign keyword",
            `H1 "${dom.h1Texts[0]}" does not contain keyword "${options.primaryKeyword}".`,
            `Update your H1 to include "${options.primaryKeyword}" — it must align with your ad group keyword for relevance scoring.`
          )
        );
      }
    }

    if (options.adHeadline) {
      const adNorm = normalise(options.adHeadline);
      const h1Words = h1Norm.split(" ");
      const adWords = adNorm.split(" ");
      const matchCount = adWords.filter((w) => h1Words.includes(w)).length;
      const similarity = matchCount / adWords.length;

      if (similarity >= 0.6) {
        items.push(
          pass(
            "h1_ad_alignment",
            "H1 aligns with ad headline",
            `H1 and ad headline share ${Math.round(similarity * 100)}% keyword overlap.`
          )
        );
      } else if (similarity >= 0.3) {
        items.push(
          warn(
            "h1_ad_alignment",
            "H1 aligns with ad headline",
            `H1 and ad headline have only ${Math.round(similarity * 100)}% keyword overlap.`,
            `Increase H1/ad headline alignment. Ad: "${options.adHeadline}" → H1: "${dom.h1Texts[0]}". Aim for 60%+ shared keywords.`
          )
        );
      } else {
        items.push(
          fail(
            "h1_ad_alignment",
            "H1 aligns with ad headline",
            `H1 "${dom.h1Texts[0]}" and ad "${options.adHeadline}" have very low alignment (${Math.round(
              similarity * 100
            )}%).`,
            "Google requires the landing page to match the ad's message. Rewrite H1 to reflect the ad headline and offer."
          )
        );
      }
    }
  }

  // ── 3. H2 subheadings present ─────────────────────────────────────────────
  if (dom.h2Count === 0) {
    items.push(
      warn(
        "h2_present",
        "H2 tags used to structure sections",
        "No H2 headings found on the page.",
        "Add H2 headings for major sections (Benefits, Features, Testimonials, etc.) using supporting keywords."
      )
    );
  } else {
    items.push(
      pass(
        "h2_present",
        "H2 tags used to structure sections",
        `${dom.h2Count} H2 heading(s) present.`
      )
    );
  }

  // ── 4. Heading hierarchy — no jumps ──────────────────────────────────────
  const levelMap: Record<string, number> = {
    H1: 1, H2: 2, H3: 3, H4: 4, H5: 5, H6: 6,
  };

  let hierarchyOk = true;
  let lastLevel = 0;
  const jumpDetails: string[] = [];

  for (const heading of dom.headingOrder) {
    const level = levelMap[heading.tag] ?? 0;
    if (lastLevel > 0 && level > lastLevel + 1) {
      hierarchyOk = false;
      jumpDetails.push(`${heading.tag} after H${lastLevel}: "${heading.text}"`);
    }
    lastLevel = level;
  }

  if (!hierarchyOk) {
    items.push(
      warn(
        "heading_hierarchy",
        "No heading hierarchy jumps (H1 → H3 without H2)",
        `Hierarchy skip(s) detected: ${jumpDetails.join("; ")}.`,
        "Fix heading order — always use H2 between H1 and H3. Jumps signal poor content structure to Google's crawler."
      )
    );
  } else {
    items.push(
      pass(
        "heading_hierarchy",
        "No heading hierarchy jumps",
        "Heading structure follows correct order (H1 → H2 → H3)."
      )
    );
  }

  // ── 5. Title tag ─────────────────────────────────────────────────────────
  const genericTitles = [
    "home",
    "untitled",
    "welcome",
    "index",
    "page",
    "new page",
    "website",
    "homepage",
  ];

  if (!dom.titleText) {
    items.push(
      fail(
        "title_tag",
        "Title tag present and relevant",
        "No <title> tag found.",
        "Add a descriptive <title> (50–60 characters) containing your primary keyword and brand name."
      )
    );
  } else if (genericTitles.includes(normalise(dom.titleText))) {
    items.push(
      fail(
        "title_tag",
        "Title tag present and relevant",
        `Title "${dom.titleText}" is generic.`,
        "Replace with a specific title like: \"[Keyword] | [Brand Name] — [Value Prop]\" (max 60 chars)."
      )
    );
  } else if (dom.titleText.length > 60) {
    items.push(
      warn(
        "title_tag",
        "Title tag present and relevant",
        `Title is ${dom.titleText.length} characters — exceeds 60 char recommended limit: "${dom.titleText}".`,
        "Trim title to 50–60 characters to prevent truncation in search results. Move brand name to the end."
      )
    );
  } else {
    items.push(
      pass(
        "title_tag",
        "Title tag present and relevant",
        `Title: "${dom.titleText}" (${dom.titleText.length} chars).`
      )
    );
  }

  // ── 6. Meta description ───────────────────────────────────────────────────
  if (!dom.metaDesc) {
    items.push(
      warn(
        "meta_description",
        "Meta description present",
        "No meta description found.",
        "Add a meta description (120–155 characters) summarising the page and including the primary keyword."
      )
    );
  } else if (dom.metaDesc.length < 70) {
    items.push(
      warn(
        "meta_description",
        "Meta description present",
        `Meta description is only ${dom.metaDesc.length} characters — too short.`,
        "Expand to 120–155 characters with a keyword-rich, compelling description."
      )
    );
  } else if (dom.metaDesc.length > 155) {
    items.push(
      warn(
        "meta_description",
        "Meta description present",
        `Meta description is ${dom.metaDesc.length} characters — may be truncated in SERPs.`,
        "Shorten to 120–155 characters."
      )
    );
  } else {
    items.push(
      pass(
        "meta_description",
        "Meta description present",
        `Meta description (${dom.metaDesc.length} chars): "${dom.metaDesc.slice(0, 80)}…"`
      )
    );
  }

  // ── 7. Viewport meta tag ─────────────────────────────────────────────────
  if (!dom.viewportMeta) {
    items.push(
      fail(
        "viewport_meta",
        "Viewport meta tag present",
        "No <meta name='viewport'> found.",
        "Add: <meta name='viewport' content='width=device-width, initial-scale=1'>. Required for mobile responsiveness — Google Ads penalises pages without this."
      )
    );
  } else if (
    !dom.viewportMeta.includes("width=device-width") ||
    !dom.viewportMeta.includes("initial-scale=1")
  ) {
    items.push(
      warn(
        "viewport_meta",
        "Viewport meta tag correctly set",
        `Viewport content: "${dom.viewportMeta}" — may be incorrectly configured.`,
        "Use: content='width=device-width, initial-scale=1' for full mobile compliance."
      )
    );
  } else {
    items.push(
      pass(
        "viewport_meta",
        "Viewport meta tag correctly set",
        `Viewport: "${dom.viewportMeta}".`
      )
    );
  }

  // ── 8. Word count / thin content ─────────────────────────────────────────
  if (wordCount < 150) {
    items.push(
      fail(
        "word_count",
        "Page has sufficient readable content (≥ 300 words)",
        `Only ~${wordCount} words detected — very thin content.`,
        "Add substantial body copy. Google requires a minimum content threshold to determine page relevance. Aim for ≥ 300 words on the page."
      )
    );
  } else if (wordCount < 300) {
    items.push(
      warn(
        "word_count",
        "Page has sufficient readable content (≥ 300 words)",
        `~${wordCount} words detected — below recommended 300 word threshold.`,
        "Expand content with benefit statements, FAQs, or testimonials to reach ≥ 300 words."
      )
    );
  } else {
    items.push(
      pass(
        "word_count",
        "Page has sufficient readable content (≥ 300 words)",
        `~${wordCount} words of readable content detected.`
      )
    );
  }

  // ── 9. Canonical tag ─────────────────────────────────────────────────────
  if (!dom.canonical) {
    items.push(
      warn(
        "canonical",
        "Canonical tag present",
        "No <link rel='canonical'> found.",
        "Add a self-referencing canonical: <link rel='canonical' href='https://yourdomain.com/page'>. Prevents duplicate content issues when UTM params create multiple URL variants."
      )
    );
  } else {
    items.push(
      pass(
        "canonical",
        "Canonical tag present",
        `Canonical: ${dom.canonical}`
      )
    );
  }

  // ── 10. HTML lang attribute ───────────────────────────────────────────────
  if (!dom.htmlLang) {
    items.push(
      warn(
        "html_lang",
        "HTML lang attribute set",
        "No lang attribute on <html> element.",
        "Add lang attribute: <html lang='en'>. Required for accessibility and language targeting compliance."
      )
    );
  } else {
    items.push(
      pass(
        "html_lang",
        "HTML lang attribute set",
        `Language set to: "${dom.htmlLang}".`
      )
    );
  }

  // ── 11. Open Graph meta ───────────────────────────────────────────────────
  if (!dom.ogTitle || !dom.ogDescription) {
    items.push(
      warn(
        "open_graph",
        "Open Graph meta tags present",
        `Missing: ${[!dom.ogTitle && "og:title", !dom.ogDescription && "og:description"]
          .filter(Boolean)
          .join(", ")}.`,
        "Add Open Graph tags for better social sharing and ad platform previews:\n<meta property='og:title' content='...'>\n<meta property='og:description' content='...'>\n<meta property='og:image' content='...'>"
      )
    );
  } else {
    items.push(
      pass(
        "open_graph",
        "Open Graph meta tags present",
        `og:title and og:description present.`
      )
    );
  }

  // ── 12. Hidden text / keyword stuffing ───────────────────────────────────
  if (dom.hiddenTextLength > 200) {
    items.push(
      fail(
        "hidden_text",
        "No hidden text or keyword stuffing",
        `~${dom.hiddenTextLength} characters of hidden text detected (display:none, visibility:hidden, or same color as background).`,
        "Remove all hidden text blocks. Google detects this as cloaking/keyword stuffing and will suspend your campaign immediately."
      )
    );
  } else {
    items.push(
      pass(
        "hidden_text",
        "No hidden text or keyword stuffing",
        "No significant hidden text detected."
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

  return {
    module: "html_structure",
    items,
    score,
    summary: {
      h1Count,
      h2Count: dom.h2Count,
      h3Count: dom.h3Count,
      titleText: dom.titleText,
      metaDescriptionLength: dom.metaDesc.length,
      wordCount,
    },
  };
}
