'use client';

import React from 'react';
import { Smartphone } from 'lucide-react';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { COUNTRIES, digitsOnly, phoneRule, type PhoneValue } from '@/lib/phone';

export interface PhoneNumberInputProps {
  value: PhoneValue;
  onChange: (value: PhoneValue) => void;
  onBlur?: () => void;
  /** Shown in red under the field, replacing the hint */
  error?: string | null;
  /** Shown under the field when there's no error (default: how many digits to type). Pass null to hide. */
  hint?: React.ReactNode | null;
  id?: string;
  disabled?: boolean;
  autoFocus?: boolean;
  /** sm: 12px (compact dialogs); md: 13px (forms) */
  size?: 'sm' | 'md';
  /** Monospace digits, e.g. in the template editor */
  mono?: boolean;
  /**
   * true (default): cap typing at the country's mobile number length. false: allow any length up to the
   * E.164 limit, for business lines such as landlines or toll-free numbers.
   */
  strictLength?: boolean;
  className?: string;
}

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  description: `+${c.dial}`,
  keywords: `${c.code} ${c.dial} +${c.dial}`,
}));

/**
 * A phone number as a searchable country-code picker plus the national number (digits only, length checked
 * per country). The value is `{ country, number }`; use `toPhoneDigits` / `toE164` / `phoneError` from
 * `@/lib/phone` to read and validate it, and `parsePhone` to fill it from a stored number.
 */
export const PhoneNumberInput: React.FC<PhoneNumberInputProps> = ({
  value,
  onChange,
  onBlur,
  error,
  hint,
  id,
  disabled = false,
  autoFocus,
  size = 'md',
  mono = false,
  strictLength = true,
  className = '',
}) => {
  const rule = phoneRule(value.country);
  const maxFor = (country: string) => {
    const r = phoneRule(country);
    return strictLength ? r.max : 15 - r.dial.length;
  };
  const max = maxFor(value.country);
  const text = size === 'md' ? 'text-[13px]' : 'text-[12px]';
  const hintId = id ? `${id}-hint` : undefined;

  const defaultHint = strictLength
    ? `Enter ${rule.lengthLabel} digits without the country code (${value.number.length}/${rule.max}).`
    : 'Enter the number without the country code.';
  const shownHint = hint === undefined ? defaultHint : hint;

  // A shorter number is kept when the country changes; a longer one is cut to the new country's length
  const changeCountry = (country: string) => onChange({ country, number: value.number.slice(0, maxFor(country)) });

  // Pasting "+91 98765 43210" into the number box: drop the country code when it matches the picked country
  const changeNumber = (raw: string) => {
    let digits = digitsOnly(raw);
    if (raw.trim().startsWith('+') && rule.dial && digits.startsWith(rule.dial)) digits = digits.slice(rule.dial.length);
    onChange({ country: value.country, number: digits.slice(0, max) });
  };

  return (
    <div className={className}>
      <div
        className={`flex items-stretch w-full rounded-lg border bg-white transition-all focus-within:ring-2 ${
          disabled ? 'bg-slate-100 opacity-70' : ''
        } ${
          error
            ? 'border-red-300 focus-within:ring-red-100'
            : 'border-slate-200 focus-within:ring-[#3440a8]/20 focus-within:border-[#3440a8]/40'
        }`}
      >
        <SearchableSelect
          variant="bare"
          size={size}
          value={value.country}
          onChange={changeCountry}
          options={COUNTRY_OPTIONS}
          disabled={disabled}
          aria-label="Country code"
          searchPlaceholder="Search country or code"
          emptyText="No country matches your search"
          className="shrink-0 border-r border-slate-200 bg-slate-50 rounded-l-lg"
          renderSelected={(o) => (
            <span className="font-medium text-slate-700 whitespace-nowrap tabular-nums">
              {o.value} {o.description}
            </span>
          )}
        />
        <div className="relative flex-1 min-w-0">
          <Smartphone className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            id={id}
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            value={value.number}
            onChange={(e) => changeNumber(e.target.value)}
            onBlur={onBlur}
            disabled={disabled}
            autoFocus={autoFocus}
            placeholder={strictLength ? `${rule.lengthLabel}-digit number` : 'Phone number'}
            aria-invalid={Boolean(error)}
            aria-describedby={hintId}
            className={`w-full h-full bg-transparent pl-8 pr-3 py-2 ${text} ${mono ? 'font-mono' : ''} text-slate-800 placeholder:text-slate-400 focus:outline-none rounded-r-lg disabled:cursor-not-allowed`}
          />
        </div>
      </div>
      {error ? (
        <p id={hintId} className="text-[11px] mt-1 text-red-600">{error}</p>
      ) : shownHint ? (
        <p id={hintId} className="text-[11px] mt-1 text-slate-400">{shownHint}</p>
      ) : null}
    </div>
  );
};

export default PhoneNumberInput;
