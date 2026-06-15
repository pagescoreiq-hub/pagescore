/**
 * PageScoreIQ — AuditController (NestJS)
 *
 * REST endpoints for triggering page validation audits.
 *
 * POST /audit/validate          → full audit (form + UTM + HTML structure)
 * POST /audit/form              → form validation only
 * POST /audit/utm               → UTM capturing only
 * POST /audit/html-structure    → HTML structure only
 * GET  /audit/health            → health check (browser alive?)
 */

import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  BadRequestException,
  Logger,
} from "@nestjs/common";
import { AuditService, RunAuditDto } from "./audit.service";

// ─── Request body types ───────────────────────────────────────────────────────

class AuditRequestBody implements RunAuditDto {
  url!: string;
  primaryKeyword?: string;
  adHeadline?: string;
}

class UrlOnlyBody {
  url!: string;
}

// ─── Controller ───────────────────────────────────────────────────────────────

@Controller("audit")
export class AuditController {
  private readonly logger = new Logger(AuditController.name);

  constructor(private readonly auditService: AuditService) {}

  // ── Health ──────────────────────────────────────────────────────────────────

  @Get("health")
  health() {
    return { status: "ok", service: "PageScoreIQ Audit Engine", ts: new Date().toISOString() };
  }

  // ── Full page validation (all 3 modules) ─────────────────────────────────

  /**
   * POST /audit/validate
   * Body: { url, primaryKeyword?, adHeadline? }
   *
   * Returns composite score + results for all three modules.
   */
  @Post("validate")
  @HttpCode(HttpStatus.OK)
  async validatePage(@Body() body: AuditRequestBody) {
    this.validateUrl(body.url);
    this.logger.log(`Full audit requested: ${body.url}`);

    const results = await this.auditService.runPageValidation(body);
    return {
      success: true,
      data: results,
    };
  }

  // ── Individual modules ─────────────────────────────────────────────────────

  /**
   * POST /audit/form
   * Body: { url }
   *
   * Runs lead form validation only.
   */
  @Post("form")
  @HttpCode(HttpStatus.OK)
  async auditForm(@Body() body: UrlOnlyBody) {
    this.validateUrl(body.url);
    const result = await this.auditService.runFormValidationOnly(body.url);
    return { success: true, data: result };
  }

  /**
   * POST /audit/utm
   * Body: { url }
   *
   * Runs UTM capturing audit only.
   */
  @Post("utm")
  @HttpCode(HttpStatus.OK)
  async auditUtm(@Body() body: UrlOnlyBody) {
    this.validateUrl(body.url);
    const result = await this.auditService.runUtmAuditOnly(body.url);
    return { success: true, data: result };
  }

  /**
   * POST /audit/html-structure
   * Body: { url, primaryKeyword?, adHeadline? }
   *
   * Runs HTML structure audit only.
   */
  @Post("html-structure")
  @HttpCode(HttpStatus.OK)
  async auditHtmlStructure(@Body() body: AuditRequestBody) {
    this.validateUrl(body.url);
    const result = await this.auditService.runHtmlStructureOnly(body.url, {
      primaryKeyword: body.primaryKeyword,
      adHeadline: body.adHeadline,
    });
    return { success: true, data: result };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private validateUrl(url: string): void {
    if (!url) {
      throw new BadRequestException("url is required");
    }
    try {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("Invalid protocol");
      }
    } catch {
      throw new BadRequestException(
        `Invalid URL: "${url}". Must be a full URL including https://`
      );
    }
  }
}
