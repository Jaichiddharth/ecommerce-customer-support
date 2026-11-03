import { NextRequest, NextResponse, after } from "next/server";
import { whatsappWebhookService } from "@/lib/services/channels/whatsapp.webhook.service";
import { apiHandler } from "@/lib/api/handler";
import { AppError } from "@/lib/errors";
import { createLogger, getRequestContext } from "@/lib/logger";

const log = createLogger("WhatsAppWebhook");

/**
 * GET Handler: Meta WhatsApp Webhook Verification
 * Responds to Meta verification challenge when setting up or checking the webhook.
 */
export const GET = apiHandler(async (req: NextRequest) => {
  const { searchParams } = new URL(req.url);

  const result = whatsappWebhookService.verifyWebhook({
    mode: searchParams.get("hub.mode"),
    verifyToken: searchParams.get("hub.verify_token"),
    challenge: searchParams.get("hub.challenge"),
  });

  if (result.isValid && result.challenge !== null) {
    // Return challenge as raw text response with HTTP 200
    return new Response(result.challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" },
    });
  }

  throw new AppError("WEBHOOK_VERIFICATION_FAILED", { expected: true });
});

/**
 * POST Handler: Meta WhatsApp Incoming Events (Messages, Status Updates)
 * Validates HMAC signature, prevents duplicate message ingestion via database meta_message_id lookup,
 * and saves incoming messages to the messages table.
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const rawBody = await req.text();

  // 1. Verify Meta HMAC-SHA256 Signature (throws WEBHOOK_MISCONFIGURED in production without a secret)
  const isSignatureValid = whatsappWebhookService.verifySignature(rawBody, req.headers.get("x-hub-signature-256"));
  if (!isSignatureValid) {
    throw new AppError("WEBHOOK_SIGNATURE_INVALID", { expected: true });
  }

  // 2. Parse payload body
  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch (err) {
    throw new AppError("INVALID_JSON", { message: "Webhook payload is not valid JSON.", cause: err, expected: true });
  }

  // 3. Process payload and persist messages (each item is isolated and logged inside the service)
  try {
    // Automations / Flow resumption run after Meta gets its 200, so slow sends never delay the webhook
    const result = await whatsappWebhookService.processWebhookPayload(payload, {
      defer: (task) =>
        after(() => task().catch((err) => log.error("Deferred webhook task failed", { err }))),
    });
    return NextResponse.json({
      success: result.success,
      message: result.success ? "Webhook event processed successfully." : "Webhook processed with failures (see server logs).",
      processedMessages: result.processedMessages,
      processedStatuses: result.processedStatuses,
      duplicatesIgnored: result.duplicatesIgnored,
      failed: result.failed,
    });
  } catch (err) {
    // Always answer Meta with 200 so the webhook subscription stays healthy; the failure is in the logs
    log.error("Unexpected error while processing webhook payload", { err, object: payload?.object });
    return NextResponse.json({
      success: false,
      error: "Internal error processing webhook.",
      code: "WEBHOOK_PROCESSING_FAILED",
      requestId: getRequestContext()?.requestId,
    });
  }
});
