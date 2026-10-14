import { NextRequest, NextResponse } from "next/server";
import { organizationRepository } from "@/lib/db/repositories/organization.repository";

/**
 * GET /api/auth/workspace?slug=<workspace-slug>
 * Public endpoint — no auth required.
 *
 * Returns:
 *   { exists: true,  available: false, name, slug } — workspace is taken (sign-in can use it)
 *   { exists: false, available: true  }             — slug is free (sign-up can claim it)
 */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug")?.trim().toLowerCase();
  if (!slug) {
    return NextResponse.json({ error: "slug is required" }, { status: 400 });
  }

  const org = await organizationRepository.findBySlug(slug);

  if (org) {
    return NextResponse.json({ exists: true, available: false, name: org.name, slug: org.slug });
  }

  return NextResponse.json({ exists: false, available: true });
}
