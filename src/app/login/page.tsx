'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import {
  MessageSquare,
  Eye,
  EyeOff,
  Loader2,
  AlertCircle,
  Zap,
} from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const { user, loading: authLoading, error, loginWithEmail, signupWithEmail, loginWithGoogle, clearError } = useAuth();

  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('admin@gmail.com');
  const [password, setPassword] = useState('admin@123');
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

  const handleAutofill = () => {
    setEmail('admin@gmail.com');
    setPassword('admin@123');
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

  return (
    <div className="min-h-screen w-screen flex bg-white font-sans text-slate-900 overflow-hidden select-none">
      {/* ======================================================== */}
      {/* LEFT COLUMN: HERO IMAGE & TESTIMONIAL                    */}
      {/* ======================================================== */}
      <div className="hidden lg:relative lg:flex lg:w-1/2 flex-col justify-between p-10 xl:p-14 overflow-hidden bg-slate-900">
        {/* Background Image with Ambient Gradient Overlay */}
        <img
          src="/images/login-hero.jpg"
          alt="Omnichannel Support Office"
          className="absolute inset-0 w-full h-full object-cover object-center"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/25 to-black/50" />

        {/* Top-Left: Brand Logo */}
        <div className="relative z-10 flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-lg bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center text-white shadow-sm">
            <MessageSquare className="w-4 h-4 stroke-[2.5]" />
          </div>
          <span className="text-lg font-bold text-white tracking-tight drop-shadow-sm">
            Omnichannel
          </span>
        </div>

        {/* Bottom-Left: Testimonial & Quote */}
        <div className="relative z-10 max-w-lg">
          <h2 className="text-2xl xl:text-3xl font-bold text-white tracking-tight leading-snug drop-shadow-md mb-4">
            &ldquo;Simply all the tools that my team and I need.&rdquo;
          </h2>
          <div className="space-y-0.5">
            <p className="text-sm font-bold text-white drop-shadow-sm">
              Sarah Jenkins
            </p>
            <p className="text-xs text-slate-300 font-medium drop-shadow-sm">
              Head of Customer Operations
            </p>
          </div>
        </div>
      </div>

      {/* ======================================================== */}
      {/* RIGHT COLUMN: AUTHENTICATION FORM                        */}
      {/* ======================================================== */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-10 md:p-14 overflow-y-auto">
        <div className="w-full max-w-[420px] mx-auto py-4">
          {/* Main Title & Subtitle */}
          <div className="text-center mb-6">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-slate-900 tracking-tight">
              {mode === 'signin' ? 'Welcome Back to Omnichannel' : 'Create your Account'}
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 mt-2 max-w-sm mx-auto leading-relaxed">
              Connect your customer channels effortlessly with our powerful support desk.
            </p>
          </div>

          {/* DEMO ACCESS CREDENTIALS CARD */}
          <div className="bg-[#f0f4ff] border border-[#dbeafe] rounded-2xl p-3.5 sm:p-4 mb-5 shadow-2xs">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5 text-[11px] font-bold text-[#4f46e5] tracking-wider uppercase">
                <Zap className="w-3.5 h-3.5 fill-[#4f46e5] text-[#4f46e5]" />
                <span>Demo Access Credentials</span>
              </div>
              <button
                type="button"
                onClick={handleAutofill}
                className="text-[11px] font-semibold text-[#4f46e5] bg-white border border-[#c7d2fe] hover:bg-[#e0e7ff]/60 px-2.5 py-0.5 rounded-md transition-all shadow-2xs cursor-pointer active:scale-95"
              >
                Auto-fill
              </button>
            </div>

            <div className="space-y-1.5 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <span className="text-slate-500 text-[11px] w-16">Email:</span>
                <span className="font-mono bg-white px-2 py-0.5 rounded border border-[#e0e7ff] text-slate-800 text-[11px] font-medium select-all">
                  admin@gmail.com
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-500 text-[11px] w-16">Password:</span>
                <span className="font-mono bg-white px-2 py-0.5 rounded border border-[#e0e7ff] text-slate-800 text-[11px] font-medium select-all">
                  admin@123
                </span>
              </div>
            </div>
          </div>

          {/* Error Message Box */}
          {activeError && (
            <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-xs text-rose-700 animate-in fade-in duration-150">
              <AlertCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
              <div className="flex-1">{activeError}</div>
              <button
                type="button"
                onClick={() => {
                  setLocalError(null);
                  clearError();
                }}
                className="text-rose-400 hover:text-rose-700 font-bold ml-1 cursor-pointer"
              >
                ✕
              </button>
            </div>
          )}

          {/* Auth Form */}
          <form onSubmit={handleEmailSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                  Full Name
                </label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Sarah Jenkins"
                  className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#5b51d8]/20 focus:border-[#5b51d8] transition-all"
                />
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Email
              </label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="admin@gmail.com"
                className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#5b51d8]/20 focus:border-[#5b51d8] transition-all"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full pl-3.5 pr-10 py-2.5 text-sm bg-white border border-slate-200 rounded-xl text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[#5b51d8]/20 focus:border-[#5b51d8] transition-all"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="p-1 text-slate-400 hover:text-slate-600 absolute right-3 top-1/2 -translate-y-1/2 cursor-pointer transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Forgot Password Link */}
            {mode === 'signin' && (
              <div className="pt-0.5">
                <button
                  type="button"
                  onClick={() => alert('Please contact administrator to reset credentials.')}
                  className="text-xs font-semibold text-[#5b51d8] hover:text-[#4338ca] transition-colors cursor-pointer"
                >
                  Forgot password?
                </button>
              </div>
            )}

            {/* Remember sign in details toggle switch */}
            <div className="flex items-center justify-between pt-1">
              <span className="text-xs font-medium text-slate-600">
                Remember sign in details
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={rememberMe}
                onClick={() => setRememberMe(!rememberMe)}
                className={`w-10 h-5.5 flex items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out cursor-pointer ${
                  rememberMe ? 'bg-[#5b51d8]' : 'bg-slate-300'
                }`}
              >
                <div
                  className={`bg-white w-4.5 h-4.5 rounded-full shadow-md transform transition-transform duration-200 ease-in-out ${
                    rememberMe ? 'translate-x-4.5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={submitting || googleSubmitting}
              className="w-full mt-2 py-3 bg-[#5b51d8] hover:bg-[#4f46e5] active:bg-[#4338ca] text-white font-bold text-sm rounded-xl shadow-md shadow-indigo-600/25 transition-all hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer flex items-center justify-center gap-2"
            >
              {submitting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin text-white" />
                  <span>Processing...</span>
                </>
              ) : (
                <span>{mode === 'signin' ? 'Log in' : 'Create Account'}</span>
              )}
            </button>
          </form>

          {/* OR Divider */}
          <div className="relative flex py-4 items-center">
            <div className="flex-grow border-t border-slate-200"></div>
            <span className="flex-shrink mx-3 text-[11px] font-bold text-slate-400 uppercase tracking-widest">
              OR
            </span>
            <div className="flex-grow border-t border-slate-200"></div>
          </div>

          {/* Continue with Google */}
          <button
            type="button"
            onClick={handleGoogleSignIn}
            disabled={googleSubmitting || submitting}
            className="w-full flex items-center justify-center gap-2.5 py-2.5 px-4 bg-white hover:bg-slate-50 active:bg-slate-100 text-slate-700 rounded-xl text-xs font-bold border border-slate-200 shadow-2xs transition-all hover:border-slate-300 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
          >
            {googleSubmitting ? (
              <Loader2 className="w-4 h-4 animate-spin text-[#5b51d8]" />
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
            <span>{googleSubmitting ? 'Signing in with Google...' : 'Continue with Google'}</span>
          </button>

          {/* Mode Switch Footnote */}
          <div className="mt-6 text-center text-xs text-slate-500">
            {mode === 'signin' ? (
              <p>
                Don't have an account?{' '}
                <button
                  type="button"
                  onClick={() => handleModeChange('signup')}
                  className="text-[#5b51d8] hover:text-[#4338ca] font-bold hover:underline cursor-pointer ml-0.5"
                >
                  Sign up
                </button>
              </p>
            ) : (
              <p>
                Already have an account?{' '}
                <button
                  type="button"
                  onClick={() => handleModeChange('signin')}
                  className="text-[#5b51d8] hover:text-[#4338ca] font-bold hover:underline cursor-pointer ml-0.5"
                >
                  Log in
                </button>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
