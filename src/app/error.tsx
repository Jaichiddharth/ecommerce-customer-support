'use client';

import { useEffect } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { clientLogger } from '@/lib/client-logger';

/**
 * Route-level error boundary: catches render errors in the app so one broken view
 * shows a recoverable message instead of a blank screen.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    clientLogger.error('app/error.tsx', 'Unhandled render error', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <div className="h-full w-full flex items-center justify-center bg-slate-50 p-6">
      <div role="alert" className="max-w-sm w-full bg-white border border-slate-200 rounded-2xl shadow-sm p-6 text-center space-y-3">
        <div className="w-12 h-12 mx-auto rounded-full bg-red-50 border border-red-100 flex items-center justify-center text-red-500">
          <AlertTriangle className="w-6 h-6" />
        </div>
        <div className="space-y-1">
          <h2 className="text-sm font-bold text-slate-900">This page ran into a problem</h2>
          <p className="text-xs text-slate-500">
            Something went wrong while showing this view. Your data is safe — try again, or reload the page.
          </p>
          {error.digest && <p className="text-[10px] text-slate-400 font-mono select-all">Ref {error.digest}</p>}
          {process.env.NODE_ENV !== 'production' && (
            <p className="text-[10px] text-red-500 font-mono break-all">{error.message}</p>
          )}
        </div>
        <div className="flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={reset}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-[#2563eb] hover:bg-blue-700 text-white rounded-lg text-xs font-semibold cursor-pointer"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Try again
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-3 py-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 rounded-lg text-xs font-semibold cursor-pointer"
          >
            Reload page
          </button>
        </div>
      </div>
    </div>
  );
}
