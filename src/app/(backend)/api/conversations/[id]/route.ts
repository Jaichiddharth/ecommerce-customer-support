import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { conversationService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

type ConversationRouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/conversations/[id]
 * Body (all optional): { takeOver, handledBy: 'ai'|'human', needsHuman, assigneeId: number|'me'|null, status, tags }
 * Each change is recorded in the thread as a team-only note naming who made it and when.
 */
export const PATCH = withAuth<ConversationRouteContext>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "inbox", "update");
  const id = Number((await context?.params)?.id);
  if (!id || isNaN(id)) {
    throw AppError.validation("Invalid conversation id.", "id");
  }

  const body = (await readJson(req)) ?? {};
  const conversation = await conversationService.update(
    id,
    req.user.organizationId,
    { id: req.user.id, name: req.user.name },
    body
  );

  return NextResponse.json({ success: true, conversation });
});
