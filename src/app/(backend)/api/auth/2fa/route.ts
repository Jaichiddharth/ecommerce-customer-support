import { NextRequest, NextResponse } from "next/server";
import { apiHandler, readJson } from "@/lib/api/handler";
import { verifyFirebaseToken } from "@/lib/security/auth";
import {
  generateTotpSecret,
  generateTotpUri,
  verifyTotpToken,
  generateBackupCodes,
} from "@/lib/security/totp";
import { userRepository } from "@/lib/db/repositories";
import { AppError } from "@/lib/errors";

/**
 * POST /api/auth/2fa
 * Handles 2-step verification setup and verification for Admins and Owners
 */
export const POST = apiHandler(async (req: NextRequest) => {
  const decodedToken = await verifyFirebaseToken(req);
  const email = decodedToken.email?.toLowerCase().trim();
  if (!email) {
    throw AppError.validation("Email is required for 2-step verification.", "email");
  }

  const body = (await readJson(req)) ?? {};
  const { action, secret, token, backupCodes } = body;

  if (action === "setup") {
    const newSecret = generateTotpSecret();
    const uri = generateTotpUri(email, "UnoCX", newSecret);
    const generatedCodes = generateBackupCodes(8);

    return NextResponse.json({
      success: true,
      secret: newSecret,
      otpauthUri: uri,
      backupCodes: generatedCodes,
    });
  }

  if (action === "verify") {
    if (!secret || typeof secret !== "string") {
      throw AppError.validation("Secret is required for verification.", "secret");
    }
    if (!token || typeof token !== "string" || token.length !== 6) {
      throw AppError.validation("Please enter a valid 6-digit verification code.", "token");
    }

    const isValid = verifyTotpToken(secret, token.trim());
    if (!isValid) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          message: "The 6-digit code is incorrect or expired. Please check your authenticator app and try again.",
        },
        { status: 400 }
      );
    }

    // If user already exists in DB, persist 2FA status
    const dbUser = await userRepository.findByFirebaseIdToken(decodedToken.uid);
    if (dbUser) {
      await userRepository.updateTeamMember(dbUser.id, dbUser.organizationId, {
        twoFactorEnabled: true,
        twoFactorSecret: secret,
        twoFactorBackupCodes: Array.isArray(backupCodes) ? backupCodes : [],
      });
    }

    return NextResponse.json({
      success: true,
      verified: true,
      message: "2-step verification has been successfully verified.",
    });
  }

  throw AppError.validation("Invalid action. Supported actions: setup, verify", "action");
});
