'use client';

import React, { useState } from 'react';
import { CreditCard, RefreshCw, Truck, User, X } from 'lucide-react';
import { ProductBrowser, type ShareProductArgs } from '../shopify/ProductBrowser';
import { ShopifyOrdersSection } from '../shopify/ShopifyOrdersSection';
import { ContactIdentities } from './ContactIdentities';
import {
  CHANNEL_LABELS,
  InboxConversation,
  confidenceLabel,
  contactIdentifier,
  conversationChannelType,
  formatDuration,
} from './inbox-types';

const CHANNEL_DOT: Record<string, string> = {
  whatsapp: 'bg-[#25d366]',
  instagram: 'bg-[#dd2a7b]',
  messenger: 'bg-[#0084ff]',
  email: 'bg-slate-400',
  webchat: 'bg-slate-400',
};

const NEW_CONTACT_DAYS = 30;

const SectionLabel: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <h4 className="text-[11px] font-semibold text-slate-500 tracking-wider">{children}</h4>
);

const Row: React.FC<{ label: string; value: React.ReactNode }> = ({ label, value }) => (
  <div className="flex items-center justify-between gap-3 text-[12.5px]">
    <span className="text-slate-500">{label}</span>
    <span className="text-slate-800 text-right truncate">{value}</span>
  </div>
);

/** Not built yet: tracking links, exchanges, payment links and cancellations need Shopify write access */
const QUICK_ACTIONS = [
  { label: 'Share tracking link', icon: Truck },
  { label: 'Start size exchange', icon: RefreshCw },
  { label: 'Send payment link', icon: CreditCard },
];

interface CustomerPanelProps {
  conversation: InboxConversation | null;
  lastAiAction?: string | null;
  shopify: { connected: boolean; needsReauth: boolean };
  onShareProduct: (args: ShareProductArgs) => Promise<boolean>;
  onInsertProductText: (text: string) => void;
  shareDisabledReason?: string | null;
}

type PanelView = 'details' | 'products';

export const CustomerPanel: React.FC<CustomerPanelProps> = ({
  conversation,
  lastAiAction,
  shopify,
  onShareProduct,
  onInsertProductText,
  shareDisabledReason,
}) => {
  const [view, setView] = useState<PanelView>('details');
  // Bumped when channels are linked or unlinked, so the orders reload for the (possibly different) Shopify customer
  const [profileVersion, setProfileVersion] = useState(0);

  if (!conversation) {
    return (
      <aside className="hidden xl:flex w-[285px] bg-white border-l border-slate-200 shrink-0 h-full flex-col items-center justify-center text-center p-6">
        <div className="w-11 h-11 rounded-full bg-slate-100 text-slate-400 flex items-center justify-center mb-3">
          <User className="w-5 h-5" />
        </div>
        <p className="text-[13px] font-semibold text-slate-700">No conversation selected</p>
        <p className="text-xs text-slate-400 mt-1 max-w-[200px]">Customer details and AI agent activity show up here.</p>
      </aside>
    );
  }

  const type = conversationChannelType(conversation);
  const isNewContact = Date.now() - new Date(conversation.customer.createdAt).getTime() < NEW_CONTACT_DAYS * 86400000;
  const customerSince = new Date(conversation.customer.createdAt).toLocaleDateString([], { month: 'short', year: 'numeric' });
  const identifier = contactIdentifier(conversation);

  const aiBadge = conversation.needsHuman
    ? { label: 'Needs human', className: 'bg-amber-50 text-amber-700' }
    : conversation.handledBy === 'ai'
      ? { label: 'Active', className: 'bg-[#eef0fb] text-[#3440a8]' }
      : { label: 'Paused', className: 'bg-slate-100 text-slate-600' };

  const actionsValue =
    conversation.aiActionsCount > 0
      ? `${conversation.aiActionsCount}${lastAiAction ? ` · ${lastAiAction}` : ''}`
      : '—';

  const timeToResolve = conversation.resolvedAt
    ? formatDuration(new Date(conversation.resolvedAt).getTime() - new Date(conversation.createdAt).getTime())
    : 'In progress';

  const viewTabs = (
    <div className="flex border-b border-slate-200 shrink-0" role="tablist">
      {(['details', 'products'] as PanelView[]).map((v) => (
        <button
          key={v}
          type="button"
          role="tab"
          aria-selected={view === v}
          onClick={() => setView(v)}
          className={`flex-1 py-2.5 text-[12.5px] font-semibold cursor-pointer border-b-2 -mb-px ${view === v ? 'border-[#3440a8] text-[#3440a8]' : 'border-transparent text-slate-500 hover:text-slate-800'
            }`}
        >
          {v === 'details' ? 'Details' : 'Products'}
        </button>
      ))}
    </div>
  );

  if (view === 'products') {
    return (
      <aside className="hidden xl:flex w-[285px] bg-white border-l border-slate-200 shrink-0 h-full flex-col">
        {viewTabs}
        {shopify.connected ? (
          <ProductBrowser
            className="flex-1 p-3"
            onShare={onShareProduct}
            onInsertText={onInsertProductText}
            shareDisabledReason={shareDisabledReason}
          />
        ) : (
          <p className="m-4 rounded-lg bg-slate-100/80 px-3 py-2.5 text-xs text-slate-600 leading-relaxed">
            {shopify.needsReauth
              ? 'The Shopify connection has expired. Reconnect the store from Integrations.'
              : 'Connect your Shopify store from Integrations to search and share products.'}
          </p>
        )}
      </aside>
    );
  }

  return (
    <aside className="hidden xl:flex w-[285px] bg-white border-l border-slate-200 shrink-0 h-full flex-col overflow-y-auto select-none">
      {viewTabs}
      {/* Customer */}
      <section className="p-4 border-b border-slate-100">
        <SectionLabel>CUSTOMER</SectionLabel>
        <p className="mt-1.5 text-[16px] font-bold text-slate-900 truncate">{conversation.customer.name}</p>
        <p className="text-xs text-slate-500">
          {isNewContact ? 'New contact' : `Customer since ${customerSince}`}
        </p>
        {identifier && (
          <p className="mt-2 text-xs text-slate-700 flex items-center gap-1.5 truncate">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${CHANNEL_DOT[type] || 'bg-slate-400'}`} />
            <span className="truncate" title={CHANNEL_LABELS[type]}>
              {identifier}
            </span>
          </p>
        )}
        {conversation.customer.email && identifier !== conversation.customer.email && (
          <p className="mt-1 text-xs text-slate-500 truncate">{conversation.customer.email}</p>
        )}
        {conversation.channel?.status === 'disconnected' && (
          <div className="mt-2.5 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-800 font-medium flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-amber-500 shrink-0" />
            <span>Channel disconnected · Messaging paused</span>
          </div>
        )}
      </section>

      {/* AI agent */}
      <section className="p-4 border-b border-slate-100 space-y-2.5">
        <div className="flex items-center justify-between">
          <SectionLabel>AI AGENT</SectionLabel>
          <span className={`px-2 py-0.5 rounded-full text-[11px] font-medium ${aiBadge.className}`}>{aiBadge.label}</span>
        </div>
        <Row label="Intent" value={conversation.aiIntent || '—'} />
        <Row label="Confidence" value={confidenceLabel(conversation.aiConfidence)} />
        <Row label="Actions" value={actionsValue} />
        <Row label="Model" value={conversation.aiModel || '—'} />
        <Row label="Time to resolve" value={timeToResolve} />
      </section>

      {/* Shopify orders of the linked customer */}
      <section className="p-4 border-b border-slate-100 select-text">
        <SectionLabel>ORDERS</SectionLabel>
        <ShopifyOrdersSection
          key={`${conversation.customer.id}:${profileVersion}`}
          contact={conversation.customer}
          storeConnected={shopify.connected}
          storeNeedsReauth={shopify.needsReauth}
        />
      </section>

      {/* Quick actions */}
      <section className="p-4 space-y-2">
        <SectionLabel>QUICK ACTIONS</SectionLabel>
        <div className="pt-0.5 space-y-2">
          {QUICK_ACTIONS.map(({ label, icon: Icon }) => (
            <button
              key={label}
              disabled
              title="Coming soon"
              className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-slate-200 text-[13px] text-slate-800 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <Icon className="w-4 h-4 text-slate-600" />
              {label}
            </button>
          ))}
          <button
            disabled
            title="Coming soon"
            className="w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg border border-red-200 text-[13px] text-red-600 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <X className="w-4 h-4" />
            Cancel order
          </button>
        </div>
        <p className="text-[11px] text-slate-400 pt-1">Quick actions are coming soon.</p>
      </section>
    </aside>
  );
};
