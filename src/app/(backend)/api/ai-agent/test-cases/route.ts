import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readJson } from "@/lib/api/handler";
import { aiAgentService } from "@/lib/services";
import { testCasesFromCsv } from "@/lib/ai-agent/csv";
import { testCasesFromJson } from "@/lib/ai-agent/test-json";
import { AppError } from "@/lib/errors";

const MAX_FILE_CHARS = 5_000_000;

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "read");
  return NextResponse.json({ success: true, cases: await aiAgentService.listTestCases(req.user) });
});

/**
 * POST /api/ai-agent/test-cases
 *   { cases: [...] }   cases from the form
 *   { csv: "..." }     a CSV file's text
 *   { json: "..." }    a JSON file's text: test cases, or Shopify orders (turned into order-status cases)
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, "ai", "create");
  const body = await readJson(req);
  let cases: unknown[] = Array.isArray(body?.cases) ? body.cases : [];
  let skipped = 0;
  let kind: "cases" | "orders" = "cases";
  for (const format of ["csv", "json"] as const) {
    if (typeof body?.[format] !== "string") continue;
    const field = format;
    if (body[format].length > MAX_FILE_CHARS) throw AppError.validation("The file is too large (max 5 MB).", field);
    try {
      const parsed = format === "csv" ? testCasesFromCsv(body[format]) : testCasesFromJson(body[format]);
      cases = parsed.cases;
      skipped = parsed.skipped;
      if ("kind" in parsed) kind = parsed.kind as "cases" | "orders";
    } catch (err) {
      throw AppError.validation(err instanceof Error ? err.message : `The ${format.toUpperCase()} file could not be read.`, field);
    }
  }
  const result = await aiAgentService.createTestCases(req.user, cases);
  return NextResponse.json({ success: true, ...result, skipped, kind }, { status: 201 });
});
