'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AlertTriangle, ArrowRight, CheckCircle2, ExternalLink, Loader2, Lock, Package, Radio, Receipt, RefreshCw, ShieldCheck, Unplug, Users } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import { ErrorState, LoadingState } from '@/components/ui/states';
import { useAuth } from '@/context/AuthContext';
import type { WooCommerceStoreOverview, WooCommerceStoreWithChannels } from '@/lib/woocommerce/types';
import { ShopifyPageHeader as PageHeader, ShopifyPageShell as PageShell, formatDate, secondaryButtonClass } from '../shopify/ShopifyPageChrome';
import { PERMISSION_LABEL, WOO_STATUS_BADGE } from './WooCommerceIntegrationView';
import { notifyWooCommerceChanged } from './useWooCommerceStores';

const formatCount = (n: number | null | undefined) => (typeof n === 'number' ? n.toLocaleString() : '—');

/** One connected WooCommerce store: details, live counts, channels and connection management */
export const WooCommerceStoreDetailView: React.FC<{ storeId: number }> = ({ storeId }) => {
  const { hasPermission, can } = useAuth();
  const allowed = can('integrations', 'read') && hasPermission('manage_billing_and_integrations');
  const [store, setStore] = useState<WooCommerceStoreWithChannels | null>(null);
  const [storeError, setStoreError] = useState<ApiError | null>(null);
  const [overview, setOverview] = useState<WooCommerceStoreOverview | null>(null);
  const [overviewError, setOverviewError] = useState<ApiError | null>(null);

  const loadStore = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/integrations/woocommerce/stores/${storeId}`);
      setStore(res.data.store);
      setStoreError(null);
    } catch (err) {
      setStoreError(toApiError(err));
    }
  }, [storeId]);

  const loadOverview = useCallback(async () => {
    setOverviewError(null);
    try {
      const res = await apiClient.get(`/api/integrations/woocommerce/stores/${storeId}/overview`);
      setOverview(res.data.overview);
    } catch (err) {
      setOverviewError(toApiError(err));
    }
  }, [storeId]);

  useEffect(() => {
    if (!allowed) return;
    loadStore();
    loadOverview();
  }, [allowed, loadStore, loadOverview]);

  const back = { href: '/integrations/woocommerce', label: 'Back to WooCommerce connections' };

  if (!allowed) {
    return (
      <PageShell>
        <PageHeader back={back} title="WooCommerce" />
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

  if (storeError || !store) {
    return (
      <PageShell>
        <PageHeader back={back} title="WooCommerce" />
        <div className="flex-1 flex items-center justify-center">
          {storeError ? <ErrorState error={storeError} title="Couldn't load this store" onRetry={loadStore} /> : <LoadingState label="Loading store…" />}
        </div>
      </PageShell>
    );
  }

  const badge = WOO_STATUS_BADGE[store.status] ?? WOO_STATUS_BADGE.connected;
  const loadingCounts = !overview && !overviewError;
  const stat = (icon: React.ReactNode, label: string, value: number | null | undefined) => (
    <div className="rounded-lg border border-slate-200 p-4 flex flex-col gap-2">
      <span className="flex items-center gap-2 text-xs font-semibold text-slate-500">
        <span className="w-7 h-7 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center">{icon}</span>
        {label}
      </span>
      <span className="text-2xl font-bold text-slate-900 tabular-nums">
        {loadingCounts ? <Loader2 className="w-5 h-5 animate-spin text-slate-300" /> : formatCount(value)}
      </span>
    </div>
  );

  return (
    <PageShell>
      <PageHeader
        back={back}
        title={store.name || store.storeHost}
        subtitle={store.storeHost}
        badges={
          <span className={`inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full border ${badge.className}`}>
            {store.status === 'connected' ? <CheckCircle2 className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {badge.label}
          </span>
        }
        actions={
          <a href={`${store.storeUrl}/wp-admin/admin.php?page=wc-admin`} target="_blank" rel="noopener noreferrer" className={secondaryButtonClass}>
            Open WooCommerce admin <ExternalLink className="w-3.5 h-3.5" />
          </a>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 sm:p-5 space-y-4">
        {overviewError && <ErrorState error={overviewError} title="Couldn't read live details from WooCommerce" compact onRetry={loadOverview} />}

        <div className="grid gap-3 sm:grid-cols-3">
          {stat(<Package className="w-4 h-4" />, 'Products', overview?.counts.products)}
          {stat(<Receipt className="w-4 h-4" />, 'Orders', overview?.counts.orders)}
          {stat(<Users className="w-4 h-4" />, 'Customers', overview?.counts.customers)}
        </div>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
          <div className="space-y-4">
            <Card title="Store details">
              <DetailList
                rows={[
                  ['Store name', overview?.name ?? store.name],
                  [
                    'Address',
                    <a key="url" href={store.storeUrl} target="_blank" rel="noopener noreferrer" className="text-[#3440a8] hover:underline inline-flex items-center gap-1 break-all">
                      {store.storeHost} <ExternalLink className="w-3 h-3 shrink-0" />
                    </a>,
                  ],
                  ['Tagline', overview?.description],
                  ['Currency', overview?.currencyCode ?? store.currencyCode],
                  ['Timezone', overview?.timezone],
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
                <p className="text-xs text-slate-500">No channel is connected to this store yet.</p>
              )}
              <Link href="/settings" className="mt-3 inline-flex items-center gap-1 text-[11px] font-semibold text-slate-700 hover:underline">
                Connect channels in Settings → Channels <ArrowRight className="w-3 h-3" />
              </Link>
            </Card>
          </div>

          <div className="space-y-4">
            <Card title="Connection">
              <DetailList
                rows={[
                  ['Status', badge.label],
                  ['Connected', `${formatDate(store.connectedAt)}${store.connectedByName ? ` by ${store.connectedByName}` : ''}`],
                  ['Last verified', store.lastVerifiedAt ? formatDate(store.lastVerifiedAt) : 'Not yet'],
                  ['API key', `${store.keyPermissions ? PERMISSION_LABEL[store.keyPermissions] ?? store.keyPermissions : 'Unknown'}${store.keyId ? ` · key #${store.keyId}` : ''}`],
                ]}
              />
              {!store.isHttps && (
                <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">
                  This store doesn&apos;t use HTTPS. Requests are signed, but switch the store to HTTPS before going live.
                </p>
              )}
              {store.lastError && store.status !== 'connected' && (
                <p className="mt-3 text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-2">{store.lastError}</p>
              )}
            </Card>
            <ManageConnectionCard store={store} onChanged={() => { loadStore(); loadOverview(); }} />
          </div>
        </div>
      </div>
    </PageShell>
  );
};

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

const ManageConnectionCard: React.FC<{ store: WooCommerceStoreWithChannels; onChanged: () => void }> = ({ store, onChanged }) => {
  const router = useRouter();
  const { hasPermission, can } = useAuth();
  const canManage = hasPermission('manage_billing_and_integrations');
  const canUpdate = can('integrations', 'update') && canManage;
  const canDelete = can('integrations', 'delete') && canManage;
  const [busy, setBusy] = useState<'verify' | 'reconnect' | 'disconnect' | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const needsReconnect = store.status === 'reauth_required';

  // The approval page opens in a new tab: pick up the renewed key when the user comes back
  useEffect(() => {
    if (busy !== 'reconnect') return;
    const onFocus = () => {
      setBusy(null);
      onChanged();
      notifyWooCommerceChanged();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [busy, onChanged]);

  const verify = async () => {
    setBusy('verify');
    try {
      await apiClient.post(`/api/integrations/woocommerce/stores/${store.id}/verify`);
      gooeyToast.success('Connection works', { description: `UnoCX can reach ${store.storeHost} with its API key.` });
    } catch (err) {
      notifyError(err, { where: 'WooCommerceStore.verify', title: 'Connection test failed' });
    } finally {
      setBusy(null);
      onChanged();
      notifyWooCommerceChanged();
    }
  };

  const reconnect = async () => {
    setBusy('reconnect');
    try {
      const res = await apiClient.post('/api/integrations/woocommerce/install', { storeUrl: store.storeUrl, reauthorize: true });
      window.open(res.data.authorizeUrl, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setBusy(null);
      notifyError(err, { where: 'WooCommerceStore.reconnect', title: "Couldn't start the WooCommerce connection" });
    }
  };

  const disconnect = async () => {
    setBusy('disconnect');
    try {
      const res = await apiClient.delete(`/api/integrations/woocommerce/stores/${store.id}`);
      const keyId = res.data?.keyId;
      gooeyToast.success('WooCommerce store disconnected', {
        description: `Also revoke the UnoCX key${keyId ? ` (#${keyId})` : ''} in WooCommerce → Settings → Advanced → REST API.`,
      });
      notifyWooCommerceChanged();
      router.push('/integrations/woocommerce');
    } catch (err) {
      notifyError(err, { where: 'WooCommerceStore.disconnect', title: 'Store not disconnected' });
      setBusy(null);
    }
  };

  if (!canUpdate && !canDelete) return null;

  return (
    <Card title="Manage connection">
      <div className="space-y-2">
        {canUpdate && !needsReconnect && (
          <button type="button" onClick={verify} disabled={busy !== null} className={`w-full ${secondaryButtonClass}`}>
            {busy === 'verify' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <ShieldCheck className="w-3.5 h-3.5" />} Test connection
          </button>
        )}
        {canUpdate && (
          <button
            type="button"
            onClick={reconnect}
            disabled={busy !== null}
            className={`w-full ${needsReconnect ? 'inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-600 hover:bg-amber-700 text-white text-xs font-semibold cursor-pointer disabled:opacity-50' : secondaryButtonClass}`}
          >
            {busy === 'reconnect' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            {needsReconnect ? 'Reconnect store' : 'Generate a new key'}
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

      <Modal isOpen={confirmDisconnect} onClose={() => setConfirmDisconnect(false)} title="Disconnect WooCommerce store?" maxWidth="sm">
        <p className="text-xs text-slate-600 leading-relaxed">
          UnoCX deletes its API key for <span className="font-semibold">{store.storeHost}</span>. Channel connections are kept and work again if you
          reconnect. WooCommerce doesn&apos;t let apps revoke keys, so also revoke the UnoCX key
          {store.keyId ? ` (#${store.keyId})` : ''} in WooCommerce → Settings → Advanced → REST API.
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

export default WooCommerceStoreDetailView;
