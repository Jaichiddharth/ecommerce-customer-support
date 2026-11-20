'use client';

import React, { useEffect, useState } from 'react';
import { UserPlus } from 'lucide-react';
import { Modal } from '@/components/ui/Modal';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { apiClient } from '@/lib/api/client';
import { notifyError } from '@/lib/api/notify';
import { gooeyToast } from '@/components/ui/goey-toaster';
import { formatPhone } from '@/components/inbox/inbox-types';
import { PhoneNumberInput } from '@/components/ui/PhoneNumberInput';
import { emptyPhone, phoneError as getPhoneError, toPhoneDigits, type PhoneValue } from '@/lib/phone';
import type { ContactChannelSummary } from '@/types/contacts';

interface AddContactModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Live channels; contacts can be added to WhatsApp numbers only */
  channels: ContactChannelSummary[];
  /** Preselected number, e.g. the channel the page is showing */
  defaultChannelId: number | null;
  onAdded: (channelId: number) => void;
}

const inputClass =
  'w-full px-3 py-2 text-[13px] border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-[#3440a8] focus:ring-1 focus:ring-[#3440a8] disabled:bg-slate-100 disabled:cursor-not-allowed';

/** Adds a contact to a WhatsApp number (POST /api/customer); the contact also gets an inbox conversation */
export const AddContactModal: React.FC<AddContactModalProps> = ({ isOpen, onClose, channels, defaultChannelId, onAdded }) => {
  const numbers = channels.filter((c) => c.type === 'whatsapp');
  const [channelId, setChannelId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState<PhoneValue>(() => emptyPhone());
  const [phoneTouched, setPhoneTouched] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  // Each time it opens: an empty form on the number the page is showing (or the first number)
  useEffect(() => {
    if (!isOpen) return;
    setName('');
    // Keep the last picked country; only the number is cleared
    setPhone((p) => emptyPhone(p.country));
    setPhoneTouched(false);
    setChannelId(numbers.some((c) => c.id === defaultChannelId) ? defaultChannelId : numbers[0]?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  const digits = toPhoneDigits(phone);
  const phoneError = getPhoneError(phone);
  // Shown once the field was left, or as soon as what's typed can't become valid (too long / leading 0)
  const shownPhoneError = phone.number && (phoneTouched || phone.number.startsWith('0')) ? phoneError : null;
  const canSave = Boolean(channelId && name.trim() && !phoneError && !isSaving);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSave || !channelId) return;
    setIsSaving(true);
    try {
      await apiClient.post('/api/customer', { name: name.trim(), phone: digits, channelId });
      const channel = numbers.find((c) => c.id === channelId);
      gooeyToast.success(`${name.trim()} added`, { description: channel ? `${channel.name} · ${formatPhone(channel.phoneNumber)}` : undefined });
      onAdded(channelId);
      onClose();
    } catch (err) {
      notifyError(err, { where: 'AddContactModal.submit', title: "Couldn't add contact" });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={() => !isSaving && onClose()}
      title="Add contact"
      icon={<UserPlus className="w-4 h-4 text-[#3440a8]" />}
      maxWidth="sm"
    >
      {numbers.length === 0 ? (
        <p className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-[12px] text-amber-800">
          Connect a WhatsApp number in Settings before adding contacts.
        </p>
      ) : (
        <form onSubmit={submit} className="space-y-3.5 text-[12px]">
          <div>
            <label htmlFor="add-contact-number" className="block font-semibold text-slate-700 mb-1">
              WhatsApp number
            </label>
            <SearchableSelect
              id="add-contact-number"
              size="md"
              value={channelId != null ? String(channelId) : null}
              onChange={(v) => setChannelId(Number(v))}
              aria-label="WhatsApp number"
              placeholder="Choose a WhatsApp number"
              searchPlaceholder="Search by name or number"
              emptyText="No WhatsApp number matches your search"
              options={numbers.map((c) => ({
                value: String(c.id),
                label: c.name,
                description: c.phoneNumber ? formatPhone(c.phoneNumber) : undefined,
                keywords: c.phoneNumber ?? undefined,
              }))}
            />
            <p className="text-[11px] text-slate-400 mt-1">The contact belongs to this number, with its own consent.</p>
          </div>

          <div>
            <label htmlFor="add-contact-name" className="block font-semibold text-slate-700 mb-1">
              Name
            </label>
            <input
              id="add-contact-name"
              type="text"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={255}
              placeholder="e.g. Priya Ramesh"
              className={inputClass}
            />
          </div>

          <div>
            <label htmlFor="add-contact-phone" className="block font-semibold text-slate-700 mb-1">
              Phone number
            </label>
            <PhoneNumberInput
              id="add-contact-phone"
              value={phone}
              onChange={setPhone}
              onBlur={() => setPhoneTouched(true)}
              error={shownPhoneError}
              hint={!phoneError ? `Will be saved as +${digits}` : undefined}
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={isSaving}
              className="px-3.5 py-2 text-[13px] text-slate-600 hover:bg-slate-100 rounded-lg cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="px-3.5 py-2 text-[13px] font-semibold text-white bg-[#3440a8] hover:bg-[#2b358d] rounded-lg cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSaving ? 'Adding…' : 'Add contact'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
};
