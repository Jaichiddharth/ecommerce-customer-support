import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { runAutomationMaintenance } from "@/lib/automation/scheduler";

/**
 * Scheduled maintenance for automations and Flows. The app already runs it every few seconds in-process
 * (src/instrumentation.ts); this endpoint is optional — for a cron as a second trigger or for
 * deployments with AUTOMATION_SCHEDULER=off. Call with `Authorization: Bearer $CRON_SECRET`.
 *  - resumes runs whose Delay ended and retries steps that failed transiently
 *  - times out runs waiting for a Flow response
 *  - releases runs interrupted mid-run (expired lease)
 *  - marks unanswered / interrupted Flow executions expired / failed
 *  - re-processes Flow responses that were stored but not processed (crash recovery)
 *  - replays automation triggers of inbound messages whose evaluation was lost
 *  - prunes finished runs older than the retention period
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

  const result = await runAutomationMaintenance();
  return NextResponse.json({ success: true, ...result });
}

export const GET = apiHandler(sweep);
export const POST = apiHandler(sweep);
