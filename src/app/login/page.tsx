'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  Eye, EyeOff, Loader2, AlertCircle,
  MessageCircle, Sparkles, Mail, CheckCircle2,
  Building2, ArrowLeft, CheckCheck,
} from 'lucide-react';

// ─── Inline brand icons ────────────────────────────────────────────────────
const InstagramIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
    <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
    <line x1="17.5" x2="17.51" y1="6.5" y2="6.5" />
  </svg>
);
const MessengerIcon = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
    <path d="M12 2C6.48 2 2 6.13 2 11.22c0 2.9 1.45 5.48 3.72 7.17V22l3.4-1.87c.91.25 1.87.39 2.88.39 5.52 0 10-4.13 10-9.22S17.52 2 12 2z" />
    <path d="m7 13.5 3.5-3.75 2.25 2.25L17 9.75l-3.5 3.75-2.25-2.25z" />
  </svg>
);

// ─── Shared styles ─────────────────────────────────────────────────────────
const inp = 'w-full h-10 px-3 text-[15px] bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#3440a8] focus:ring-1 focus:ring-[#3440a8] transition-colors';
const lbl = 'block text-[13px] font-medium text-slate-600 mb-1';

function toSlug(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

type Mode = 'signin' | 'signup-ws' | 'signup-creds' | 'verify';
// For sign-up, workspace is NEW — we only need the slug (org doesn't exist yet)
interface WorkspaceInfo { slug: string; displayName: string }

// ─── Sub-components ─────────────────────────────────────────────────────────

function BrandPanel() {
  return (
    <div className="hidden lg:flex lg:w-[44%] shrink-0 flex-col bg-[#3440a8] text-white px-10 pt-10 pb-10">
      <div className="flex items-center gap-3">
        <div className="relative w-9 h-9 rounded-lg bg-white flex items-center justify-center">
          <span className="text-[#3440a8] text-xl font-extrabold leading-none">U</span>
          <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
        </div>
        <span className="text-xl font-bold tracking-tight">UnoCX</span>
      </div>
      <div className="flex-1 flex flex-col justify-center px-5 py-8">
        <h2 className="text-[32px] xl:text-4xl font-bold leading-[1.2] tracking-tight max-w-[420px]">
          The AI helpdesk that lives in the DMs.
        </h2>
        <p className="mt-4 text-[15px] leading-relaxed text-indigo-100/90 max-w-[360px]">
          One AI agent for WhatsApp, Instagram and Messenger that resolves orders on any store.
        </p>
        <div className="mt-8 max-w-[440px] space-y-3">
          <div className="w-[77%] bg-white rounded-xl px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <InstagramIcon className="w-4 h-4 text-[#c13584] shrink-0" />
              <p className="text-[14px] font-bold text-slate-900">&ldquo;Where is my order?&rdquo;</p>
            </div>
            <p className="mt-1 text-[12px] text-slate-500">AI agent · out for delivery, tracking sent · 4 s</p>
          </div>
          <div className="w-[65%] ml-[35%] bg-[#dcf7e8] rounded-xl px-4 py-3 shadow-sm">
            <p className="text-[14px] font-bold text-slate-900">Address updated</p>
            <p className="mt-1 text-[12px] text-[#2f6b4f]">Customer confirmed · Shopify order changed</p>
          </div>
          <div className="w-[73%] ml-[8%] bg-white rounded-xl px-4 py-3 shadow-sm">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-[#3440a8] shrink-0" />
              <p className="text-[14px] font-bold text-slate-900">Resolved by AI</p>
            </div>
            <p className="mt-1 text-[12px] text-slate-500">No agent needed · customer rated 5/5</p>
          </div>
        </div>
      </div>
      <div className="px-5 flex gap-10">
        <div>
          <p className="text-[12px] font-semibold text-indigo-200">Channels</p>
          <div className="mt-2 flex items-center gap-2.5">
            {[
              { bg: 'bg-[#25d366]', icon: <MessageCircle className="w-4 h-4 text-white" />, t: 'WhatsApp' },
              { bg: 'bg-[#c13584]', icon: <InstagramIcon className="w-4 h-4 text-white" />, t: 'Instagram' },
              { bg: 'bg-[#0a7cff]', icon: <MessengerIcon className="w-4 h-4 text-white" />, t: 'Messenger' },
            ].map(({ bg, icon, t }) => (
              <div key={t} className={`w-8 h-8 rounded-lg ${bg} flex items-center justify-center`} title={t}>{icon}</div>
            ))}
          </div>
        </div>
        <div>
          <p className="text-[12px] font-semibold text-indigo-200">Works with</p>
          <div className="mt-2 w-8 h-8 rounded-lg bg-[#5e8e3e] flex items-center justify-center" title="Shopify">
            <span className="text-white text-sm font-bold">S</span>
          </div>
          <p className="mt-1.5 text-[12px] text-indigo-200">Built for Shopify brands</p>
        </div>
      </div>
    </div>
  );
}

function GoogleBtn({ onClick, loading, label }: { onClick: () => void; loading: boolean; label: string }) {
  return (
    <button type="button" onClick={onClick} disabled={loading}
      className="w-full h-10 flex items-center justify-center gap-3 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-800 rounded-lg text-[14px] font-semibold border border-slate-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer">
      {loading
        ? <Loader2 className="w-4 h-4 animate-spin text-[#3440a8]" />
        : <span className="w-[18px] h-[18px] rounded-full border border-slate-200 bg-white flex items-center justify-center text-[10px] font-bold text-[#4285f4] leading-none shadow-sm">G</span>
      }
      <span>{loading ? 'Please wait...' : label}</span>
    </button>
  );
}

function OrDivider() {
  return (
    <div className="flex items-center gap-4 my-4">
      <div className="flex-1 border-t border-slate-200" />
      <span className="text-[12px] text-slate-400 font-medium">or</span>
      <div className="flex-1 border-t border-slate-200" />
    </div>
  );
}

function ErrorBanner({ msg, onDismiss }: { msg: string; onDismiss: () => void }) {
  return (
    <div className="mb-4 p-2.5 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-[13px] text-rose-700">
      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
      <span className="flex-1">{msg}</span>
      <button type="button" onClick={onDismiss} className="text-rose-400 hover:text-rose-600 font-bold leading-none cursor-pointer">✕</button>
    </div>
  );
}

/** Step indicator dots shown during signup flow */
function SignupSteps({ step }: { step: 1 | 2 }) {
  return (
    <div className="flex items-center gap-2 mb-6">
      {[1, 2].map(n => (
        <React.Fragment key={n}>
          <div className={`flex items-center justify-center w-6 h-6 rounded-full text-[11px] font-bold transition-colors ${n < step ? 'bg-emerald-500 text-white' : n === step ? 'bg-[#3440a8] text-white' : 'bg-slate-200 text-slate-500'}`}>
            {n < step ? <CheckCheck className="w-3.5 h-3.5" /> : n}
          </div>
          <span className={`text-[12px] font-medium ${n === step ? 'text-slate-800' : 'text-slate-400'}`}>
            {n === 1 ? 'Workspace' : 'Your details'}
          </span>
          {n < 2 && <div className="flex-1 h-px bg-slate-200 mx-1" />}
        </React.Fragment>
      ))}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function LoginPage() {
  const router = useRouter();
  const {
    user, loading: authLoading, error,
    loginWithEmail, signupWithEmail, loginWithGoogle,
    resendVerificationEmail, clearError,
  } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');

  // Sign-in fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);

  // Sign-up — workspace step
  const [wsInput, setWsInput] = useState('');
  const [wsInfo, setWsInfo] = useState<WorkspaceInfo | null>(null);
  const [wsChecking, setWsChecking] = useState(false);

  // Sign-up — credentials step
  const [suName, setSuName] = useState('');
  const [suEmail, setSuEmail] = useState('');
  const [suPassword, setSuPassword] = useState('');
  const [showSuPw, setShowSuPw] = useState(false);

  // Verify state
  const [verifyEmail, setVerifyEmail] = useState('');
  const [verifyPassword, setVerifyPassword] = useState('');

  // Loading / errors
  const [submitting, setSubmitting] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const wsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!authLoading && user && user.emailVerified) router.replace('/');
  }, [user, authLoading, router]);

  useEffect(() => {
    if (mode === 'signup-ws') setTimeout(() => wsRef.current?.focus(), 50);
  }, [mode]);

  const resetErr = () => { setLocalError(null); clearError(); };
  const go = (m: Mode) => { setMode(m); resetErr(); };

  // ── Sign in ────────────────────────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    resetErr();
    if (!email.trim() || !password) return setLocalError('Please enter your email and password.');
    setSubmitting(true);
    try {
      await loginWithEmail(email.trim(), password);
      router.replace('/');
    } catch (err: any) {
      if (err.code === 'auth/email-not-verified') setLocalError(err.message);
    } finally { setSubmitting(false); }
  };

  const handleGoogleSignIn = async () => {
    resetErr();
    setGoogleLoading(true);
    try { await loginWithGoogle(); router.replace('/'); }
    catch { } finally { setGoogleLoading(false); }
  };

  // ── Sign-up step 1: check workspace is AVAILABLE (must not exist yet) ────
  const handleWorkspaceContinue = async (e: React.FormEvent) => {
    e.preventDefault();
    resetErr();
    const slug = toSlug(wsInput);
    if (!slug) return setLocalError('Please enter a workspace name.');
    setWsChecking(true);
    try {
      const res = await fetch(`/api/auth/workspace?slug=${encodeURIComponent(slug)}`);
      const data = await res.json();
      if (!data.available) {
        // Slug already exists in DB — cannot use it for a new workspace
        setLocalError(`"${slug}" is already taken. Please choose a different workspace name.`);
        return;
      }
      // Slug is free — derive a display name from it
      const displayName = slug.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
      setWsInfo({ slug, displayName });
      go('signup-creds');
    } catch {
      setLocalError('Could not reach the server. Please try again.');
    } finally { setWsChecking(false); }
  };

  // ── Sign-up step 2: create account (email/password) ───────────────────────
  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetErr();
    if (!suName.trim()) return setLocalError('Please enter your full name.');
    if (!suEmail.trim()) return setLocalError('Please enter your work email.');
    if (suPassword.length < 6) return setLocalError('Password must be at least 6 characters.');
    if (!wsInfo) return go('signup-ws');

    setSubmitting(true);
    try {
      setVerifyEmail(suEmail.trim());
      setVerifyPassword(suPassword);
      await signupWithEmail(suEmail.trim(), suPassword, suName.trim(), wsInfo.slug);
      router.replace('/');
    } catch (err: any) {
      if (err.code === 'auth/email-verification-sent') go('verify');
    } finally { setSubmitting(false); }
  };

  // ── Sign-up step 2: Google ─────────────────────────────────────────────────
  const handleGoogleSignUp = async () => {
    resetErr();
    if (!wsInfo) return go('signup-ws');
    setGoogleLoading(true);
    try { await loginWithGoogle(wsInfo.slug); router.replace('/'); }
    catch { } finally { setGoogleLoading(false); }
  };

  const handleResend = async () => {
    try { await resendVerificationEmail(verifyEmail, verifyPassword); } catch { }
  };

  const activeError = localError || error;

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div className="h-full w-full flex bg-white font-sans text-slate-900">
      <BrandPanel />

      {/* Right panel */}
      <div className="flex-1 flex flex-col px-6 sm:px-12 h-full overflow-hidden">
        <div className="flex-1 flex items-center justify-center">
          <div className="w-full max-w-[360px]">

            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-2.5 mb-8">
              <div className="relative w-8 h-8 rounded-lg bg-[#3440a8] flex items-center justify-center">
                <span className="text-white text-lg font-extrabold leading-none">U</span>
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </div>
              <span className="text-lg font-bold tracking-tight">UnoCX</span>
            </div>

            {activeError && <ErrorBanner msg={activeError} onDismiss={resetErr} />}

            {/* ══ SIGN IN ══════════════════════════════════════════════════ */}
            {mode === 'signin' && (
              <>
                <h1 className="text-[26px] font-bold tracking-tight leading-tight">Sign in</h1>
                <p className="mt-1 text-[14px] text-slate-500">Welcome back. Use your work email.</p>

                <form onSubmit={handleSignIn} className="mt-5 space-y-3.5">
                  <div>
                    <label htmlFor="si-email" className={lbl}>Work email</label>
                    <input id="si-email" type="email" required autoComplete="email" placeholder="you@company.com"
                      value={email} onChange={e => setEmail(e.target.value)} className={inp} />
                  </div>

                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <label htmlFor="si-pw" className="text-[13px] font-medium text-slate-600">Password</label>
                      <button type="button"
                        onClick={() => alert('Please contact your administrator to reset credentials.')}
                        className="text-[12px] font-semibold text-[#3440a8] hover:text-[#283388] cursor-pointer">
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <input id="si-pw" type={showPw ? 'text' : 'password'} required autoComplete="current-password"
                        value={password} onChange={e => setPassword(e.target.value)} className={`${inp} pr-10`} />
                      <button type="button" onClick={() => setShowPw(!showPw)}
                        className="p-1 text-slate-400 hover:text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                        aria-label={showPw ? 'Hide' : 'Show'}>
                        {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>

                  <label className="flex items-center gap-2.5 cursor-pointer w-fit">
                    <input type="checkbox" checked={rememberMe} onChange={e => setRememberMe(e.target.checked)}
                      className="w-4 h-4 accent-[#3440a8] cursor-pointer" />
                    <span className="text-[14px] text-slate-700">Keep me signed in</span>
                  </label>

                  <button type="submit" disabled={submitting || googleLoading}
                    className="w-full h-10 bg-[#3440a8] hover:bg-[#2c3794] active:bg-[#283388] text-white font-semibold text-[14px] rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2">
                    {submitting ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Signing in...</span></> : 'Sign in'}
                  </button>
                </form>

                <OrDivider />
                <GoogleBtn onClick={handleGoogleSignIn} loading={googleLoading} label="Continue with Google" />

                <p className="mt-6 text-[13px] text-slate-600 text-center">
                  New to UnoCX?{' '}
                  <button type="button" onClick={() => go('signup-ws')}
                    className="font-bold text-[#3440a8] hover:underline cursor-pointer">
                    Create an account
                  </button>
                </p>
              </>
            )}

            {/* ══ SIGN-UP STEP 1: Workspace ═════════════════════════════════ */}
            {mode === 'signup-ws' && (
              <>
                {/* Back button */}
                <button type="button" onClick={() => go('signin')}
                  className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800 cursor-pointer mb-5 transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                </button>

                <SignupSteps step={1} />

                <h1 className="text-[24px] font-bold tracking-tight leading-tight">Find your workspace</h1>
                <p className="mt-1 text-[14px] text-slate-500">Enter the workspace name your team uses.</p>

                <form onSubmit={handleWorkspaceContinue} className="mt-5 space-y-4">
                  <div>
                    <label htmlFor="ws-name" className={lbl}>Workspace name</label>
                    <div className="relative">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={wsRef}
                        id="ws-name"
                        type="text"
                        required
                        placeholder="your-company"
                        autoComplete="organization"
                        value={wsInput}
                        onChange={e => setWsInput(e.target.value)}
                        className={`${inp} pl-9`}
                      />
                    </div>
                    {wsInput && (
                      <p className="mt-1 text-[11px] text-slate-400">
                        Will be created as: <span className="font-semibold text-slate-500">{toSlug(wsInput)}</span>
                      </p>
                    )}
                  </div>

                  <button type="submit" disabled={wsChecking}
                    className="w-full h-10 bg-[#3440a8] hover:bg-[#2c3794] active:bg-[#283388] text-white font-semibold text-[14px] rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2">
                    {wsChecking
                      ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Checking...</span></>
                      : 'Continue'}
                  </button>
                </form>

                <p className="mt-6 text-[13px] text-slate-600 text-center">
                  Already have an account?{' '}
                  <button type="button" onClick={() => go('signin')}
                    className="font-bold text-[#3440a8] hover:underline cursor-pointer">
                    Sign in
                  </button>
                </p>
              </>
            )}

            {/* ══ SIGN-UP STEP 2: Credentials ══════════════════════════════ */}
            {mode === 'signup-creds' && wsInfo && (
              <>
                {/* Back to workspace step */}
                <button type="button" onClick={() => go('signup-ws')}
                  className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800 cursor-pointer mb-5 transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" /> Change workspace
                </button>

                <SignupSteps step={2} />

                {/* Workspace badge — green to signal it's available/new */}
                <div className="flex items-center gap-2 mb-4 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <Building2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="text-[13px] font-semibold text-emerald-700">{wsInfo.displayName}</span>
                  <span className="ml-auto text-[11px] text-emerald-500 font-medium">{wsInfo.slug}</span>
                  <CheckCheck className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                </div>

                <h1 className="text-[22px] font-bold tracking-tight leading-tight">Create your account</h1>
                <p className="mt-0.5 text-[13px] text-slate-500">You'll be the admin of <span className="font-semibold text-slate-700">{wsInfo.displayName}</span>.</p>

                <form onSubmit={handleSignUp} className="mt-4 space-y-3">
                  <div>
                    <label htmlFor="su-name" className={lbl}>Full name</label>
                    <input id="su-name" type="text" required autoComplete="name" placeholder="Jane Smith"
                      value={suName} onChange={e => setSuName(e.target.value)} className={inp} />
                  </div>
                  <div>
                    <label htmlFor="su-email" className={lbl}>Work email</label>
                    <input id="su-email" type="email" required autoComplete="email" placeholder="you@company.com"
                      value={suEmail} onChange={e => setSuEmail(e.target.value)} className={inp} />
                  </div>
                  <div>
                    <label htmlFor="su-pw" className={lbl}>Password</label>
                    <div className="relative">
                      <input id="su-pw" type={showSuPw ? 'text' : 'password'} required autoComplete="new-password"
                        placeholder="Min. 6 characters"
                        value={suPassword} onChange={e => setSuPassword(e.target.value)} className={`${inp} pr-10`} />
                      <button type="button" onClick={() => setShowSuPw(!showSuPw)}
                        className="p-1 text-slate-400 hover:text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                        aria-label={showSuPw ? 'Hide' : 'Show'}>
                        {showSuPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                  </div>
                  <button type="submit" disabled={submitting || googleLoading}
                    className="w-full h-10 bg-[#3440a8] hover:bg-[#2c3794] active:bg-[#283388] text-white font-semibold text-[14px] rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2">
                    {submitting
                      ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Creating account...</span></>
                      : 'Create account'}
                  </button>
                </form>

                <OrDivider />
                <GoogleBtn onClick={handleGoogleSignUp} loading={googleLoading} label="Continue with Google" />

                <p className="mt-4 text-[13px] text-slate-600 text-center">
                  Already have an account?{' '}
                  <button type="button" onClick={() => go('signin')}
                    className="font-bold text-[#3440a8] hover:underline cursor-pointer">
                    Sign in
                  </button>
                </p>
              </>
            )}

            {/* ══ VERIFY EMAIL ═════════════════════════════════════════════ */}
            {mode === 'verify' && (
              <div className="text-center">
                <div className="mx-auto mb-5 w-14 h-14 rounded-full bg-indigo-50 flex items-center justify-center">
                  <Mail className="w-7 h-7 text-[#3440a8]" />
                </div>
                <h1 className="text-[22px] font-bold tracking-tight">Check your inbox</h1>
                <p className="mt-2.5 text-[14px] text-slate-500 leading-relaxed">
                  We sent a verification link to{' '}
                  <span className="font-semibold text-slate-700">{verifyEmail}</span>.
                </p>
                <div className="mt-5 p-3.5 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2.5 text-left">
                  <CheckCircle2 className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  <p className="text-[13px] text-amber-800">
                    Once verified, come back and sign in with your email and password.
                  </p>
                </div>
                <div className="mt-5 space-y-2.5">
                  <button type="button" onClick={() => go('signin')}
                    className="w-full h-10 bg-[#3440a8] hover:bg-[#2c3794] text-white font-semibold text-[14px] rounded-lg transition-colors cursor-pointer flex items-center justify-center">
                    Go to Sign in
                  </button>
                  <button type="button" onClick={handleResend}
                    className="w-full h-10 bg-white hover:bg-slate-50 text-slate-600 font-medium text-[14px] rounded-lg border border-slate-200 transition-colors cursor-pointer">
                    Resend verification email
                  </button>
                </div>
              </div>
            )}

          </div>
        </div>

        {/* Footer */}
        <div className="py-4 text-center text-[12px] text-slate-400 space-x-3">
          <a href="#" className="hover:text-slate-600">Terms</a>
          <span>·</span>
          <a href="#" className="hover:text-slate-600">Privacy</a>
          <span>·</span>
          <a href="#" className="hover:text-slate-600">Help</a>
        </div>
      </div>
    </div>
  );
}