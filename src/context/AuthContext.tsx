'use client';

import React, { createContext, useContext, useEffect, useState, useCallback, useRef } from 'react';
import {
  User,
  UserCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signInWithPopup,
  signOut,
  onAuthStateChanged,
  updateProfile,
  sendEmailVerification,
  getAdditionalUserInfo,
} from 'firebase/auth';
import axios from 'axios';
import { auth, googleProvider } from '../lib/firebase/config';
import { getFirebaseAuthErrorMessage } from '../lib/firebase/errors';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { notifyError, errorDescription } from '@/lib/api/notify';
import { toApiError } from '@/lib/api/api-error';
import { clientLogger } from '@/lib/client-logger';

export const NO_WORKSPACE_MESSAGE =
  'No workspace is linked to this email. Create an account to set up your company, or ask your admin to invite you.';

/** Error codes thrown by the auth flows whose message is already set on `error` for inline display. */
const INLINE_ERROR_CODES = ['auth/no-workspace', 'auth/sync-failed', 'auth/email-not-verified', 'auth/email-verification-sent'];

// ─── Session lifetime ("Keep me signed in") ────────────────────────────────
// Firebase refresh tokens never expire on their own, so the session deadline is tracked here.
const DAY_MS = 24 * 60 * 60 * 1000;
export const SESSION_DAYS_REMEMBERED = 30;
export const SESSION_DAYS_DEFAULT = 10;
const SESSION_EXPIRY_KEY = 'unocx_session_expires_at';
const SESSION_CHECK_INTERVAL_MS = 60 * 1000;

function setSessionExpiry(rememberMe: boolean) {
  const days = rememberMe ? SESSION_DAYS_REMEMBERED : SESSION_DAYS_DEFAULT;
  try { localStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + days * DAY_MS)); } catch { }
}

function clearSessionExpiry() {
  try { localStorage.removeItem(SESSION_EXPIRY_KEY); } catch { }
}

/** True once the stored deadline has passed. A session restored without one gets the default lifetime. */
function isSessionExpired(): boolean {
  try {
    const raw = localStorage.getItem(SESSION_EXPIRY_KEY);
    if (!raw) {
      setSessionExpiry(false);
      return false;
    }
    return Date.now() >= Number(raw);
  } catch {
    return false;
  }
}

export const SESSION_EXPIRED_MESSAGE = 'Your session has expired. Please sign in again.';

/** Workspace to create for a Google sign-up, resolved once the Google account's email is known. */
export interface GoogleWorkspace {
  slug: string;
  name: string;
}

export interface DbUser {
  id: number;
  organizationId: number;
  organizationName?: string | null;
  organizationSlug?: string | null;
  organizationPlan?: string | null;
  organizationSeats?: number | null;
  name: string;
  email: string;
  role: string;
  permissions?: Record<string, boolean>;
  avatarUrl: string | null;
  isOnline: boolean;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  dbUser: DbUser | null;
  permissions: Record<string, boolean> | null;
  hasPermission: (key: string) => boolean;
  refreshDbUser: () => Promise<void>;
  loading: boolean;
  error: string | null;
  loginWithEmail: (email: string, password: string, rememberMe?: boolean) => Promise<UserCredential>;
  signupWithEmail: (email: string, password: string, displayName?: string, workspaceSlug?: string) => Promise<UserCredential>;
  /** Sign-in when `resolveWorkspace` is omitted; sign-up (creates a workspace) when it is given. */
  loginWithGoogle: (rememberMe?: boolean, resolveWorkspace?: (email: string) => Promise<GoogleWorkspace>) => Promise<UserCredential>;
  logout: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  syncDbUser: (currentUser: User, workspaceSlug?: string, workspaceName?: string) => Promise<DbUser | null>;
  resendVerificationEmail: (email: string, password: string) => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [dbUser, setDbUser] = useState<DbUser | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  /**
   * True while loginWithEmail / loginWithGoogle / signupWithEmail are running.
   * Those flows own the user state until the workspace check passes, so
   * onAuthStateChanged must not expose a half-authenticated user meanwhile.
   */
  const authInFlight = useRef(false);

  /**
   * Syncs the authenticated Firebase user with the PostgreSQL `users` table.
   * Pass workspaceSlug to create a new workspace (sign-up path).
   * Throws when the server rejects the user (e.g. 404 = not mapped to any workspace).
   */
  const syncDbUser = useCallback(async (currentUser: User, workspaceSlug?: string, workspaceName?: string): Promise<DbUser | null> => {
    const idToken = await currentUser.getIdToken();
    const response = await axios.post(
      '/api/auth/sync',
      {
        name: currentUser.displayName || currentUser.email?.split('@')[0] || 'Team Member',
        avatarUrl: currentUser.photoURL || null,
        ...(workspaceSlug ? { workspaceSlug } : {}),
        ...(workspaceSlug && workspaceName ? { workspaceName } : {}),
      },
      { headers: { Authorization: `Bearer ${idToken}` } }
    );

    if (!response.data?.success || !response.data?.user) {
      throw new Error('Could not load your account. Please try again.');
    }
    setDbUser(response.data.user);
    try {
      await currentUser.getIdToken(true);
    } catch { }
    return response.data.user;
  }, []);

  /** Ends a session that failed the workspace check; optionally deletes a just-created Firebase account. */
  const abortSession = async (currentUser: User, deleteAccount: boolean) => {
    if (deleteAccount) {
      try { await currentUser.delete(); } catch { }
    }
    try { await signOut(auth); } catch { }
    setUser(null);
    setDbUser(null);
  };

  /** Turns a /api/auth/sync failure into a coded error and surfaces its message inline on the login page. */
  const syncFailure = (syncErr: unknown, where: string) => {
    const apiError = toApiError(syncErr);
    const noWorkspace = apiError.status === 404;
    const message = noWorkspace ? NO_WORKSPACE_MESSAGE : errorDescription(apiError);
    clientLogger.warn(where, message, { code: apiError.code, status: apiError.status });
    setError(message);
    const err: any = new Error(message);
    err.code = noWorkspace ? 'auth/no-workspace' : 'auth/sync-failed';
    return err;
  };

  useEffect(() => {
    // Listen to Firebase auth state changes
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
        if (authInFlight.current) {
          setLoading(false);
          return;
        }

        if (currentUser && !currentUser.emailVerified) {
          const isEmailPasswordUser = currentUser.providerData.some(
            (p) => p.providerId === 'password'
          );
          if (isEmailPasswordUser) {
            await signOut(auth);
            setUser(null);
            setDbUser(null);
            setLoading(false);
            return;
          }
        }

        if (currentUser && isSessionExpired()) {
          await signOut(auth);
          clearSessionExpiry();
          setUser(null);
          setDbUser(null);
          setError(SESSION_EXPIRED_MESSAGE);
          setLoading(false);
          return;
        }

        if (currentUser && currentUser.email) {
          try {
            await syncDbUser(currentUser);
            setUser(currentUser);
          } catch (syncErr) {
            const apiError = toApiError(syncErr);
            if (apiError.status === 404) {
              // Restored session for a user with no workspace — send them back to login
              await signOut(auth);
              setUser(null);
              setDbUser(null);
              setError(NO_WORKSPACE_MESSAGE);
            } else {
              notifyError(apiError, { where: 'AuthContext.syncDbUser', title: "Couldn't load your account" });
              setUser(currentUser);
            }
          }
        } else {
          setUser(null);
          setDbUser(null);
        }
        setLoading(false);
      },
      (err) => {
        clientLogger.error('AuthContext.onAuthStateChanged', 'Firebase auth state error', err);
        const msg = getFirebaseAuthErrorMessage(err);
        gooeyToast.error('Authentication Error', {
          description: msg,
        });
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [syncDbUser]);

  // End an open session once its deadline passes (polled: a 30-day setTimeout would overflow)
  useEffect(() => {
    if (!user) return;
    const id = setInterval(async () => {
      if (!isSessionExpired()) return;
      try { await signOut(auth); } catch { }
      clearSessionExpiry();
      setUser(null);
      setDbUser(null);
      setError(SESSION_EXPIRED_MESSAGE);
    }, SESSION_CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [user]);

  const refreshDbUser = useCallback(async () => {
    try {
      if (!auth.currentUser) return;
      const idToken = await auth.currentUser.getIdToken();
      const res = await axios.get('/api/auth/me', {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.data?.success && res.data.user) {
        setDbUser(res.data.user);
      }
    } catch {
      // silent
    }
  }, []);

  const hasPermission = useCallback(
    (permissionKey: string): boolean => {
      if (!dbUser) return false;
      const role = (dbUser.role || '').toUpperCase();
      if (role === 'OWNER') return true;
      if (dbUser.permissions && dbUser.permissions[permissionKey] !== undefined) {
        return Boolean(dbUser.permissions[permissionKey]);
      }
      return false;
    },
    [dbUser]
  );

  // Auto-refresh permissions and role when window regains focus or every 20s
  useEffect(() => {
    if (!user) return;
    const handleFocus = () => {
      refreshDbUser();
    };
    window.addEventListener('focus', handleFocus);
    const id = setInterval(refreshDbUser, 20000);
    return () => {
      window.removeEventListener('focus', handleFocus);
      clearInterval(id);
    };
  }, [user, refreshDbUser]);

  const clearError = () => setError(null);

  const loginWithEmail = async (email: string, password: string, rememberMe = false) => {
    authInFlight.current = true;
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      if (!result.user.emailVerified) {
        await signOut(auth);
        const err: any = new Error('Please verify your email before signing in. Check your inbox for the verification link.');
        err.code = 'auth/email-not-verified';
        throw err;
      }
      // The user must belong to a workspace before the session is kept
      try {
        await syncDbUser(result.user);
      } catch (syncErr) {
        await abortSession(result.user, false);
        throw syncFailure(syncErr, 'AuthContext.loginWithEmail');
      }
      setSessionExpiry(rememberMe);
      setUser(result.user);
      return result;
    } catch (err: any) {
      if (INLINE_ERROR_CODES.includes(err?.code)) throw err;
      const msg = getFirebaseAuthErrorMessage(err);
      clientLogger.warn('AuthContext.loginWithEmail', msg, { code: err?.code });
      gooeyToast.error('Login failed', { description: msg });
      throw err;
    } finally {
      authInFlight.current = false;
    }
  };

  const signupWithEmail = async (email: string, password: string, displayName?: string, workspaceSlug?: string) => {
    authInFlight.current = true;
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName && result.user) {
        await updateProfile(result.user, { displayName });
      }

      // Create the org + DB user NOW while the token is valid.
      // workspaceSlug tells syncUser to create a new workspace (signup path).
      // If that fails, remove the Firebase account so the email isn't left orphaned.
      try {
        await syncDbUser(result.user, workspaceSlug);
      } catch (syncErr) {
        await abortSession(result.user, true);
        throw syncFailure(syncErr, 'AuthContext.signupWithEmail');
      }

      await sendEmailVerification(result.user);
      await signOut(auth);
      setDbUser(null);
      const signal: any = new Error('EMAIL_VERIFICATION_SENT');
      signal.code = 'auth/email-verification-sent';
      throw signal;
    } catch (err: any) {
      if (INLINE_ERROR_CODES.includes(err?.code)) throw err;
      const msg = getFirebaseAuthErrorMessage(err);
      clientLogger.warn('AuthContext.signupWithEmail', msg, { code: err?.code });
      gooeyToast.error('Sign up failed', { description: msg });
      throw err;
    } finally {
      authInFlight.current = false;
    }
  };

  const resendVerificationEmail = async (email: string, password: string) => {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      if (!result.user.emailVerified) {
        await sendEmailVerification(result.user);
        await signOut(auth);
        gooeyToast.success('Email sent', { description: 'A new verification link has been sent to your inbox.' });
      }
    } catch (err: any) {
      const msg = getFirebaseAuthErrorMessage(err);
      clientLogger.warn('AuthContext.resendVerificationEmail', msg, { code: err?.code });
      gooeyToast.error('Could not resend email', { description: msg });
      throw err;
    }
  };

  const loginWithGoogle = async (rememberMe = false, resolveWorkspace?: (email: string) => Promise<GoogleWorkspace>) => {
    authInFlight.current = true;
    try {
      const result = await signInWithPopup(auth, googleProvider);
      // Sign-in (no resolver) requires an existing workspace; sign-up creates one named after the Google email.
      // A Google account Firebase just created for this attempt is removed on failure.
      try {
        const workspace = resolveWorkspace && result.user.email
          ? await resolveWorkspace(result.user.email)
          : undefined;
        await syncDbUser(result.user, workspace?.slug, workspace?.name);
      } catch (syncErr) {
        await abortSession(result.user, !!getAdditionalUserInfo(result)?.isNewUser);
        throw syncFailure(syncErr, 'AuthContext.loginWithGoogle');
      }
      setSessionExpiry(rememberMe);
      setUser(result.user);
      return result;
    } catch (err: any) {
      if (INLINE_ERROR_CODES.includes(err?.code)) throw err;
      const msg = getFirebaseAuthErrorMessage(err);
      clientLogger.warn('AuthContext.loginWithGoogle', msg, { code: err?.code });
      gooeyToast.error('Google sign-in failed', { description: msg });
      throw err;
    } finally {
      authInFlight.current = false;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      clearSessionExpiry();
      setUser(null);
      setDbUser(null);
    } catch (err: any) {
      const msg = getFirebaseAuthErrorMessage(err);
      clientLogger.error('AuthContext.logout', msg, { code: err?.code });
      gooeyToast.error('Logout failed', {
        description: msg,
      });
      throw err;
    }
  };

  const getIdToken = useCallback(async (forceRefresh = false): Promise<string | null> => {
    if (!auth.currentUser) return null;
    try {
      return await auth.currentUser.getIdToken(forceRefresh);
    } catch (err) {
      clientLogger.error('AuthContext.getIdToken', 'Failed to get Firebase ID token', err);
      return null;
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        dbUser,
        permissions: dbUser?.permissions ?? null,
        hasPermission,
        refreshDbUser,
        loading,
        error,
        loginWithEmail,
        signupWithEmail,
        loginWithGoogle,
        logout,
        getIdToken,
        syncDbUser,
        resendVerificationEmail,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthContextType => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
