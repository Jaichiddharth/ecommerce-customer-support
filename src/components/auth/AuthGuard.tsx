'use client';

import React, { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../context/AuthContext';
import { MessageSquare, Loader2 } from 'lucide-react';

interface AuthGuardProps {
  children: React.ReactNode;
}

export const AuthGuard: React.FC<AuthGuardProps> = ({ children }) => {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-[#0f172a] text-white">
        <div className="flex flex-col items-center gap-4">
          <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-[#2563eb] to-[#4f46e5] flex items-center justify-center text-white shadow-xl shadow-blue-900/40 animate-pulse font-black text-2xl">
            O
          </div>
          <div className="flex items-center gap-2 text-slate-300 text-sm font-medium">
            <Loader2 className="w-4 h-4 animate-spin text-[#2563eb]" />
            <span>Loading Omnichannel Workspace...</span>
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return null; // Will redirect via useEffect
  }

  return <>{children}</>;
};
