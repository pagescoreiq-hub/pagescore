# PageScoreIQ — 10-Module Audit Engine: Run Guide

## Modules

| # | Module | File | Weight | Impact |
|---|--------|------|--------|--------|
| 1 | Security & Malware | `m1-security-malware.audit.ts` | 15% | CRITICAL |
| 2 | URL & Redirect Compliance | `m2-url-redirect.audit.ts` | 12% | CRITICAL |
| 3 | Tracking & Tag Verification | `m3-tracking-tags.audit.ts` | 12% | HIGH |
| 4 | Content & Ad Policy | `m4-content-policy.audit.ts` | 12% | CRITICAL |
| 5 | Page Structure & Headings | `m5-page-structure.audit.ts` | 8% | HIGH |
| 6 | Page Speed & Core Web Vitals | `m6-page-speed.audit.ts` | 8% | HIGH |
| 7 | Mobile & Design | `m7-mobile-design.audit.ts` | 5% | MEDIUM |
| 8 | Legal & Privacy | `m8-legal-privacy.audit.ts` | 5% | HIGH |
| 9 | Conversion & UX Quality | `m9-conversion-ux.audit.ts` | 8% | MEDIUM |
| 10 | HTML & Form Validation | `m10-html-form.audit.ts` | 15% | CRITICAL |

---

## Quick Start (CLI)

### Step 1 — Install dependencies
```bash
cd C:\Users\kkira\Claude\Projects\LPQC
npm install playwright tsx typescript
npx playwright install chromium
```

### Step 2 — Run full 10-module audit
```bash
npx tsx scripts/test-audit.ts --url https://yourlandingpage.com
```

### Step 3 — Run with keyword + ad headline (enables alignment checks)
```bash
npx tsx scripts/test-audit.ts \
  --url https://yourlandingpage.com \
  --keyword "luxury flats raidurg" \
  --headline "Premium Flats in Raidurg | Book Now"
```

### Run specific modules only
```bash
# Modules 1, 3, and 10 only
npx tsx scripts/test-audit.ts --url https://yourpage.com --modules 1,3,10

# Single module
npx tsx scripts/test-audit.ts --url https://yourpage.com --modules 6
```

### Optional API keys (for full checks)
```bash
# Set as env vars for enhanced checks:
set SAFE_BROWSING_API_KEY=your_key   # Module 1: real Google Safe Browsing scan
set PSI_API_KEY=your_key             # Module 6: real PageSpeed Insights scores
```

---

## Grade Scale

| Grade | Score | Verdict |
|-------|-------|---------|
| A+ | 90–100 | Safe to launch |
| A  | 80–89  | Good — fix warnings before scaling |
| B  | 70–79  | Proceed with caution |
| C  | 60–69  | High risk — fix critical items |
| D/F | <60  | **DO NOT LAUNCH** |

---

## File Structure

```
LPQC/
├── audit-modules/
│   ├── types.ts                       ← Shared types + helpers
│   ├── m1-security-malware.audit.ts   ← Module 1 (15%, CRITICAL)
│   ├── m2-url-redirect.audit.ts       ← Module 2 (12%, CRITICAL)
│   ├── m3-tracking-tags.audit.ts      ← Module 3 (12%, HIGH)
│   ├── m4-content-policy.audit.ts     ← Module 4 (12%, CRITICAL)
│   ├── m5-page-structure.audit.ts     ← Module 5 (8%, HIGH)
│   ├── m6-page-speed.audit.ts         ← Module 6 (8%, HIGH)
│   ├── m7-mobile-design.audit.ts      ← Module 7 (5%, MEDIUM)
│   ├── m8-legal-privacy.audit.ts      ← Module 8 (5%, HIGH)
│   ├── m9-conversion-ux.audit.ts      ← Module 9 (8%, MEDIUM)
│   ├── m10-html-form.audit.ts         ← Module 10 (15%, CRITICAL)
│   └── index.ts                       ← runFullAudit() + all exports
│
├── backend/
│   └── audit/
│       ├── audit.service.ts           ← NestJS service (10-module runner)
│       ├── audit.controller.ts        ← REST endpoints
│       └── audit.module.ts            ← Module registration
│
└── scripts/
    └── test-audit.ts                  ← CLI test runner
```
