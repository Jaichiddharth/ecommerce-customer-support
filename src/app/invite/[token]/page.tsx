'use client';

import React, { useState, useEffect, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { auth, googleProvider } from '@/lib/firebase/config';
import {
  signInWithPopup,
  signOut,
} from 'firebase/auth';
import {
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Lock,
  Copy,
  Check,
  Building2,
  UserCheck,
  ArrowRight,
  Sparkles,
  KeyRound,
  Store,
  Globe,
  Users,
  Clock,
} from 'lucide-react';
import { gooeyToast } from 'goey-toast';
import axios from 'axios';

interface InvitationData {
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
  expiresAt: string;
  accountExists: boolean;
  trial?: {
    isTrial: boolean;
    totalDays: number;
    daysLeft: number;
    currentDay: number;
    isExpired: boolean;
    trialEndsAt: string;
    formattedExpiresAt: string;
  } | null;
}

export default function AcceptInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const resolvedParams = use(params);
  const token = resolvedParams.token;
  const router = useRouter();
  const { user: authUser, syncDbUser, loading: authLoading } = useAuth();

  const [isLoading, setIsLoading] = useState(true);
  const [invitation, setInvitation] = useState<InvitationData | null>(null);
  const [invalidReason, setInvalidReason] = useState<string | null>(null);

  // Form states
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [emailVerificationSent, setEmailVerificationSent] = useState(false);

  // 2FA state for Admins/Owners
  const [show2FASetup, setShow2FASetup] = useState(false);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpUri, setTotpUri] = useState('');
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [verificationCode, setVerificationCode] = useState('');
  const [isVerifying2FA, setIsVerifying2FA] = useState(false);
  const [copiedSecret, setCopiedSecret] = useState(false);
  const [copiedCodes, setCopiedCodes] = useState(false);

  // Fetch invitation data
  useEffect(() => {
    async function loadInvite() {
      try {
        setIsLoading(true);
        const res = await axios.get(`/api/invitations/${token}`);
        if (res.data?.success && res.data?.valid && res.data?.invitation) {
          setInvitation(res.data.invitation);
        } else {
          setInvalidReason(res.data?.reason || 'invalid');
        }
      } catch (err: any) {
        setInvalidReason('not_found');
      } finally {
        setIsLoading(false);
      }
    }
    if (token) loadInvite();
  }, [token]);

  // Initiate 2FA setup if role is Admin/Owner
  const start2FASetup = async () => {
    try {
      setIsVerifying2FA(true);
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      const idToken = await currentUser.getIdToken();

      const res = await axios.post(
        '/api/auth/2fa',
        { action: 'setup' },
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (res.data?.success) {
        setTotpSecret(res.data.secret);
        setTotpUri(res.data.otpauthUri);
        setBackupCodes(res.data.backupCodes || []);
        setShow2FASetup(true);
      }
    } catch (err: any) {
      gooeyToast.error('Could not initialize 2-step verification', {
        description: err.response?.data?.message || err.message,
      });
    } finally {
      setIsVerifying2FA(false);
    }
  };

  // Complete acceptance and enter workspace
  const completeAcceptance = async (twoFactorVerified = false) => {
    try {
      setIsSubmitting(true);
      setFormError(null);
      const currentUser = auth.currentUser;
      if (!currentUser) {
        setFormError('Session not detected. Please sign in again.');
        return;
      }

      const idToken = await currentUser.getIdToken();
      const res = await axios.post(
        `/api/invitations/${token}/accept`,
        { twoFactorVerified },
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (res.data?.success) {
        gooeyToast.success(`Welcome to ${res.data.workspaceName}!`);
        // Refresh auth context so dbUser matches the joined workspace
        try {
          await syncDbUser(currentUser);
        } catch {
          // ignore if already synced
        }
        router.replace('/');
      }
    } catch (err: any) {
      const msg = err.response?.data?.message || err.message || 'Failed to accept invitation';
      setFormError(msg);
      gooeyToast.error('Failed to accept invitation', { description: msg });
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle Verify 2FA submission
  const handleVerify2FA = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!verificationCode || verificationCode.trim().length !== 6) {
      gooeyToast.error('Please enter the 6-digit code from your authenticator app.');
      return;
    }

    try {
      setIsVerifying2FA(true);
      const currentUser = auth.currentUser;
      if (!currentUser) return;
      const idToken = await currentUser.getIdToken();

      const res = await axios.post(
        '/api/auth/2fa',
        {
          action: 'verify',
          secret: totpSecret,
          token: verificationCode.trim(),
          backupCodes,
        },
        { headers: { Authorization: `Bearer ${idToken}` } }
      );

      if (res.data?.success && res.data?.verified) {
        gooeyToast.success('2-step verification enabled');
        // Now finalize workspace acceptance
        await completeAcceptance(true);
      }
    } catch (err: any) {
      gooeyToast.error('Invalid 2-step code', {
        description: err.response?.data?.message || 'Please check your authenticator app and try again.',
      });
    } finally {
      setIsVerifying2FA(false);
    }
  };

  // Check email match and route to 2FA or directly accept
  const handleAuthenticatedUser = async () => {
    if (!invitation) return;
    const currentUser = auth.currentUser;
    if (!currentUser || !currentUser.email) return;

    if (currentUser.email.toLowerCase().trim() !== invitation.email.toLowerCase().trim()) {
      setFormError(
        `This invitation is reserved for ${invitation.email}. You are currently signed in as ${currentUser.email}. A different email cannot accept this invitation.`
      );
      return;
    }

    const isPrivileged = invitation.role === 'OWNER';
    if (isPrivileged) {
      await start2FASetup();
    } else {
      await completeAcceptance(false);
    }
  };

  // Handle Google Auth (Sign In or Sign Up)
  const handleGoogleAuth = async () => {
    if (!invitation) return;
    setFormError(null);
    setGoogleLoading(true);

    try {
      const cred = await signInWithPopup(auth, googleProvider);
      const signedInEmail = (cred.user.email || '').toLowerCase().trim();
      const targetEmail = invitation.email.toLowerCase().trim();

      if (signedInEmail !== targetEmail) {
        await signOut(auth);
        setFormError(
          `This invitation was issued to ${invitation.email}. You signed in with ${signedInEmail}. A different email cannot accept this invitation.`
        );
        return;
      }

      await handleAuthenticatedUser();
    } catch (err: any) {
      if (err.code !== 'auth/popup-closed-by-user') {
        setFormError(err.message || 'Google authentication failed.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  // Handle Sign Out from current mismatching user
  const handleSignOutCurrent = async () => {
    await signOut(auth);
    setFormError(null);
  };

  const isMatchingUser =
    Boolean(
      authUser?.email &&
      invitation &&
      authUser.email.toLowerCase().trim() === invitation.email.toLowerCase().trim()
    );

  const isMismatchUser =
    Boolean(
      authUser?.email &&
      invitation &&
      authUser.email.toLowerCase().trim() !== invitation.email.toLowerCase().trim()
    );

  // ─── Loading View ────────────────────────────────────────────────────────
  if (isLoading || authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="flex flex-col items-center gap-3">
          <Loader2 className="w-8 h-8 text-[#1e2a78] animate-spin" />
          <p className="text-sm font-medium text-slate-500">Verifying invitation link...</p>
        </div>
      </div>
    );
  }

  // ─── Invalid / Expired View ──────────────────────────────────────────────
  if (invalidReason || !invitation) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200/90 shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-amber-50 text-amber-600 flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-6 h-6" />
          </div>

          <h1 className="text-xl font-bold text-slate-900 mb-2">
            {invalidReason === 'already_accepted'
              ? 'Invitation Already Accepted'
              : invalidReason === 'expired'
                ? 'Invitation Link Expired'
                : invalidReason === 'revoked'
                  ? 'Invitation Revoked'
                  : 'Invalid Invitation Link'}
          </h1>

          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            {invalidReason === 'already_accepted'
              ? 'This invitation link has already been used to join the workspace. You can sign in to continue.'
              : invalidReason === 'expired'
                ? 'This single-use invitation expired after 7 days. Please ask your administrator to send you a new invitation.'
                : invalidReason === 'revoked'
                  ? 'This invitation was revoked by a workspace administrator.'
                  : 'This invitation link is not valid or has been removed. Check the URL and try again.'}
          </p>

          <button
            onClick={() => router.push('/login')}
            className="w-full py-2.5 px-4 bg-[#1e2a78] hover:bg-[#16205e] text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
          >
            Go to UnoCX Sign in
          </button>
        </div>
      </div>
    );
  }

  // ─── Email Verification Sent View ─────────────────────────────────────────
  if (emailVerificationSent) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200/90 shadow-sm p-8 text-center">
          <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="w-6 h-6" />
          </div>

          <h1 className="text-xl font-bold text-slate-900 mb-2">Verify your email</h1>
          <p className="text-sm text-slate-600 mb-6 leading-relaxed">
            We sent a verification link to <strong>{invitation.email}</strong>. Please click the link in your email to complete registration, then return here to join <strong>{invitation.organizationName}</strong>.
          </p>

          <button
            onClick={() => setEmailVerificationSent(false)}
            className="w-full py-2.5 px-4 bg-[#1e2a78] hover:bg-[#16205e] text-white text-sm font-semibold rounded-xl transition-colors cursor-pointer"
          >
            I&apos;ve verified my email &rarr; Continue
          </button>
        </div>
      </div>
    );
  }

  // ─── 2-Step Verification Setup View (Admins & Owners) ────────────────────
  if (show2FASetup) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-8">
        <div className="w-full max-w-lg bg-white rounded-2xl border border-slate-200/90 shadow-sm p-8">
          <div className="flex items-center gap-3 mb-6 pb-4 border-b border-slate-100">
            <div className="w-10 h-10 rounded-xl bg-[#eef0fb] text-[#1e2a78] flex items-center justify-center shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-lg font-bold text-slate-900">2-Step Verification Required</h1>
              <p className="text-xs text-slate-500">
                Workspace Owners must configure an authenticator app before entering.
              </p>
            </div>
          </div>

          <form onSubmit={handleVerify2FA} className="space-y-6">
            {/* Step 1: Scan QR / Key */}
            <div>
              <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-[#1e2a78] bg-[#eef0fb] px-2 py-0.5 rounded-md mb-2">
                Step 1: Link Authenticator App
              </span>
              <p className="text-xs text-slate-600 mb-3">
                Open Google Authenticator, Microsoft Authenticator, or 1Password and scan the QR code, or enter this secret key manually:
              </p>

              {totpUri && (
                <div className="flex items-center justify-center p-4 bg-slate-50 rounded-xl border border-slate-200/70 mb-3">
                  <img
                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(totpUri)}`}
                    alt="Authenticator QR Code"
                    className="w-40 h-40 rounded-lg shadow-xs"
                  />
                </div>
              )}

              <div className="flex items-center gap-2 bg-slate-100/80 p-2.5 rounded-xl border border-slate-200 text-xs">
                <code className="flex-1 font-mono text-slate-800 break-all select-all font-semibold">
                  {totpSecret}
                </code>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(totpSecret);
                    setCopiedSecret(true);
                    setTimeout(() => setCopiedSecret(false), 2000);
                  }}
                  className="px-2.5 py-1 bg-white border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700 font-medium flex items-center gap-1 cursor-pointer shrink-0"
                >
                  {copiedSecret ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedSecret ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>

            {/* Step 2: Verification Code Input */}
            <div>
              <span className="inline-block text-[11px] font-bold uppercase tracking-wider text-[#1e2a78] bg-[#eef0fb] px-2 py-0.5 rounded-md mb-2">
                Step 2: Enter 6-digit verification code
              </span>
              <input
                type="text"
                maxLength={6}
                required
                autoFocus
                placeholder="123456"
                value={verificationCode}
                onChange={(e) => setVerificationCode(e.target.value.replace(/\D/g, ''))}
                className="w-full text-center tracking-[0.4em] font-mono text-xl py-2.5 bg-slate-50 border border-slate-300 rounded-xl focus:bg-white focus:outline-none focus:border-[#1e2a78] focus:ring-1 focus:ring-[#1e2a78]"
              />
            </div>

            {/* Backup Codes */}
            {backupCodes.length > 0 && (
              <div className="p-3.5 bg-amber-50/70 border border-amber-200/80 rounded-xl text-xs text-amber-900">
                <div className="flex items-center justify-between mb-1.5">
                  <span className="font-semibold flex items-center gap-1.5">
                    <KeyRound className="w-3.5 h-3.5 text-amber-700" />
                    Backup Recovery Codes
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(backupCodes.join('\n'));
                      setCopiedCodes(true);
                      setTimeout(() => setCopiedCodes(false), 2000);
                    }}
                    className="text-[11px] font-bold text-amber-800 hover:text-amber-900 underline cursor-pointer"
                  >
                    {copiedCodes ? 'Copied!' : 'Copy codes'}
                  </button>
                </div>
                <p className="text-[11px] text-amber-800 mb-2">
                  Save these single-use codes in a secure location in case you lose access to your device.
                </p>
                <div className="grid grid-cols-2 gap-1.5 font-mono text-[11px]">
                  {backupCodes.map((code, idx) => (
                    <div key={idx} className="bg-white/80 px-2 py-1 rounded border border-amber-200/60 text-slate-800">
                      {code}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button
              type="submit"
              disabled={isVerifying2FA || verificationCode.length !== 6}
              className="w-full py-3 bg-[#1e2a78] hover:bg-[#16205e] disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              {isVerifying2FA && <Loader2 className="w-4 h-4 animate-spin" />}
              Verify & Enter Workspace
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ─── Main Invitation Screen ───────────────────────────────────────────────
  return (
    <div className="min-h-screen flex flex-col md:flex-row bg-slate-50 font-sans">
      {/* Left Branding / Details Panel */}
      <div className="md:w-[42%] bg-[#1e2a78] text-white p-8 md:p-12 flex flex-col justify-between">
        <div>
          {/* Brand header */}
          <div className="flex items-center gap-3 mb-10">
            <div className="w-9 h-9 rounded-xl bg-white flex items-center justify-center">
              <span className="text-[#1e2a78] text-xl font-extrabold leading-none">U</span>
            </div>
            <span className="text-xl font-bold tracking-tight">UnoCX</span>
          </div>

          {/* Invitation banner */}
          <div className="space-y-4 max-w-md">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-indigo-500/30 text-indigo-200 text-xs font-semibold">
              <Sparkles className="w-3.5 h-3.5" />
              Workspace Invitation
            </div>

            <h1 className="text-2xl md:text-3xl font-bold tracking-tight leading-tight">
              Join {invitation.organizationName}
            </h1>

            <p className="text-indigo-100/90 text-sm leading-relaxed">
              <strong>{invitation.inviterName || 'A team administrator'}</strong> has invited you to collaborate in their UnoCX customer experience inbox.
            </p>

            {/* Scope / permissions breakdown card */}
            {invitation.trial && (
              <div className="p-3 bg-white/10 backdrop-blur-xs border border-white/15 rounded-xl flex items-center justify-between text-xs text-indigo-100">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-amber-300 shrink-0" />
                  <div>
                    <span className="font-semibold block text-white">Workspace 7-Day Trial</span>
                    <span className="text-[11px] text-indigo-200">
                      Shared with workspace · {invitation.trial.isExpired ? 'Expired' : `Day ${invitation.trial.currentDay} of ${invitation.trial.totalDays}`}
                    </span>
                  </div>
                </div>
                <span className="px-2.5 py-1 bg-amber-400/20 text-amber-200 rounded-lg font-bold text-xs">
                  {invitation.trial.isExpired ? 'Expired' : `${invitation.trial.daysLeft}d left`}
                </span>
              </div>
            )}

            <div className="bg-white/10 backdrop-blur-xs rounded-2xl p-5 border border-white/10 space-y-3.5 mt-6 text-xs text-indigo-50">
              <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                <span className="text-indigo-200 font-medium">Assigned Role</span>
                <span className="px-2.5 py-0.5 rounded-full bg-white/20 font-bold uppercase tracking-wider text-[11px] text-white">
                  {invitation.role}
                </span>
              </div>

              {invitation.teams && invitation.teams.length > 0 && (
                <div className="flex items-start justify-between border-b border-white/10 pb-2.5 gap-2">
                  <span className="text-indigo-200 font-medium flex items-center gap-1">
                    <Users className="w-3.5 h-3.5" /> Teams
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {invitation.teams.map((t) => (
                      <span key={t} className="px-2 py-0.5 bg-white/15 rounded text-[11px]">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {invitation.languages && invitation.languages.length > 0 && (
                <div className="flex items-start justify-between border-b border-white/10 pb-2.5 gap-2">
                  <span className="text-indigo-200 font-medium flex items-center gap-1">
                    <Globe className="w-3.5 h-3.5" /> Languages
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {invitation.languages.map((l) => (
                      <span key={l} className="px-2 py-0.5 bg-white/15 rounded text-[11px]">
                        {l}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {invitation.stores && invitation.stores.length > 0 && (
                <div className="flex items-start justify-between gap-2">
                  <span className="text-indigo-200 font-medium flex items-center gap-1">
                    <Store className="w-3.5 h-3.5" /> Stores
                  </span>
                  <div className="flex flex-wrap gap-1 justify-end">
                    {invitation.stores.map((s) => (
                      <span key={s} className="px-2 py-0.5 bg-white/15 rounded text-[11px]">
                        {s}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="text-xs text-indigo-200/70 pt-8">
          Single-use invitation link expires in 7 days · UnoCX
        </div>
      </div>

      {/* Right Interaction Panel */}
      <div className="flex-1 flex items-center justify-center p-6 md:p-12">
        <div className="w-full max-w-md bg-white rounded-2xl border border-slate-200/90 shadow-sm p-8">
          {/* Target Email Lock Chip */}
          <div className="mb-6 p-3 bg-slate-50 border border-slate-200 rounded-xl flex items-center gap-2.5 text-xs">
            <Lock className="w-4 h-4 text-slate-500 shrink-0" />
            <div className="flex-1 truncate">
              <span className="text-slate-500 block text-[10px] font-semibold uppercase tracking-wider">
                Invitation issued to
              </span>
              <span className="font-semibold text-slate-800">{invitation.email}</span>
            </div>
          </div>

          {/* Error Banner */}
          {formError && (
            <div className="mb-5 p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2.5 text-xs text-rose-800">
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
              <div className="flex-1">{formError}</div>
            </div>
          )}

          {/* Mismatch Account Warning */}
          {isMismatchUser && (
            <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 space-y-3">
              <p>
                You are currently signed in as <strong>{authUser?.email}</strong>. This invitation can only be accepted by <strong>{invitation.email}</strong>.
              </p>
              <button
                type="button"
                onClick={handleSignOutCurrent}
                className="w-full py-2 bg-white border border-amber-300 rounded-lg font-semibold hover:bg-amber-100/50 cursor-pointer text-amber-900"
              >
                Sign out & switch account
              </button>
            </div>
          )}

          {/* Already Signed In as Matching User */}
          {isMatchingUser && (
            <div className="space-y-4">
              <div className="text-center py-2">
                <div className="w-12 h-12 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mx-auto mb-3">
                  <UserCheck className="w-6 h-6" />
                </div>
                <h2 className="text-base font-bold text-slate-900">Signed in as {authUser?.email}</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Ready to join {invitation.organizationName} with your assigned access.
                </p>
              </div>

              <button
                type="button"
                onClick={handleAuthenticatedUser}
                disabled={isSubmitting}
                className="w-full py-3 bg-[#1e2a78] hover:bg-[#16205e] disabled:opacity-50 text-white text-sm font-semibold rounded-xl shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Join {invitation.organizationName} &rarr;
              </button>
            </div>
          )}

          {/* Not Signed In: Show Google Sign-in */}
          {!authUser && (
            <div>
              <div className="mb-6">
                <h2 className="text-xl font-bold text-slate-900">Sign in to join</h2>
                <p className="text-xs text-slate-500 mt-1">
                  Sign in with {invitation.email} to join the workspace.
                </p>
              </div>

              {/* Google Sign In */}
              <button
                type="button"
                onClick={handleGoogleAuth}
                disabled={googleLoading || isSubmitting}
                className="w-full h-11 px-4 text-xs font-semibold text-slate-700 bg-white border border-slate-300 rounded-xl hover:bg-slate-50 transition-colors flex items-center justify-center gap-2.5 cursor-pointer shadow-2xs"
              >
                {googleLoading ? (
                  <Loader2 className="w-4 h-4 animate-spin text-slate-500" />
                ) : (
                  <svg className="w-4 h-4" viewBox="0 0 24 24">
                    <path
                      fill="#4285F4"
                      d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                    />
                    <path
                      fill="#34A853"
                      d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                    />
                    <path
                      fill="#FBBC05"
                      d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
                    />
                    <path
                      fill="#EA4335"
                      d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
                    />
                  </svg>
                )}
                Continue with Google ({invitation.email})
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
