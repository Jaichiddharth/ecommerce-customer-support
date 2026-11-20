import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { apiHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { parseQueueMessage } from "@/lib/campaigns/aws";
import { handleCampaignMessage } from "@/lib/campaigns/engine";

/**
 * POST /api/campaigns/worker — called by the campaign Lambda (infra/campaigns/cloudformation.yaml) for every
 * SQS message, with `Authorization: Bearer $CAMPAIGN_WORKER_SECRET`. Body: {"type":"start"|"tick", ...}.
 *
 * Runs one start or tick: the app checks the campaign is still running, claims and sends the next contacts,
 * and itself queues the next tick in SQS. Paused / cancelled / stale ticks return 200 and do nothing.
 * A 5xx makes the Lambda report the message as failed, so SQS retries it (and parks it in the DLQ after 5 tries);
 * retrying is safe because ticks are numbered and leased.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const secret = process.env.CAMPAIGN_WORKER_SECRET;
  if (!secret) throw new AppError("WEBHOOK_MISCONFIGURED", { message: "CAMPAIGN_WORKER_SECRET is not configured." });
  const header = req.headers.get("authorization") ?? "";
  const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
  const expected = Buffer.from(secret);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) {
    throw new AppError("FORBIDDEN", { expected: true });
  }

  const msg = parseQueueMessage(await req.text());
  // An unreadable message would fail forever: acknowledge it so it doesn't loop through retries
  if (!msg) return NextResponse.json({ success: true, ignored: "unreadable message" });

  await handleCampaignMessage(msg);
  return NextResponse.json({ success: true });
});
