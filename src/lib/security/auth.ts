import { NextRequest } from "next/server";
import { User } from "../db/schema";
import { userRepository } from "../db/repositories";
import { adminAuth } from "../firebase/admin";
import type { DecodedIdToken } from "firebase-admin/auth";
import { AppError, toAppError } from "../errors";
import { apiHandler } from "../api/handler";
import { createLogger, setRequestContext } from "../logger";

const log = createLogger("auth");

/** Longest a sign-in may last ("Keep me signed in"); the client enforces the shorter default itself. */
const MAX_SESSION_AGE_SECONDS = 30 * 24 * 60 * 60;

export interface AuthUser {
  id: number;
  organizationId: number;
  uid: string;
  email: string;
  name: string;
  role: string;
  avatarUrl?: string | null;
  isOnline?: boolean | null;
  createdAt?: Date;
}

// Backward-compatibility alias
export type RequestUser = AuthUser;

export interface AuthenticatedRequest extends NextRequest {
  user: AuthUser;
  decodedToken?: DecodedIdToken;
}

export interface AuthContext {
  user: AuthUser;
  decodedToken: DecodedIdToken;
}

/** Bearer token from the Authorization header, or ?token= (EventSource / <img> can't send headers). */
export function extractToken(req: NextRequest): string {
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) return authHeader.substring(7).trim();
  return req.nextUrl.searchParams.get("token")?.trim() || "";
}

/** Verify the Firebase ID token. Throws AUTH_TOKEN_MISSING / AUTH_TOKEN_EXPIRED / AUTH_TOKEN_INVALID / FIREBASE_UNAVAILABLE. */
export async function verifyFirebaseToken(req: NextRequest): Promise<DecodedIdToken> {
  const token = extractToken(req);
  if (!token) {
    throw new AppError("AUTH_TOKEN_MISSING", { expected: true });
  }
  let decoded: DecodedIdToken;
  try {
    decoded = await adminAuth.verifyIdToken(token);
  } catch (err) {
    throw toAppError(err);
  }
  // auth_time is when the user last actually signed in; token refreshes don't move it
  if (Date.now() / 1000 - decoded.auth_time > MAX_SESSION_AGE_SECONDS) {
    throw new AppError("AUTH_TOKEN_EXPIRED", { expected: true });
  }
  return decoded;
}

/**
 * Resolves the authenticated user and organization for a request:
 * Firebase Admin `verifyIdToken` + PostgreSQL user lookup.
 * Throws a typed AppError so a database outage is reported as DB_UNAVAILABLE (503), not as "unauthorized".
 */
export async function authenticate(req: NextRequest): Promise<AuthContext> {
  const decodedToken = await verifyFirebaseToken(req);
  const uid = decodedToken.uid;
  const email = decodedToken.email?.toLowerCase().trim();

  // Users are identified by Firebase UID only; /api/auth/sync links the UID to the DB user
  const dbUser: User | null = await userRepository.findByFirebaseIdToken(uid);
  if (!dbUser) {
    throw new AppError("AUTH_USER_NOT_FOUND", { expected: true, details: { hint: "Call /api/auth/sync after sign-in." } });
  }

  const authUser: AuthUser = {
    id: dbUser.id,
    organizationId: dbUser.organizationId,
    uid: uid || dbUser.firebaseIdToken,
    email: dbUser.email,
    name: dbUser.name || decodedToken.name || email?.split("@")[0] || "User",
    role: dbUser.role || "AGENT",
    avatarUrl: dbUser.avatarUrl || (decodedToken.picture as string | undefined) || null,
    isOnline: dbUser.isOnline ?? true,
    createdAt: dbUser.createdAt,
  };

  return { user: authUser, decodedToken };
}

/** Non-throwing variant: returns null when the request is not authenticated. */
export async function getAuthContext(req: NextRequest): Promise<AuthContext | null> {
  try {
    return await authenticate(req);
  } catch (err) {
    log.debug("Request is not authenticated", { err });
    return null;
  }
}

/**
 * Helper to get just the authenticated user from a request
 */
export async function getAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const context = await getAuthContext(req);
  return context?.user ?? null;
}

/**
 * Backend Route Middleware: authenticates the request, attaches `req.user` / `req.decodedToken`,
 * and runs the handler inside `apiHandler`, so anything the handler throws is logged and
 * returned as the standard error response.
 */
export function withAuth<T = any>(
  handler: (req: AuthenticatedRequest, context?: T) => Promise<Response> | Response
) {
  return apiHandler<T>(async (req, context) => {
    const auth = await authenticate(req);

    const authReq = req as AuthenticatedRequest;
    authReq.user = auth.user;
    authReq.decodedToken = auth.decodedToken;
    setRequestContext({ userId: auth.user.id, orgId: auth.user.organizationId });

    return handler(authReq, context);
  });
}
