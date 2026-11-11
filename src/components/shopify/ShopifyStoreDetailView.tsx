'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Lock,
  Package,
  Radio,
  Receipt,
  RefreshCw,
  Unplug,
  Users,
} from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/context/AuthContext';
import type { ShopifyCount, ShopifyStoreOverview, ShopifyStoreWithChannels } from '@/lib/shopify/types';
import { STATUS_BADGE } from './ShopifyIntegrationView';
import { ShopifyPageHeader, ShopifyPageShell, ShopifyTabs, formatDate, secondaryButtonClass } from './ShopifyPageChrome';
import { notifyShopifyChanged } from './useShopifyStore';
import { OrderHistoryNotice, hasFullOrderHistory } from './OrderHistoryNotice';
import { StoreCustomersTab } from './store/StoreCustomersTab';
import { StoreOrdersTab } from './store/StoreOrdersTab';
import { StoreProductsTab } from './store/StoreProductsTab';

export const STORE_DETAIL_TABS = ['overview', 'products', 'orders', 'customers'] as const;
export type StoreDetailTab = (typeof STORE_DETAIL_TABS)[number];

const formatCount = (c: ShopifyCount | null | undefined) => (c ? `${c.count.toLocaleString()}${c.atLeast ? '+' : ''}` : '—');

interface ShopifyStoreDetailViewProps {
  storeId: number;
  tab: StoreDetailTab;
  onTabChange: (tab: StoreDetailTab) => void;
}

/** One connected store: its details, products, orders and customers */
export const ShopifyStoreDetailView: React.FC<ShopifyStoreDetailViewProps> = ({ storeId, tab, onTabChange }) => {
  const { hasPermission, can } = useAuth();
  const allowed = can('integrations', 'read') && hasPermission('manage_billing_and_integrations');

  const [store, setStore] = useState<ShopifyStoreWithChannels | null>(null);
  const [storeError, setStoreError] = useState<ApiError | null>(null);
  const [overview, setOverview] = useState<ShopifyStoreOverview | null>(null);
  const [overviewError, setOverviewError] = useState<ApiError | null>(null);

  const loadStore = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/integrations/shopify/stores/${storeId}`);
      setStore(res.data.store);
      setStoreError(null);
    } catch (err) {
      setStoreError(toApiError(err));
    }
  }, [storeId]);

  const loadOverview = useCallback(async () => {
    setOverviewError(null);
    try {
      const res = await apiClient.get(`/api/integrations/shopify/stores/${storeId}/overview`);
      setOverview(res.data.overview);
    } catch (err) {
      setOverviewError(toApiError(err));
    }
  }, [storeId]);

  useEffect(() => {
    if (!allowed) return;
    setStore(null);
    setOverview(null);
    loadStore();
    loadOverview();
  }, [allowed, loadStore, loadOverview]);

  const back = { href: '/integrations/shopify', label: 'Back to Shopify connections' };

  if (!allowed) {
    return (
      <ShopifyPageShell>
        <ShopifyPageHeader back={back} title="Shopify" />
        <div className="flex-1 flex flex-col items-center justify-center text-center p-6">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200/80 flex items-center justify-center text-amber-600 mb-3">
            <Lock className="w-5 h-5" />
          </div>
          <p className="text-sm font-bold text-slate-900">Shopify Integration Restricted</p>
          <p className="mt-1 text-xs text-slate-500 max-w-sm">Your role does not have permission to manage billing and integrations.</p>
        </div>
      </ShopifyPageShell>
    );
  }

  if (storeError || !store) {
    return (
      <ShopifyPageShell>
        <ShopifyPageHeader back={back} title="Shopify" />
        <div className="flex-1 flex items-center justify-center">
          {storeError ? <ErrorState error={storeError} title="Couldn't load this store" onRetry={loadStore} /> : <LoadingState label="Loading store…" />}
        </div>
      </ShopifyPageShell>
    );
  }

  const badge = STATUS_BADGE[store.status] ?? STATUS_BADGE.connected;
  const hasAllOrders = hasFullOrderHistory(store.scopes);
  const countLabel = (label: string, c: ShopifyCount | null | undefined) => (c ? `${label} (${formatCount(c)})` : label);

  return (
    <ShopifyPageShell>
      <ShopifyPageHeader
        back={back}
        title={store.name || store.shopDomain}
        subtitle={store.shopDomain}
        badges={
          <>
            <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.className}`}>
              {store.status === 'connected' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
              {badge.label}
            </span>
          </>
        }
        actions={
          <a href={`https://${store.shopDomain}/admin`} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>
            Open Shopify admin <ExternalLink className="w-3.5 h-3.5" />
          </a>
        }
      />
      <ShopifyTabs<StoreDetailTab>
        active={tab}
        onChange={onTabChange}
        tabs={[
          { key: 'overview', label: 'Overview' },
          { key: 'products', label: countLabel('Products', overview?.counts.products) },
          { key: 'orders', label: countLabel('Orders', overview?.counts.orders) },
          { key: 'customers', label: countLabel('Customers', overview?.counts.customers) },
        ]}
      />

      <div className="flex-1 overflow-y-auto p-4 sm:p-5">
        {tab === 'overview' && (
          <StoreOverviewTab
            store={store}
            overview={overview}
            overviewError={overviewError}
            hasAllOrders={hasAllOrders}
            onRetryOverview={loadOverview}
            onOpenTab={onTabChange}
            onStoreChanged={loadStore}
          />
        )}
        {tab === 'products' && <StoreProductsTab storeId={store.id} shopDomain={store.shopDomain} />}
        {tab === 'orders' && <StoreOrdersTab storeId={store.id} shopDomain={store.shopDomain} hasAllOrders={hasAllOrders} />}
        {tab === 'customers' && <StoreCustomersTab storeId={store.id} shopDomain={store.shopDomain} />}
      </div>
    </ShopifyPageShell>
  );
};

/* ------------------------------------------------------------------ */
/* Overview                                                            */
/* ------------------------------------------------------------------ */

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
  <section className="rounded-lg border border-slate-200 p-4">
    <h2 className="text-[13px] font-bold text-slate-900">{title}</h2>
    <div className="mt-3">{children}</div>
  </section>
);

const DetailList: React.FC<{ rows: [string, React.ReactNode][] }> = ({ rows }) => (
  <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
    {rows.map(([label, value]) => (
      <div key={label} className="min-w-0">
        <dt className="text-slate-500">{label}</dt>
        <dd className="mt-0.5 text-slate-800 break-words">{value || '—'}</dd>
      </div>
    ))}
  </dl>
);

const StoreOverviewTab: React.FC<{
  store: ShopifyStoreWithChannels;
  overview: ShopifyStoreOverview | null;
  overviewError: ApiError | null;
  hasAllOrders: boolean;
  onRetryOverview: () => void;
  onOpenTab: (tab: StoreDetailTab) => void;
  onStoreChanged: () => void;
}> = ({ store, overview, overviewError, hasAllOrders, onRetryOverview, onOpenTab, onStoreChanged }) => {
  const loadingCounts = !overview && !overviewError;
  const storefront = overview?.storefrontUrl ?? store.primaryDomainUrl;

  const stat = (icon: React.ReactNode, label: string, count: ShopifyCount | null | undefined, target: StoreDetailTab, hint?: string) => (
    <button
      type="button"
      onClick={() => onOpenTab(target)}
      className="text-left rounded-lg border border-slate-200 p-4 flex flex-col gap-2 hover:border-slate-400 cursor-pointer group"
    >
      <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">{icon}</span>
        {label}
      </span>
      <span className="text-2xl font-bold text-slate-900 tabular-nums">
        {loadingCounts ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : formatCount(count)}
      </span>
      {hint && <span className="text-[11px] text-slate-400">{hint}</span>}
      <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-700 group-hover:underline">
        View {label.toLowerCase()} <ArrowRight className="w-3.5 h-3.5" />
      </span>
    </button>
  );

  return (
    <div className="space-y-4">
      {overviewError && <ErrorState error={overviewError} title="Couldn't read live details from Shopify" compact onRetry={onRetryOverview} />}
      {!hasAllOrders && <OrderHistoryNotice />}

      <div className="grid gap-3 sm:grid-cols-3">
        {stat(<Package className="w-4 h-4" />, 'Products', overview?.counts.products, 'products', 'Active products')}
        {stat(<Receipt className="w-4 h-4" />, 'Orders', overview?.counts.orders, 'orders', hasAllOrders ? undefined : 'Last 60 days')}
        {stat(<Users className="w-4 h-4" />, 'Customers', overview?.counts.customers, 'customers')}
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div className="space-y-4">
          <Card title="Store details">
            <DetailList
              rows={[
                ['Store name', overview?.name ?? store.name],
                ['Shopify domain', store.shopDomain],
                [
                  'Storefront',
                  storefront ? (
                    <a href={storefront} target="_blank" rel="noopener noreferrer" className="text-[#3440a8] hover:underline inline-flex items-center gap-1 break-all">
                      {storefront.replace(/^https?:\/\//, '')} <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>
                  ) : null,
                ],
                ['Store email', overview?.email ?? store.email],
                ['Customer contact email', overview?.contactEmail],
                ['Currency', overview?.currencyCode ?? store.currencyCode],
                ['Timezone', overview?.timezone],
                [
                  'Plan',
                  overview?.plan.name
                    ? `${overview.plan.name}${overview.plan.shopifyPlus ? ' · Shopify Plus' : ''}${overview.plan.developmentStore ? ' · Development store' : ''}`
                    : null,
                ],
                ['Address', overview?.address],
                ['On Shopify since', overview?.shopCreatedAt ? formatDate(overview.shopCreatedAt) : null],
              ]}
            />
          </Card>

          <Card title="Channels using this store">
            {store.channels.length > 0 ? (
              <ul className="space-y-2">
                {store.channels.map((m) => (
                  <li key={m.id} className="flex items-center gap-2.5 text-xs">
                    <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-500 flex items-center justify-center shrink-0">
                      <Radio className="w-3.5 h-3.5" />
                    </span>
                    <span className="min-w-0">
                      <span className="block font-semibold text-slate-800 truncate">{m.channel.name}</span>
                      <span className="block text-[11px] text-slate-500 truncate">
                        {m.channel.type}
                        {m.channel.phoneNumber ? ` · ${m.channel.phoneNumber}` : m.channel.handle ? ` · ${m.channel.handle}` : ''}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-xs text-slate-500">
                No WhatsApp number is connected to this store yet, so its products and orders don&apos;t show in the inbox.
              </p>
            )}
            <Link href="/settings" className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:underline">
              Connect numbers in Settings → Channels <ArrowRight className="w-3 h-3" />
            </Link>
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Connection">
            <DetailList
              rows={[
                ['Status', STATUS_BADGE[store.status]?.label ?? store.status],
                ['Connected', `${formatDate(store.connectedAt)}${store.connectedByName ? ` by ${store.connectedByName}` : ''}`],
                [
                  'Order history',
                  hasAllOrders ? (
                    'Full history'
                  ) : (
                    <span className="text-amber-700 font-medium" title="Needs Public distribution and the approved read_all_orders permission">
                      Last 60 days only
                    </span>
                  ),
                ],
              ]}
            />
            {store.lastError && store.status !== 'connected' && (
              <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">{store.lastError}</p>
            )}
            <p className="mt-4 text-xs text-slate-500">Permissions granted</p>
            <div className="mt-1.5 flex flex-wrap gap-1">
              {store.scopes.map((scope) => (
                <span key={scope} className="px-1.5 py-0.5 rounded bg-slate-100 text-[10.5px] font-medium text-slate-600">
                  {scope}
                </span>
              ))}
            </div>
            {store.missingScopes.length > 0 && (
              <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">
                Missing: {store.missingScopes.join(', ')}. Reconnect the store to grant them.
              </p>
            )}
          </Card>

          <ManageConnectionCard store={store} onStoreChanged={onStoreChanged} />
        </div>
      </div>
    </div>
  );
};

/** Make default, reconnect (re-authorize) and disconnect */
const ManageConnectionCard: React.FC<{ store: ShopifyStoreWithChannels; onStoreChanged: () => void }> = ({ store, onStoreChanged }) => {
  const router = useRouter();
  const { hasPermission, can } = useAuth();
  const canManage = hasPermission('manage_billing_and_integrations');
  const canUpdate = can('integrations', 'update') && canManage;
  const canDelete = can('integrations', 'delete') && canManage;
  const [busy, setBusy] = useState<'reconnect' | 'disconnect' | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const needsReconnect = store.status === 'reauth_required' || store.missingScopes.length > 0;

  // Shopify's approval page opens in a new tab: pick up the new connection when the user comes back
  useEffect(() => {
    if (busy !== 'reconnect') return;
    const onFocus = () => {
      setBusy(null);
      onStoreChanged();
      notifyShopifyChanged();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [busy, onStoreChanged]);

  const reconnect = async () => {
    setBusy('reconnect');
    try {
      const res = await apiClient.post('/api/integrations/shopify/install', { shop: store.shopDomain });
      window.open(res.data.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setBusy(null);
      notifyError(err, { where: 'ManageConnectionCard.reconnect', title: "Couldn't start the Shopify connection" });
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      await apiClient.delete('/api/integrations/shopify', { params: { storeId: store.id } });
      gooeyToast.success('Shopify store disconnected', { description: store.shopDomain });
      notifyShopifyChanged();
      router.push('/integrations/shopify');
    } catch (err) {
      notifyError(err, { where: 'ManageConnectionCard.disconnect', title: 'Store not disconnected' });
      setBusy(null);
    }
  };

  if (!canUpdate && !canDelete) return null;

  return (
    <Card title="Manage connection">
      <div className="space-y-2">
        {canUpdate && (
          <button
            type="button"
            onClick={reconnect}
            disabled={busy !== null}
            className={`w-full ${needsReconnect ? 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50' : secondaryButtonClass}`}
          >
            {busy === 'reconnect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {needsReconnect ? 'Reconnect store' : 'Re-authorize'}
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            onClick={() => setConfirmDisconnect(true)}
            disabled={busy !== null}
            className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md border border-red-200 text-xs font-semibold text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
          >
            <Unplug className="w-3.5 h-3.5" /> Disconnect
          </button>
        )}
      </div>

      <Modal isOpen={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="Disconnect Shopify store?" maxWidth="sm">
        <p className="text-xs text-slate-600 leading-relaxed">
          Your team will no longer see products, customers or orders from <span className="font-semibold">{store.shopDomain}</span>. Linked
          contacts and channel connections are kept and work again if you reconnect this store.
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setConfirmDisconnect(false)} className={secondaryButtonClass}>
            Cancel
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={busy === 'disconnect'}
            className="px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-60 inline-flex items-center gap-1.5"
          >
            {busy === 'disconnect' && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Disconnect
          </button>
        </div>
      </Modal>
    </Card>
  );
};

export default ShopifyStoreDetailView;
