import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, assertPagePermission } from "@/lib/security/auth";
import { readFormData } from "@/lib/api/handler";
import { parseId } from "@/lib/api/params";
import { AppError } from "@/lib/errors";
import { campaignService } from "@/lib/services/campaign.service";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/campaigns/:id/audience (multipart: file, phoneColumn, defaultCountry)
 * Stores the contact file in S3, parses it with the same rules as the wizard preview and replaces the
 * draft's recipients. defaultCountry "" = numbers without a country code are skipped.
 */
export const PUT = withAuth(async (req: AuthenticatedRequest, context?: Ctx) => {
  assertPagePermission(req.user, "broadcasts", "update");
  const id = parseId((await context!.params).id);
  const form = await readFormData(req);
  const file = form.get("file");
  if (!file || typeof file === "string") throw AppError.validation("Choose a contact file.", "file");
  const phoneColumn = String(form.get("phoneColumn") ?? "").trim();
  if (!phoneColumn) throw AppError.validation("Pick the phone number column.", "phoneColumn");
  const defaultCountry = String(form.get("defaultCountry") ?? "").trim().toUpperCase();
  if (defaultCountry && !/^[A-Z]{2}$/.test(defaultCountry)) throw AppError.validation("The default country is invalid.", "defaultCountry");

  const campaign = await campaignService.importAudience(req.user.organizationId, id, file, { phoneColumn, defaultCountry });
  return NextResponse.json({ success: true, campaign });
});
