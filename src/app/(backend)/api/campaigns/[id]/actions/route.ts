import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission, type AuthUser } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { AppError } from "@/lib/errors";
import { campaignService } from "@/lib/services/campaign.service";

type Ctx = { params: Promise<{ id: string }> };

// No "unschedule": once scheduled, a campaign is locked (cancel it and duplicate it to change it)
const ACTIONS = ["schedule", "pause", "resume", "cancel", "duplicate"] as const;
type Action = (typeof ACTIONS)[number];

/** Starting messages to customers (schedule, resume) needs the "Create and launch campaigns" permission */
function assertCanLaunch(user: AuthUser) {
  const role = (user.role || "").toUpperCase();
  if (role !== "OWNER" && !(user.permissions as Record<string, boolean> | undefined)?.create_and_launch_campaigns) {
    throw new AppError("FORBIDDEN", { message: "You don't have permission to launch campaigns.", expected: true });
  }
}

// POST /api/campaigns/:id/actions  { action: "schedule" | "pause" | "resume" | "cancel" | "duplicate" }
export const POST = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  const id = parseId((await context!.params).id);
  const body = (await readJson(req)) ?? {};
  const action = body.action as Action;
  if (!ACTIONS.includes(action)) throw AppError.validation(`action must be one of: ${ACTIONS.join(", ")}`, "action");
  const orgId = req.user.organizationId;

  if (action === "duplicate") {
    assertPagePermission(req.user, "broadcasts", "create");
    const campaign = await campaignService.duplicate(orgId, req.user.id, id);
    return NextResponse.json({ success: true, campaign }, { status: 201 });
  }

  assertPagePermission(req.user, "broadcasts", "update");
  if (action === "schedule" || action === "resume") assertCanLaunch(req.user);
  const campaign =
    action === "schedule"
      ? await campaignService.schedule(orgId, id)
      : action === "pause"
        ? await campaignService.pause(orgId, id)
        : action === "resume"
          ? await campaignService.resume(orgId, id)
          : await campaignService.cancel(orgId, id);
  return NextResponse.json({ success: true, campaign });
});
