'use client';

import React, { useEffect, useState } from 'react';
import { AuthGuard } from '../components/auth/AuthGuard';
import { Sidebar, TabType } from '../components/Sidebar';
import { DashboardView } from '../components/DashboardView';
import { InboxView, InboxCounts } from '../components/InboxView';
import { IntegrationsView, IntegrationKey } from '../components/integrations/IntegrationsView';
import { SettingsView } from '../components/SettingsView';
import { TemplatesView } from '../components/templates/TemplatesView';
import { gooeyToast } from '@/components/ui/goey-toaster';

export default function Home() {
  const [activeTab, setActiveTab] = useState<TabType>('inbox');
  const [selectedConversationId, setSelectedConversationId] = useState<string>('');
  const [inboxCounts, setInboxCounts] = useState<InboxCounts>({ unread: 0, ai: 0 });
  const [openIntegration, setOpenIntegration] = useState<IntegrationKey | null>(null);

  // Picking a sidebar item always lands on its main page (e.g. Integrations shows the grid again)
  const selectTab = (tab: TabType) => {
    setActiveTab(tab);
    setOpenIntegration(null);
  };

  // Shopify's OAuth callback redirects to /?tab=integrations&integration=shopify&shopify=connected|error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tab') === 'integrations') {
      setActiveTab('integrations');
      if (params.get('integration') === 'shopify') setOpenIntegration('shopify');
    }
    if (params.get('tab') === 'templates') {
      setActiveTab('templates');
    }
    const result = params.get('shopify');
    if (result === 'connected') {
      gooeyToast.success('Shopify store connected', { description: params.get('shop') ?? undefined });
    } else if (result === 'error') {
      gooeyToast.error("Couldn't connect Shopify", {
        description: params.get('message') || 'The Shopify authorization failed. Please try again.',
      });
    }
    if (params.has('tab') || params.has('integration') || result) window.history.replaceState(null, '', window.location.pathname);
  }, []);

  return (
    <AuthGuard>
      <div className="flex h-screen w-screen overflow-hidden bg-white font-sans text-slate-900 antialiased">
        <Sidebar
          activeTab={activeTab}
          setActiveTab={selectTab}
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

            {activeTab === 'integrations' && (
              <IntegrationsView openIntegration={openIntegration} onOpenIntegration={setOpenIntegration} />
            )}

            {activeTab === 'templates' && <TemplatesView />}

            {activeTab === 'settings' && (
              <SettingsView
                onOpenConversation={(id) => {
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
