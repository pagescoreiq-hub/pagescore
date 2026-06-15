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
import { runFullAudit, FullAuditOptions, FullAuditReport } from "./audit-modules";

// __dirname is not available in ESM — derive it from import.meta.url
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

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
  json(res, 200, {
    status: "ok",
    service: "PageScoreIQ Audit Engine",
    version: "2.0",
    browser: browserOk ? "ready" : "not started",
    modules: 10,
    ts: new Date().toISOString(),
  });
}

async function handleModulesList(res: Res) {
  json(res, 200, { modules: MODULE_INFO });
}

async function handleFullAudit(req: Req, res: Res) {
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
    ? modulesParam.map(Number).filter((n) => n >= 1 && n <= 10)
    : undefined;

  console.log(`[audit] Full audit: ${url}${modules ? " modules=" + modules.join(",") : ""}`);
  const startMs = Date.now();

  try {
    const report = await runAudit({
      url,
      adHeadline: typeof body.adHeadline === "string" ? body.adHeadline : undefined,
      primaryKeyword: typeof body.primaryKeyword === "string" ? body.primaryKeyword : undefined,
      declaredUrl: typeof body.declaredUrl === "string" ? body.declaredUrl : url,
      safeBrowsingApiKey: process.env.SAFE_BROWSING_API_KEY,
      psiApiKey: process.env.PSI_API_KEY,
      modules,
    });

    const durationMs = Date.now() - startMs;
    console.log(`[audit] Done in ${(durationMs / 1000).toFixed(1)}s - Score: ${report.overallScore}/100 Grade: ${report.grade}`);

    json(res, 200, { success: true, durationMs, data: report });
  } catch (e: any) {
    console.error(`[audit] Failed: ${e.message}`);
    json(res, 500, { success: false, error: e.message });
  }
}

async function handleSingleModule(req: Req, res: Res, moduleNum: number) {
  if (moduleNum < 1 || moduleNum > 10) {
    return json(res, 400, { success: false, error: "Module number must be 1-10" });
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
    // GET / or /index.html -> serve frontend
    if (method === "GET" && (url === "/" || url === "/index.html")) {
      const htmlPath = path.join(__dirname, "public", "index.html");
      try {
        const html = fs.readFileSync(htmlPath, "utf-8");
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(html);
      } catch {
        res.writeHead(404);
        res.end("Frontend not found. Make sure public/index.html exists.");
      }
      return;
    }

    // GET /health
    if (method === "GET" && url === "/health") {
      return await handleHealth(res);
    }

    // GET /audit/modules
    if (method === "GET" && url === "/audit/modules") {
      return await handleModulesList(res);
    }

    // POST /audit  or  POST /audit/full
    if (method === "POST" && (url === "/audit" || url === "/audit/full")) {
      return await handleFullAudit(req, res);
    }

    // POST /audit/module/3  (single module by number)
    const moduleMatch = url.match(/^\/audit\/module\/(\d+)$/);
    if (method === "POST" && moduleMatch) {
      return await handleSingleModule(req, res, parseInt(moduleMatch[1]));
    }

    // 404
    json(res, 404, {
      error: "Not found",
      routes: [
        "GET  /health",
        "GET  /audit/modules",
        "POST /audit",
        "POST /audit/module/:n   (n = 1-10)",
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
  server.close(() => process.exit(0));
});

start().catch((e) => {
  console.error("Startup failed:", e.message);
  process.exit(1);
});
