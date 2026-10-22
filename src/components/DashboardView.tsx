'use client';

import React, { useState } from 'react';
import { Rocket, X, Sparkles } from 'lucide-react';
import { TabType } from './Sidebar';

interface DashboardViewProps {
  setActiveTab: (tab: TabType) => void;
  onSelectConversation: (id: string) => void;
}

export const DashboardView: React.FC<DashboardViewProps> = () => {
  const [showPopup, setShowPopup] = useState(false);

  return (
    <>
      {/* Page */}
      <div
        className="flex flex-col items-center justify-center h-full min-h-[60vh] cursor-pointer select-none"
        onClick={() => setShowPopup(true)}
      >
        <div className="flex flex-col items-center gap-4 text-center px-6">
          <div className="w-20 h-20 rounded-2xl bg-slate-100 flex items-center justify-center shadow-sm">
            <Rocket className="w-9 h-9 text-slate-400" />
          </div>
          <div>
            <h2 className="text-xl font-bold text-slate-800">Home</h2>
            <p className="text-sm text-slate-400 mt-1">Analytics dashboard coming soon</p>
          </div>
        </div>
      </div>

      {/* Coming Soon Popup */}
      {showPopup && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => setShowPopup(false)}
        >
          <div
            className="relative bg-white rounded-2xl shadow-2xl p-8 mx-4 max-w-sm w-full flex flex-col items-center gap-4 text-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close */}
            <button
              onClick={() => setShowPopup(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-slate-600 transition-colors"
              aria-label="Close"
            >
              <X className="w-5 h-5" />
            </button>

            {/* Icon */}
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg">
              <Sparkles className="w-8 h-8 text-white" />
            </div>

            {/* Text */}
            <div>
              <h3 className="text-lg font-bold text-slate-900">Coming Soon</h3>
              <p className="text-sm text-slate-500 mt-1.5 leading-relaxed">
                The analytics dashboard is under construction. We&apos;re working on real-time insights and performance metrics for your workspace.
              </p>
            </div>

            {/* CTA */}
            <button
              onClick={() => setShowPopup(false)}
              className="mt-2 px-6 py-2.5 rounded-xl bg-slate-900 hover:bg-slate-700 text-white text-sm font-semibold transition-colors"
            >
              Got it
            </button>
          </div>
        </div>
      )}
    </>
  );
};
