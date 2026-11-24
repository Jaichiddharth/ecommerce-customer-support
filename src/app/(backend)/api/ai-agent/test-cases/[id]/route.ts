import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { aiAgentService } from "@/lib/services";
import { AppError } from "@/lib/errors";

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = withAuth<Ctx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "delete");
  const id = (await context?.params)?.id ?? "";
  if (!/^tc_[a-f0-9]{6,32}$/.test(id)) throw AppError.validation("Invalid test case id.", "id");
  await aiAgentService.deleteTestCase(req.user, id);
  return NextResponse.json({ success: true });
});
