'use client';

import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
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
} from 'firebase/auth';
import axios from 'axios';
import { auth, googleProvider } from '../lib/firebase/config';
import { getFirebaseAuthErrorMessage } from '../lib/firebase/errors';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { notifyError } from '@/lib/api/notify';
import { clientLogger } from '@/lib/client-logger';

export interface DbUser {
  id: number;
  organizationId: number;
  name: string;
  email: string;
  role: string;
  avatarUrl: string | null;
  isOnline: boolean;
  createdAt: string;
}

interface AuthContextType {
  user: User | null;
  dbUser: DbUser | null;
  loading: boolean;
  error: string | null;
  loginWithEmail: (email: string, password: string) => Promise<UserCredential>;
  signupWithEmail: (email: string, password: string, displayName?: string) => Promise<UserCredential>;
  loginWithGoogle: () => Promise<UserCredential>;
  logout: () => Promise<void>;
  getIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  syncDbUser: (currentUser: User) => Promise<DbUser | null>;
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
   * Syncs the authenticated Firebase user with the PostgreSQL `users` table
   */
  const syncDbUser = useCallback(async (currentUser: User): Promise<DbUser | null> => {
    try {
      // Identity, organization and role are resolved server-side from the verified ID token
      const idToken = await currentUser.getIdToken();
      const response = await axios.post(
        '/api/auth/sync',
        {
          name: currentUser.displayName || currentUser.email?.split('@')[0] || 'Team Member',
          avatarUrl: currentUser.photoURL || null,
        },
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (response.data?.success && response.data?.user) {
        setDbUser(response.data.user);
        // Force refresh the token so custom claims (organizationId, userId) are immediately available in the token
        try {
          await currentUser.getIdToken(true);
        } catch { }
        return response.data.user;
      }
      return null;
    } catch (syncErr) {
      // Without a synced DB user every API call would fail — tell the user why
      const apiError = notifyError(syncErr, { where: 'AuthContext.syncDbUser', title: "Couldn't load your account" });
      setError(apiError.message);
      return null;
    }
  }, []);

  useEffect(() => {
    // Listen to Firebase auth state changes
    const unsubscribe = onAuthStateChanged(
      auth,
      async (currentUser) => {
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

        setUser(currentUser);
        if (currentUser && currentUser.email) {
          await syncDbUser(currentUser);
        } else {
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

  const clearError = () => setError(null);

  const loginWithEmail = async (email: string, password: string) => {
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      if (!result.user.emailVerified) {
        await signOut(auth);
        const err: any = new Error('Please verify your email before signing in. Check your inbox for the verification link.');
        err.code = 'auth/email-not-verified';
        throw err;
      }
      if (result.user) {
        await syncDbUser(result.user);
      }
      return result;
    } catch (err: any) {
      const msg = err.code === 'auth/email-not-verified'
        ? err.message
        : getFirebaseAuthErrorMessage(err);
      clientLogger.warn('AuthContext.loginWithEmail', msg, { code: err?.code });
      if (err.code !== 'auth/email-not-verified') {
        gooeyToast.error('Login failed', { description: msg });
      }
      throw err;
    }
  };

  const signupWithEmail = async (email: string, password: string, displayName?: string) => {
    try {
      const result = await createUserWithEmailAndPassword(auth, email, password);
      if (displayName && result.user) {
        await updateProfile(result.user, { displayName });
      }
      await sendEmailVerification(result.user);
      await signOut(auth);
      const signal: any = new Error('EMAIL_VERIFICATION_SENT');
      signal.code = 'auth/email-verification-sent';
      throw signal;
    } catch (err: any) {
      if (err.code === 'auth/email-verification-sent') {
        throw err;
      }
      const msg = getFirebaseAuthErrorMessage(err);
      clientLogger.warn('AuthContext.signupWithEmail', msg, { code: err?.code });
      gooeyToast.error('Sign up failed', { description: msg });
      throw err;
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

  const loginWithGoogle = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      if (result.user) {
        await syncDbUser(result.user);
      }
      return result;
    } catch (err: any) {
      const msg = getFirebaseAuthErrorMessage(err);
      clientLogger.warn('AuthContext.loginWithGoogle', msg, { code: err?.code });
      gooeyToast.error('Google sign-in failed', {
        description: msg,
      });
      throw err;
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
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
