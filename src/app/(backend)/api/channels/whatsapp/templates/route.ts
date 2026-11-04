import { NextResponse } from "next/server";
import { channels } from "@/lib/services";
import { withAuth, AuthenticatedRequest } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";
import { validateTemplateComponents } from "@/lib/whatsapp-templates";
import { TEMPLATE_LIMITS } from "@/types/templates";

const CATEGORIES = ["MARKETING", "UTILITY", "AUTHENTICATION"];

/** Throws a 400 listing every Meta rule the components break */
function assertValidComponents(components: unknown) {
  if (!Array.isArray(components) || components.length === 0) {
    throw AppError.validation("Template must include components (BODY is required)", "components");
  }
  const errors = validateTemplateComponents(components);
  if (errors.length > 0) {
    throw new AppError("VALIDATION_ERROR", {
      message: errors.join(" "),
      details: { field: "components", errors },
      expected: true,
    });
  }
}

/**
 * GET /api/channels/whatsapp/templates
 * Fetches templates from Meta Graph API for the active WhatsApp channel with optional filters & pagination
 */
export const GET = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const param = (key: string) => searchParams.get(key) || undefined;
  const limit = param("limit") ? parseInt(param("limit")!, 10) : undefined;

  const result = await channels.whatsapp.getTemplates(req.user.organizationId, {
    phoneNumberId: param("phoneNumberId"),
    name: param("name"),
    status: param("status"),
    category: param("category"),
    language: param("language"),
    limit,
    after: param("after"),
    before: param("before"),
  });

  return NextResponse.json({ success: true, ...result });
});

/**
 * POST /api/channels/whatsapp/templates
 * Submits a new template to Meta for review. `components` are in Meta's format, including `example` blocks.
 */
export const POST = withAuth(async (req: AuthenticatedRequest) => {
  const body = await readJson(req);
  const { name, category, language, components, phoneNumberId } = body ?? {};

  if (!name || typeof name !== "string") {
    throw AppError.validation("Template name is required", "name");
  }
  if (!/^[a-z0-9_]+$/.test(name) || name.length > TEMPLATE_LIMITS.name) {
    throw AppError.validation(
      `Template name can only contain lowercase letters, numbers and underscores, up to ${TEMPLATE_LIMITS.name} characters.`,
      "name"
    );
  }
  if (!CATEGORIES.includes(category)) {
    throw AppError.validation("Valid category (MARKETING, UTILITY, or AUTHENTICATION) is required", "category");
  }
  if (!language || typeof language !== "string") {
    throw AppError.validation("Language code is required (e.g. en_US, ta)", "language");
  }
  assertValidComponents(components);

  const result = await channels.whatsapp.createTemplate(
    req.user.organizationId,
    { name, category, language, components },
    phoneNumberId
  );

  return NextResponse.json({
    success: true,
    message: "Template submitted to Meta for review.",
    data: result,
  });
});

/**
 * PUT /api/channels/whatsapp/templates
 * Edits an existing template on Meta (allowed when status is APPROVED, REJECTED, or PAUSED).
 * Name and language can't change; the whole component set is replaced.
 */
export const PUT = withAuth(async (req: AuthenticatedRequest) => {
  const body = await readJson(req);
  const { templateId, components, category, phoneNumberId } = body ?? {};

  if (!templateId || typeof templateId !== "string") {
    throw AppError.validation("Template ID is required to update template", "templateId");
  }
  if (category !== undefined && !CATEGORIES.includes(category)) {
    throw AppError.validation("Category must be MARKETING, UTILITY, or AUTHENTICATION", "category");
  }
  assertValidComponents(components);

  const result = await channels.whatsapp.updateTemplate(
    req.user.organizationId,
    templateId,
    { components, ...(category ? { category } : {}) },
    phoneNumberId
  );

  return NextResponse.json({
    success: true,
    message: "Template changes submitted to Meta for review.",
    data: result,
  });
});

/**
 * DELETE /api/channels/whatsapp/templates?name=…&hsm_id=…
 * Deletes one language version (with hsm_id) or all versions of a template from Meta
 */
export const DELETE = withAuth(async (req: AuthenticatedRequest) => {
  const { searchParams } = new URL(req.url);
  const name = searchParams.get("name");
  const hsmId = searchParams.get("hsm_id") || undefined;
  const phoneNumberId = searchParams.get("phoneNumberId") || undefined;

  if (!name) {
    throw AppError.validation("Template name is required to delete", "name");
  }

  const result = await channels.whatsapp.deleteTemplate(req.user.organizationId, name, hsmId, phoneNumberId);

  return NextResponse.json({
    success: true,
    message: "Template deleted successfully.",
    data: result,
  });
});
