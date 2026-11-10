'use client';

import React, { useEffect, useState } from 'react';
import { Check, Loader2, Search, UserSearch } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/states';
import { formatShopifyPrice } from '@/lib/shopify/product-message';
import type { ShopifyCustomerSummary, ShopifyOrderSearchResult } from '@/lib/shopify/types';
import { ShopifyOrderCard } from './ShopifyOrderCard';
import { ShopifyCustomerTags } from './ShopifyCustomerTags';

interface LinkCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: { id: number; name: string; email: string | null; phone: string | null };
  /** Shopify customer currently linked, so it can be marked in the results */
  currentShopifyCustomerId?: string | null;
  /** The store of the conversation's WhatsApp number: searched and linked in */
  store?: { id: number; name: string | null; shopDomain: string } | null;
  onLinked: (customer: ShopifyCustomerSummary) => void;
}

type SearchMode = 'customers' | 'orders';

const MODE_LABELS: Record<SearchMode, { tab: string; placeholder: string; hint: string }> = {
  customers: { tab: 'Customer', placeholder: 'Name, email or phone (+91 98765 43210)', hint: 'Name, email or phone number with country code' },
  orders: { tab: 'Order', placeholder: '#1001 or name@example.com', hint: 'Order number or the email used on the order' },
};

const RadioDot: React.FC<{ selected: boolean }> = ({ selected }) => (
  <span
    className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
      selected ? 'bg-[#3440a8] border-[#3440a8] text-white' : 'border-slate-300'
    }`}
  >
    {selected && <Check className="w-3 h-3" />}
  </span>
);

/**
 * Search Shopify customers (by name, email or phone) or orders (by number or email) and link the
 * customer to the contact. The customer may use a different phone or email than the chat.
 */
export const LinkCustomerModal: React.FC<LinkCustomerModalProps> = ({ isOpen, onClose, contact, currentShopifyCustomerId, store, onLinked }) => {
  const [mode, setMode] = useState<SearchMode>('customers');
  const [query, setQuery] = useState('');
  const [customerResults, setCustomerResults] = useState<ShopifyCustomerSummary[] | null>(null);
  const [orderResults, setOrderResults] = useState<ShopifyOrderSearchResult[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<{ key: string; customer: ShopifyCustomerSummary } | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  const resetResults = () => {
    setCustomerResults(null);
    setOrderResults(null);
    setSearchError(null);
    setSelected(null);
  };

  // Prefill from the contact every time the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setMode('customers');
    setQuery(contact.phone ? `+${contact.phone.replace(/\D/g, '')}` : contact.email ?? contact.name);
    resetResults();
  }, [isOpen, contact.email, contact.phone, contact.name]);

  const switchMode = (next: SearchMode) => {
    if (next === mode) return;
    setMode(next);
    setQuery(next === 'orders' ? '' : contact.phone ? `+${contact.phone.replace(/\D/g, '')}` : contact.email ?? contact.name);
    resetResults();
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const q = query.trim();
    if (!q) return;
    setIsSearching(true);
    setSelected(null);
    // The store of the conversation's number (customerId makes the server check it's the contact's store too)
    const params = { q, customerId: contact.id, storeId: store?.id };
    try {
      if (mode === 'customers') {
        const res = await apiClient.get('/api/integrations/shopify/customers', { params });
        setCustomerResults(res.data.customers ?? []);
      } else {
        const res = await apiClient.get('/api/integrations/shopify/orders', { params });
        setOrderResults(res.data.results ?? []);
      }
      setSearchError(null);
    } catch (err) {
      setSearchError(toApiError(err));
      setCustomerResults(null);
      setOrderResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleLink = async () => {
    if (!selected) return;
    setIsLinking(true);
    try {
      const res = await apiClient.put(`/api/integrations/shopify/contacts/${contact.id}/link`, {
        shopifyCustomerId: selected.customer.id,
        storeId: store?.id,
      });
      gooeyToast.success(`${contact.name} is now linked to ${res.data.shopifyCustomer.displayName}`);
      onLinked(res.data.shopifyCustomer);
      onClose();
    } catch (err) {
      notifyError(err, { where: 'LinkCustomerModal.handleLink', title: 'Customer not linked' });
    } finally {
      setIsLinking(false);
    }
  };

  const linkedNow = (c: ShopifyCustomerSummary | null) =>
    c && currentShopifyCustomerId === c.id ? <span className="ml-1.5 text-[10px] text-emerald-700">(linked now)</span> : null;

  const results = mode === 'customers' ? customerResults : orderResults;

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Find Shopify customer" icon={<UserSearch className="w-4 h-4 text-[#3440a8]" />} maxWidth="md">
      <div className="space-y-3 text-xs">
        <p className="text-slate-500">
          Find <span className="font-semibold text-slate-700">{contact.name}</span> in{' '}
          {store ? <span className="font-semibold text-slate-700">{store.name || store.shopDomain}</span> : 'your Shopify store'}. The
          customer can have a different phone number or email than this chat.
        </p>
        <div className="flex rounded-lg bg-slate-100 p-0.5" role="tablist">
          {(Object.keys(MODE_LABELS) as SearchMode[]).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={`flex-1 py-1.5 rounded-md font-semibold cursor-pointer ${
                mode === m ? 'bg-white text-[#3440a8] shadow-sm' : 'text-slate-500 hover:text-slate-800'
              }`}
            >
              {MODE_LABELS[m].tab}
            </button>
          ))}
        </div>
        <form onSubmit={handleSearch} className="space-y-1">
          <label className="block font-semibold text-slate-700">{MODE_LABELS[mode].hint}</label>
          <div className="flex gap-2">
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={MODE_LABELS[mode].placeholder}
              autoFocus
              className="flex-1 min-w-0 px-3 py-2 border border-slate-200 rounded-lg text-[13px] outline-none focus:border-[#3440a8]"
            />
            <button
              type="submit"
              disabled={isSearching || !query.trim()}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
            >
              {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Search
            </button>
          </div>
        </form>
      </div>

      {searchError && <ErrorState error={searchError} title="Search failed" compact onRetry={() => handleSearch()} />}

      {results && results.length === 0 && (
        <div className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-600">
          {mode === 'customers'
            ? 'No Shopify customer matches. Try another spelling, the email, or search by order number.'
            : 'No order matches. Check the order number or email and search again.'}
        </div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2">
          {mode === 'customers' && customerResults && customerResults.length > 1 && (
            <p className="text-[11px] text-amber-700">{customerResults.length} customers match. Choose the right one.</p>
          )}
          <ul className="space-y-1.5 max-h-72 overflow-y-auto" role="radiogroup">
            {mode === 'customers' &&
              customerResults?.map((c) => {
                const isSelected = selected?.key === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => setSelected({ key: c.id, customer: c })}
                      className={`w-full text-left p-2.5 rounded-lg border cursor-pointer flex items-start gap-2.5 ${
                        isSelected ? 'border-[#3440a8] bg-[#f4f5fd]' : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <RadioDot selected={isSelected} />
                      <span className="min-w-0 flex-1 text-xs">
                        <span className="block font-semibold text-slate-900 truncate">
                          {c.displayName}
                          {linkedNow(c)}
                        </span>
                        {c.email && <span className="block text-slate-600 truncate">{c.email}</span>}
                        {c.phone && <span className="block text-slate-600">{c.phone}</span>}
                        <span className="block text-[11px] text-slate-400">
                          ID {c.legacyId} · {c.numberOfOrders} order{c.numberOfOrders === 1 ? '' : 's'}
                          {c.amountSpent ? ` · ${formatShopifyPrice(c.amountSpent.amount, c.amountSpent.currencyCode)} spent` : ''}
                        </span>
                        <ShopifyCustomerTags tags={c.tags} className="mt-1" />
                      </span>
                    </button>
                  </li>
                );
              })}
            {mode === 'orders' &&
              orderResults?.map(({ order, customer }) => {
                const isSelected = selected?.key === order.id;
                return (
                  <li key={order.id} className={`rounded-lg border p-1.5 ${isSelected ? 'border-[#3440a8] bg-[#f4f5fd]' : 'border-slate-200'}`}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      disabled={!customer}
                      onClick={() => customer && setSelected({ key: order.id, customer })}
                      className="w-full text-left px-1 py-1 flex items-start gap-2.5 cursor-pointer disabled:cursor-not-allowed"
                    >
                      <RadioDot selected={isSelected} />
                      <span className="min-w-0 flex-1 text-xs">
                        {customer ? (
                          <>
                            <span className="block font-semibold text-slate-900 truncate">
                              {customer.displayName}
                              {linkedNow(customer)}
                            </span>
                            <span className="block text-slate-600 truncate">{customer.email || customer.phone || `ID ${customer.legacyId}`}</span>
                            <ShopifyCustomerTags tags={customer.tags} className="mt-1" />
                          </>
                        ) : (
                          <span className="block text-slate-500">Guest checkout: there&apos;s no customer to link</span>
                        )}
                      </span>
                    </button>
                    <ShopifyOrderCard order={order} as="div" />
                  </li>
                );
              })}
          </ul>
          <button
            type="button"
            onClick={handleLink}
            disabled={!selected || isLinking}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3440a8] hover:bg-[#2b3590] text-white text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLinking && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {selected ? `Link ${selected.customer.displayName} to ${contact.name}` : `Link to ${contact.name}`}
          </button>
        </div>
      )}
    </Modal>
  );
};
