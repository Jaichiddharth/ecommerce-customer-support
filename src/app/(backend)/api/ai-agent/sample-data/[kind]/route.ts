import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiSampleDataService, type SampleKind } from "@/lib/services";
import { AppError } from "@/lib/errors";

type Ctx = { params: Promise<{ kind: string }> };

async function kindOf(context?: Ctx): Promise<SampleKind> {
  const kind = (await context?.params)?.kind;
  if (kind !== "orders" && kind !== "products") throw AppError.notFound("Unknown sample data.");
  return kind;
}

/** PUT /api/ai-agent/sample-data/<orders|products> { format: "csv"|"json", text, fileName }: replaces it, regenerates checks */
export const PUT = withAuth<Ctx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "create");
  const result = await aiSampleDataService.upload(req.user, await kindOf(context), await readJson(req));
  return NextResponse.json({ success: true, ...result });
});

/** DELETE /api/ai-agent/sample-data/<orders|products>: removes it and the checks made from it */
export const DELETE = withAuth<Ctx>(async (req: AuthenticatedRequest, context) => {
  assertPagePermission(req.user, "ai", "delete");
  return NextResponse.json({ success: true, sample: await aiSampleDataService.remove(req.user, await kindOf(context)) });
});
