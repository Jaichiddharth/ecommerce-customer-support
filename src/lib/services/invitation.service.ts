import crypto from "crypto";
import { invitationRepository, userRepository, organizationRepository } from "../db/repositories";
import { emailService } from "./email.service";
import { AppError } from "../errors";
import { adminAuth } from "../firebase/admin";
import { createLogger } from "../logger";

const log = createLogger("invitation.service");

export interface CreateInvitationsInput {
  organizationId: number;
  inviter: {
    id: number;
    name: string;
    email: string;
    role: string;
  };
  emails: string[];
  role: string;
  customPermissions?: Record<string, boolean> | null;
  teams?: string[];
  languages?: string[];
  stores?: string[];
  originUrl?: string;
}

export interface InvitationResult {
  email: string;
  token: string;
  inviteUrl: string;
  emailSent: boolean;
  emailError?: string;
  expiresAt: Date;
}

/**
 * Resolves the public origin for invitation emails and links.
 * Avoids localhost/127.0.0.1 in transactional emails so recipients can open the link.
 */
export function resolvePublicInviteOrigin(inputOrigin?: string): string {
  // 1. If explicit input origin is provided and is NOT localhost, use it
  if (inputOrigin && !inputOrigin.includes("localhost") && !inputOrigin.includes("127.0.0.1")) {
    return inputOrigin.replace(/\/+$/, "");
  }

  // 2. Check environment variables
  const envUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  if (envUrl && !envUrl.includes("localhost") && !envUrl.includes("127.0.0.1")) {
    return envUrl.replace(/\/+$/, "");
  }

  // 3. Fallback to public ngrok tunnel
  return "https://cure-thriving-bobbing.ngrok-free.dev";
}

export class InvitationService {
  /**
   * Invites one or more emails to an organization with role, stores, teams, and languages.
   * Validates against plan seat limits and sends secure single-use 7-day links.
   */
  async createInvitations(input: CreateInvitationsInput): Promise<{
    results: InvitationResult[];
    seats: { used: number; total: number; plan: string };
  }> {
    const { organizationId, inviter, emails, role, customPermissions, teams, languages, stores } = input;

    if (!emails || emails.length === 0) {
      throw AppError.validation("At least one email address is required.", "emails");
    }

    // Normalize and deduplicate emails
    const cleanEmails = Array.from(
      new Set(
        emails
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e && e.includes("@"))
      )
    );

    if (cleanEmails.length === 0) {
      throw AppError.validation("Please provide valid email addresses.", "emails");
    }

    const assignedRole = (role || "AGENT").toUpperCase();
    if (!["ADMIN", "AGENT", "VIEWER"].includes(assignedRole)) {
      throw AppError.validation("Role must be Admin, Agent, or Viewer.", "role");
    }

    // Check organization and seat limits
    const org = await organizationRepository.findById(organizationId);
    if (!org) {
      throw new AppError("NOT_FOUND", { message: "Organization not found." });
    }

    const maxSeats = org.maxSeats || 10;
    const planName = (org.plan || "Growth").charAt(0).toUpperCase() + (org.plan || "Growth").slice(1);
    
    // Count current active members in the org
    const currentMembersCount = await userRepository.countByOrg(organizationId);

    // Calculate how many new seats would be needed
    // (Existing members in this workspace don't consume additional seats)
    const existingMembers = await userRepository.listByOrg(organizationId);
    const existingEmails = new Set(existingMembers.map((m) => m.email.toLowerCase()));

    const newEmailsCount = cleanEmails.filter((email) => !existingEmails.has(email)).length;

    if (currentMembersCount + newEmailsCount > maxSeats) {
      throw new AppError("CONFLICT", {
        message: `Inviting ${newEmailsCount} member${newEmailsCount > 1 ? "s" : ""} would exceed your limit of ${maxSeats} seats on the ${planName} plan (${currentMembersCount} currently used). Please upgrade your plan to invite more members.`,
        details: {
          used: currentMembersCount,
          total: maxSeats,
          plan: planName,
          requested: newEmailsCount,
        },
        expected: true,
      });
    }

    const origin = resolvePublicInviteOrigin(input.originUrl);

    const results: InvitationResult[] = [];

    for (const email of cleanEmails) {
      // If user is already active member in this workspace
      const existingUser = existingMembers.find((m) => m.email.toLowerCase() === email);
      if (existingUser && existingUser.status === "active") {
        throw new AppError("CONFLICT", {
          message: `"${email}" is already an active member of this workspace.`,
          expected: true,
        });
      }

      // Check for existing pending invitation to renew or revoke
      const existingPending = await invitationRepository.findPendingByOrgAndEmail(organizationId, email);
      if (existingPending) {
        // Revoke the old pending invite before creating a fresh single-use link
        await invitationRepository.revoke(existingPending.id, organizationId);
      }

      // Generate a cryptographically secure single-use token
      const token = crypto.randomBytes(32).toString("hex");
      // Exactly 7 days expiration
      const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      // Create invitation in DB
      await invitationRepository.create({
        organizationId,
        email,
        name: email.split("@")[0],
        role: assignedRole,
        customPermissions: customPermissions || null,
        teams: Array.isArray(teams) && teams.length > 0 ? teams : ["Support"],
        languages: Array.isArray(languages) && languages.length > 0 ? languages : ["EN"],
        stores: Array.isArray(stores) ? stores : [],
        token,
        invitedById: inviter.id,
        expiresAt,
      });

      // Ensure user record with status 'invited' exists
      if (!existingUser) {
        await userRepository.createTeamMember({
          organizationId,
          name: email.split("@")[0],
          email,
          role: assignedRole,
          teams: Array.isArray(teams) && teams.length > 0 ? teams : ["Support"],
          languages: Array.isArray(languages) && languages.length > 0 ? languages : ["EN"],
          stores: Array.isArray(stores) ? stores : [],
          customPermissions: customPermissions || null,
          status: "invited",
        });
      } else {
        await userRepository.updateTeamMember(existingUser.id, organizationId, {
          role: assignedRole,
          teams: Array.isArray(teams) && teams.length > 0 ? teams : ["Support"],
          languages: Array.isArray(languages) && languages.length > 0 ? languages : ["EN"],
          stores: Array.isArray(stores) ? stores : [],
          customPermissions: customPermissions || null,
          status: "invited",
        });
      }

      const inviteUrl = `${origin.replace(/\/+$/, "")}/invite/${token}`;

      // Dispatch invitation email with SPF/DKIM headers
      const sendResult = await emailService.sendInvitationEmail({
        toEmail: email,
        inviterName: inviter.name,
        inviterEmail: inviter.email,
        workspaceName: org.name,
        inviteUrl,
        role: assignedRole,
        expiresAt,
      });

      results.push({
        email,
        token,
        inviteUrl,
        emailSent: sendResult.success,
        emailError: sendResult.error,
        expiresAt,
      });
    }

    const updatedMembersCount = await userRepository.countByOrg(organizationId);

    return {
      results,
      seats: {
        used: updatedMembersCount,
        total: maxSeats,
        plan: planName,
      },
    };
  }

  /**
   * Validates an invitation token and returns invitation metadata
   */
  async getInvitationByToken(token: string): Promise<{
    valid: boolean;
    reason?: "not_found" | "already_accepted" | "revoked" | "expired";
    invitation?: {
      id: number;
      organizationId: number;
      organizationName: string;
      email: string;
      name: string | null;
      role: string;
      teams: string[];
      languages: string[];
      stores: string[];
      customPermissions: Record<string, boolean> | null;
      inviterName: string | null;
      inviterEmail: string | null;
      expiresAt: Date;
      accountExists: boolean;
    };
  }> {
    if (!token || typeof token !== "string") {
      return { valid: false, reason: "not_found" };
    }

    const invite = await invitationRepository.findByToken(token.trim());
    if (!invite) {
      return { valid: false, reason: "not_found" };
    }

    if (invite.status === "accepted") {
      return { valid: false, reason: "already_accepted" };
    }

    if (invite.status === "revoked") {
      return { valid: false, reason: "revoked" };
    }

    if (new Date() > new Date(invite.expiresAt)) {
      return { valid: false, reason: "expired" };
    }

    // Check if an account already exists in Firebase for this email
    let accountExists = false;
    try {
      const fbUser = await adminAuth.getUserByEmail(invite.email.toLowerCase().trim());
      if (fbUser) accountExists = true;
    } catch {
      // User not found in Firebase => new person
      accountExists = false;
    }

    return {
      valid: true,
      invitation: {
        id: invite.id,
        organizationId: invite.organizationId,
        organizationName: invite.organizationName || "UnoCX Workspace",
        email: invite.email,
        name: invite.name,
        role: invite.role,
        teams: invite.teams || ["Support"],
        languages: invite.languages || ["EN"],
        stores: invite.stores || [],
        customPermissions: (invite.customPermissions as Record<string, boolean>) || null,
        inviterName: invite.inviterName || "A workspace admin",
        inviterEmail: invite.inviterEmail ?? null,
        expiresAt: invite.expiresAt,
        accountExists,
      },
    };
  }

  /**
   * Accepts an invitation.
   * Strict security checks:
   * 1. Token must be valid, pending, and unexpired (single-use enforced).
   * 2. The signed-in user's email MUST match the invited email address.
   * 3. Admins/Owners must have 2-step verification verified before entering.
   */
  async acceptInvitation(
    token: string,
    authUser: {
      uid: string;
      email: string;
      name?: string | null;
      picture?: string | null;
    },
    twoFactorVerified?: boolean
  ): Promise<{
    success: boolean;
    workspaceSlug: string;
    workspaceName: string;
    role: string;
  }> {
    const inviteCheck = await this.getInvitationByToken(token);
    if (!inviteCheck.valid || !inviteCheck.invitation) {
      if (inviteCheck.reason === "already_accepted") {
        throw new AppError("CONFLICT", {
          message: "This invitation link has already been used and is no longer valid.",
          expected: true,
        });
      }
      if (inviteCheck.reason === "expired") {
        throw new AppError("CONFLICT", {
          message: "This invitation link has expired (valid for 7 days). Please request a new invitation.",
          expected: true,
        });
      }
      throw new AppError("NOT_FOUND", {
        message: "Invalid invitation link.",
        expected: true,
      });
    }

    const invitation = inviteCheck.invitation;

    // Strict email check: only the exact invited email can accept!
    const invitedEmailNorm = invitation.email.toLowerCase().trim();
    const authenticatedEmailNorm = (authUser.email || "").toLowerCase().trim();

    if (invitedEmailNorm !== authenticatedEmailNorm) {
      throw new AppError("FORBIDDEN", {
        message: `This invitation was issued to "${invitation.email}". You are currently signed in as "${authUser.email}". A different email cannot accept this invitation.`,
        details: {
          expectedEmail: invitation.email,
          actualEmail: authUser.email,
        },
        expected: true,
      });
    }

    // Role check: Admins and Owners must set up 2-step verification before entering
    const isPrivileged = invitation.role === "ADMIN" || invitation.role === "OWNER";
    if (isPrivileged && !twoFactorVerified) {
      throw new AppError("FORBIDDEN", {
        message: "Administrators and Owners are required to set up 2-step verification before entering the workspace.",
        details: { requiresTwoFactor: true },
        expected: true,
      });
    }

    // Single-use: Mark invitation as accepted
    await invitationRepository.markAccepted(invitation.id);

    // Activate or create the user in the organization
    const activatedUser = await userRepository.activateInvitedUser(
      invitation.organizationId,
      invitedEmailNorm,
      {
        name: authUser.name || invitation.name || invitedEmailNorm.split("@")[0],
        role: invitation.role,
        teams: invitation.teams,
        languages: invitation.languages,
        stores: invitation.stores,
        customPermissions: invitation.customPermissions,
        firebaseIdToken: authUser.uid,
        avatarUrl: authUser.picture || null,
      }
    );

    // Set custom claims in Firebase for instant authentication resolution
    try {
      await adminAuth.setCustomUserClaims(authUser.uid, {
        organizationId: invitation.organizationId,
        userId: activatedUser.id,
        role: invitation.role,
      });
    } catch (err) {
      log.warn("Could not set custom user claims on Firebase after accepting invite", { err });
    }

    const org = await organizationRepository.findById(invitation.organizationId);

    return {
      success: true,
      workspaceSlug: org?.slug || "workspace",
      workspaceName: org?.name || invitation.organizationName,
      role: invitation.role,
    };
  }

  /**
   * Resends an invitation with a refreshed 7-day single-use token
   */
  async resendInvitation(
    invitationId: number,
    organizationId: number,
    inviter: { name: string; email: string },
    originUrl?: string
  ): Promise<InvitationResult> {
    const existing = await invitationRepository.listByOrg(organizationId);
    const invite = existing.find((i) => i.id === invitationId);
    if (!invite) {
      throw new AppError("NOT_FOUND", { message: "Invitation not found." });
    }

    const newToken = crypto.randomBytes(32).toString("hex");
    const newExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    await invitationRepository.renew(invitationId, organizationId, newToken, newExpiresAt);

    const org = await organizationRepository.findById(organizationId);
    const origin = resolvePublicInviteOrigin(originUrl);

    const inviteUrl = `${origin.replace(/\/+$/, "")}/invite/${newToken}`;

    const sendResult = await emailService.sendInvitationEmail({
      toEmail: invite.email,
      inviterName: inviter.name,
      inviterEmail: inviter.email,
      workspaceName: org?.name || "UnoCX",
      inviteUrl,
      role: invite.role,
      expiresAt: newExpiresAt,
    });

    return {
      email: invite.email,
      token: newToken,
      inviteUrl,
      emailSent: sendResult.success,
      emailError: sendResult.error,
      expiresAt: newExpiresAt,
    };
  }

  /**
   * Revokes a pending invitation
   */
  async revokeInvitation(invitationId: number, organizationId: number): Promise<boolean> {
    return await invitationRepository.revoke(invitationId, organizationId);
  }
}

export const invitationService = new InvitationService();
