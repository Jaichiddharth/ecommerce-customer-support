'use client';

import React, { useState } from 'react';
import { AuthGuard } from '../components/auth/AuthGuard';
import { TabType } from '../components/Sidebar';
import { DashboardView } from '../components/DashboardView';
import { InboxView } from '../components/InboxView';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('inbox');
  const [selectedConversationId, setSelectedConversationId] = useState<string>('');

  return (
    <AuthGuard>
      <div className="flex h-screen w-screen overflow-hidden bg-white font-sans text-slate-900 antialiased">
        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          {/* View Switcher */}
          <main className="flex-1 overflow-hidden h-full">
            {activeTab === 'inbox' && (
              <InboxView
                selectedConversationId={selectedConversationId}
                onSelectConversation={setSelectedConversationId}
              />
            )}

            {activeTab === 'dashboard' && (
              <DashboardView
                setActiveTab={setActiveTab}
                onSelectConversation={(id) => {
                  setSelectedConversationId(id);
                  setActiveTab('inbox');
                }}
              />
            )}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}

