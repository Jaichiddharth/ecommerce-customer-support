'use client';

import React, { useCallback, useEffect, useState } from 'react';
import { Check, Link2, Loader2, Search, X } from 'lucide-react';
import apiClient from '@/lib/api/client';
import { ApiError, toApiError } from '@/lib/api/api-error';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { Modal } from '@/components/ui/Modal';
import { ErrorState } from '@/components/ui/states';
import type { ContactIdentity } from '@/types';
import { ChannelIcon } from './ChannelIcon';
import { CHANNEL_LABELS, formatHandle, formatPhone } from './inbox-types';

const identifierOf = (c: ContactIdentity) => formatHandle(c.handle) || formatPhone(c.phone) || c.email || '';

const IdentityRow: React.FC<{ identity: ContactIdentity; trailing?: React.ReactNode }> = ({ identity, trailing }) => {
  const type = identity.channel?.type || 'whatsapp';
  return (
    <div className="flex items-center gap-2 min-w-0">
      <ChannelIcon type={type} size="sm" />
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-slate-800 truncate">{identifierOf(identity) || identity.name}</span>
        <span className="block text-[11px] text-slate-400 truncate">
          {CHANNEL_LABELS[type] || type}
          {identity.channel?.name ? ` · ${identity.channel.name}` : ''}
        </span>
      </span>
      {trailing}
    </div>
  );
};

interface LinkIdentityModalProps {
  isOpen: boolean;
  onClose: () => void;
  contact: { id: number; name: string };
  onLinked: (identities: ContactIdentity[]) => void;
}

/** Search the workspace's contacts and add one (with its own linked channels) to this contact's profile */
const LinkIdentityModal: React.FC<LinkIdentityModalProps> = ({ isOpen, onClose, contact, onLinked }) => {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ContactIdentity[] | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<ApiError | null>(null);
  const [selected, setSelected] = useState<ContactIdentity | null>(null);
  const [isLinking, setIsLinking] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setQuery('');
    setResults(null);
    setSearchError(null);
    setSelected(null);
  }, [isOpen]);

  // Search as the agent types
  useEffect(() => {
    if (!isOpen) return;
    const q = query.trim();
    if (q.length < 2) {
      setResults(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await apiClient.get(`/api/customer/${contact.id}/identities`, { params: { q } });
        if (!cancelled) {
          setResults(res.data.candidates ?? []);
          setSearchError(null);
        }
      } catch (err) {
        if (!cancelled) setSearchError(toApiError(err));
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query, isOpen, contact.id]);

  const handleLink = async () => {
    if (!selected) return;
    setIsLinking(true);
    try {
      const res = await apiClient.put(`/api/customer/${contact.id}/identities`, { contactId: selected.id });
      gooeyToast.success(`${selected.name} is now linked to ${contact.name}`);
      onLinked(res.data.identities ?? []);
      onClose();
    } catch (err) {
      notifyError(err, { where: 'LinkIdentityModal.handleLink', title: 'Channels not linked' });
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Link another channel" icon={<Link2 className="w-4 h-4 text-[#3440a8]" />} maxWidth="md">
      <div className="space-y-3 text-xs">
        <p className="text-slate-500">
          Is <span className="font-semibold text-slate-700">{contact.name}</span> also talking to you on another channel or number? Link that
          contact so both share one customer view, including the Shopify customer and order history.
        </p>
        <div className="relative">
          <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, phone, email or @handle"
            autoFocus
            className="w-full pl-8 pr-8 py-2 border border-slate-200 rounded-lg text-[13px] outline-none focus:border-[#3440a8]"
          />
          {isSearching && <Loader2 className="w-3.5 h-3.5 text-slate-400 animate-spin absolute right-3 top-1/2 -translate-y-1/2" />}
        </div>
      </div>

      {searchError && <ErrorState error={searchError} title="Search failed" compact />}

      {results && results.length === 0 && !isSearching && (
        <div className="rounded-lg bg-slate-50 px-3 py-3 text-xs text-slate-600">No other contact matches.</div>
      )}

      {results && results.length > 0 && (
        <div className="space-y-2">
          <ul className="space-y-1.5 max-h-64 overflow-y-auto" role="radiogroup">
            {results.map((c) => {
              const isSelected = selected?.id === c.id;
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelected(c)}
                    className={`w-full text-left p-2.5 rounded-lg border cursor-pointer ${
                      isSelected ? 'border-[#3440a8] bg-[#f4f5fd]' : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <p className="text-xs font-semibold text-slate-900 truncate mb-1 flex items-center gap-1.5">
                      {isSelected && <Check className="w-3.5 h-3.5 text-[#3440a8]" />}
                      {c.name}
                    </p>
                    <IdentityRow identity={c} />
                  </button>
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
            {isLinking && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Link to {contact.name}
          </button>
        </div>
      )}
    </Modal>
  );
};

interface ContactIdentitiesProps {
  contact: { id: number; name: string };
  /** Called after channels are linked or unlinked, since that can change the profile's Shopify customer */
  onChange: () => void;
}

/** The contact's other channel identities (Instagram, Messenger, other numbers), with link / unlink */
export const ContactIdentities: React.FC<ContactIdentitiesProps> = ({ contact, onChange }) => {
  const [identities, setIdentities] = useState<ContactIdentity[]>([]);
  const [showLinkModal, setShowLinkModal] = useState(false);
  const [unlinkingId, setUnlinkingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await apiClient.get(`/api/customer/${contact.id}/identities`);
      setIdentities(res.data.identities ?? []);
    } catch (err) {
      // The rest of the panel still works without this list
      notifyError(err, { where: 'ContactIdentities.load', title: "Couldn't load linked channels" });
    }
  }, [contact.id]);

  useEffect(() => {
    setIdentities([]);
    load();
  }, [load]);

  const handleUnlink = async (identity: ContactIdentity) => {
    setUnlinkingId(identity.id);
    try {
      const res = await apiClient.delete(`/api/customer/${contact.id}/identities`, { params: { contactId: identity.id } });
      setIdentities(res.data.identities ?? []);
      gooeyToast.success(`${identifierOf(identity) || identity.name} unlinked`);
      onChange();
    } catch (err) {
      notifyError(err, { where: 'ContactIdentities.handleUnlink', title: 'Channel not unlinked' });
    } finally {
      setUnlinkingId(null);
    }
  };

  const others = identities.filter((i) => i.id !== contact.id);

  return (
    <div className="mt-3">
      {others.length > 0 && (
        <>
          <p className="text-[11px] font-semibold text-slate-500 mb-1.5">Also on</p>
          <ul className="space-y-1.5 mb-2">
            {others.map((identity) => (
              <li key={identity.id}>
                <IdentityRow
                  identity={identity}
                  trailing={
                    <button
                      type="button"
                      onClick={() => handleUnlink(identity)}
                      disabled={unlinkingId !== null}
                      title="Unlink this channel"
                      className="p-1 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 cursor-pointer disabled:opacity-50"
                    >
                      {unlinkingId === identity.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <X className="w-3.5 h-3.5" />}
                    </button>
                  }
                />
              </li>
            ))}
          </ul>
        </>
      )}
      <button
        type="button"
        onClick={() => setShowLinkModal(true)}
        className="text-[11.5px] font-semibold text-[#3440a8] hover:underline cursor-pointer inline-flex items-center gap-1"
      >
        <Link2 className="w-3.5 h-3.5" /> Link another channel
      </button>
      <LinkIdentityModal
        isOpen={showLinkModal}
        onClose={() => setShowLinkModal(false)}
        contact={contact}
        onLinked={(next) => {
          setIdentities(next);
          onChange();
        }}
      />
    </div>
  );
};
