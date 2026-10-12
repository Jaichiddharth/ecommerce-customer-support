'use client';

import React from 'react';
import { AlertTriangle, RefreshCw, WifiOff, Lock, Loader2 } from 'lucide-react';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { errorTitle } from '@/lib/api/notify';

const isDev = process.env.NODE_ENV !== 'production';

interface ErrorStateProps {
  /** Anything caught (ApiError, AxiosError, Error, string). */
  error: unknown;
  /** Heading used when the error has no specific title of its own (e.g. "Couldn't load messages"). */
  title?: string;
  onRetry?: () => void;
  retrying?: boolean;
  /** Smaller variant for sidebars and narrow panels. */
  compact?: boolean;
  className?: string;
}

/**
 * Inline error panel used in place of content that failed to load.
 * Shows a user-friendly message, a Retry button, the request reference, and (in development) where it failed.
 */
export function ErrorState({ error, title, onRetry, retrying = false, compact = false, className = '' }: ErrorStateProps) {
  const apiError: ApiError = typeof error === 'string'
    ? toApiError(new Error(error))
    : toApiError(error);
  const message = typeof error === 'string' ? error : apiError.message;
  const Icon = apiError.source === 'network' ? WifiOff : apiError.isAuthError ? Lock : AlertTriangle;

  return (
    <div
      role="alert"
      className={`flex flex-col items-center justify-center text-center gap-2.5 ${compact ? 'p-4' : 'p-8'} ${className}`}
    >
      <div className={`${compact ? 'w-8 h-8' : 'w-10 h-10'} rounded-full bg-red-50 border border-red-100 flex items-center justify-center text-red-500`}>
        <Icon className={compact ? 'w-4 h-4' : 'w-5 h-5'} />
      </div>
      <div className="space-y-0.5">
        <p className={`font-bold text-slate-700 ${compact ? 'text-[11px]' : 'text-xs'}`}>{apiError.title ?? title ?? errorTitle(apiError)}</p>
        <p className={`text-slate-500 mx-auto ${compact ? 'text-[10px] max-w-[180px]' : 'text-[11px] max-w-xs'}`}>{message}</p>
        {apiError.requestId && (
          <p className="text-[10px] text-slate-400 font-mono select-all">Ref {apiError.requestId}</p>
        )}
        {isDev && apiError.debug?.origin && (
          <p className="text-[10px] text-slate-400 font-mono break-all max-w-xs mx-auto" title={apiError.debug.cause}>
            {apiError.debug.origin}
          </p>
        )}
      </div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          disabled={retrying}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer transition-colors disabled:opacity-60 disabled:cursor-wait"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${retrying ? 'animate-spin' : ''}`} />
          <span>{retrying ? 'Retrying…' : 'Try again'}</span>
        </button>
      )}
    </div>
  );
}

interface EmptyStateProps {
  icon?: React.ReactNode;
  title: string;
  description?: React.ReactNode;
  action?: React.ReactNode;
  compact?: boolean;
  className?: string;
}

/** "Nothing here yet" panel — use only when the data loaded successfully and is empty. */
export function EmptyState({ icon, title, description, action, compact = false, className = '' }: EmptyStateProps) {
  return (
    <div className={`flex flex-col items-center justify-center text-center gap-3 text-slate-400 ${compact ? 'p-4' : 'p-8'} ${className}`}>
      {icon && (
        <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center text-slate-400">{icon}</div>
      )}
      <div>
        <p className="font-bold text-slate-700 text-xs mb-0.5">{title}</p>
        {description && <p className="text-[11px] text-slate-400 max-w-[220px] mx-auto">{description}</p>}
      </div>
      {action}
    </div>
  );
}

/** Spinner + label for loading panels. */
export function LoadingState({ label = 'Loading…', compact = false, className = '' }: { label?: string; compact?: boolean; className?: string }) {
  return (
    <div className={`flex flex-col items-center justify-center gap-2 text-slate-400 ${compact ? 'p-4' : 'p-8'} ${className}`}>
      <Loader2 className="w-5 h-5 animate-spin text-[#2563eb]" />
      <span className="text-[11px] text-slate-500">{label}</span>
    </div>
  );
}
