'use client';

import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ShopifyIntegrationView, ShopifyLogo } from '../shopify/ShopifyIntegrationView';
import { useShopifyStore } from '../shopify/useShopifyStore';

export type IntegrationKey = 'shopify';

interface IntegrationDefinition {
  key: IntegrationKey;
  name: string;
  category: string;
  description: string;
  logo: React.ReactNode;
}

/** Platforms that can be connected to UnoCX; add new ones here and render their page in IntegrationsView */
const INTEGRATIONS: IntegrationDefinition[] = [
  {
    key: 'shopify',
    name: 'Shopify',
    category: 'E-commerce',
    description: 'Share products in chats and see customer orders beside every conversation.',
    logo: <ShopifyLogo />,
  },
];

interface IntegrationStatus {
  connected: boolean;
  label: string;
  needsAttention?: boolean;
}

interface IntegrationsViewProps {
  /** The integration whose page is open, or null for the grid */
  openIntegration: IntegrationKey | null;
  onOpenIntegration: (key: IntegrationKey | null) => void;
}

export const IntegrationsView: React.FC<IntegrationsViewProps> = ({ openIntegration, onOpenIntegration }) => {
  const shopify = useShopifyStore();

  if (openIntegration === 'shopify') return <ShopifyIntegrationView onBack={() => onOpenIntegration(null)} />;

  const shopifyAttention = shopify.stores.some((s) => s.status !== 'connected' || s.missingScopes.length > 0);
  const statuses: Record<IntegrationKey, IntegrationStatus | null> = {
    shopify: shopify.isLoading
      ? null
      : shopify.stores.length > 0
        ? {
            connected: true,
            needsAttention: shopifyAttention,
            label: shopifyAttention
              ? 'Needs attention'
              : `${shopify.stores.length} ${shopify.stores.length === 1 ? 'store' : 'stores'} connected`,
          }
        : { connected: false, label: 'Not connected' },
  };

  return (
    <div className="h-full overflow-y-auto bg-slate-50/60">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        <h1 className="text-xl font-bold text-slate-900">Integrations</h1>
        <p className="mt-1 text-[13px] text-slate-500">Connect the tools your business runs on to bring their data into UnoCX.</p>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {INTEGRATIONS.map((integration) => {
            const status = statuses[integration.key];
            return (
              <button
                key={integration.key}
                type="button"
                onClick={() => onOpenIntegration(integration.key)}
                className="group text-left bg-white rounded-2xl border border-slate-200 hover:border-[#3440a8] hover:shadow-sm p-5 flex flex-col gap-4 cursor-pointer transition-all"
              >
                <div className="flex items-start justify-between gap-3">
                  {integration.logo}
                  <span className="text-[11px] font-semibold text-slate-500 bg-slate-100 rounded-full px-2.5 py-1">{integration.category}</span>
                </div>
                <div className="min-w-0">
                  <h2 className="text-[15px] font-bold text-slate-900">{integration.name}</h2>
                  <p className="mt-1 text-xs text-slate-500 leading-relaxed">{integration.description}</p>
                </div>
                <div className="mt-auto pt-3 border-t border-slate-100 flex items-center justify-between gap-2 text-xs">
                  {status ? (
                    <span
                      className={`inline-flex items-center gap-1.5 font-semibold ${
                        status.needsAttention ? 'text-amber-700' : status.connected ? 'text-emerald-700' : 'text-slate-500'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          status.needsAttention ? 'bg-amber-500' : status.connected ? 'bg-emerald-500' : 'bg-slate-300'
                        }`}
                      />
                      {status.label}
                    </span>
                  ) : (
                    <span className="text-slate-400">Checking…</span>
                  )}
                  <span className="inline-flex items-center gap-0.5 font-semibold text-[#3440a8]">
                    {status?.connected ? 'Manage' : 'Connect'}
                    <ChevronRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default IntegrationsView;
