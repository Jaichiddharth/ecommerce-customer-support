import { NextResponse } from "next/server";
import { withAuth, AuthenticatedRequest, DEFAULT_ROLE_PERMISSIONS, assertRole, assertPagePermission } from "@/lib/security/auth";
import { userRepository, organizationRepository, invitationRepository, shopifyRepository } from "@/lib/db/repositories";
import { invitationService } from "@/lib/services/invitation.service";
import { AppError } from "@/lib/errors";
import { readJson } from "@/lib/api/handler";

export const GET = withAuth(async (req: AuthenticatedRequest) => {
  assertPagePermission(req.user, 'settings', 'read');
  const orgId = req.user.organizationId;
  const org = await organizationRepository.findById(orgId);
  const users = await userRepository.listByOrg(orgId);
  const allInvitations = await invitationRepository.listByOrg(orgId);
  const connectedStores = await shopifyRepository.findActiveStores(orgId);

  // Filter for currently active pending invitations
  const pendingInvitations = allInvitations
    .filter((inv) => inv.status === "pending" && new Date(inv.expiresAt) > new Date())
    .map((inv) => ({
      id: inv.id,
      email: inv.email,
      name: inv.name,
      role: inv.role,
      teams: inv.teams,
      languages: inv.languages,
      stores: inv.stores,
      token: inv.token,
      inviterName: inv.inviterName,
      inviterEmail: inv.inviterEmail,
      status: inv.status,
      expiresAt: inv.expiresAt,
      createdAt: inv.createdAt,
    }));

  const members = users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role || "AGENT",
    teams: u.teams && u.teams.length > 0 ? u.teams : ["Support"],
    languages: u.languages && u.languages.length > 0 ? u.languages : ["EN"],
    stores: u.stores || [],
    customPermissions: u.customPermissions,
    status: u.status || (u.isOnline ? "online" : "active"),
    isOnline: u.isOnline,
    avatarUrl: u.avatarUrl,
    twoFactorEnabled: u.twoFactorEnabled,
    createdAt: u.createdAt,
  }));

  const maxSeats = org?.maxSeats || 10;
  const plan = org?.plan || "Growth";
  const storedPermissions = (org?.rolePermissions as Record<string, Record<string, boolean>>) || {};

  // Merge default permissions with any custom organization permissions
  const mergedPermissions = {
    OWNER: DEFAULT_ROLE_PERMISSIONS.OWNER,
    ADMIN: { ...DEFAULT_ROLE_PERMISSIONS.ADMIN, ...(storedPermissions.ADMIN || {}) },
    AGENT: { ...DEFAULT_ROLE_PERMISSIONS.AGENT, ...(storedPermissions.AGENT || {}) },
    VIEWER: { ...DEFAULT_ROLE_PERMISSIONS.VIEWER, ...(storedPermissions.VIEWER || {}) },
  };

  const storesList = connectedStores.map((s) => ({
    id: s.id,
    name: s.name || s.shopDomain,
    domain: s.shopDomain,
    status: s.status,
  }));

  return NextResponse.json({
    success: true,
    members,
    pendingInvitations,
    stores: storesList,
    seats: {
      used: members.length,
      total: maxSeats,
      available: Math.max(0, maxSeats - members.length),
      plan: plan.charAt(0).toUpperCase() + plan.slice(1),
    },
    permissions: mergedPermissions,
    currentRole: req.user.role,
  });
});

export const POST = withAuth(async (req: AuthenticatedRequest) => {
  assertRole(req.user.role, ["OWNER", "ADMIN"]);
  assertPagePermission(req.user, 'settings', 'create');

  const orgId = req.user.organizationId;
  const body = (await readJson(req)) ?? {};
  const { emails, email, name, role, customPermissions, teams, languages, stores } = body;

  // Support both single email string and multiple emails array/string
  let targetEmails: string[] = [];
  if (Array.isArray(emails)) {
    targetEmails = emails;
  } else if (typeof emails === "string" && emails.trim()) {
    targetEmails = emails.split(/[\s,;]+/).filter(Boolean);
  } else if (typeof email === "string" && email.trim()) {
    targetEmails = [email.trim()];
  }

  if (targetEmails.length === 0) {
    throw AppError.validation("At least one valid email address is required.", "emails");
  }

  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto") || "https";
  const headerOrigin = forwardedHost ? `${forwardedProto}://${forwardedHost}` : req.headers.get("origin");
  const originUrl = body.originUrl || headerOrigin || req.nextUrl.origin;

  const result = await invitationService.createInvitations({
    organizationId: orgId,
    inviter: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
    },
    emails: targetEmails,
    role: role || "AGENT",
    customPermissions: customPermissions || null,
    teams: Array.isArray(teams) ? teams : ["Support"],
    languages: Array.isArray(languages) ? languages : ["EN"],
    stores: Array.isArray(stores) ? stores : [],
    originUrl,
  });

  const count = result.results.length;
  const message =
    count === 1
      ? `Invitation sent to ${result.results[0].email}`
      : `Invitations sent to ${count} team members`;

  return NextResponse.json({
    success: true,
    message,
    invitations: result.results,
    seats: result.seats,
  });
});


