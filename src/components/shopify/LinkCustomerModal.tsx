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
import type { ShopifyCustomerSummary } from '@/lib/shopify/types';

interface LinkCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: { id: number; name: string; email: string | null; phone: string | null };
  /** Shopify customer currently linked, so it can be marked in the results */
  currentShopifyCustomerId?: string | null;
  onLinked: (customer: ShopifyCustomerSummary) => void;
}

/**
 * Search Shopify customers by email or phone and link one to the contact.
 * Nothing is linked automatically: the agent always picks the result and confirms.
 */
export const LinkCustomerModal: React.FC<LinkCustomerModalProps> = ({ isOpen, onClose, contact, currentShopifyCustomerId, onLinked }) => {
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [results, setResults] = useState<ShopifyCustomerSummary[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  // Prefill from the contact every time the modal opens
  useEffect(() => {
    if (!isOpen) return;
    setEmail(contact.email ?? '');
    setPhone(contact.phone ? `+${contact.phone.replace(/\D/g, '')}` : '');
    setResults(null);
    setSearchError(null);
    setSelectedId(null);
  }, [isOpen, contact.email, contact.phone]);

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!email.trim() && !phone.trim()) return;
    setIsSearching(true);
    setSelectedId(null);
    try {
      const res = await apiClient.get('/api/integrations/shopify/customers', {
        params: { email: email.trim() || undefined, phone: phone.trim() || undefined },
      });
      setResults(res.data.customers ?? []);
      setSearchError(null);
    } catch (err) {
      setSearchError(toApiError(err));
      setResults(null);
    } finally {
      setIsSearching(false);
    }
  };

  const handleLink = async () => {
    if (!selectedId) return;
    setIsLinking(true);
    try {
      const res = await apiClient.put(`/api/integrations/shopify/contacts/${contact.id}/link`, { shopifyCustomerId: selectedId });
      gooeyToast.success(`${contact.name} is now linked to ${res.data.shopifyCustomer.displayName}`);
      onLinked(res.data.shopifyCustomer);
      onClose();
    } catch (err) {
      notifyError(err, { where: 'LinkCustomerModal.handleLink', title: 'Customer not linked' });
    } finally {
      setIsLinking(false);
    }
  };

  const inputClass = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-[13px] outline-none focus:border-[#3440a8]';

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Find Shopify customer" icon={<UserSearch className="w-4 h-4 text-[#3440a8]" />} maxWidth="md">
      <form onSubmit={handleSearch} className="space-y-3 text-xs">
        <p className="text-slate-500">
          Search your Shopify store for <span className="font-semibold text-slate-700">{contact.name}</span> by email or phone, then pick
          the right customer.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Email</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" className={inputClass} />
          </div>
          <div>
            <label className="block font-semibold text-slate-700 mb-1">Phone (with country code)</label>
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+91 98765 43210" className={inputClass} />
          </div>
        </div>
        <button
          type="submit"
          disabled={isSearching || (!email.trim() && !phone.trim())}
          className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg border border-slate-200 font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer disabled:opacity-50"
        >
          {isSearching ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Search className="w-3.5 h-3.5" />} Search Shopify
        </button>
      </form>

      {searchError && <ErrorState error={searchError} title="Search failed" compact onRetry={() => handleSearch()} />}

      {results && results.length === 0 && (
        <div className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-600">
          No Shopify customer has this email or phone number. Check the details and search again — customers aren&apos;t created
          automatically.
        </div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2">
          {results.length > 1 && <p className="text-[11px] text-amber-700">{results.length} customers match. Choose the right one.</p>}
          <ul className="space-y-1.5 max-h-64 overflow-y-auto" role="radiogroup">
            {results.map((c) => {
              const selected = selectedId === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setSelectedId(c.id)}
                    className={`w-full text-left p-2.5 rounded-lg border cursor-pointer flex items-start gap-2.5 ${
                      selected ? 'border-[#3440a8] bg-[#f4f5fd]' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span
                      className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center shrink-0 ${
                        selected ? 'bg-[#3440a8] border-[#3440a8] text-white' : 'border-slate-300'
                      }`}
                    >
                      {selected && <Check className="w-3 h-3" />}
                    </span>
                    <span className="min-w-0 flex-1 text-xs">
                      <span className="block font-semibold text-slate-900 truncate">
                        {c.displayName}
                        {currentShopifyCustomerId === c.id && <span className="ml-1.5 text-[10px] text-emerald-700">(linked now)</span>}
                      </span>
                      {c.email && <span className="block text-slate-600 truncate">{c.email}</span>}
                      {c.phone && <span className="block text-slate-600">{c.phone}</span>}
                      <span className="block text-[11px] text-slate-400">
                        ID {c.legacyId} · {c.numberOfOrders} order{c.numberOfOrders === 1 ? '' : 's'}
                        {c.amountSpent ? ` · ${formatShopifyPrice(c.amountSpent.amount, c.amountSpent.currencyCode)} spent` : ''}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <button
            type="button"
            onClick={handleLink}
            disabled={!selectedId || isLinking}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-[#3440a8] hover:bg-[#2b3590] text-white text-xs font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isLinking && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Link to {contact.name}
          </button>
        </div>
      )}
    </Modal>
  );
};
