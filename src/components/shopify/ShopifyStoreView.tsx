'use client';

import React, { useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  MessageSquareShare,
  Package,
  ReceiptText,
  ShoppingBag,
  Unplug,
} from 'lucide-react';
import apiClient from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/context/AuthContext';
import { ProductBrowser } from './ProductBrowser';
import { notifyShopifyChanged, useShopifyStore } from './useShopifyStore';

const BENEFITS = [
  { icon: Package, title: 'Find products in seconds', text: 'Search your catalog by name or SKU without leaving the inbox.' },
  { icon: MessageSquareShare, title: 'Share products in chats', text: 'Send the exact size, color or option with its price, image and link.' },
  { icon: ReceiptText, title: 'See order history', text: "Link a contact to their Shopify customer and see their orders beside the chat." },
];

const STATUS_BADGE: Record<string, { label: string; className: string }> = {
  connected: { label: 'Connected', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  reauth_required: { label: 'Reconnect needed', className: 'bg-amber-50 text-amber-700 border-amber-200' },
};

export const ShopifyStoreView: React.FC = () => {
  const { dbUser } = useAuth();
  const { store, configured, isLoading, error, refresh, isConnected, needsReauth } = useShopifyStore();
  const [shopInput, setShopInput] = useState('');
  const [isConnecting, setIsConnecting] = useState(false);
  const [showDisconnect, setShowDisconnect] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);

  const isAdmin = dbUser?.role === 'ADMIN';

  const startConnect = async (shop: string) => {
    if (!shop.trim()) return;
    setIsConnecting(true);
    try {
      const res = await apiClient.post('/api/integrations/shopify/install', { shop: shop.trim() });
      // Shopify asks the merchant to approve the permissions, then redirects back to /?tab=store
      window.open(res.data.authorizeUrl, '_blank', 'noopener,noreferrer');
      setIsConnecting(false);
    } catch (err) {
      notifyError(err, { where: 'ShopifyStoreView.startConnect', title: "Couldn't start the Shopify connection" });
      setIsConnecting(false);
    }
  };

  const handleDisconnect = async () => {
    setIsDisconnecting(true);
    try {
      await apiClient.delete('/api/integrations/shopify');
      gooeyToast.success('Shopify store disconnected');
      setShowDisconnect(false);
      notifyShopifyChanged();
    } catch (err) {
      notifyError(err, { where: 'ShopifyStoreView.handleDisconnect', title: 'Store not disconnected' });
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isLoading) return <LoadingState label="Loading store…" className="h-full" />;
  if (error) return <ErrorState error={error} title="Couldn't load your Shopify connection" onRetry={refresh} className="h-full" />;

  // ---------------------------------------------------------------
  // Not connected: explain the value and offer Connect
  // ---------------------------------------------------------------
  if (!store) {
    return (
      <div className="h-full overflow-y-auto bg-slate-50/60">
        <div className="max-w-2xl mx-auto px-4 py-10">
          <div className="bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 text-center">
            <div className="mx-auto w-12 h-12 rounded-2xl bg-[#eef7ea] text-[#5e8e3e] flex items-center justify-center">
              <ShoppingBag className="w-6 h-6" />
            </div>
            <h2 className="mt-4 text-lg font-bold text-slate-900">Connect your Shopify store</h2>
            <p className="mt-1 text-[13px] text-slate-500 max-w-md mx-auto">
              Bring your products and orders into every conversation, so your team can answer faster and help customers buy.
            </p>

            <ul className="mt-6 grid gap-3 sm:grid-cols-3 text-left">
              {BENEFITS.map(({ icon: Icon, title, text }) => (
                <li key={title} className="rounded-xl border border-slate-200 p-3">
                  <Icon className="w-4 h-4 text-[#3440a8]" />
                  <p className="mt-2 text-[12.5px] font-semibold text-slate-900">{title}</p>
                  <p className="mt-0.5 text-[11.5px] text-slate-500 leading-relaxed">{text}</p>
                </li>
              ))}
            </ul>

            {!configured ? (
              <p className="mt-6 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2.5">
                The Shopify integration isn&apos;t set up on this server yet. Ask your administrator to add the Shopify app credentials.
              </p>
            ) : !isAdmin ? (
              <p className="mt-6 text-xs text-slate-600 bg-slate-100 rounded-lg px-3 py-2.5">Ask a workspace admin to connect your Shopify store.</p>
            ) : (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  startConnect(shopInput);
                }}
                className="mt-6 flex flex-col sm:flex-row gap-2 max-w-md mx-auto"
              >
                <input
                  value={shopInput}
                  onChange={(e) => setShopInput(e.target.value)}
                  placeholder="your-store.myshopify.com"
                  aria-label="Shopify store address"
                  className="flex-1 min-w-0 px-3 py-2.5 border border-slate-200 rounded-lg text-[13px] outline-none focus:border-[#3440a8]"
                />
                <button
                  type="submit"
                  disabled={isConnecting || !shopInput.trim()}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-lg bg-[#3440a8] hover:bg-[#2b3590] text-white text-[13px] font-semibold cursor-pointer disabled:opacity-50"
                >
                  {isConnecting && <Loader2 className="w-4 h-4 animate-spin" />} Connect Shopify Store
                </button>
              </form>
            )}
            <p className="mt-3 text-[11px] text-slate-400">
              Read-only access to products, customers and orders. Nothing in your store is changed.
            </p>
          </div>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------
  // Connected (or needs re-authorization)
  // ---------------------------------------------------------------
  const badge = STATUS_BADGE[store.status] ?? STATUS_BADGE.connected;
  const reconnectReason = needsReauth
    ? 'Shopify no longer accepts this connection (the app may have been uninstalled or its access revoked).'
    : store.missingScopes.length > 0
      ? `Some permissions are missing (${store.missingScopes.join(', ')}).`
      : null;

  return (
    <div className="h-full overflow-y-auto bg-slate-50/60">
      <div className="max-w-5xl mx-auto px-4 py-6 grid gap-5 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section className="bg-white rounded-2xl border border-slate-200 p-5 space-y-4 self-start">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 rounded-xl bg-[#eef7ea] text-[#5e8e3e] flex items-center justify-center shrink-0">
                <ShoppingBag className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <h2 className="text-[15px] font-bold text-slate-900 truncate">{store.name || store.shopDomain}</h2>
                <p className="text-xs text-slate-500 truncate">{store.shopDomain}</p>
              </div>
            </div>
            <span className={`shrink-0 inline-flex items-center gap-1 text-[11px] font-semibold px-2.5 py-1 rounded-full border ${badge.className}`}>
              {store.status === 'connected' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
              {badge.label}
            </span>
          </div>

          {reconnectReason && (
            <div className="rounded-lg bg-amber-50 border border-amber-200 px-3 py-2.5 text-xs text-amber-800 flex flex-col sm:flex-row sm:items-center gap-2 justify-between">
              <span>{reconnectReason}</span>
              {isAdmin && (
                <button
                  type="button"
                  onClick={() => startConnect(store.shopDomain)}
                  disabled={isConnecting}
                  className="shrink-0 px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
                >
                  {isConnecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Reconnect
                </button>
              )}
            </div>
          )}

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
            {[
              ['Storefront', store.primaryDomainUrl ? (
                <a href={store.primaryDomainUrl} target="_blank" rel="noopener noreferrer" className="text-[#3440a8] hover:underline inline-flex items-center gap-1">
                  {store.primaryDomainUrl.replace(/^https?:\/\//, '')} <ExternalLink className="w-3 h-3" />
                </a>
              ) : '—'],
              ['Store email', store.email || '—'],
              ['Currency', store.currencyCode || '—'],
              ['Connected', `${new Date(store.connectedAt).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}${store.connectedByName ? ` by ${store.connectedByName}` : ''}`],
              ['Permissions', store.scopes.join(', ') || '—'],
            ].map(([label, value]) => (
              <div key={String(label)} className="min-w-0">
                <dt className="text-slate-500">{label}</dt>
                <dd className="mt-0.5 text-slate-800 break-words">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="pt-3 border-t border-slate-100 flex flex-wrap gap-2 justify-between items-center">
            <a
              href={`https://${store.shopDomain}/admin`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-semibold text-[#3440a8] hover:underline inline-flex items-center gap-1"
            >
              Open Shopify admin <ExternalLink className="w-3 h-3" />
            </a>
            {isAdmin && (
              <button
                type="button"
                onClick={() => setShowDisconnect(true)}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer"
              >
                <Unplug className="w-3.5 h-3.5" /> Disconnect store
              </button>
            )}
          </div>
        </section>

        {isConnected && (
          <section className="bg-white rounded-2xl border border-slate-200 p-4 flex flex-col h-[640px] max-h-[calc(100vh-3rem)]">
            <h3 className="text-[11px] font-semibold text-slate-500 tracking-wider mb-3">PRODUCTS</h3>
            <ProductBrowser className="flex-1" />
          </section>
        )}
      </div>

      <Modal isOpen={showDisconnect} onClose={() => setShowDisconnect(false)} title="Disconnect Shopify store?" maxWidth="sm">
        <p className="text-xs text-slate-600 leading-relaxed">
          Your team will no longer be able to search or share products from <span className="font-semibold">{store.shopDomain}</span> or see
          customer orders. Linked contacts are kept and work again if you reconnect this store.
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={() => setShowDisconnect(false)}
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

export default ShopifyStoreView;
