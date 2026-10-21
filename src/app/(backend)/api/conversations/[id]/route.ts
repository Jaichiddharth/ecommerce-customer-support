import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { conversationService } from "@/lib/services";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

type ConversationRouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/conversations/[id]
 * Body (all optional): { takeOver, handledBy: 'ai'|'human', needsHuman, assigneeId: number|'me'|null, status, tags }
 */
export const PATCH = withAuth<ConversationRouteContext>(async (req: AuthenticatedRequest, context) => {
  const id = Number((await context?.params)?.id);
  if (!id || isNaN(id)) {
    throw AppError.validation("Invalid conversation id.", "id");
  }

  const body = (await readJson(req)) ?? {};
  const conversation = await conversationService.update(id, req.user.organizationId, req.user.id, body);

  return NextResponse.json({ success: true, conversation });
});
