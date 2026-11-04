'use client';

import React from 'react';
import { AuthGuard } from '@/components/auth/AuthGuard';
import { Sidebar } from '@/components/Sidebar';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <AuthGuard>
      <div className="flex h-screen w-screen overflow-hidden bg-white font-sans text-slate-900 antialiased">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <main className="flex-1 overflow-hidden h-full">
            {children}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}

