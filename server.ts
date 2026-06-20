/**
 * PageScoreIQ - Express Test Server
 *
 * Lightweight HTTP server wrapping all 10 audit modules.
 * No compile step needed - run directly with tsx.
 *
 * Start:
 *   npx tsx server.ts
 *   npx tsx server.ts --port 4000
 *
 * Endpoints:
 *   GET  /health                   Server + browser status
 *   POST /audit                    Full 10-module audit
 *   POST /audit/module/:n          Single module (1-10)
 *   GET  /audit/modules            List all modules with weights
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { chromium, Browser } from "playwright";
import { runFullAudit, FullAuditOptions, FullAuditReport, normalizeAuditType } from "./audit-modules";
import { loadR2ConfigFromEnv, saveReportToR2, SavedReport, renderReportHtml } from "./lib/r2-storage";
import { register, login, refresh, logout, AuthError } from "./lib/auth";
import { verifyAccessToken, bearerFromHeader, JwtPayload } from "./lib/jwt";
import { isDbConfigured, pingDb, closePool } from "./lib/db";
import { getOrCreateWebsite, touchLastAudited } from "./lib/models/website.model";
import { createAuditRecord } from "./lib/models/audit.model";

// __dirname is not available in ESM — derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// Load a local .env if present (Node 20.12+ built-in). On Railway, variables are
// injected directly and no .env file exists — loadEnvFile throws, so we ignore it.
try {
  process.loadEnvFile(path.join(__dirname, ".env"));
} catch {
  /* no .env file — using process.env as-is */
}

// -- Config --------------------------------------------------------------------

const PORT = parseInt(process.argv.find((a) => a.startsWith("--port="))?.split("=")[1] ?? "") ||
  parseInt(process.argv[process.argv.indexOf("--port") + 1] ?? "") ||
  parseInt(process.env.PORT ?? "") ||   // Railway / hosting platforms inject PORT
  3000;

// -- Browser singleton ---------------------------------------------------------

let browser: Browser | null = null;

async function getBrowser(): Promise<Browser> {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    });
    console.log("  [browser] Chromium launched");
  }
  return browser;
}

// -- Audit runner --------------------------------------------------------------

async function runAudit(options: FullAuditOptions): Promise<FullAuditReport> {
  const b = await getBrowser();
  const context = await b.newContext({
    viewport: { width: 1280, height: 800 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
      "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  });
  const page = await context.newPage();
  try {
    await page.goto(options.url, { waitUntil: "load", timeout: 60_000 });
    await page.waitForTimeout(2000);
    return await runFullAudit(page, options);
  } finally {
    await context.close();
  }
}

// -- PDF rendering -------------------------------------------------------------

/** Render the report's HTML into a PDF buffer using the Chromium instance. */
async function renderReportPdf(report: FullAuditReport): Promise<Buffer> {
  const b = await getBrowser();
  const context = await b.newContext();
  const page = await context.newPage();
  try {
    const html = renderReportHtml(report);
    await page.setContent(html, { waitUntil: "load" });
    const pdf = await page.pdf({
      format: "A4",
      printBackground: true,
      margin: { top: "16px", bottom: "16px", left: "16px", right: "16px" },
    });
    return pdf;
  } finally {
    await context.close();
  }
}

// -- HTTP helpers --------------------------------------------------------------

type Res = http.ServerResponse;
type Req = http.IncomingMessage;

function json(res: Res, status: number, body: unknown) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  });
  res.end(payload);
}

function readBody(req: Req): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function validateUrl(url: unknown): string {
  if (!url || typeof url !== "string") throw new Error("url is required (string)");
  try {
    const p = new URL(url);
    if (!["http:", "https:"].includes(p.protocol)) throw new Error("Must start with http:// or https://");
    return url;
  } catch {
    throw new Error(`Invalid URL: "${url}" - must be a full URL including https://`);
  }
}

// -- Auth helpers --------------------------------------------------------------

/** Resolve the current user from a Bearer access token, or null if unauthenticated. */
function getAuthUser(req: Req): JwtPayload | null {
  const token = bearerFromHeader(req.headers.authorization);
  return token ? verifyAccessToken(token) : null;
}

/** Request metadata stored alongside a session (user-agent / client IP). */
function reqMeta(req: Req) {
  const fwd = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim();
  return {
    userAgent: (req.headers["user-agent"] as string | undefined) ?? null,
    ip: fwd || req.socket.remoteAddress || null,
  };
}

function serveFile(res: Res, fileName: string, status = 200) {
  const filePath = path.join(__dirname, "public", fileName);
  try {
    const html = fs.readFileSync(filePath, "utf-8");
    res.writeHead(status, { "Content-Type": "text/html; charset=utf-8" });
    res.end(html);
  } catch {
    res.writeHead(404);
    res.end(`Page not found: ${fileName}`);
  }
}

async function handleRegister(req: Req, res: Res) {
  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch (e: any) {
    return json(res, 400, { success: false, error: e.message });
  }
  try {
    const result = await register(body, reqMeta(req));
    json(res, 201, { success: true, ...result });
  } catch (e: any) {
    const status = e instanceof AuthError ? e.status : 500;
    if (!(e instanceof AuthError)) console.error("[register] error:", e.message);
    json(res, status, { success: false, error: e.message });
  }
}

async function handleLogin(req: Req, res: Res) {
  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch (e: any) {
    return json(res, 400, { success: false, error: e.message });
  }
  try {
    const result = await login(body, reqMeta(req));
    json(res, 200, { success: true, ...result });
  } catch (e: any) {
    const status = e instanceof AuthError ? e.status : 500;
    if (!(e instanceof AuthError)) console.error("[login] error:", e.message);
    json(res, status, { success: false, error: e.message });
  }
}

async function handleRefresh(req: Req, res: Res) {
  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch (e: any) {
    return json(res, 400, { success: false, error: e.message });
  }
  try {
    const result = await refresh(body.refreshToken, reqMeta(req));
    json(res, 200, { success: true, ...result });
  } catch (e: any) {
    const status = e instanceof AuthError ? e.status : 500;
    if (!(e instanceof AuthError)) console.error("[refresh] error:", e.message);
    json(res, status, { success: false, error: e.message });
  }
}

async function handleLogout(req: Req, res: Res) {
  let body: Record<string, unknown> = {};
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch {
    /* logout is best-effort; ignore body parse errors */
  }
  try {
    await logout(body.refreshToken);
  } catch (e: any) {
    console.error("[logout] error:", e.message);
  }
  json(res, 200, { success: true });
}

// -- Route handlers ------------------------------------------------------------

const MODULE_INFO = [
  { n: 1,  name: "Security & Malware",        weight: 15, impact: "CRITICAL" },
  { n: 2,  name: "URL & Redirect Compliance", weight: 12, impact: "CRITICAL" },
  { n: 3,  name: "Tracking & Tag Verification", weight: 12, impact: "HIGH" },
  { n: 4,  name: "Content & Ad Policy",        weight: 12, impact: "CRITICAL" },
  { n: 5,  name: "Page Structure & Headings",  weight: 8,  impact: "HIGH" },
  { n: 6,  name: "Page Speed & Core Web Vitals", weight: 8, impact: "HIGH" },
  { n: 7,  name: "Mobile & Design",            weight: 5,  impact: "MEDIUM" },
  { n: 8,  name: "Legal & Privacy",            weight: 5,  impact: "HIGH" },
  { n: 9,  name: "Conversion & UX Quality",    weight: 8,  impact: "MEDIUM" },
  { n: 10, name: "HTML & Form Validation",     weight: 15, impact: "CRITICAL" },
];

async function handleHealth(res: Res) {
  const browserOk = !!browser?.isConnected();
  const dbOk = isDbConfigured() ? await pingDb() : false;
  json(res, 200, {
    status: "ok",
    service: "PageScoreIQ Audit Engine",
    version: "2.0",
    browser: browserOk ? "ready" : "not started",
    database: isDbConfigured() ? (dbOk ? "connected" : "unreachable") : "not configured",
    modules: 10,
    ts: new Date().toISOString(),
  });
}

async function handleModulesList(res: Res) {
  json(res, 200, { modules: MODULE_INFO });
}

async function handleFullAudit(req: Req, res: Res, user: JwtPayload) {
  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch (e: any) {
    return json(res, 400, { success: false, error: e.message });
  }

  let url: string;
  try {
    url = validateUrl(body.url);
  } catch (e: any) {
    return json(res, 400, { success: false, error: e.message });
  }

  const modulesParam = body.modules;
  const modules = Array.isArray(modulesParam)
    ? modulesParam.map(Number).filter((n) => n >= 1 && n <= 12)
    : undefined;

  const auditType = normalizeAuditType(body.auditType);

  console.log(`[audit] Full audit (${auditType}): ${url}${modules ? " modules=" + modules.join(",") : ""}`);
  const startMs = Date.now();

  try {
    const report = await runAudit({
      url,
      auditType,
      adHeadline: typeof body.adHeadline === "string" ? body.adHeadline : undefined,
      primaryKeyword: typeof body.primaryKeyword === "string" ? body.primaryKeyword : undefined,
      declaredUrl: typeof body.declaredUrl === "string" ? body.declaredUrl : url,
      safeBrowsingApiKey: process.env.SAFE_BROWSING_API_KEY,
      psiApiKey: process.env.PSI_API_KEY,
      modules,
    });

    const durationMs = Date.now() - startMs;
    console.log(`[audit] Done in ${(durationMs / 1000).toFixed(1)}s - Score: ${report.overallScore}/100 Grade: ${report.grade}`);

    // Save the PDF to Cloudflare R2 under report/<username>/<hostname>/<ts>.pdf
    // (best-effort — never fails the audit).
    let saved: SavedReport | null = null;
    const r2 = loadR2ConfigFromEnv();
    if (r2) {
      try {
        const pdf = await renderReportPdf(report);
        saved = await saveReportToR2(report, r2, user.username, pdf);
        console.log(`[audit] PDF saved to R2: ${saved.key}`);
      } catch (e: any) {
        console.error(`[audit] R2 save failed (audit still returned): ${e.message}`);
      }
    }

    // Record the run in Postgres (best-effort — never fails the audit).
    if (isDbConfigured()) {
      try {
        const hostname = new URL(url).hostname;
        const website = await getOrCreateWebsite({ userId: user.sub, url, hostname });
        await createAuditRecord({
          userId: user.sub,
          websiteId: website.id,
          url,
          auditType: report.auditType,
          overallScore: report.overallScore,
          grade: report.grade,
          verdict: report.verdict,
          summary: report.summary,
          report,
          pdfKey: saved?.key ?? null,
          pdfUrl: saved?.pdfUrl ?? null,
        });
        await touchLastAudited(website.id);
      } catch (e: any) {
        console.error(`[audit] DB record failed (audit still returned): ${e.message}`);
      }
    }

    json(res, 200, { success: true, durationMs, data: report, report: saved });
  } catch (e: any) {
    console.error(`[audit] Failed: ${e.message}`);
    json(res, 500, { success: false, error: e.message });
  }
}

async function handleSingleModule(req: Req, res: Res, moduleNum: number) {
  if (moduleNum < 1 || moduleNum > 12) {
    return json(res, 400, { success: false, error: "Module number must be 1-12" });
  }

  let body: Record<string, unknown>;
  try {
    body = (await readBody(req)) as Record<string, unknown>;
  } catch (e: any) {
    return json(res, 400, { success: false, error: e.message });
  }

  let url: string;
  try {
    url = validateUrl(body.url);
  } catch (e: any) {
    return json(res, 400, { success: false, error: e.message });
  }

  console.log(`[audit] Module ${moduleNum} audit: ${url}`);
  const startMs = Date.now();

  try {
    const report = await runAudit({
      url,
      adHeadline: typeof body.adHeadline === "string" ? body.adHeadline : undefined,
      primaryKeyword: typeof body.primaryKeyword === "string" ? body.primaryKeyword : undefined,
      declaredUrl: url,
      safeBrowsingApiKey: process.env.SAFE_BROWSING_API_KEY,
      psiApiKey: process.env.PSI_API_KEY,
      modules: [moduleNum],
    });

    const moduleResult = report.modules[0];
    const durationMs = Date.now() - startMs;

    json(res, 200, {
      success: true,
      durationMs,
      data: {
        url: report.url,
        ranAt: report.ranAt,
        module: moduleResult,
      },
    });
  } catch (e: any) {
    console.error(`[audit] Module ${moduleNum} failed: ${e.message}`);
    json(res, 500, { success: false, error: e.message });
  }
}

// -- Server --------------------------------------------------------------------

const server = http.createServer(async (req: Req, res: Res) => {
  const method = req.method?.toUpperCase() ?? "GET";
  const url = req.url ?? "/";

  // CORS preflight
  if (method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    });
    return res.end();
  }

  try {
    // Static pages — auth is enforced client-side via the JWT, so pages are
    // served unconditionally; their JS redirects when no valid token is present.
    if (method === "GET" && (url === "/login" || url === "/login.html")) {
      return serveFile(res, "login.html");
    }
    if (method === "GET" && (url === "/register" || url === "/register.html")) {
      return serveFile(res, "register.html");
    }
    if (method === "GET" && (url === "/" || url === "/index.html")) {
      return serveFile(res, "index.html");
    }

    // Auth API
    if (method === "POST" && url === "/register") return await handleRegister(req, res);
    if (method === "POST" && url === "/login") return await handleLogin(req, res);
    if (method === "POST" && url === "/refresh") return await handleRefresh(req, res);
    if (method === "POST" && url === "/logout") return await handleLogout(req, res);

    // GET /health
    if (method === "GET" && url === "/health") {
      return await handleHealth(res);
    }

    // GET /audit/modules
    if (method === "GET" && url === "/audit/modules") {
      return await handleModulesList(res);
    }

    // POST /audit  or  POST /audit/full  (requires a valid Bearer access token)
    if (method === "POST" && (url === "/audit" || url === "/audit/full")) {
      const user = getAuthUser(req);
      if (!user) return json(res, 401, { success: false, error: "Not authenticated" });
      return await handleFullAudit(req, res, user);
    }

    // POST /audit/module/3  (single module by number, requires auth)
    const moduleMatch = url.match(/^\/audit\/module\/(\d+)$/);
    if (method === "POST" && moduleMatch) {
      if (!getAuthUser(req)) return json(res, 401, { success: false, error: "Not authenticated" });
      return await handleSingleModule(req, res, parseInt(moduleMatch[1]));
    }

    // 404
    json(res, 404, {
      error: "Not found",
      routes: [
        "POST /register",
        "POST /login",
        "POST /refresh",
        "POST /logout",
        "GET  /health",
        "GET  /audit/modules",
        "POST /audit                (Bearer token)",
        "POST /audit/module/:n      (n = 1-10, Bearer token)",
      ],
    });
  } catch (e: any) {
    json(res, 500, { success: false, error: "Internal server error: " + e.message });
  }
});

// -- Startup -------------------------------------------------------------------

async function start() {
  console.log("\n  PageScoreIQ - Audit API Server");
  console.log("  ================================");

  // Pre-warm browser
  process.stdout.write("  Starting Chromium...");
  await getBrowser();
  console.log(" ready");

  server.listen(PORT, () => {
    console.log(`\n  Server running at http://localhost:${PORT}`);
    console.log(`\n  Frontend UI:  http://localhost:${PORT}/`);
    console.log("\n  API Endpoints:");
    console.log(`    GET  http://localhost:${PORT}/health`);
    console.log(`    GET  http://localhost:${PORT}/audit/modules`);
    console.log(`    POST http://localhost:${PORT}/audit`);
    console.log(`    POST http://localhost:${PORT}/audit/module/1  (through /10)`);
    console.log("\n  Press Ctrl+C to stop.\n");
  });
}

// Graceful shutdown
process.on("SIGINT", async () => {
  console.log("\n  Shutting down...");
  if (browser) await browser.close();
  await closePool().catch(() => {});
  server.close(() => process.exit(0));
});

start().catch((e) => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});
