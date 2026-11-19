'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Check, CheckCircle2, ChevronRight, Globe, KeyRound, Link2, Loader2, Lock, Package, Receipt, ShieldCheck } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/context/AuthContext';
import type { WooCommerceStoreInfo } from '@/lib/woocommerce/types';
import { ShopifyPageHeader as PageHeader, ShopifyPageShell as PageShell, ShopifyTabs as Tabs, primaryButtonClass } from '../shopify/ShopifyPageChrome';
import { useWooCommerceStores } from './useWooCommerceStores';

export const WOO_STATUS_BADGE: Record<string, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  reauth_required: { label: 'Reconnect needed', className: 'bg-amber-50 text-amber-700 border-amber-200' },
};

export const PERMISSION_LABEL: Record<string, string> = { read: 'Read', write: 'Write', read_write: 'Read/Write' };

/** Neutral mark for the WooCommerce card (no brand artwork is bundled) */
export const WooCommerceLogo: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => (
  <div className={`rounded-xl bg-[#7f54b3] flex items-center justify-center shrink-0 text-white font-extrabold text-[11px] tracking-tight ${className}`} aria-label="WooCommerce">
    Woo
  </div>
);

const STEPS = [
  { title: 'Enter your store address', text: 'UnoCX checks it is a WordPress site with WooCommerce and its REST API enabled.' },
  { title: 'Approve on your store', text: 'Your WordPress admin opens. Log in and click Approve. WooCommerce creates an API key just for UnoCX.' },
  { title: 'Key delivered automatically', text: 'WooCommerce sends the key straight to UnoCX over HTTPS. You never copy or paste keys.' },
  { title: 'Connect your numbers', text: 'Choose which WhatsApp number (or other channel) works with this store in Settings → Channels.' },
];

const ACTIONS = [
  { icon: KeyRound, title: 'Automatic API key generation', text: 'One click on your store creates and delivers a REST API key; no manual keys.', where: 'Ready', ready: true },
  { icon: Link2, title: 'One store per channel', text: 'Each number works with one store, on WooCommerce or Shopify.', where: 'Settings → Channels', ready: true },
  { icon: Package, title: 'Share products in chat', text: 'Search the catalog from the inbox and send products with image, price and link.', where: 'Coming soon', ready: false },
  { icon: Receipt, title: 'Orders beside the conversation', text: 'A matched customer’s recent orders with payment and shipping status.', where: 'Coming soon', ready: false },
];

type WooTab = 'details' | 'connections' | 'actions';

export const WooCommerceIntegrationView: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const { hasPermission, can } = useAuth();
  const canManage = hasPermission('manage_billing_and_integrations');
  const allowed = can('integrations', 'read') && canManage;
  const canConnect = can('integrations', 'create') && canManage;
  const { stores, configured, scope, isLoading, error, refresh } = useWooCommerceStores(allowed);
  const [tab, setTab] = useState<WooTab>('connections');
  const [showConnect, setShowConnect] = useState(false);
  const storeCount = useRef(stores.length);

  // The store's approval page opens in a new tab: pick up the new connection when the user comes back
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  useEffect(() => {
    if (stores.length > storeCount.current) {
      setShowConnect(false);
      setTab('connections');
    }
    storeCount.current = stores.length;
  }, [stores.length]);

  if (!allowed) {
    return (
      <PageShell>
        <PageHeader back={{ onClick: onBack, label: 'Back to Integrations' }} title="WooCommerce" />
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 mb-3">
            <Lock className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-slate-900">WooCommerce Integration Restricted</p>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">Your role does not have permission to manage billing and integrations.</p>
        </div>
      </PageShell>
    );
  }

  if (isLoading) return <LoadingState label="Loading WooCommerce…" className="h-full" />;
  if (error) return <ErrorState error={error} title="Couldn't load your WooCommerce connection" onRetry={refresh} className="h-full" />;

  if (stores.length === 0 || showConnect) {
    return (
      <PageShell>
        <PageHeader
          back={stores.length > 0 ? { onClick: () => setShowConnect(false), label: 'Back to connections' } : { onClick: onBack, label: 'Back to Integrations' }}
          title={stores.length > 0 ? 'Connect another WooCommerce store' : 'Connect your WooCommerce store'}
        />
        <div className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="max-w-5xl grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-5">
              <p className="text-[13px] text-slate-500">
                Connect a WordPress store running WooCommerce. UnoCX gets its own API key, generated by your store after you approve it.
              </p>
              {!configured ? (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2.5">
                  The WooCommerce integration isn&apos;t set up on this server yet. Ask your administrator to set WOOCOMMERCE_APP_URL to the app&apos;s public
                  HTTPS address.
                </p>
              ) : !canConnect ? (
                <p className="text-xs text-slate-600 bg-slate-100 rounded-lg px-3 py-2.5 flex items-center gap-2">
                  <Lock className="w-3.5 h-3.5 text-slate-400" /> Ask a workspace admin to connect your WooCommerce store.
                </p>
              ) : (
                <StoreUrlForm connectedStores={stores} />
              )}
              <section className="rounded-lg border border-slate-200 p-5">
                <h2 className="text-sm font-bold text-slate-900">How it works</h2>
                <ol className="mt-4 space-y-4">
                  {STEPS.map(({ title, text }, i) => (
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
            <RequirementsCard scope={scope} />
          </div>
        </div>
      </PageShell>
    );
  }

  return (
    <PageShell>
      <PageHeader
        back={{ onClick: onBack, label: 'Back to Integrations' }}
        title="WooCommerce"
        actions={
          canConnect && configured ? (
            <button type="button" onClick={() => setShowConnect(true)} className={primaryButtonClass}>
              Connect WooCommerce
            </button>
          ) : null
        }
      />
      <Tabs<WooTab>
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
          <ul className="divide-y divide-slate-200 border-b border-slate-200">
            {stores.map((store) => (
              <StoreRow key={store.id} store={store} />
            ))}
          </ul>
        )}
        {tab === 'details' && <AppDetails stores={stores} configured={configured} scope={scope} />}
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
                <span className={`shrink-0 text-[11px] font-semibold px-2 py-0.5 rounded-full ${ready ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
                  {where}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </PageShell>
  );
};

const StoreRow: React.FC<{ store: WooCommerceStoreInfo }> = ({ store }) => {
  const needsAttention = store.status !== 'connected';
  return (
    <li>
      <Link href={`/integrations/woocommerce/stores/${store.id}`} className="flex items-center gap-3 px-4 sm:px-5 py-3.5 hover:bg-slate-50">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-semibold text-slate-900 truncate">{store.name || store.storeHost}</span>
            {needsAttention && (
              <span className="inline-flex items-center gap-1 text-[10.5px] text-amber-700 bg-amber-50 rounded-full px-2 py-0.5 font-semibold">
                <AlertTriangle className="w-3 h-3" /> Reconnect needed
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 truncate">
            {store.storeHost}
            {store.currencyCode ? ` · ${store.currencyCode}` : ''}
            {store.keyPermissions ? ` · ${PERMISSION_LABEL[store.keyPermissions] ?? store.keyPermissions} key` : ''}
            {!store.isHttps && <span className="text-amber-700"> · Not HTTPS</span>}
          </p>
        </div>
        <ChevronRight className="w-4 h-4 text-slate-500 shrink-0" />
      </Link>
    </li>
  );
};

const AppDetails: React.FC<{ stores: WooCommerceStoreInfo[]; configured: boolean; scope: string }> = ({ stores, configured, scope }) => {
  const attention = stores.filter((s) => s.status !== 'connected').length;
  return (
    <div className="p-4 sm:p-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px] max-w-5xl">
      <div className="space-y-4 min-w-0">
        <section className="rounded-lg border border-slate-200 p-5 flex gap-4">
          <WooCommerceLogo className="w-12 h-12" />
          <div className="min-w-0">
            <h2 className="text-sm font-bold text-slate-900">WooCommerce</h2>
            <p className="mt-1 text-xs text-slate-500 leading-relaxed">
              Connect one or more WooCommerce stores. Each store generates its own API key for UnoCX through WooCommerce&apos;s application
              authentication, and each channel can work with one store.
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
              <dt className="text-slate-500">Server setup</dt>
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
      </div>
      <RequirementsCard scope={scope} />
    </div>
  );
};

const RequirementsCard: React.FC<{ scope: string }> = ({ scope }) => (
  <section className="rounded-lg border border-slate-200 p-5 self-start">
    <h2 className="text-sm font-bold text-slate-900">Your store needs</h2>
    <ul className="mt-4 space-y-4">
      {[
        { icon: <Globe className="w-3.5 h-3.5" />, title: 'A public HTTPS address', text: 'UnoCX calls your store’s REST API; HTTPS keeps the API key private.' },
        { icon: <Check className="w-3.5 h-3.5" />, title: 'WooCommerce 3.5 or later', text: 'With the WordPress REST API enabled (it is by default).' },
        { icon: <ShieldCheck className="w-3.5 h-3.5" />, title: 'An administrator login', text: 'Only a store admin can approve the API key.' },
        {
          icon: <KeyRound className="w-3.5 h-3.5" />,
          title: `${PERMISSION_LABEL[scope] ?? scope} API key`,
          text: 'Read access for products, customers and orders; write access lets UnoCX register order webhooks later.',
        },
      ].map(({ icon, title, text }) => (
        <li key={title} className="flex gap-3">
          <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">{icon}</span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-slate-900">{title}</p>
            <p className="text-xs text-slate-500">{text}</p>
          </div>
        </li>
      ))}
    </ul>
  </section>
);

/** Normalizes the typed address the same way the server does, for the "already connected" hint */
function toStoreHost(input: string): string {
  let value = input.trim().toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(value)) value = `https://${value}`;
  try {
    const url = new URL(value);
    const path = url.pathname.replace(/\/(wp-admin|wp-json|wp-login\.php|index\.php|wc-auth)(\/.*)?$/i, '').replace(/\/+$/, '');
    return `${url.hostname}${url.port ? `:${url.port}` : ''}${path}`;
  } catch {
    return value;
  }
}

const StoreUrlForm: React.FC<{ connectedStores: WooCommerceStoreInfo[] }> = ({ connectedStores }) => {
  const [input, setInput] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const typedHost = input.trim() ? toStoreHost(input) : '';
  const alreadyConnected = typedHost ? connectedStores.find((s) => s.storeHost === typedHost || s.storeHost === typedHost.replace(/^www\./, '')) : undefined;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || alreadyConnected) return;
    setIsConnecting(true);
    try {
      const res = await apiClient.post('/api/integrations/woocommerce/install', { storeUrl: input.trim() });
      // The store asks the admin to log in and approve, then WooCommerce returns them to /integrations/woocommerce
      window.open(res.data.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      notifyError(err, { where: 'WooCommerceIntegrationView.connect', title: "Couldn't start the WooCommerce connection" });
    } finally {
      setIsConnecting(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <label htmlFor="woocommerce-store-url" className="block text-xs text-slate-600 mb-1.5">
        Store address
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0 flex items-center bg-white border border-slate-300 rounded-lg focus-within:border-slate-500">
          <Globe className="w-4 h-4 text-slate-400 ml-3" />
          <input
            id="woocommerce-store-url"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="https://shop.example.com"
            autoComplete="off"
            spellCheck={false}
            inputMode="url"
            className="flex-1 min-w-0 px-2 py-2.5 bg-transparent text-[13px] outline-none"
          />
        </div>
        <button type="submit" disabled={isConnecting || !input.trim() || Boolean(alreadyConnected)} className={`sm:w-44 py-2.5 ${primaryButtonClass}`}>
          {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />} {isConnecting ? 'Checking store…' : 'Connect store'}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] text-slate-400">The address of your WordPress site, including the folder if WooCommerce is installed in one.</p>
      {alreadyConnected && (
        <p role="alert" className="mt-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 flex items-start gap-2">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 text-amber-600 shrink-0" />
          <span>
            <span className="font-semibold">{alreadyConnected.name || alreadyConnected.storeHost}</span> is already connected to this workspace.{' '}
            <Link href={`/integrations/woocommerce/stores/${alreadyConnected.id}`} className="font-semibold underline">
              Open store
            </Link>
          </span>
        </p>
      )}
    </form>
  );
};

export default WooCommerceIntegrationView;
