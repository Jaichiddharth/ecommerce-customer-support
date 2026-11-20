import countries from '../../countryCode.json';

/**
 * Phone numbers entered in the app are a country + a national number. The full number sent to the API is
 * the dial code followed by the national number, digits only (E.164 without "+"), e.g. 919876543210.
 */

export interface Country {
  /** ISO 3166-1 alpha-2, e.g. "IN" */
  code: string;
  name: string;
  /** Dial code digits, e.g. "91" */
  dial: string;
}

export interface PhoneValue {
  /** ISO country code */
  country: string;
  /** National number, digits only, without the country code or trunk 0 */
  number: string;
}

export const DEFAULT_COUNTRY = 'IN';

export const COUNTRIES: Country[] = (countries as { name: string; dial_code: string; code: string }[])
  .map((c) => ({ code: c.code, name: c.name, dial: (c.dial_code ?? '').replace(/\D/g, '') }))
  .filter((c) => c.dial);

/**
 * Allowed national (mobile) number lengths, without the country code or trunk 0.
 * Countries not listed fall back to a generic range so the full E.164 number stays ≤ 15 digits.
 */
const NATIONAL_LENGTHS: Record<string, [min: number, max: number]> = {
  IN: [10, 10], US: [10, 10], CA: [10, 10], GB: [10, 10], AU: [9, 9], NZ: [8, 10],
  AE: [9, 9], SA: [9, 9], QA: [8, 8], KW: [8, 8], OM: [8, 8], BH: [8, 8], EG: [10, 10],
  PK: [10, 10], BD: [10, 10], LK: [9, 9], NP: [10, 10], SG: [8, 8], MY: [9, 10],
  ID: [9, 12], PH: [10, 10], TH: [9, 9], VN: [9, 10], CN: [11, 11], JP: [10, 10], KR: [9, 10],
  DE: [10, 11], FR: [9, 9], IT: [9, 10], ES: [9, 9], NL: [9, 9], TR: [10, 10], RU: [10, 10],
  BR: [10, 11], MX: [10, 10], ZA: [9, 9], NG: [10, 10], KE: [9, 9],
};

/** The country picked when several share a dial code and the number alone can't tell them apart */
const PRIMARY_FOR_DIAL: Record<string, string> = { '1': 'US', '7': 'RU', '44': 'GB', '61': 'AU', '47': 'NO', '358': 'FI' };

export const digitsOnly = (v: string) => v.replace(/\D/g, '');

export const findCountry = (code: string) => COUNTRIES.find((c) => c.code === code);

export function phoneRule(countryCode: string) {
  const c = findCountry(countryCode);
  const dial = c?.dial ?? '';
  const [min, max] = NATIONAL_LENGTHS[countryCode] ?? [6, 15 - dial.length];
  const lengthLabel = min === max ? `${min}` : `${min}–${max}`;
  return { dial, name: c?.name ?? countryCode, min, max, lengthLabel };
}

export const emptyPhone = (country: string = DEFAULT_COUNTRY): PhoneValue => ({ country, number: '' });

/** Full number, digits only with the country code (e.g. "919876543210"); empty when no number was typed */
export function toPhoneDigits(value: PhoneValue): string {
  return value.number ? phoneRule(value.country).dial + value.number : '';
}

/** Full number for display or APIs that want it, e.g. "+919876543210"; empty when no number was typed */
export const toE164 = (value: PhoneValue) => (value.number ? `+${toPhoneDigits(value)}` : '');

/** Why the number can't be used, or null when it's valid. An empty number is an error only when required. */
export function phoneError(value: PhoneValue, { required = true }: { required?: boolean } = {}): string | null {
  const rule = phoneRule(value.country);
  if (!value.number) return required ? 'Enter a phone number.' : null;
  if (value.number.startsWith('0')) return 'Don’t start with 0. Enter the number without the leading zero.';
  if (value.number.length < rule.min || value.number.length > rule.max) {
    return `Enter a ${rule.lengthLabel}-digit number for ${rule.name} (+${rule.dial}).`;
  }
  return null;
}

/**
 * Splits a stored or pasted number ("+91 98765 43210", "919876543210", "9876543210") into country + national
 * number. Digits that fit the fallback country's national length are taken as a national number unless the
 * input starts with "+"; otherwise the longest matching dial code wins.
 */
export function parsePhone(input: string | null | undefined, fallbackCountry: string = DEFAULT_COUNTRY): PhoneValue {
  const raw = (input ?? '').trim();
  let digits = digitsOnly(raw);
  if (!digits) return emptyPhone(fallbackCountry);
  if (raw.startsWith('00')) digits = digits.slice(2);
  const international = raw.startsWith('+') || raw.startsWith('00');

  const fits = (code: string, national: string) => {
    const r = phoneRule(code);
    return national.length >= r.min && national.length <= r.max;
  };

  // The fallback country first: its own dial code, then a bare national number
  const fallback = phoneRule(fallbackCountry);
  if (fallback.dial && digits.startsWith(fallback.dial) && fits(fallbackCountry, digits.slice(fallback.dial.length))) {
    return { country: fallbackCountry, number: digits.slice(fallback.dial.length) };
  }
  if (!international && fits(fallbackCountry, digits.replace(/^0+/, ''))) {
    return { country: fallbackCountry, number: digits.replace(/^0+/, '') };
  }

  // Longest dial code that leaves a number of a valid length
  for (let len = 4; len >= 1; len--) {
    const dial = digits.slice(0, len);
    const matches = COUNTRIES.filter((c) => c.dial === dial && fits(c.code, digits.slice(len)));
    if (matches.length) {
      const country = matches.find((c) => c.code === PRIMARY_FOR_DIAL[dial]) ?? matches[0];
      return { country: country.code, number: digits.slice(len) };
    }
  }

  // Unrecognised: keep the digits on the fallback country so validation shows what's wrong
  return { country: fallbackCountry, number: digits };
}
