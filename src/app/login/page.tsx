'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { Eye, EyeOff, Loader2, AlertCircle, MessageCircle, Sparkles } from 'lucide-react';

// lucide-react v1 dropped brand icons, so these two are drawn inline
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

const inputClass =
  'w-full h-10 px-3 text-[15px] bg-white border border-slate-300 rounded-md text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-[#3440a8] focus:ring-1 focus:ring-[#3440a8] transition-colors';

const labelClass = 'block text-sm text-slate-700 mb-1.5';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, error, loginWithEmail, signupWithEmail, loginWithGoogle, clearError } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [googleSubmitting, setGoogleSubmitting] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  // If already authenticated, redirect to main dashboard
  useEffect(() => {
    if (!authLoading && user) {
      router.replace('/');
    }
  }, [user, authLoading, router]);

  const handleModeChange = (newMode: 'signin' | 'signup') => {
    setMode(newMode);
    setLocalError(null);
    clearError();
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);
    clearError();

    if (!email.trim() || !password) {
      setLocalError('Please fill in both email and password.');
      return;
    }

    if (mode === 'signup' && !name.trim()) {
      setLocalError('Please enter your full name.');
      return;
    }

    if (password.length < 6) {
      setLocalError('Password must be at least 6 characters long.');
      return;
    }

    setSubmitting(true);
    try {
      if (mode === 'signin') {
        await loginWithEmail(email.trim(), password);
      } else {
        await signupWithEmail(email.trim(), password, name.trim());
      }
      router.replace('/');
    } catch (err: any) {
      // Error handled by AuthContext
    } finally {
      setSubmitting(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setLocalError(null);
    clearError();
    setGoogleSubmitting(true);
    try {
      await loginWithGoogle();
      router.replace('/');
    } catch (err: any) {
      // Error handled by AuthContext
    } finally {
      setGoogleSubmitting(false);
    }
  };

  const activeError = localError || error;
  const isSignin = mode === 'signin';

  return (
    <div className="h-full w-full flex bg-white font-sans text-slate-900">
      {/* ======================================================== */}
      {/* LEFT COLUMN: BRAND PANEL                                 */}
      {/* ======================================================== */}
      {/* overflow-y-auto */}
      <div className="hidden lg:flex lg:w-[44%] shrink-0 flex-col bg-[#3440a8] text-white px-10 pt-10 pb-10 ">
        {/* Brand Logo */}
        <div className="flex items-center gap-3">
          <div className="relative w-9 h-9 rounded-lg bg-white flex items-center justify-center">
            <span className="text-[#3440a8] text-xl font-extrabold leading-none">U</span>
            <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </div>
          <span className="text-xl font-bold tracking-tight">UnoCX</span>
        </div>

        {/* Headline & Activity Cards */}
        <div className="flex-1 flex flex-col justify-center px-5 py-10">
          <h2 className="text-[34px] xl:text-4xl font-bold leading-[1.2] tracking-tight max-w-[420px]">
            The AI helpdesk that lives in the DMs.
          </h2>
          <p className="mt-5 text-base leading-relaxed text-indigo-100/90 max-w-[380px]">
            One AI agent for WhatsApp, Instagram and Messenger that resolves orders on any store.
          </p>

          <div className="mt-9 max-w-[440px] space-y-3.5">
            <div className="w-[77%] bg-white rounded-xl px-4 py-3.5 shadow-sm">
              <div className="flex items-center gap-2.5">
                <InstagramIcon className="w-[18px] h-[18px] text-[#c13584] shrink-0" />
                <p className="text-[15px] font-bold text-slate-900">&ldquo;Where is my order?&rdquo;</p>
              </div>
              <p className="mt-1.5 text-[13px] text-slate-500">AI agent · out for delivery, tracking sent · 4 s</p>
            </div>

            <div className="w-[68%] ml-[32%] bg-[#dcf7e8] rounded-xl px-4 py-3.5 shadow-sm">
              <p className="text-[15px] font-bold text-slate-900">Address updated</p>
              <p className="mt-1.5 text-[13px] text-[#2f6b4f]">Customer confirmed · Shopify order changed</p>
            </div>

            <div className="w-[75%] ml-[9%] bg-white rounded-xl px-4 py-3.5 shadow-sm">
              <div className="flex items-center gap-2.5">
                <Sparkles className="w-[18px] h-[18px] text-[#3440a8] shrink-0" />
                <p className="text-[15px] font-bold text-slate-900">Resolved by AI</p>
              </div>
              <p className="mt-1.5 text-[13px] text-slate-500">No agent needed · customer rated 5/5</p>
            </div>
          </div>
        </div>

        {/* Channels & Integrations */}
        <div className="px-5">
          <div className='flex gap-10'>
            <div>

              <p className="text-[13px] font-semibold text-indigo-200">Channels</p>
              <div className="mt-2.5 flex items-center gap-3">
                <div className="w-[34px] h-[34px] rounded-lg bg-[#25d366] flex items-center justify-center" title="WhatsApp">
                  <MessageCircle className="w-[18px] h-[18px] text-white" />
                </div>
                <div className="w-[34px] h-[34px] rounded-lg bg-[#c13584] flex items-center justify-center" title="Instagram">
                  <InstagramIcon className="w-[18px] h-[18px] text-white" />
                </div>
                <div className="w-[34px] h-[34px] rounded-lg bg-[#0a7cff] flex items-center justify-center" title="Messenger">
                  <MessengerIcon className="w-[18px] h-[18px] text-white" />
                </div>
              </div>

            </div>

            <div>

              <p className=" text-[13px] font-semibold text-indigo-200">Works with</p>
              <div className="mt-2.5 w-[34px] h-[34px] rounded-lg bg-[#5e8e3e] flex items-center justify-center" title="Shopify">
                <span className="text-white text-base font-bold leading-none">S</span>
              </div>
              <p className="mt-2 text-[13px] text-indigo-200">Built for Shopify brands</p>
            </div>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* RIGHT COLUMN: AUTHENTICATION FORM                        */}
      {/* ======================================================== */}
      {/* overflow-y-auto */}
      <div className="flex-1 flex flex-col  px-6 sm:px-10">
        <div className="flex-1 flex items-center justify-center py-10">
          <div className="w-full max-w-[380px]">
            {/* Mobile-only brand mark (left panel is hidden below lg) */}
            <div className="lg:hidden flex items-center gap-2.5 mb-10">
              <div className="relative w-8 h-8 rounded-lg bg-[#3440a8] flex items-center justify-center">
                <span className="text-white text-lg font-extrabold leading-none">U</span>
                <span className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-emerald-400" />
              </div>
              <span className="text-lg font-bold tracking-tight text-slate-900">UnoCX</span>
            </div>

            {/* Title & Subtitle */}
            <h1 className="text-3xl font-bold tracking-tight text-slate-900">
              {isSignin ? 'Sign in' : 'Create your account'}
            </h1>
            <p className="mt-2 text-[15px] text-slate-500">
              {isSignin ? 'Welcome back. Use your work email.' : 'Start your 14-day trial. Use your work email.'}
            </p>

            {/* Error Message Box */}
            {activeError && (
              <div className="mt-6 p-3 bg-rose-50 border border-rose-200 rounded-md flex items-start gap-2 text-sm text-rose-700 animate-in fade-in duration-150">
                <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                <div className="flex-1">{activeError}</div>
                <button
                  type="button"
                  onClick={() => {
                    setLocalError(null);
                    clearError();
                  }}
                  className="text-rose-400 hover:text-rose-700 font-bold ml-1 cursor-pointer"
                  aria-label="Dismiss error"
                >
                  ✕
                </button>
              </div>
            )}

            {/* Auth Form */}
            <form onSubmit={handleEmailSubmit} className="mt-7 space-y-5">
              {!isSignin && (
                <div>
                  <label htmlFor="name" className={labelClass}>
                    Full name
                  </label>
                  <input
                    id="name"
                    type="text"
                    required
                    placeholder='noctylle'
                    autoComplete="name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClass}
                  />
                </div>
              )}

              <div>
                <label htmlFor="email" className={labelClass}>
                  Work email
                </label>
                <input
                  id="email"
                  type="email"
                  placeholder='example@noctyle.com'
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className={inputClass}
                />
              </div>

              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <label htmlFor="password" aria-placeholder="password" className="text-sm text-slate-700">
                    Password
                  </label>
                  {isSignin && (
                    <button
                      type="button"
                      onClick={() => alert('Please contact administrator to reset credentials.')}
                      className="text-sm font-semibold text-[#3440a8] hover:text-[#283388] transition-colors cursor-pointer"
                    >
                      Forgot password?
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoComplete={isSignin ? 'current-password' : 'new-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${inputClass} pr-10`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="p-1 text-slate-400 hover:text-slate-600 absolute right-2.5 top-1/2 -translate-y-1/2 cursor-pointer transition-colors"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {isSignin && (
                <label className="flex items-center gap-3 cursor-pointer w-fit">
                  <input
                    type="checkbox"
                    checked={rememberMe}
                    onChange={(e) => setRememberMe(e.target.checked)}
                    className="w-[18px] h-[18px] accent-[#3440a8] cursor-pointer"
                  />
                  <span className="text-[15px] text-slate-800">Keep me signed in on this device</span>
                </label>
              )}

              {/* Submit Button */}
              <button
                type="submit"
                disabled={submitting || googleSubmitting}
                className="w-full h-11 bg-[#3440a8] hover:bg-[#2c3794] active:bg-[#283388] text-white font-semibold text-base rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin text-white" />
                    <span>{isSignin ? 'Signing in...' : 'Creating account...'}</span>
                  </>
                ) : (
                  <span>{isSignin ? 'Sign in' : 'Create account'}</span>
                )}
              </button>
            </form>

            {/* OR Divider */}
            <div className="flex items-center gap-6 py-7">
              <div className="flex-1 border-t border-slate-200" />
              <span className="text-sm text-slate-500">or</span>
              <div className="flex-1 border-t border-slate-200" />
            </div>

            {/* Continue with Google */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleSubmitting || submitting}
              className="w-full h-11 flex items-center justify-center gap-4 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-900 rounded-md text-base font-semibold border border-slate-300 transition-colors disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
            >
              {googleSubmitting ? (
                <Loader2 className="w-5 h-5 animate-spin text-[#3440a8]" />
              ) : (
                <span className="w-5 h-5 rounded-full border border-slate-300 flex items-center justify-center text-[11px] font-bold text-[#4285f4] leading-none">
                  G
                </span>
              )}
              <span>{googleSubmitting ? 'Signing in with Google...' : 'Continue with Google'}</span>
            </button>

            {/* Mode Switch */}
            <p className="mt-9 text-[15px] text-slate-700">
              {isSignin ? 'New to UnoCX?' : 'Already have an account?'}
              <button
                type="button"
                onClick={() => handleModeChange(isSignin ? 'signup' : 'signin')}
                className="ml-2 font-bold text-[#3440a8] hover:text-[#283388] hover:underline cursor-pointer"
              >
                {isSignin ? 'Start a 14-day trial' : 'Sign in'}
              </button>
            </p>
          </div>
        </div>

        {/* Footer Links */}
        <div className="w-full max-w-[380px] mx-auto pb-8 text-[13px] text-slate-400">
          <a href="#" className="hover:text-slate-600">Terms</a>
          <span className="mx-1.5">·</span>
          <a href="#" className="hover:text-slate-600">Privacy</a>
          <span className="mx-1.5">·</span>
          <a href="#" className="hover:text-slate-600">Help</a>
        </div>
      </div>
    </div>
  );
}