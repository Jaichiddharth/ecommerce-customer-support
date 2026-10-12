'use client';

import { useEffect } from 'react';
import { clientLogger } from '@/lib/client-logger';

/**
 * Last-resort boundary for errors in the root layout itself (replaces <html>/<body>).
 * Kept dependency-free so it renders even when providers or styles fail.
 */
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    clientLogger.error('app/global-error.tsx', 'Unhandled error in root layout', {
      message: error.message,
      digest: error.digest,
      stack: error.stack,
    });
  }, [error]);

  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f8fafc', color: '#0f172a' }}>
        <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <div role="alert" style={{ maxWidth: 380, textAlign: 'center', background: '#fff', border: '1px solid #e2e8f0', borderRadius: 16, padding: 24 }}>
            <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>The app couldn&apos;t load</h2>
            <p style={{ fontSize: 12, color: '#64748b', margin: '0 0 12px' }}>
              Something went wrong while starting the app. Please try again.
            </p>
            {error.digest && <p style={{ fontSize: 10, color: '#94a3b8', fontFamily: 'monospace' }}>Ref {error.digest}</p>}
            <button
              type="button"
              onClick={reset}
              style={{ marginTop: 8, padding: '8px 14px', fontSize: 12, fontWeight: 600, color: '#fff', background: '#2563eb', border: 0, borderRadius: 8, cursor: 'pointer' }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
