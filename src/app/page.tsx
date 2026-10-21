'use client';

import React, { useEffect, useState } from 'react';
import { AuthGuard } from '../components/auth/AuthGuard';
import { Sidebar, TabType } from '../components/Sidebar';
import { DashboardView } from '../components/DashboardView';
import { InboxView, InboxCounts } from '../components/InboxView';
import { ShopifyStoreView } from '../components/shopify/ShopifyStoreView';
import { gooeyToast } from '@/components/ui/goey-toaster';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('inbox');
  const [selectedConversationId, setSelectedConversationId] = useState<string>('');
  const [inboxCounts, setInboxCounts] = useState<InboxCounts>({ unread: 0, ai: 0 });

  // Shopify's OAuth callback redirects to /?tab=store&shopify=connected|error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'store') setActiveTab('store');
    const result = params.get('shopify');
    if (result === 'connected') {
      gooeyToast.success('Shopify store connected', { description: params.get('shop') ?? undefined });
    } else if (result === 'error') {
      gooeyToast.error("Couldn't connect Shopify", {
        description: params.get('message') || 'The Shopify authorization failed. Please try again.',
      });
    }
    if (params.has('tab') || result) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return (
    <AuthGuard>
      <div className="flex h-screen w-screen overflow-hidden bg-white font-sans text-slate-900 antialiased">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={setActiveTab}
          unreadCount={inboxCounts.unread}
          aiCount={inboxCounts.ai}
        />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden">
          <main className="flex-1 overflow-hidden h-full">
            {activeTab === 'inbox' && (
              <InboxView
                selectedConversationId={selectedConversationId}
                onSelectConversation={setSelectedConversationId}
                onCountsChange={setInboxCounts}
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

            {activeTab === 'store' && <ShopifyStoreView />}
          </main>
        </div>
      </div>
    </AuthGuard>
  );
}
