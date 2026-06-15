/**
 * PageScoreIQ — Module 5: Page Structure & Heading Tags (Weight: 8%, Impact: HIGH)
 *
 * Heading tag structure signals content relevance to Google's crawler.
 * A mismatched or missing H1 directly impacts Quality Score.
 *
 * Checks:
 *  - Exactly one H1 tag on page
 *  - H1 contains primary campaign keyword
 *  - H2 tags support sections logically
 *  - No heading hierarchy jumps (H1→H3 without H2)
 *  - Title tag present and relevant
 *  - Meta description present
 *  - Page has sufficient content (>300 words)
 *  - No duplicate H1 tags
 */

import { Page } from "playwright";
import { ModuleResult, pass, fail, warn, calcScore } from "./types";

export interface PageStructureAuditOptions {
  primaryKeyword?: string;
  adHeadline?: string;
}

export interface PageStructureSummary {
  h1Count: number;
  h1Texts: string[];
  h2Count: number;
  h3Count: number;
  titleText: string;
  metaDescriptionLength: number;
  wordCount: number;
  hasHeadingJump: boolean;
}

export interface PageStructureResult extends Omit<import("./types").ModuleResult, "module"> {
  module: "page_structure";
  summary: PageStructureSummary;
}

export async function auditPageStructure(
  page: Page,
  options: PageStructureAuditOptions = {}
): Promise<PageStructureResult> {
  const items = [];

  const structureData = await page.evaluate(() => {
    const h1Els = Array.from(document.querySelectorAll("h1"));
    const h2Els = Array.from(document.querySelectorAll("h2"));
    const h3Els = Array.from(document.querySelectorAll("h3"));
    const h4Els = Array.from(document.querySelectorAll("h4"));

    const h1Texts = h1Els.map((el) => el.innerText.trim());

    // Check for heading hierarchy jumps
    const allHeadings = Array.from(document.querySelectorAll("h1, h2, h3, h4, h5, h6")).map((el) =>
      parseInt(el.tagName.replace("H", ""))
    );
    let hasJump = false;
    for (let i = 1; i < allHeadings.length; i++) {
      if (allHeadings[i] - allHeadings[i - 1] > 1) {
        hasJump = true;
        break;
      }
    }

    const title = document.title?.trim() || "";
    const metaDesc = document.querySelector<HTMLMetaElement>('meta[name="description"]')?.content || "";

    // Word count (rough)
    const bodyText = document.body?.innerText || "";
    const wordCount = bodyText.split(/\s+/).filter((w) => w.length > 0).length;

    return {
      h1Count: h1Els.length,
      h1Texts,
      h2Count: h2Els.length,
      h3Count: h3Els.length,
      h4Count: h4Els.length,
      hasHeadingJump: hasJump,
      title,
      metaDescLength: metaDesc.length,
      metaDescText: metaDesc.slice(0, 160),
      wordCount,
    };
  });

  const { primaryKeyword, adHeadline } = options;

  // ── 1. Exactly one H1 ─────────────────────────────────────────────────────
  if (structureData.h1Count === 1) {
    items.push(pass("h1_count", "Exactly one H1 tag present on the page", `One H1 found: "${structureData.h1Texts[0].slice(0, 80)}"`));
  } else if (structureData.h1Count === 0) {
    items.push(fail("h1_count", "Exactly one H1 tag present on the page", "No H1 tag found on page.", "Add a single H1 tag that contains your primary campaign keyword. It signals the page topic to Google's crawler."));
  } else {
    items.push(fail("h1_count", "Exactly one H1 tag present on the page", `${structureData.h1Count} H1 tags found. Only one is allowed.`, "Remove or demote extra H1 tags to H2/H3. Multiple H1s dilute relevance signals."));
  }

  // ── 2. No duplicate H1 ────────────────────────────────────────────────────
  if (structureData.h1Count <= 1) {
    items.push(pass("h1_duplicate", "No duplicate H1 tags", structureData.h1Count === 0 ? "No H1 present." : "Single H1 — no duplicates."));
  } else {
    items.push(
      fail(
        "h1_duplicate",
        "No duplicate H1 tags",
        `${structureData.h1Count} H1 tags: ${structureData.h1Texts.map((t) => `"${t.slice(0, 40)}"`).join(", ")}`,
        "Merge or remove duplicate H1 tags. Only the first H1 will be used for relevance scoring."
      )
    );
  }

  // ── 3. H1 contains primary keyword ───────────────────────────────────────
  if (primaryKeyword && structureData.h1Texts.length > 0) {
    const h1Lower = structureData.h1Texts[0].toLowerCase();
    const kwWords = primaryKeyword.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
    const matched = kwWords.filter((w) => h1Lower.includes(w));
    const ratio = kwWords.length > 0 ? matched.length / kwWords.length : 0;

    if (ratio >= 0.6) {
      items.push(pass("h1_keyword", "H1 contains primary campaign keyword", `H1 includes keyword words: ${matched.join(", ")}`));
    } else {
      items.push(
        fail(
          "h1_keyword",
          "H1 contains primary campaign keyword",
          `H1 "${structureData.h1Texts[0].slice(0, 60)}" has low keyword match with "${primaryKeyword}" (${Math.round(ratio * 100)}%).`,
          "Update the H1 to include your primary ad keyword naturally. This directly affects Quality Score."
        )
      );
    }
  } else if (primaryKeyword) {
    items.push(fail("h1_keyword", "H1 contains primary campaign keyword", "No H1 found to check keyword.", "Add H1 with keyword first."));
  } else {
    items.push(warn("h1_keyword", "H1 contains primary campaign keyword", "No primary keyword provided — keyword check skipped.", "Provide --keyword flag to enable H1 keyword alignment check."));
  }

  // ── 4. H2 tags present ────────────────────────────────────────────────────
  if (structureData.h2Count >= 2) {
    items.push(pass("h2_structure", "H2 tags used to support sections logically", `${structureData.h2Count} H2 tag(s) found — good content structure.`));
  } else if (structureData.h2Count === 1) {
    items.push(warn("h2_structure", "H2 tags used to support sections logically", "Only 1 H2 found. Consider adding more to break up content.", "Add H2 subheadings for major page sections. Use keyword-supporting phrases."));
  } else {
    items.push(warn("h2_structure", "H2 tags used to support sections logically", "No H2 tags found.", "Add H2 subheadings with keyword-supporting phrases to improve content structure and crawlability."));
  }

  // ── 5. Heading hierarchy ──────────────────────────────────────────────────
  if (structureData.hasHeadingJump) {
    items.push(warn("heading_hierarchy", "No heading hierarchy jumps (H1→H3 without H2)", "Heading level skipped in hierarchy (e.g. H1→H3).", "Fix heading order: H1 → H2 → H3. Skipping levels breaks document structure and accessibility."));
  } else {
    items.push(pass("heading_hierarchy", "No heading hierarchy jumps (H1→H3 without H2)", "Heading hierarchy is correctly nested."));
  }

  // ── 6. Title tag ──────────────────────────────────────────────────────────
  if (structureData.title.length > 0) {
    const titleScore = structureData.title.length >= 30 && structureData.title.length <= 70;
    if (titleScore) {
      items.push(pass("title_tag", "Title tag present and relevant to ad", `Title: "${structureData.title.slice(0, 70)}" (${structureData.title.length} chars — good length).`));
    } else {
      items.push(warn("title_tag", "Title tag present and relevant to ad", `Title "${structureData.title.slice(0, 70)}" is ${structureData.title.length < 30 ? "too short" : "too long"} (${structureData.title.length} chars).`, "Optimal title length is 30–70 characters. Include your primary keyword near the start."));
    }
  } else {
    items.push(fail("title_tag", "Title tag present and relevant to ad", "No <title> tag found.", "Add a <title> tag with your primary campaign topic. Missing title severely hurts Quality Score."));
  }

  // ── 7. Meta description ───────────────────────────────────────────────────
  if (structureData.metaDescLength > 0) {
    items.push(warn("meta_desc", "Meta description present", `Meta description: ${structureData.metaDescLength} chars. Google may still override with page content.`, structureData.metaDescLength < 120 ? "Expand meta description to 120–160 chars for better search snippet coverage." : ""));
  } else {
    items.push(warn("meta_desc", "Meta description present", "No meta description found.", "Add a 120–160 character meta description including your keyword and value proposition."));
  }

  // ── 8. Word count ─────────────────────────────────────────────────────────
  if (structureData.wordCount >= 300) {
    items.push(pass("word_count", "Page has sufficient readable content (>300 words)", `~${structureData.wordCount} words detected — good content depth.`));
  } else {
    items.push(warn("word_count", "Page has sufficient readable content (>300 words)", `Only ~${structureData.wordCount} words detected. Thin content may hurt Quality Score.`, "Expand page content to at least 300 words. Add value proposition, benefits, FAQs, or supporting copy."));
  }

  const summary: PageStructureSummary = {
    h1Count: structureData.h1Count,
    h1Texts: structureData.h1Texts,
    h2Count: structureData.h2Count,
    h3Count: structureData.h3Count,
    titleText: structureData.title,
    metaDescriptionLength: structureData.metaDescLength,
    wordCount: structureData.wordCount,
    hasHeadingJump: structureData.hasHeadingJump,
  };

  return {
    module: "page_structure",
    moduleNumber: 5,
    moduleName: "Page Structure & Heading Tags",
    weight: 8,
    impact: "HIGH",
    items,
    score: calcScore(items),
    summary,
  };
}
