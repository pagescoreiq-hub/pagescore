/**
 * PageScoreIQ — AuditModule (NestJS)
 *
 * Register this module in your AppModule:
 *
 *   @Module({ imports: [AuditModule] })
 *   export class AppModule {}
 */

import { Module } from "@nestjs/common";
import { AuditService } from "./audit.service";
import { AuditController } from "./audit.controller";

@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService], // Export so other modules (e.g. ScheduleModule) can inject it
})
export class AuditModule {}
