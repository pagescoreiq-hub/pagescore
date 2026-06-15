/**
 * PageScoreIQ — Cloudflare R2 report storage (zero-dependency)
 *
 * Uploads each audit report (JSON + a readable HTML page) straight to Cloudflare
 * R2. R2 speaks the S3 protocol, so we sign requests with AWS Signature V4 using
 * Node's built-in `crypto` — NO aws-sdk, no external packages, and no AWS account.
 * Requests only ever go to your Cloudflare R2 endpoint.
 *
 * Required environment variables (set in Railway → Variables, or a local .env):
 *   R2_ACCOUNT_ID         Cloudflare account ID (shown in the R2 dashboard)
 *   R2_ACCESS_KEY_ID      R2 API token Access Key ID
 *   R2_SECRET_ACCESS_KEY  R2 API token Secret Access Key
 *   R2_BUCKET             Bucket name, e.g. "pagescore-reports"
 *
 * Optional:
 *   R2_PUBLIC_BASE_URL    If the bucket has public access (an r2.dev URL or a
 *                         custom domain), set it here for permanent public links,
 *                         e.g. "https://pub-xxxx.r2.dev". If omitted, the helper
 *                         returns time-limited presigned URLs (valid 7 days).
 */

import crypto from "crypto";
import type { FullAuditReport } from "../audit-modules";

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicBaseUrl?: string;
}

export interface SavedReport {
  key: string; // object key of the JSON report
  jsonUrl: string; // link to the JSON report
  htmlUrl: string; // link to the human-readable HTML report
  public: boolean; // true = permanent public link, false = presigned (expiring)
}

const REGION = "auto";
const SERVICE = "s3";

/** Read R2 config from environment. Returns null if not fully configured. */
export function loadR2ConfigFromEnv(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;

  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) return null;

  return {
    accountId,
    accessKeyId,
    secretAccessKey,
    bucket,
    publicBaseUrl: process.env.R2_PUBLIC_BASE_URL?.replace(/\/+$/, ""),
  };
}

// ─── AWS SigV4 signing (built on node:crypto) ─────────────────────────────────

function sha256hex(data: string | Buffer): string {
  return crypto.createHash("sha256").update(data).digest("hex");
}

function hmac(key: string | Buffer, data: string): Buffer {
  return crypto.createHmac("sha256", key).update(data, "utf8").digest();
}

/** RFC3986 percent-encoding (encodeURIComponent + the chars it leaves out). */
function uriEncode(str: string): string {
  return encodeURIComponent(str).replace(
    /[!'()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

/** Encode an object key while preserving "/" separators. */
function encodeKey(key: string): string {
  return key.split("/").map(uriEncode).join("/");
}

function amzDates(now: Date): { amzDate: string; dateStamp: string } {
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // YYYYMMDDTHHMMSSZ
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

function signingKey(secret: string, dateStamp: string): Buffer {
  const kDate = hmac("AWS4" + secret, dateStamp);
  const kRegion = hmac(kDate, REGION);
  const kService = hmac(kRegion, SERVICE);
  return hmac(kService, "aws4_request");
}

function host(cfg: R2Config): string {
  return `${cfg.accountId}.r2.cloudflarestorage.com`;
}

/** Upload an object to R2 with a SigV4-signed PUT. */
async function putObject(
  cfg: R2Config,
  key: string,
  body: string,
  contentType: string
): Promise<void> {
  const now = new Date();
  const { amzDate, dateStamp } = amzDates(now);
  const h = host(cfg);
  const canonicalUri = `/${cfg.bucket}/${encodeKey(key)}`;
  const payloadHash = sha256hex(body);

  const canonicalHeaders =
    `content-type:${contentType}\n` +
    `host:${h}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    "", // no query string
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", signingKey(cfg.secretAccessKey, dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const res = await fetch(`https://${h}${canonicalUri}`, {
    method: "PUT",
    headers: {
      "Content-Type": contentType,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      Authorization: authorization,
    },
    body,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`R2 upload failed (${res.status}) for "${key}": ${text.slice(0, 300)}`);
  }
}

/** Build a time-limited presigned GET URL (SigV4 query signing). */
function presignGet(cfg: R2Config, key: string, expiresSec: number): string {
  const now = new Date();
  const { amzDate, dateStamp } = amzDates(now);
  const h = host(cfg);
  const canonicalUri = `/${cfg.bucket}/${encodeKey(key)}`;
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  const params: Record<string, string> = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${cfg.accessKeyId}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(expiresSec),
    "X-Amz-SignedHeaders": "host",
  };
  const canonicalQuery = Object.keys(params)
    .sort()
    .map((k) => `${uriEncode(k)}=${uriEncode(params[k])}`)
    .join("&");

  const canonicalRequest = [
    "GET",
    canonicalUri,
    canonicalQuery,
    `host:${h}\n`,
    "host",
    "UNSIGNED-PAYLOAD",
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256hex(canonicalRequest),
  ].join("\n");

  const signature = crypto
    .createHmac("sha256", signingKey(cfg.secretAccessKey, dateStamp))
    .update(stringToSign, "utf8")
    .digest("hex");

  return `https://${h}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

function linkFor(cfg: R2Config, key: string): { url: string; isPublic: boolean } {
  if (cfg.publicBaseUrl) {
    return { url: `${cfg.publicBaseUrl}/${encodeKey(key)}`, isPublic: true };
  }
  return { url: presignGet(cfg, key, 7 * 24 * 60 * 60), isPublic: false };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/** Build a stable, sortable object key base from the report. */
function buildKeyBase(report: FullAuditReport): string {
  let hostname = "unknown";
  try {
    hostname = new URL(report.url).hostname.replace(/[^a-z0-9.-]/gi, "_");
  } catch {
    /* keep default */
  }
  const ts = report.ranAt.replace(/[:.]/g, "-"); // 2026-06-15T10-20-30-000Z
  const grade = report.grade.replace("+", "plus");
  return `reports/${hostname}/${ts}__${grade}__${report.overallScore}`;
}

/**
 * Upload a full audit report to R2 as both JSON and HTML.
 * Returns the object key and shareable URLs.
 */
export async function saveReportToR2(
  report: FullAuditReport,
  cfg: R2Config
): Promise<SavedReport> {
  const base = buildKeyBase(report);
  const jsonKey = `${base}.json`;
  const htmlKey = `${base}.html`;

  await putObject(cfg, jsonKey, JSON.stringify(report, null, 2), "application/json; charset=utf-8");
  await putObject(cfg, htmlKey, renderReportHtml(report), "text/html; charset=utf-8");

  const jsonLink = linkFor(cfg, jsonKey);
  const htmlLink = linkFor(cfg, htmlKey);

  return {
    key: jsonKey,
    jsonUrl: jsonLink.url,
    htmlUrl: htmlLink.url,
    public: jsonLink.isPublic,
  };
}

// ─── Minimal self-contained HTML report ───────────────────────────────────────

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const STATUS_COLOR: Record<string, string> = {
  PASS: "#16a34a",
  WARN: "#d97706",
  FAIL: "#dc2626",
};

export function renderReportHtml(report: FullAuditReport): string {
  const modules = report.modules
    .map((m) => {
      const items = m.items
        .map(
          (i) => `
        <div class="item">
          <span class="badge" style="background:${STATUS_COLOR[i.status] || "#666"}">${i.status}</span>
          <div>
            <div class="label">${esc(i.label)}</div>
            <div class="detail">${esc(i.detail)}</div>
            ${i.fix && i.status !== "PASS" ? `<div class="fix">Fix: ${esc(i.fix)}</div>` : ""}
          </div>
        </div>`
        )
        .join("");
      return `
      <section class="module">
        <h2>Module ${m.moduleNumber} — ${esc(m.moduleName)}
          <span class="impact">${esc(m.impact)} · ${m.weight}%</span>
          <span class="mscore">${m.score}/100</span>
        </h2>
        ${items}
      </section>`;
    })
    .join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>PageScoreIQ Report — ${esc(report.url)}</title>
<style>
  :root { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; }
  body { margin:0; background:#0f1117; color:#e5e7eb; }
  .wrap { max-width: 900px; margin: 0 auto; padding: 32px 20px 80px; }
  header { border-bottom:1px solid #232838; padding-bottom:20px; margin-bottom:24px; }
  h1 { font-size: 20px; margin:0 0 6px; }
  .url { color:#60a5fa; word-break: break-all; }
  .meta { color:#9ca3af; font-size:13px; margin-top:8px; }
  .hero { display:flex; align-items:center; gap:24px; margin:24px 0; }
  .grade { font-size:56px; font-weight:800; line-height:1; }
  .score { font-size:32px; font-weight:700; }
  .verdict { color:#cbd5e1; }
  .module { border:1px solid #232838; border-radius:10px; padding:16px 18px; margin:16px 0; background:#151926; }
  .module h2 { font-size:15px; margin:0 0 12px; display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .impact { font-size:11px; color:#9ca3af; font-weight:500; }
  .mscore { margin-left:auto; font-size:14px; color:#e5e7eb; }
  .item { display:flex; gap:12px; padding:10px 0; border-top:1px solid #1c2130; }
  .badge { font-size:11px; font-weight:700; color:#fff; padding:2px 8px; border-radius:999px; height:fit-content; }
  .label { font-weight:600; font-size:14px; }
  .detail { color:#9ca3af; font-size:13px; margin-top:2px; }
  .fix { color:#38bdf8; font-size:13px; margin-top:4px; }
</style></head>
<body><div class="wrap">
  <header>
    <h1>PageScoreIQ — Landing Page Audit</h1>
    <div class="url">${esc(report.url)}</div>
    <div class="meta">Audited ${esc(report.ranAt)} · ${report.modules.length}/10 modules ·
      ${report.summary.pass} passed, ${report.summary.warn} warnings, ${report.summary.fail} failed</div>
  </header>
  <div class="hero">
    <div class="grade" style="color:${report.overallScore >= 80 ? "#16a34a" : report.overallScore >= 60 ? "#d97706" : "#dc2626"}">${esc(report.grade)}</div>
    <div>
      <div class="score">${report.overallScore}/100</div>
      <div class="verdict">${esc(report.verdict)}</div>
    </div>
  </div>
  ${modules}
</div></body></html>`;
}
