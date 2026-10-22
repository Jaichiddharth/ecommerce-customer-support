'use client';

import React, { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, NO_WORKSPACE_MESSAGE } from '../../context/AuthContext';
import {
  Eye, EyeOff, Loader2, AlertCircle,
  MessageCircle, Sparkles, Mail, CheckCircle2,
  Building2, ArrowLeft,
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
const inp = 'w-full h-9 px-3 text-[14px] bg-white border border-slate-300 rounded-lg text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#3440a8] focus:ring-1 focus:ring-[#3440a8] transition-colors';
const lbl = 'block text-[12px] font-medium text-slate-600 mb-0.5';

function toSlug(s: string) {
  return s.trim().toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/** Workspace slug for a Google sign-up: jane.doe@acme.com → jane-doe-acme-com (room left for a -N suffix). */
function emailToSlug(email: string) {
  return email.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 90);
}

/** Returns true if password has ≥8 chars, ≥1 letter, ≥1 digit */
function validatePassword(pw: string): { ok: boolean; msg: string } {
  if (pw.length < 8) return { ok: false, msg: 'Password must be at least 8 characters.' };
  if (!/[a-zA-Z]/.test(pw)) return { ok: false, msg: 'Password must contain at least one letter.' };
  if (!/[0-9]/.test(pw)) return { ok: false, msg: 'Password must contain at least one number.' };
  return { ok: true, msg: '' };
}

type Mode = 'signin' | 'signup' | 'verify';
type WsStatus = 'idle' | 'checking' | 'available' | 'taken' | 'error';

/** Throws on network failure so callers can tell "taken" apart from "unreachable". */
async function checkSlug(slug: string): Promise<boolean> {
  const res = await fetch(`/api/auth/workspace?slug=${encodeURIComponent(slug)}`);
  const data = await res.json();
  return !!data.available;
}

/** Checks a slug; if taken, finds the first free alternative (-1, -2, -3). */
async function lookupWorkspace(slug: string): Promise<{ available: boolean; suggestion: string | null }> {
  if (await checkSlug(slug)) return { available: true, suggestion: null };
  for (let n = 1; n <= 3; n++) {
    const candidate = `${slug}-${n}`;
    if (await checkSlug(candidate)) return { available: false, suggestion: candidate };
  }
  return { available: false, suggestion: null };
}

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
      className="w-full h-10 flex items-center justify-center gap-3 bg-white hover:bg-slate-50 text-slate-800 rounded-lg text-[14px] font-semibold border border-slate-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer">
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
    <div className="flex items-center gap-4 my-2">
      <div className="flex-1 border-t border-slate-200" />
      <span className="text-[12px] text-slate-400 font-medium">or</span>
      <div className="flex-1 border-t border-slate-200" />
    </div>
  );
}

function ErrorBanner({ msg, onDismiss, action }: {
  msg: string; onDismiss: () => void; action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="mb-4 p-2.5 bg-rose-50 border border-rose-200 rounded-lg flex items-start gap-2 text-[13px] text-rose-700">
      <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
      <span className="flex-1">
        {msg}
        {action && (
          <button type="button" onClick={action.onClick}
            className="block mt-1 font-semibold text-[#3440a8] hover:underline cursor-pointer">
            {action.label} →
          </button>
        )}
      </span>
      <button type="button" onClick={onDismiss} className="text-rose-400 hover:text-rose-600 font-bold leading-none cursor-pointer">✕</button>
    </div>
  );
}

/** Inline workspace availability hint under the company field */
function WorkspaceHint({ status, slug, suggestion, onUseSuggestion }: {
  status: WsStatus; slug: string; suggestion: string | null; onUseSuggestion: () => void;
}) {
  const base = 'mt-1 min-h-[18px] text-[12px] flex items-center gap-1.5';
  if (status === 'checking') return (
    <p className={`${base} text-slate-400`}><Loader2 className="w-3 h-3 animate-spin" /> Checking availability…</p>
  );
  if (status === 'available') return (
    <p className={`${base} text-emerald-600`}>
      <CheckCircle2 className="w-3.5 h-3.5" /> Workspace <span className="font-semibold">{slug}</span> is available
    </p>
  );
  if (status === 'taken') return (
    <p className={`${base} text-amber-700 flex-wrap`}>
      <AlertCircle className="w-3.5 h-3.5" />
      <span><span className="font-semibold">{slug}</span> is taken.</span>
      {suggestion
        ? <button type="button" onClick={onUseSuggestion} className="font-semibold text-[#3440a8] hover:underline cursor-pointer">Use {suggestion}</button>
        : <span>Try a different name.</span>}
    </p>
  );
  if (status === 'error') return (
    <p className={`${base} text-slate-400`}>Couldn&apos;t check availability — we&apos;ll retry when you submit.</p>
  );
  return <p className={`${base} text-slate-400`}>This becomes your team&apos;s workspace on UnoCX.</p>;
}

/** Password strength indicator bar */
function PwStrengthBar({ pw }: { pw: string }) {
  if (!pw) return null;
  const hasLen = pw.length >= 8;
  const hasLetter = /[a-zA-Z]/.test(pw);
  const hasNum = /[0-9]/.test(pw);
  const score = [hasLen, hasLetter, hasNum].filter(Boolean).length;
  const colors = ['bg-rose-400', 'bg-amber-400', 'bg-emerald-500'];
  const labels = ['Weak', 'Almost', 'Strong'];
  return (
    <div className="mt-1.5">
      <div className="flex gap-1">
        {[0, 1, 2].map(i => (
          <div key={i} className={`h-1 flex-1 rounded-full transition-colors ${i < score ? colors[score - 1] : 'bg-slate-200'}`} />
        ))}
      </div>
      <p className={`mt-0.5 text-[11px] font-medium ${score === 3 ? 'text-emerald-600' : score === 2 ? 'text-amber-600' : 'text-rose-500'}`}>
        {pw.length > 0 ? labels[score - 1] || 'Weak' : ''}
        {!hasLen && pw.length > 0 && ' · 8+ chars required'}
        {hasLen && !hasLetter && ' · add a letter'}
        {hasLen && !hasNum && ' · add a number'}
      </p>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
export default function LoginPage() {
  const router = useRouter();
  const {
    user, dbUser, loading: authLoading, error,
    loginWithEmail, signupWithEmail, loginWithGoogle,
    resendVerificationEmail, clearError,
  } = useAuth();

  const [mode, setMode] = useState<Mode>('signin');

  // Sign-in fields
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  // Sign-up
  const [companyInput, setCompanyInput] = useState('');
  const [wsStatus, setWsStatus] = useState<WsStatus>('idle');
  const [wsSuggestion, setWsSuggestion] = useState<string | null>(null);
  const wsReq = useRef(0);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
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

  const companyRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Only leave the login page once the user is verified AND mapped to a workspace
    if (!authLoading && user && user.emailVerified && dbUser) router.replace('/');
  }, [user, dbUser, authLoading, router]);

  useEffect(() => {
    if (mode === 'signup') setTimeout(() => companyRef.current?.focus(), 50);
  }, [mode]);

  // ─── Live workspace availability check (debounced) ────────────────────────
  useEffect(() => {
    if (mode !== 'signup') return;
    const slug = toSlug(companyInput);
    const id = ++wsReq.current;
    setWsSuggestion(null);
    if (!slug) { setWsStatus('idle'); return; }
    setWsStatus('checking');
    const t = setTimeout(async () => {
      try {
        const r = await lookupWorkspace(slug);
        if (id !== wsReq.current) return;
        setWsStatus(r.available ? 'available' : 'taken');
        setWsSuggestion(r.suggestion);
      } catch {
        if (id === wsReq.current) setWsStatus('error');
      }
    }, 400);
    return () => clearTimeout(t);
  }, [companyInput, mode]);

  const resetErr = () => { setLocalError(null); clearError(); };
  const go = (m: Mode) => { setMode(m); resetErr(); };

  // ─── Sign in ───────────────────────────────────────────────────────────────
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    resetErr();
    if (!email.trim() || !password) return setLocalError('Please enter your email and password.');
    setSubmitting(true);
    try {
      await loginWithEmail(email.trim(), password, rememberMe);
      router.replace('/');
    } catch (err: any) {
      if (err.code === 'auth/email-not-verified') setLocalError(err.message);
    } finally { setSubmitting(false); }
  };

  const handleGoogleSignIn = async () => {
    resetErr();
    setGoogleLoading(true);
    try { await loginWithGoogle(rememberMe); router.replace('/'); }
    catch { } finally { setGoogleLoading(false); }
  };

  // ─── Sign-up: confirm the workspace slug is free before creating account ──
  const resolveWorkspace = async (): Promise<string | null> => {
    const slug = toSlug(companyInput);
    if (!slug) {
      setLocalError('Please enter your company name.');
      companyRef.current?.focus();
      return null;
    }
    if (wsStatus === 'available') return slug;
    try {
      const r = await lookupWorkspace(slug);
      setWsSuggestion(r.suggestion);
      if (r.available) { setWsStatus('available'); return slug; }
      setWsStatus('taken');
      setLocalError(r.suggestion
        ? `"${slug}" is already taken. Use "${r.suggestion}" or pick another company name.`
        : `"${slug}" and similar names are taken. Please try a different company name.`);
    } catch {
      setLocalError('Could not reach the server. Please try again.');
    }
    companyRef.current?.focus();
    return null;
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    resetErr();
    if (!toSlug(companyInput)) { companyRef.current?.focus(); return setLocalError('Please enter your company name.'); }
    if (!firstName.trim()) return setLocalError('Please enter your first name.');
    if (!lastName.trim()) return setLocalError('Please enter your last name.');
    if (!suEmail.trim()) return setLocalError('Please enter your work email.');
    const pwCheck = validatePassword(suPassword);
    if (!pwCheck.ok) return setLocalError(pwCheck.msg);

    setSubmitting(true);
    try {
      const slug = await resolveWorkspace();
      if (!slug) return;
      setVerifyEmail(suEmail.trim());
      setVerifyPassword(suPassword);
      await signupWithEmail(suEmail.trim(), suPassword, `${firstName.trim()} ${lastName.trim()}`, slug);
      router.replace('/');
    } catch (err: any) {
      if (err.code === 'auth/email-verification-sent') go('verify');
    } finally { setSubmitting(false); }
  };

  // Google sign-up needs no company name: the workspace is named after the Google email
  const resolveGoogleWorkspace = async (googleEmail: string) => {
    const slug = emailToSlug(googleEmail);
    const r = await lookupWorkspace(slug);
    const free = r.available ? slug : r.suggestion;
    if (!free) throw new Error(`A workspace for ${googleEmail} already exists. Sign in instead, or sign up with email.`);
    return { slug: free, name: googleEmail.trim().toLowerCase() };
  };

  const handleGoogleSignUp = async () => {
    resetErr();
    setGoogleLoading(true);
    try {
      await loginWithGoogle(false, resolveGoogleWorkspace);
      router.replace('/');
    } catch { } finally { setGoogleLoading(false); }
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
      <div className="flex-1 flex flex-col px-6 sm:px-12 h-full overflow-y-auto">
        <div className="flex-1 flex items-center justify-center py-4">
          <div className="w-full max-w-[380px]">

            {/* Mobile logo */}
            <div className="lg:hidden flex items-center gap-2.5 mb-7">
              <div className="relative w-8 h-8 rounded-lg bg-[#3440a8] flex items-center justify-center">
                <span className="text-white text-lg font-extrabold leading-none">U</span>
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </div>
              <span className="text-lg font-bold tracking-tight">UnoCX</span>
            </div>

            {activeError && (
              <ErrorBanner msg={activeError} onDismiss={resetErr}
                action={mode === 'signin' && activeError === NO_WORKSPACE_MESSAGE
                  ? { label: 'Create an account', onClick: () => { if (email.trim()) setSuEmail(email.trim()); go('signup'); } }
                  : undefined} />
            )}

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
                  <button type="button" onClick={() => go('signup')}
                    className="font-bold text-[#3440a8] hover:underline cursor-pointer">
                    Create an account
                  </button>
                </p>
              </>
            )}

            {/* ══ SIGN UP ══════════════════════════════════════════════════ */}
            {mode === 'signup' && (
              <>
                <button type="button" onClick={() => go('signin')}
                  className="flex items-center gap-1.5 text-[13px] text-slate-500 hover:text-slate-800 cursor-pointer mb-4 transition-colors">
                  <ArrowLeft className="w-3.5 h-3.5" /> Back to sign in
                </button>

                <h1 className="text-[24px] font-bold tracking-tight leading-tight">Create your workspace</h1>
                <p className="mt-1 text-[14px] text-slate-500">Set up UnoCX for your team in under a minute.</p>

                {/* Group 1: manual sign-up with company + personal details */}
                <form onSubmit={handleSignUp} className="mt-5 space-y-3" noValidate>
                  {/* Company */}
                  <div>
                    <label htmlFor="co-name" className={lbl}>Company name</label>
                    <div className="relative">
                      <Building2 className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                      <input
                        ref={companyRef}
                        id="co-name"
                        type="text"
                        placeholder="Acme Inc."
                        autoComplete="organization"
                        value={companyInput}
                        onChange={e => { setCompanyInput(e.target.value); resetErr(); }}
                        className={`${inp} pl-9 ${wsStatus === 'taken' ? 'border-amber-400' : ''}`}
                      />
                    </div>
                    <WorkspaceHint
                      status={wsStatus}
                      slug={toSlug(companyInput)}
                      suggestion={wsSuggestion}
                      onUseSuggestion={() => { if (wsSuggestion) { setCompanyInput(wsSuggestion); resetErr(); } }}
                    />
                  </div>

                  {/* Name row */}
                  <div className="grid grid-cols-2 gap-2.5">
                    <div>
                      <label htmlFor="su-fn" className={lbl}>First name</label>
                      <input id="su-fn" type="text" autoComplete="given-name" placeholder="Jane"
                        value={firstName} onChange={e => setFirstName(e.target.value)} className={inp} />
                    </div>
                    <div>
                      <label htmlFor="su-ln" className={lbl}>Last name</label>
                      <input id="su-ln" type="text" autoComplete="family-name" placeholder="Smith"
                        value={lastName} onChange={e => setLastName(e.target.value)} className={inp} />
                    </div>
                  </div>

                  {/* Email */}
                  <div>
                    <label htmlFor="su-email" className={lbl}>Work email</label>
                    <input id="su-email" type="email" autoComplete="email" placeholder="you@company.com"
                      value={suEmail} onChange={e => setSuEmail(e.target.value)} className={inp} />
                  </div>

                  {/* Password */}
                  <div>
                    <label htmlFor="su-pw" className={lbl}>Password</label>
                    <div className="relative">
                      <input id="su-pw" type={showSuPw ? 'text' : 'password'} autoComplete="new-password"
                        placeholder="8+ characters, letters & numbers"
                        value={suPassword} onChange={e => setSuPassword(e.target.value)} className={`${inp} pr-10`} />
                      <button type="button" onClick={() => setShowSuPw(!showSuPw)}
                        className="p-1 text-slate-400 hover:text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer"
                        aria-label={showSuPw ? 'Hide password' : 'Show password'}>
                        {showSuPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <PwStrengthBar pw={suPassword} />
                  </div>

                  <button type="submit" disabled={submitting || googleLoading}
                    className="w-full h-10 bg-[#3440a8] hover:bg-[#2c3794] active:bg-[#283388] text-white font-semibold text-[14px] rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2 !mt-4">
                    {submitting
                      ? <><Loader2 className="w-4 h-4 animate-spin" /><span>Creating workspace...</span></>
                      : 'Create account'}
                  </button>
                </form>

                <OrDivider />

                {/* Group 2: Google sign-up — no form; the workspace is named after the Google email */}
                <GoogleBtn onClick={handleGoogleSignUp} loading={googleLoading} label="Sign up with Google" />
                <p className="mt-1.5 text-[12px] text-slate-400 text-center">
                  No form needed — your workspace is named after your Google email.
                </p>

                <p className="mt-3 text-[11px] text-slate-400 text-center leading-relaxed">
                  By creating an account you agree to our{' '}
                  <a href="#" className="underline hover:text-slate-600">Terms</a> and{' '}
                  <a href="#" className="underline hover:text-slate-600">Privacy Policy</a>.
                </p>

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
        <div className="py-2 text-center text-[12px] text-slate-400 space-x-3">
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