import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { automationEngine } from "@/lib/automation/engine";
import { whatsappFlowSubmissionService } from "@/lib/services/whatsapp-flows";

/**
 * Scheduled maintenance for automations and Flows — call every minute from a cron
 * (e.g. Vercel Cron, Cloud Scheduler, or a crontab curl) with `Authorization: Bearer $CRON_SECRET`.
 *  - resumes runs whose Delay ended
 *  - times out runs waiting for a Flow response
 *  - marks unanswered Flow executions expired
 *  - re-processes Flow responses that were stored but not processed (crash recovery)
 */
async function sweep(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) throw new AppError("WEBHOOK_MISCONFIGURED", { message: "CRON_SECRET is not configured." });
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new AppError("FORBIDDEN", { expected: true });
  }

  const reprocessed = await whatsappFlowSubmissionService.processStale();
  const result = await automationEngine.sweep();
  return NextResponse.json({ success: true, ...result, reprocessedSubmissions: reprocessed });
}

export const GET = apiHandler(sweep);
export const POST = apiHandler(sweep);
