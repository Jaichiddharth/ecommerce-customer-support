'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Lock,
  Plus,
  ShieldAlert,
  Unplug,
} from 'lucide-react';
import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/context/AuthContext';
import type { ShopifyStoreInfo } from '@/lib/shopify/types';
import { notifyShopifyChanged, useShopifyStore } from './useShopifyStore';

const AFTER_INSTALL = [
  { title: 'Products in every chat', text: 'search your catalog by name or SKU and share it with price, image and link' },
  { title: 'Contacts linked to customers', text: 'match a WhatsApp contact to their Shopify customer by email or phone' },
  { title: 'Orders beside the conversation', text: 'see a linked customer’s recent orders, payment and fulfilment status' },
];

const WHAT_WE_READ = [
  { title: 'Products and variants', text: 'titles, options, prices, stock and images' },
  { title: 'Customers', text: 'name, email and phone, to link contacts' },
  { title: 'Orders', text: 'items, totals, payment and fulfilment status' },
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  reauth_required: { label: 'Reconnect needed', className: 'bg-amber-50 text-amber-700 border-amber-200' },
};

export const ShopifyLogo: React.FC<{ className?: string }> = ({ className = 'w-10 h-10' }) => (
  <div className={`rounded-xl bg-white flex items-center justify-center shrink-0 border border-slate-200 overflow-hidden ${className}`}>
    <img
      src="/shopify-logo.png"
      alt="Shopify"
      className="w-full h-full object-contain p-1"
    />
  </div>
);

interface ShopifyIntegrationViewProps {
  /** Back to the Integrations grid */
  onBack: () => void;
}

export const ShopifyIntegrationView: React.FC<ShopifyIntegrationViewProps> = ({ onBack }) => {
  const { dbUser, hasPermission, can } = useAuth();
  const canManage = hasPermission('manage_billing_and_integrations');
  const canRead = can('integrations', 'read');
  const canCreate = can('integrations', 'create');
  const canUpdate = can('integrations', 'update');
  const canDelete = can('integrations', 'delete');
  const isAdmin = canManage;
  const canConnect = canCreate && canManage;
  const canDisconnect = canDelete && canManage;
  const canReconnect = canUpdate && canManage;
  const { store: primaryStore, stores, configured, isLoading, error, refresh } = useShopifyStore();
  const [showConnect, setShowConnect] = useState(false);
  const [connectingShop, setConnectingShop] = useState<string | null>(null);
  const [storeToDisconnect, setStoreToDisconnect] = useState<ShopifyStoreInfo | null>(null);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const storeCount = useRef(stores.length);

  if (!canRead || !canManage) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50/60 flex items-center justify-center p-6">
        <div className="max-w-md w-full bg-white rounded-2xl border border-slate-200/90 shadow-xs p-8 text-center flex flex-col items-center">
          <div className="w-14 h-14 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 mb-4 shadow-2xs">
            <Lock className="w-6 h-6 stroke-[2]" />
          </div>
          <h2 className="text-lg font-bold text-slate-900">Shopify Integration Restricted</h2>
          <p className="mt-2 text-xs text-slate-500 leading-relaxed max-w-sm">
            Your role does not have permission to manage billing and integrations. Contact your workspace administrator to connect or manage stores.
          </p>
          <button
            type="button"
            onClick={onBack}
            className="mt-5 px-4 py-2 rounded-xl text-xs font-semibold text-white bg-[#3440a8] hover:bg-[#2b358c] transition-colors cursor-pointer"
          >
            Back to Integrations
          </button>
        </div>
      </div>
    );
  }

  // Shopify's approval page opens in a new tab: pick up the new connection when the user comes back
  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  // A store was just connected: leave the connect page and show it in the list
  useEffect(() => {
    if (stores.length > storeCount.current) setShowConnect(false);
    storeCount.current = stores.length;
  }, [stores.length]);

  const startConnect = async (shop: string) => {
    if (!shop.trim()) return;
    setConnectingShop(shop);
    try {
      const res = await apiClient.post('/api/integrations/shopify/install', { shop: shop.trim() });
      // Shopify asks the merchant to approve the permissions, then redirects back to /?tab=integrations&integration=shopify
      window.open(res.data.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      notifyError(err, { where: 'ShopifyIntegrationView.startConnect', title: "Couldn't start the Shopify connection" });
    } finally {
      setConnectingShop(null);
    }
  };

  const handleDisconnect = async () => {
    if (!storeToDisconnect) return;
    setIsDisconnecting(true);
    try {
      await apiClient.delete('/api/integrations/shopify', { params: { storeId: storeToDisconnect.id } });
      gooeyToast.success('Shopify store disconnected', { description: storeToDisconnect.shopDomain });
      setStoreToDisconnect(null);
      notifyShopifyChanged();
    } catch (err) {
      notifyError(err, { where: 'ShopifyIntegrationView.handleDisconnect', title: 'Store not disconnected' });
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isLoading) return <LoadingState label="Loading Shopify…" className="h-full" />;
  if (error) return <ErrorState error={error} title="Couldn't load your Shopify connection" onRetry={refresh} className="h-full" />;

  const backLink = (label: string, onClick: () => void) => (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-900 cursor-pointer"
    >
      <ArrowLeft className="w-3.5 h-3.5" /> {label}
    </button>
  );

  // ---------------------------------------------------------------
  // Connect a store (first store, or another one)
  // ---------------------------------------------------------------
  if (stores.length === 0 || showConnect) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50/60">
        <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
          {stores.length > 0
            ? backLink('Connected stores', () => setShowConnect(false))
            : backLink('Integrations', onBack)}

          <div className="mt-4 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
            <div className="min-w-0 space-y-5">
              <div>
                <h1 className="text-2xl font-bold text-slate-900">
                  {stores.length > 0 ? 'Connect another Shopify store' : 'Connect your Shopify store'}
                </h1>
                <p className="mt-1 text-[13px] text-slate-500">
                  UnoCX reads products, customers and orders so your team can answer and sell inside every conversation.
                </p>
              </div>

              <div className="rounded-xl border-2 border-[#3440a8] bg-[#eef0fb]/60 p-4 flex items-center gap-3">
                <ShopifyLogo />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-slate-900">Shopify</p>
                  <p className="text-xs text-slate-500">Approve UnoCX in your Shopify admin</p>
                </div>
                <span className="hidden sm:block text-xs text-slate-500">About 2 minutes</span>
                <span className="w-4 h-4 rounded-full border-2 border-[#3440a8] flex items-center justify-center shrink-0">
                  <span className="w-2 h-2 rounded-full bg-[#3440a8]" />
                </span>
              </div>

              {!configured ? (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2.5">
                  The Shopify integration isn&apos;t set up on this server yet. Ask your administrator to add the Shopify app credentials.
                </p>
              ) : !canConnect ? (
                <p className="text-xs text-slate-600 bg-slate-100 rounded-lg px-3 py-2.5 flex items-center gap-2"><Lock className="w-3.5 h-3.5 text-slate-400" /> Ask a workspace admin to connect your Shopify store or request create permissions.</p>
              ) : (
                <ShopAddressForm isConnecting={connectingShop !== null} onSubmit={startConnect} />
              )}

              <section className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="text-sm font-bold text-slate-900">After install</h2>
                <ol className="mt-4 space-y-4">
                  {AFTER_INSTALL.map(({ title, text }, i) => (
                    <li key={title} className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-[#eef0fb] text-[#3440a8] text-[11px] font-bold flex items-center justify-center shrink-0">
                        {i + 1}
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-900">{title}</p>
                        <p className="text-xs text-slate-500">{text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </div>

            <aside className="space-y-4">
              <section className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="text-sm font-bold text-slate-900">What UnoCX reads</h2>
                <ul className="mt-4 space-y-4">
                  {WHAT_WE_READ.map(({ title, text }) => (
                    <li key={title} className="flex gap-3">
                      <span className="w-6 h-6 rounded-full bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
                        <Check className="w-3.5 h-3.5" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-[13px] font-semibold text-slate-900">{title}</p>
                        <p className="text-xs text-slate-500">{text}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="bg-white rounded-xl border border-slate-200 p-5">
                <h2 className="text-sm font-bold text-slate-900">What UnoCX changes</h2>
                <div className="mt-4 flex gap-3">
                  <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
                    <Lock className="w-3.5 h-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-slate-900">Nothing</p>
                    <p className="text-xs text-slate-500">Access is read-only. Your products, customers and orders are never edited.</p>
                  </div>
                </div>
              </section>
            </aside>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Connected stores
  // ---------------------------------------------------------------
  return (
    <div className="h-full overflow-y-auto bg-slate-50/60">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 py-8">
        {backLink('Integrations', onBack)}

        <div className="mt-4 flex items-center gap-3">
          <ShopifyLogo />
          <div className="min-w-0">
            <h1 className="text-xl font-bold text-slate-900">Shopify</h1>
            <p className="text-[13px] text-slate-500">
              {stores.length} {stores.length === 1 ? 'store' : 'stores'} connected
            </p>
          </div>
        </div>

        <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {stores.map((store) => (
            <StoreCard
              key={store.id}
              store={store}
              isPrimary={stores.length > 1 && store.id === primaryStore?.id}
              isAdmin={isAdmin}
              canReconnect={canReconnect}
              canDisconnect={canDisconnect}
              isReconnecting={connectingShop === store.shopDomain}
              onReconnect={() => startConnect(store.shopDomain)}
              onDisconnect={() => setStoreToDisconnect(store)}
            />
          ))}

          {canConnect && configured && (
            <button
              type="button"
              onClick={() => setShowConnect(true)}
              className="min-h-[220px] rounded-2xl border-2 border-dashed border-slate-300 hover:border-[#3440a8] hover:bg-[#eef0fb]/40 text-slate-500 hover:text-[#3440a8] flex flex-col items-center justify-center gap-2 cursor-pointer transition-colors"
            >
              <span className="w-10 h-10 rounded-full bg-white border border-slate-200 flex items-center justify-center">
                <Plus className="w-5 h-5" />
              </span>
              <span className="text-[13px] font-semibold">Connect store</span>
              <span className="text-[11px] text-slate-400">Add another Shopify store</span>
            </button>
          )}
        </div>
      </div>

      <Modal isOpen={storeToDisconnect !== null} onClose={() => setStoreToDisconnect(null)} title="Disconnect Shopify store?" maxWidth="sm">
        <p className="text-xs text-slate-600 leading-relaxed">
          Your team will no longer see products, customers or orders from{' '}
          <span className="font-semibold">{storeToDisconnect?.shopDomain}</span>. Linked contacts are kept and work again if you
          reconnect this store.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setStoreToDisconnect(null)}
            className="px-3 py-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleDisconnect}
            disabled={isDisconnecting}
            className="px-3 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {isDisconnecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Disconnect
          </button>
        </div>
      </Modal>
    </div>
  );
};

/** "<handle>.myshopify.com" input; the server also accepts a full domain or admin URL pasted here */
const ShopAddressForm: React.FC<{ isConnecting: boolean; onSubmit: (shop: string) => void }> = ({ isConnecting, onSubmit }) => {
  const [shopInput, setShopInput] = useState('');

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(shopInput);
      }}
    >
      <label htmlFor="shopify-store-address" className="block text-xs text-slate-600 mb-1.5">
        Shopify store address
      </label>
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 min-w-0 flex items-center bg-white border border-slate-300 rounded-lg focus-within:border-[#3440a8] focus-within:ring-1 focus-within:ring-[#3440a8]">
          <input
            id="shopify-store-address"
            value={shopInput}
            onChange={(e) => setShopInput(e.target.value)}
            placeholder="your-store"
            autoComplete="off"
            spellCheck={false}
            className="flex-1 min-w-0 px-3 py-2.5 bg-transparent text-[13px] outline-none"
          />
          {!shopInput.includes('.') && <span className="pr-3 text-[13px] text-slate-400">.myshopify.com</span>}
        </div>
        <button
          type="submit"
          disabled={isConnecting || !shopInput.trim()}
          className="sm:w-44 inline-flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-[#3440a8] hover:bg-[#2b3590] text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50"
        >
          {isConnecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Install app
        </button>
      </div>
    </form>
  );
};

interface StoreCardProps {
  store: ShopifyStoreInfo;
  /** The store the inbox uses for products, customers and orders */
  isPrimary: boolean;
  isAdmin: boolean;
  canReconnect: boolean;
  canDisconnect: boolean;
  isReconnecting: boolean;
  onReconnect: () => void;
  onDisconnect: () => void;
}

const StoreCard: React.FC<StoreCardProps> = ({ store, isPrimary, isAdmin, canReconnect, canDisconnect, isReconnecting, onReconnect, onDisconnect }) => {
  const badge = STATUS_BADGE[store.status] ?? STATUS_BADGE.connected;
  const reconnectReason =
    store.status === 'reauth_required'
      ? 'Shopify no longer accepts this connection (the app may have been uninstalled or its access revoked).'
      : store.missingScopes.length > 0
        ? `Some permissions are missing (${store.missingScopes.join(', ')}).`
        : null;

  return (
    <section className="bg-white rounded-2xl border border-slate-200 p-5 flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-slate-900 truncate">{store.name || store.shopDomain}</h2>
          <p className="text-xs text-slate-500 truncate">{store.shopDomain}</p>
        </div>
        <span className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${badge.className}`}>
          {store.status === 'connected' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
          {badge.label}
        </span>
      </div>

      {isPrimary && (
        <p className="-mt-2 text-[11px] text-[#3440a8] bg-[#eef0fb] rounded-md px-2 py-1 self-start font-semibold">Used in the inbox</p>
      )}

      {reconnectReason && (
        <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 space-y-2">
          <p>{reconnectReason}</p>
          {canReconnect && (
            <button
              type="button"
              onClick={onReconnect}
              disabled={isReconnecting}
              className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
            >
              {isReconnecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Reconnect
            </button>
          )}
        </div>
      )}

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs">
        {[
          ['Storefront', store.primaryDomainUrl ? (
            <a href={store.primaryDomainUrl} target="_blank" rel="noopener noreferrer" className="text-[#3440a8] hover:underline inline-flex items-center gap-1 break-all">
              {store.primaryDomainUrl.replace(/^https?:\/\//, '')} <ExternalLink className="w-3 h-3 shrink-0" />
            </a>
          ) : '—'],
          ['Currency', store.currencyCode || '—'],
          ['Store email', store.email || '—'],
          ['Connected', `${new Date(store.connectedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}${store.connectedByName ? ` by ${store.connectedByName}` : ''}`],
        ].map(([label, value]) => (
          <div key={String(label)} className="min-w-0">
            <dt className="text-slate-500">{label}</dt>
            <dd className="mt-0.5 text-slate-800 break-words">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-auto pt-3 border-t border-slate-100 flex flex-wrap gap-2 justify-between items-center">
        <a
          href={`https://${store.shopDomain}/admin`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs font-semibold text-[#3440a8] hover:underline inline-flex items-center gap-1"
        >
          Open Shopify admin <ExternalLink className="w-3 h-3" />
        </a>
        {canDisconnect && (
          <button
            type="button"
            onClick={onDisconnect}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
          >
            <Unplug className="w-3.5 h-3.5" /> Disconnect
          </button>
        )}
      </div>
    </section>
  );
};

export default ShopifyIntegrationView;

