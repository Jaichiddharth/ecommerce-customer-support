'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Download,
  Link2,
  Loader2,
  Lock,
  Package,
  Receipt,
  Store,
  Users,
} from 'lucide-react';
import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/context/AuthContext';
import type { ShopifyStoreInfo } from '@/lib/shopify/types';
import { ShopifyPageHeader, ShopifyPageShell, ShopifyTabs, primaryButtonClass } from './ShopifyPageChrome';
import { useShopifyStore } from './useShopifyStore';
import { ShopifyAppAccessNote, hasFullOrderHistory, type ShopifyAppDistribution } from './OrderHistoryNotice';

const AFTER_INSTALL = [
  { title: 'Products in every chat', text: 'search your catalog by name or SKU and share it with price, image and link' },
  { title: 'Contacts linked to customers', text: 'match a WhatsApp contact to their Shopify customer by email or phone' },
  { title: 'Orders beside the conversation', text: 'see a linked customer’s recent orders, payment and fulfilment status' },
];

const WHAT_WE_READ = [
  { title: 'Products and variants', text: 'titles, options, prices, stock and images', scope: 'read_products' },
  { title: 'Customers', text: 'name, email, phone and tags, to link contacts', scope: 'read_customers' },
  {
    title: 'Orders',
    text: 'items, totals, payment and fulfilment status: the last 60 days, or the full history once Shopify approves read_all_orders',
    scope: 'read_orders',
  },
];

const ACTIONS = [
  { icon: Package, title: 'Share products in chat', text: 'Search the store’s catalog from the inbox and send a product with its image, price and link.', where: 'Inbox → Products', ready: true },
  { icon: Link2, title: 'Link contacts to customers', text: 'Contacts are matched to their Shopify customer by phone or email; agents can link one by hand.', where: 'Inbox → contact panel', ready: true },
  { icon: Receipt, title: 'Show orders beside the conversation', text: 'A linked customer’s recent orders with payment and fulfilment status.', where: 'Inbox → contact panel', ready: true },
  { icon: Users, title: 'Browse store customers and orders', text: 'Every store’s products, orders and customers, with each customer’s order history.', where: 'Connections → a store', ready: true },
  { icon: Clock, title: 'Share tracking link, start exchange, send payment link', text: 'Need write access to Shopify, which the app doesn’t ask for yet.', where: 'Coming soon', ready: false },
];

export const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  reauth_required: { label: 'Reconnect needed', className: 'bg-amber-50 text-amber-700 border-amber-200' },
};

export const ShopifyLogo: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => (
  <div className={`rounded-xl bg-white flex items-center justify-center shrink-0 border border-slate-200 overflow-hidden ${className}`}>
    <img src="/shopify-logo.png" alt="Shopify" className="w-full h-full object-contain p-1" />
  </div>
);

type ShopifyTab = 'details' | 'connections' | 'actions';

interface ShopifyIntegrationViewProps {
  /** Back to the Integrations grid */
  onBack: () => void;
}

export const ShopifyIntegrationView: React.FC<ShopifyIntegrationViewProps> = ({ onBack }) => {
  const { hasPermission, can } = useAuth();
  const canManage = hasPermission('manage_billing_and_integrations');
  const allowed = can('integrations', 'read') && canManage;
  const canConnect = can('integrations', 'create') && canManage;
  const { stores, configured, distribution, isLoading, error, refresh } = useShopifyStore();
  const [tab, setTab] = useState<ShopifyTab>('connections');
  const [showConnect, setShowConnect] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const storeCount = useRef(stores.length);

  // Shopify's approval page opens in a new tab: pick up the new connection when the user comes back
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  // A store was just connected: leave the connect page and show it in the list
  useEffect(() => {
    if (stores.length > storeCount.current) {
      setShowConnect(false);
      setTab('connections');
    }
    storeCount.current = stores.length;
  }, [stores.length]);

  if (!allowed) {
    return (
      <ShopifyPageShell>
        <ShopifyPageHeader back={{ onClick: onBack, label: 'Back to Integrations' }} title="Shopify" />
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 mb-3">
            <Lock className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-slate-900">Shopify Integration Restricted</p>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">
            Your role does not have permission to manage billing and integrations. Contact your workspace administrator.
          </p>
        </div>
      </ShopifyPageShell>
    );
  }

  if (isLoading) return <LoadingState label="Loading Shopify…" className="h-full" />;
  if (error) return <ErrorState error={error} title="Couldn't load your Shopify connection" onRetry={refresh} className="h-full" />;

  const startConnect = async (shop: string) => {
    if (!shop.trim()) return;
    setIsConnecting(true);
    try {
      const res = await apiClient.post('/api/integrations/shopify/install', { shop: shop.trim() });
      // Shopify asks the merchant to approve the permissions, then redirects back to /integrations/shopify
      window.open(res.data.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      notifyError(err, { where: 'ShopifyIntegrationView.startConnect', title: "Couldn't start the Shopify connection" });
    } finally {
      setIsConnecting(false);
    }
  };

  // ---------------------------------------------------------------
  // Connect a store (first store, or another one)
  // ---------------------------------------------------------------
  if (stores.length === 0 || showConnect) {
    return (
      <ShopifyPageShell>
        <ShopifyPageHeader
          back={stores.length > 0 ? { onClick: () => setShowConnect(false), label: 'Back to connections' } : { onClick: onBack, label: 'Back to Integrations' }}
          title={stores.length > 0 ? 'Connect another Shopify store' : 'Connect your Shopify store'}
        />
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-5xl grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-5">
              <p className="text-[13px] text-slate-500">
                UnoCX reads products, customers and orders so your team can answer and sell inside every conversation.
              </p>
              {!configured ? (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2.5">
                  The Shopify integration isn&apos;t set up on this server yet. Ask your administrator to add the Shopify app credentials.
                </p>
              ) : !canConnect ? (
                <p className="text-xs text-slate-600 bg-slate-100 rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-slate-400" /> Ask a workspace admin to connect your Shopify store or request create permissions.
                </p>
              ) : (
                <ShopAddressForm isConnecting={isConnecting} onSubmit={startConnect} connectedStores={stores} />
              )}
              {configured && distribution === 'private' && <ShopifyAppAccessNote distribution={distribution} />}
              <section className="rounded-lg border border-slate-200 p-5">
                <h2 className="text-sm font-bold text-slate-900">After install</h2>
                <ol className="mt-4 space-y-4">
                  {AFTER_INSTALL.map(({ title, text }, i) => (
                    <li key={title} className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-900">{title}</p>
                        <p className="text-xs text-slate-500">{text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>
            <WhatWeReadCard />
          </div>
        </div>
      </ShopifyPageShell>
    );
  }

  // ---------------------------------------------------------------
  // App details · Connections · Actions
  // ---------------------------------------------------------------
  const limitedStores = stores.filter((s) => !hasFullOrderHistory(s.scopes)).length;
  return (
    <ShopifyPageShell>
      <ShopifyPageHeader
        back={{ onClick: onBack, label: 'Back to Integrations' }}
        title="Shopify"
        actions={
          canConnect && configured ? (
            <button type="button" onClick={() => setShowConnect(true)} className={primaryButtonClass}>
              Connect shopify
            </button>
          ) : null
        }
      />
      <ShopifyTabs<ShopifyTab>
        active={tab}
        onChange={setTab}
        tabs={[
          { key: 'details', label: 'App Details' },
          { key: 'connections', label: 'Connections' },
          { key: 'actions', label: 'Actions' },
        ]}
      />
      <div className="flex-1 overflow-y-auto">
        {tab === 'connections' && (
          <>
            <ShopifyAppAccessNote
              distribution={distribution}
              limitedStores={limitedStores}
              className="mx-4 sm:mx-5 mt-4 mb-3"
            />
            <ul className="divide-y divide-slate-200 border-y border-slate-200">
              {stores.map((store) => (
                <StoreRow key={store.id} store={store} />
              ))}
            </ul>
          </>
        )}
        {tab === 'details' && <AppDetails stores={stores} configured={configured} distribution={distribution} />}
        {tab === 'actions' && (
          <ul className="divide-y divide-slate-200 border-b border-slate-200">
            {ACTIONS.map(({ icon: Icon, title, text, where, ready }) => (
              <li key={title} className="flex items-start gap-3 px-4 sm:px-5 py-3.5">
                <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                  <Icon className="w-4 h-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13px] font-semibold text-slate-900">{title}</p>
                  <p className="text-xs text-slate-500">{text}</p>
                </div>
                <span
                  className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${
                    ready ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {where}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </ShopifyPageShell>
  );
};

/** One connection: opens the store's page */
const StoreRow: React.FC<{ store: ShopifyStoreInfo }> = ({ store }) => {
  const needsAttention = store.status !== 'connected' || store.missingScopes.length > 0;
  return (
    <li>
      <Link href={`/integrations/shopify/stores/${store.id}`} className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-slate-50">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-900 truncate">{store.name || store.shopDomain}</span>
            {needsAttention && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 font-semibold">
                <AlertTriangle className="w-3 h-3" /> {store.status === 'reauth_required' ? 'Reconnect needed' : 'Permissions missing'}
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">
            {store.shopDomain}
            {store.currencyCode ? ` · ${store.currencyCode}` : ''}
            {' · '}
            {hasFullOrderHistory(store.scopes) ? (
              'Full order history'
            ) : (
              <span className="text-amber-700" title="Shopify shares only the last 60 days of orders until read_all_orders is approved">
                Orders: last 60 days
              </span>
            )}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
      </Link>
    </li>
  );
};

const AppDetails: React.FC<{ stores: ShopifyStoreInfo[]; configured: boolean; distribution: ShopifyAppDistribution }> = ({
  stores,
  configured,
  distribution,
}) => {
  const attention = stores.filter((s) => s.status !== 'connected' || s.missingScopes.length > 0).length;
  const appTypeBadge = 'text-[10.5px] font-semibold px-2 py-0.5 rounded-full bg-slate-100 text-slate-700';
  return (
    <div className="p-4 sm:p-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] max-w-5xl">
      <div className="space-y-4 min-w-0">
        <section className="rounded-lg border border-slate-200 p-5 flex gap-4">
          <ShopifyLogo className="w-12 h-12" />
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-bold text-slate-900">Shopify</h2>
              <span className={appTypeBadge}>{distribution === 'public' ? 'Public app' : 'Private app'}</span>
              <span className={appTypeBadge}>Non-embedded</span>
            </div>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Connect one or more Shopify stores so your team can share products, link chat contacts to Shopify customers and see their orders
              without leaving the conversation. Each WhatsApp channel can use its own store.
            </p>
          </div>
        </section>
        <section className="rounded-lg border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-900">Status</h2>
          <dl className="mt-3 grid sm:grid-cols-3 gap-4 text-xs">
            <div>
              <dt className="text-slate-500">Stores connected</dt>
              <dd className="mt-0.5 text-lg font-bold text-slate-900">{stores.length}</dd>
            </div>
            <div>
              <dt className="text-slate-500">Need attention</dt>
              <dd className={`mt-0.5 text-lg font-bold ${attention ? 'text-amber-600' : 'text-slate-900'}`}>{attention}</dd>
            </div>
            <div>
              <dt className="text-slate-500">App credentials</dt>
              <dd className="mt-1 inline-flex items-center gap-1 font-semibold">
                {configured ? (
                  <span className="text-emerald-700 inline-flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Configured
                  </span>
                ) : (
                  <span className="text-amber-700">Not configured</span>
                )}
              </dd>
            </div>
          </dl>
        </section>
        <section className="rounded-lg border border-slate-200 p-5">
          <h2 className="text-sm font-bold text-slate-900">What UnoCX changes</h2>
          <div className="mt-3 flex gap-3">
            <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
              <Lock className="w-3.5 h-3.5" />
            </span>
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-slate-900">Nothing</p>
              <p className="text-xs text-slate-500">Access is read-only. Your products, customers and orders are never edited.</p>
            </div>
          </div>
        </section>
      </div>
      <WhatWeReadCard />
    </div>
  );
};

const WhatWeReadCard: React.FC = () => (
  <section className="rounded-lg border border-slate-200 p-5 self-start">
    <h2 className="text-sm font-bold text-slate-900">What UnoCX reads</h2>
    <ul className="mt-4 space-y-4">
      {WHAT_WE_READ.map(({ title, text, scope }) => (
        <li key={title} className="flex gap-3">
          <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
            <Check className="w-3.5 h-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">{text}</p>
            <p className="mt-0.5 text-[10.5px] font-mono text-slate-400">{scope}</p>
          </div>
        </li>
      ))}
    </ul>
  </section>
);

/** "<handle>.myshopify.com" input; the server also accepts a full domain or admin URL pasted here */
/** "My-Store", "my-store.myshopify.com", "https://my-store.myshopify.com/admin" or an admin.shopify.com/store/... link → "my-store.myshopify.com" */
function toShopDomain(input: string): string {
  let value = input.trim().toLowerCase();
  const adminMatch = value.match(/admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/);
  if (adminMatch) return `${adminMatch[1]}.myshopify.com`;
  value = value.replace(/^https?:\/\//, '').split(/[/?#]/)[0];
  return /^[a-z0-9][a-z0-9-]*$/.test(value) ? `${value}.myshopify.com` : value;
}

const ShopAddressForm: React.FC<{
  isConnecting: boolean;
  onSubmit: (shop: string) => void;
  /** This workspace's live stores: typing one of them is blocked until it's disconnected */
  connectedStores: ShopifyStoreInfo[];
}> = ({ isConnecting, onSubmit, connectedStores }) => {
  const [shopInput, setShopInput] = useState('');
  const typedDomain = shopInput.trim() ? toShopDomain(shopInput) : '';
  const alreadyConnected = typedDomain ? connectedStores.find((s) => s.shopDomain.toLowerCase() === typedDomain) : undefined;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (alreadyConnected) return;
        onSubmit(shopInput);
      }}
    >
      <label htmlFor="shopify-store-address" className="block text-xs text-slate-600 mb-1.5">
        Shopify store address
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0 flex items-center bg-white border border-slate-300 rounded-lg focus-within:border-slate-500">
          <Store className="w-4 h-4 text-slate-400 ml-3" />
          <input
            id="shopify-store-address"
            value={shopInput}
            onChange={(e) => setShopInput(e.target.value)}
            placeholder="your-store"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 px-2 py-2.5 bg-transparent text-[13px] outline-none"
          />
          {!shopInput.includes('.') && <span className="pr-3 text-[13px] text-slate-400">.myshopify.com</span>}
        </div>
        <button type="submit" disabled={isConnecting || !shopInput.trim() || Boolean(alreadyConnected)} className={`sm:w-44 py-2.5 ${primaryButtonClass}`}>
          {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Install app
        </button>
      </div>
      {alreadyConnected && (
        <p role="alert" className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-600 shrink-0" />
          <span>
            <span className="font-semibold">{alreadyConnected.name || alreadyConnected.shopDomain}</span> is already connected to this
            workspace. Disconnect it first to connect it again
            {alreadyConnected.status === 'reauth_required' ? ', or reconnect it from its page' : ''}.{' '}
            <Link href={`/integrations/shopify/stores/${alreadyConnected.id}`} className="font-semibold underline">
              Open store
            </Link>
          </span>
        </p>
      )}
    </form>
  );
};

export default ShopifyIntegrationView;
