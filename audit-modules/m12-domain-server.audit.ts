/**
 * PageScoreIQ — Module 12: Domain & Server Health (Weight: 18%, Website audit only)
 *
 * PRD v2.0 §4 — 12 checklist items. Implemented with Node built-ins only:
 *   node:tls   → SSL certificate validity + chain
 *   node:dns   → A/CNAME resolution
 *   node:https → TTFB measurement
 *   fetch()    → HTTP→HTTPS redirect, www canonicalization, security headers,
 *                custom 404, uptime / server errors
 *   RDAP       → domain expiry / recent ownership change (modern WHOIS)
 */

import { Page } from "playwright";
import tls from "node:tls";
import https from "node:https";
import dns from "node:dns/promises";
import { ModuleResult, AuditItem, pass, fail, warn, calcScore } from "./types";

const TIMEOUT = 10_000;

interface CertInfo {
  authorized: boolean;
  authorizationError?: string;
  validTo?: string;
  chainComplete: boolean;
}

/** Open a TLS connection and inspect the peer certificate + chain. */
function getCert(host: string): Promise<CertInfo | null> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host, port: 443, servername: host, timeout: TIMEOUT, rejectUnauthorized: false },
      () => {
        const cert: any = socket.getPeerCertificate(true);
        let chainComplete = false;
        let c: any = cert;
        const seen = new Set<string>();
        while (c && c.fingerprint && !seen.has(c.fingerprint)) {
          seen.add(c.fingerprint);
          if (c.issuerCertificate && c.issuerCertificate.fingerprint === c.fingerprint) {
            chainComplete = true; // reached a self-signed root → chain resolves
            break;
          }
          c = c.issuerCertificate;
        }
        resolve({
          authorized: socket.authorized,
          authorizationError: socket.authorizationError ? String(socket.authorizationError) : undefined,
          validTo: cert?.valid_to,
          chainComplete,
        });
        socket.end();
      }
    );
    socket.on("error", () => resolve(null));
    socket.on("timeout", () => { socket.destroy(); resolve(null); });
  });
}

/** Measure time-to-first-byte for an HTTPS GET. */
function measureTtfb(host: string): Promise<{ ttfb: number; status: number } | null> {
  return new Promise((resolve) => {
    const start = Date.now();
    const req = https.request(
      { method: "GET", host, path: "/", port: 443, timeout: TIMEOUT },
      (res) => {
        const ttfb = Date.now() - start;
        res.destroy();
        resolve({ ttfb, status: res.statusCode || 0 });
      }
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => { req.destroy(); resolve(null); });
    req.end();
  });
}

async function safeFetch(url: string, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetch(url, { signal: AbortSignal.timeout(TIMEOUT), redirect: "follow", ...init });
  } catch {
    return null;
  }
}

/** Best-effort registrable domain (handles common 2-label ccTLDs like co.uk). */
function registrableDomain(host: string): string {
  const h = host.replace(/^www\./i, "");
  const parts = h.split(".");
  if (parts.length <= 2) return h;
  const secondLevel = parts[parts.length - 2];
  const tld = parts[parts.length - 1];
  if (secondLevel.length <= 3 && tld.length <= 3) return parts.slice(-3).join(".");
  return parts.slice(-2).join(".");
}

async function rdap(domain: string): Promise<any | null> {
  try {
    const res = await fetch(`https://rdap.org/domain/${domain}`, {
      signal: AbortSignal.timeout(TIMEOUT),
      headers: { Accept: "application/rdap+json" },
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function auditDomainServer(page: Page): Promise<ModuleResult> {
  const items: AuditItem[] = [];
  const pageUrl = page.url();
  let host = "";
  try { host = new URL(pageUrl).hostname; } catch { /* leave empty */ }
  const origin = host ? `https://${host}` : pageUrl;

  // Run independent probes concurrently.
  const [cert, dnsA, ttfb, rootRes, httpRes, wwwPair, notFoundRes, rdapData] = await Promise.all([
    host ? getCert(host) : Promise.resolve(null),
    host ? dns.resolve4(host).catch(() => dns.resolveCname(host).catch(() => [] as string[])) : Promise.resolve([] as string[]),
    host ? measureTtfb(host) : Promise.resolve(null),
    safeFetch(`${origin}/`),
    host ? safeFetch(`http://${host}/`, { redirect: "manual" }) : Promise.resolve(null),
    // www vs non-www: resolve final host for both
    (async () => {
      if (!host) return null;
      const bare = host.replace(/^www\./i, "");
      const a = await safeFetch(`https://${bare}/`);
      const b = await safeFetch(`https://www.${bare}/`);
      const fa = a ? (() => { try { return new URL(a.url).hostname; } catch { return null; } })() : null;
      const fb = b ? (() => { try { return new URL(b.url).hostname; } catch { return null; } })() : null;
      return { fa, fb };
    })(),
    safeFetch(`${origin}/psiq-nonexistent-${Math.floor(Number(process.hrtime.bigint() % 1000000n))}`),
    host ? rdap(registrableDomain(host)) : Promise.resolve(null),
  ]);

  // ── 1. SSL valid & not expiring within 30 days ──────────────────────────────
  if (!cert || !cert.validTo) {
    items.push(fail("ssl_valid", "SSL certificate valid and not expiring within 30 days",
      "Could not retrieve an SSL certificate over HTTPS.",
      "Ensure the site serves a valid TLS certificate on port 443."));
  } else {
    const expiry = new Date(cert.validTo).getTime();
    const days = Math.round((expiry - Date.now()) / (24 * 60 * 60 * 1000));
    if (isNaN(expiry)) {
      items.push(warn("ssl_valid", "SSL certificate valid and not expiring within 30 days",
        "Certificate present but expiry date could not be parsed.", "Verify the certificate manually."));
    } else if (days < 0) {
      items.push(fail("ssl_valid", "SSL certificate valid and not expiring within 30 days",
        `Certificate EXPIRED ${Math.abs(days)} day(s) ago.`, "Renew the TLS certificate immediately."));
    } else if (days <= 30) {
      items.push(warn("ssl_valid", "SSL certificate valid and not expiring within 30 days",
        `Certificate expires in ${days} day(s).`, "Renew/auto-renew the certificate before it lapses."));
    } else {
      items.push(pass("ssl_valid", "SSL certificate valid and not expiring within 30 days",
        `Certificate valid for ${days} more day(s).`));
    }
  }

  // ── 2. SSL chain complete ───────────────────────────────────────────────────
  if (!cert) {
    items.push(fail("ssl_chain", "SSL certificate chain is complete (no intermediate cert errors)",
      "No TLS handshake — chain could not be verified.", "Fix TLS so the certificate is served."));
  } else if (cert.authorized) {
    // Node validated a path from the served cert to a trusted root, so the
    // intermediate chain is sufficient. (Servers correctly omit the root cert,
    // so a "self-signed root in the served chain" test would false-negative.)
    items.push(pass("ssl_chain", "SSL certificate chain is complete (no intermediate cert errors)",
      "Certificate chain validates against trusted roots."));
  } else {
    const reason = /unable to (verify|get).*(issuer|chain)/i.test(cert.authorizationError || "")
      ? "intermediate certificate(s) missing from the served chain"
      : cert.authorizationError || "chain validation failed";
    items.push(fail("ssl_chain", "SSL certificate chain is complete (no intermediate cert errors)",
      `Chain issue: ${reason}.`,
      "Install the full intermediate certificate chain on the server (concatenate the CA bundle)."));
  }

  // ── 3. HTTP → HTTPS redirect (301) ──────────────────────────────────────────
  if (!httpRes) {
    items.push(warn("https_redirect", "HTTP correctly redirects to HTTPS (301, not 302)",
      "Could not reach the site over plain HTTP.", "Ensure http:// redirects to https:// with a 301."));
  } else {
    const loc = httpRes.headers.get("location") || "";
    const isRedirect = httpRes.status >= 300 && httpRes.status < 400;
    if (isRedirect && loc.startsWith("https://")) {
      if (httpRes.status === 301) {
        items.push(pass("https_redirect", "HTTP correctly redirects to HTTPS (301, not 302)",
          `HTTP → HTTPS via ${httpRes.status}.`));
      } else {
        items.push(warn("https_redirect", "HTTP correctly redirects to HTTPS (301, not 302)",
          `HTTP redirects to HTTPS but with a ${httpRes.status} (should be 301).`,
          "Use a permanent 301 redirect from HTTP to HTTPS."));
      }
    } else {
      items.push(fail("https_redirect", "HTTP correctly redirects to HTTPS (301, not 302)",
        `HTTP did not redirect to HTTPS (status ${httpRes.status}).`,
        "Force a 301 redirect from http:// to https://."));
    }
  }

  // ── 4. www vs non-www consistency ───────────────────────────────────────────
  if (!wwwPair || (!wwwPair.fa && !wwwPair.fb)) {
    items.push(warn("www_canonical", "WWW vs non-WWW resolves consistently to one canonical version",
      "Could not compare www and non-www responses.", "Pick one canonical host and 301 the other to it."));
  } else if (wwwPair.fa && wwwPair.fb && wwwPair.fa === wwwPair.fb) {
    items.push(pass("www_canonical", "WWW vs non-WWW resolves consistently to one canonical version",
      `Both variants resolve to ${wwwPair.fa}.`));
  } else {
    items.push(fail("www_canonical", "WWW vs non-WWW resolves consistently to one canonical version",
      `Inconsistent: non-www → ${wwwPair.fa || "?"}, www → ${wwwPair.fb || "?"}.`,
      "301-redirect one variant to the other so only one canonical host serves content."));
  }

  // ── 5. DNS resolves ─────────────────────────────────────────────────────────
  if (dnsA && dnsA.length > 0) {
    items.push(pass("dns", "DNS resolves correctly (A/CNAME records valid)",
      `Resolved ${dnsA.length} record(s): ${dnsA.slice(0, 3).join(", ")}.`));
  } else {
    items.push(fail("dns", "DNS resolves correctly (A/CNAME records valid)",
      "No A or CNAME records resolved for the host.",
      "Check the domain's DNS A/CNAME records at your DNS provider."));
  }

  // ── 6. TTFB < 600ms ─────────────────────────────────────────────────────────
  if (!ttfb) {
    items.push(warn("ttfb", "Server response time (TTFB) under 600ms",
      "Could not measure TTFB.", "Verify the server responds over HTTPS."));
  } else if (ttfb.ttfb <= 600) {
    items.push(pass("ttfb", "Server response time (TTFB) under 600ms", `TTFB ≈ ${ttfb.ttfb}ms.`));
  } else {
    items.push(warn("ttfb", "Server response time (TTFB) under 600ms",
      `TTFB ≈ ${ttfb.ttfb}ms (target < 600ms).`,
      "Improve server response time: caching, CDN, faster origin, or warmer connections."));
  }

  // ── 7. Security headers ─────────────────────────────────────────────────────
  if (!rootRes) {
    items.push(warn("security_headers", "Correct HTTP security headers present (HSTS, X-Content-Type-Options)",
      "Could not fetch the homepage to inspect headers.", "Ensure the homepage is reachable over HTTPS."));
  } else {
    const hsts = rootRes.headers.get("strict-transport-security");
    const xcto = rootRes.headers.get("x-content-type-options");
    const missing: string[] = [];
    if (!hsts) missing.push("Strict-Transport-Security");
    if (!xcto) missing.push("X-Content-Type-Options");
    if (missing.length === 0) {
      items.push(pass("security_headers", "Correct HTTP security headers present (HSTS, X-Content-Type-Options)",
        "HSTS and X-Content-Type-Options present."));
    } else {
      items.push(fail("security_headers", "Correct HTTP security headers present (HSTS, X-Content-Type-Options)",
        `Missing header(s): ${missing.join(", ")}.`,
        "Add the missing headers (e.g. Strict-Transport-Security: max-age=31536000; includeSubDomains, X-Content-Type-Options: nosniff)."));
    }
  }

  // ── 8. Hosting/CDN conflicts (heuristic, informational) ─────────────────────
  if (!rootRes) {
    items.push(warn("hosting_conflicts", "No mixed hosting errors (CDN/origin server conflicts)",
      "Could not inspect response headers.", "Ensure the homepage responds normally."));
  } else {
    const server = rootRes.headers.get("server") || "";
    const cdn = ["cf-ray", "x-vercel-id", "x-amz-cf-id", "x-fastly-request-id", "x-served-by"].find((h) => rootRes.headers.get(h));
    if (rootRes.status >= 500) {
      items.push(fail("hosting_conflicts", "No mixed hosting errors (CDN/origin server conflicts)",
        `Homepage returned ${rootRes.status} — possible origin/CDN failure.`,
        "Investigate origin health and CDN configuration."));
    } else {
      items.push(pass("hosting_conflicts", "No mixed hosting errors (CDN/origin server conflicts)",
        `No CDN/origin conflict detected${cdn ? ` (CDN: ${cdn})` : ""}${server ? `, server: ${server}` : ""}.`));
    }
  }

  // ── 9. Custom 404 returns 404 (not 200) ─────────────────────────────────────
  if (!notFoundRes) {
    items.push(warn("custom_404", "404 page exists and returns proper 404 status (not 200)",
      "Could not test a non-existent URL.", "Ensure unknown paths return a 404 status."));
  } else if (notFoundRes.status === 404) {
    items.push(pass("custom_404", "404 page exists and returns proper 404 status (not 200)",
      "Unknown URL correctly returned HTTP 404."));
  } else {
    items.push(fail("custom_404", "404 page exists and returns proper 404 status (not 200)",
      `Unknown URL returned HTTP ${notFoundRes.status} (soft 404).`,
      "Return a real 404 status for non-existent pages, not 200."));
  }

  // ── 10. Uptime (page was reachable at audit time) ───────────────────────────
  if (rootRes && rootRes.status < 500) {
    items.push(pass("uptime", "Server uptime check passes (page reachable at audit time)",
      `Homepage reachable (HTTP ${rootRes.status}).`));
  } else {
    items.push(fail("uptime", "Server uptime check passes (page reachable at audit time)",
      rootRes ? `Homepage returned ${rootRes.status}.` : "Homepage was not reachable.",
      "Restore availability; the server did not return a healthy response."));
  }

  // ── 11. No server error codes during crawl ──────────────────────────────────
  const probed = [rootRes, ttfb ? { status: ttfb.status } : null].filter(Boolean) as { status: number }[];
  const serverErr = probed.find((r) => r.status >= 500);
  if (serverErr) {
    items.push(fail("server_errors", "No server error codes (500/502/503) during crawl",
      `Encountered HTTP ${serverErr.status} during checks.`,
      "Fix the 5xx error on the origin server."));
  } else {
    items.push(pass("server_errors", "No server error codes (500/502/503) during crawl",
      "No 5xx responses observed during checks."));
  }

  // ── 12. Domain ownership / expiry (RDAP) ────────────────────────────────────
  if (!rdapData) {
    items.push(warn("whois", "Domain not recently changed ownership / expiring soon (WHOIS check)",
      "RDAP/WHOIS lookup unavailable for this domain.",
      "Verify the domain's expiry and registration manually with your registrar."));
  } else {
    const events: any[] = Array.isArray(rdapData.events) ? rdapData.events : [];
    const find = (action: string) => events.find((e) => e.eventAction === action)?.eventDate as string | undefined;
    const expiration = find("expiration");
    const lastChanged = find("last changed") || find("last update of RDAP database");
    const now = Date.now();

    const expDays = expiration ? Math.round((new Date(expiration).getTime() - now) / 86_400_000) : null;
    const changedDays = lastChanged ? Math.round((now - new Date(lastChanged).getTime()) / 86_400_000) : null;

    if (expDays !== null && expDays <= 30) {
      items.push(fail("whois", "Domain not recently changed ownership / expiring soon (WHOIS check)",
        `Domain expires in ${expDays} day(s).`, "Renew the domain registration immediately."));
    } else if (changedDays !== null && changedDays <= 30) {
      items.push(warn("whois", "Domain not recently changed ownership / expiring soon (WHOIS check)",
        `Domain registration changed ${changedDays} day(s) ago.`,
        "Recent ownership/registration changes can affect ad trust — confirm this was expected."));
    } else {
      items.push(pass("whois", "Domain not recently changed ownership / expiring soon (WHOIS check)",
        expDays !== null ? `Domain valid for ~${expDays} more day(s).` : "No expiry/recent-change concerns found."));
    }
  }

  return {
    module: "domain_server",
    moduleNumber: 12,
    moduleName: "Domain & Server Health",
    weight: 18,
    impact: "CRITICAL",
    items,
    score: calcScore(items),
  };
}
