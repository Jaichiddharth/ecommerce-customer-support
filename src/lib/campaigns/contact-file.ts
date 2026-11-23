import { digitsOnly, parsePhone, phoneError, toE164 } from '@/lib/phone';

/**
 * Contact file parsing shared by the browser (instant preview in the wizard) and the server (the import that
 * is actually stored), so both apply exactly the same rules.
 */

/** One contact from the file; `phone` is E.164 ("+919876543210"), `fields` holds every column by header */
export interface CampaignRecipient {
  phone: string;
  fields: Record<string, string>;
  /** The file had no country code for this number; the default country's code was added */
  countryAdded?: boolean;
}

/** A row that was left out of the audience, with the reason shown to the user */
export interface RejectedRow {
  /** 1-based row number in the file, counting the header row */
  row: number;
  value: string;
  reason: string;
}

/** What the import found, without the recipients themselves (stored on the campaign) */
export interface AudienceSummary {
  fileName: string;
  fileSize: number;
  /** Column headers in file order */
  columns: string[];
  phoneColumn: string;
  /** ISO country whose code is added to numbers written without one; '' = none, such numbers are skipped */
  defaultCountry: string;
  /** Data rows in the file (header excluded) */
  totalRows: number;
  recipientCount: number;
  rejectedCount: number;
  /** Skipped rows; may be only the first part of the list when stored on the server (see rejectedCount) */
  rejected: RejectedRow[];
  duplicates: number;
  /** Recipients whose country code came from `defaultCountry` */
  countryAdded: number;
  /**
   * Recipients with an empty cell, per column (columns with none are left out). Missing on audiences imported
   * before this was added.
   */
  emptyCells?: Record<string, number>;
}

/** A full import: the summary plus every valid recipient */
export interface ParsedAudience extends AudienceSummary {
  recipients: CampaignRecipient[];
}

export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_ROWS = 50_000;

export interface ParsedSheet {
  columns: string[];
  rows: Record<string, string>[];
}

/** File types the contact upload accepts (for the input's `accept` and the format guide) */
export const ACCEPTED_EXTENSIONS = ['.csv', '.xlsx', '.xls'] as const;
export const ACCEPT_ATTR = '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel';

export class SheetError extends Error {}

/** Header row + data rows (string cells) → columns and keyed rows, ignoring blank lines */
function toSheet(records: string[][]): ParsedSheet {
  const nonEmpty = records.filter((r) => r.some((cell) => String(cell ?? '').trim() !== ''));
  if (nonEmpty.length === 0) return { columns: [], rows: [] };

  // Blank or repeated headers get a unique name so no column is lost
  const seen = new Map<string, number>();
  const columns = nonEmpty[0].map((raw, i) => {
    const base = String(raw ?? '').trim() || `Column ${i + 1}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base} (${n})` : base;
  });

  const rows = nonEmpty.slice(1).map((cells) => {
    const row: Record<string, string> = {};
    columns.forEach((col, i) => (row[col] = String(cells[i] ?? '').trim()));
    return row;
  });
  return { columns, rows };
}

/** CSV via PapaParse: delimiter auto-detected (comma, semicolon, tab), quoted fields, BOM */
export async function parseCsvText(text: string): Promise<ParsedSheet> {
  const { default: Papa } = await import('papaparse');
  const result = Papa.parse<string[]>(text.replace(/^﻿/, ''), {
    skipEmptyLines: 'greedy',
    delimitersToGuess: [',', ';', '\t', '|'],
  });
  // Field-count mismatches are fine (short rows are padded); only a broken quote makes the file unreadable
  const fatal = result.errors.find((e) => e.type === 'Quotes');
  if (fatal) throw new SheetError(`Row ${(fatal.row ?? 0) + 1} has an unclosed quote ("). Fix it and upload again.`);
  return toSheet(result.data);
}

/**
 * First non-empty worksheet of an .xlsx / .xls file via SheetJS. Cells keep the text Excel shows (dates,
 * currency), except whole numbers of 7+ digits, which are written out in full so phone numbers and order ids
 * aren't turned into "9.17E+11".
 */
export async function parseWorkbook(data: ArrayBuffer): Promise<ParsedSheet> {
  const XLSX = await import('xlsx');
  const workbook = XLSX.read(data, { type: 'array', cellDates: true, dense: true });
  for (const name of workbook.SheetNames) {
    const sheet = workbook.Sheets[name];
    if (!sheet?.['!ref']) continue;
    const range = XLSX.utils.decode_range(sheet['!ref']);
    const records: string[][] = [];
    for (let r = range.s.r; r <= range.e.r; r++) {
      const record: string[] = [];
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = sheet['!data']?.[r]?.[c];
        if (!cell || cell.v == null) record.push('');
        else if (cell.t === 'n' && Number.isInteger(cell.v) && Math.abs(cell.v as number) >= 1e6) record.push(String(cell.v));
        else record.push(XLSX.utils.format_cell(cell));
      }
      records.push(record);
    }
    const parsed = toSheet(records);
    if (parsed.rows.length > 0) return parsed;
  }
  return { columns: [], rows: [] };
}

/** Reads an uploaded contact file (.csv, .xlsx or .xls) into columns and rows */
export async function parseContactFile(file: File): Promise<ParsedSheet> {
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (ext === '.csv') return parseCsvText(await file.text());
  if (ext === '.xlsx' || ext === '.xls') {
    try {
      return await parseWorkbook(await file.arrayBuffer());
    } catch {
      throw new SheetError("Couldn't open this Excel file. If it's password-protected, remove the password or save it as CSV.");
    }
  }
  throw new SheetError('Upload a .csv, .xlsx or .xls file.');
}

const PHONE_HEADER_RE = /phone|mobile|whats ?app|wa ?number|msisdn|contact ?number|^number$/i;

/** The column most likely to hold phone numbers, by header name, or by content as a fallback */
export function guessPhoneColumn(sheet: ParsedSheet): string {
  const byName = sheet.columns.find((c) => PHONE_HEADER_RE.test(c));
  if (byName) return byName;
  const sample = sheet.rows.slice(0, 20);
  const byContent = sheet.columns.find(
    (c) => sample.length > 0 && sample.filter((r) => /^\+?[\d\s\-()]{8,}$/.test(r[c] ?? '')).length >= sample.length * 0.8
  );
  return byContent ?? '';
}

/** Validates and normalizes the phone column, dropping invalid numbers and repeats of the same number */
export function buildAudience(
  sheet: ParsedSheet,
  meta: { fileName: string; fileSize: number; phoneColumn: string; defaultCountry: string }
): ParsedAudience {
  const recipients: CampaignRecipient[] = [];
  const rejected: RejectedRow[] = [];
  const seen = new Set<string>();
  let duplicates = 0;
  let countryAdded = 0;

  sheet.rows.forEach((fields, index) => {
    const row = index + 2; // header is row 1
    const value = fields[meta.phoneColumn] ?? '';
    if (!value) {
      rejected.push({ row, value, reason: 'No phone number' });
      return;
    }
    if (/^\d(\.\d+)?e\+?\d+$/i.test(value)) {
      rejected.push({ row, value, reason: 'Changed by Excel to scientific notation. Format the column as text and export again.' });
      return;
    }
    const written = digitsOnly(value).replace(/^00/, '');
    // No default country: every number must carry its own code. Without a "+" (or 00) a 10-digit local number
    // can look like a valid foreign one (5065734680 → Costa Rica +506), so short bare numbers are skipped.
    if (!meta.defaultCountry && !/^\s*(\+|00)/.test(value) && written.length < 11) {
      rejected.push({ row, value, reason: 'No country code. Write it as +<country code><number>, or pick a default country.' });
      return;
    }
    const phone = meta.defaultCountry ? parsePhone(value, meta.defaultCountry) : parsePhone(`+${written}`);
    const problem = phoneError(phone);
    if (problem) {
      rejected.push({
        row,
        value,
        reason: meta.defaultCountry ? problem : 'Not a valid number with a country code (e.g. +14155550123).',
      });
      return;
    }
    const e164 = toE164(phone);
    if (seen.has(e164)) {
      duplicates++;
      return;
    }
    seen.add(e164);
    // The number didn't include a country code, so the default country's code was put in front
    const added = digitsOnly(e164) !== written;
    if (added) countryAdded++;
    recipients.push({ phone: e164, fields, ...(added ? { countryAdded: true } : {}) });
  });

  // Empty cells among the contacts that will be sent to, so the variable mapping can warn about them
  const emptyCells: Record<string, number> = {};
  for (const col of sheet.columns) {
    const empty = recipients.reduce((n, r) => (r.fields[col]?.trim() ? n : n + 1), 0);
    if (empty > 0) emptyCells[col] = empty;
  }

  return {
    fileName: meta.fileName,
    fileSize: meta.fileSize,
    columns: sheet.columns,
    phoneColumn: meta.phoneColumn,
    defaultCountry: meta.defaultCountry,
    totalRows: sheet.rows.length,
    recipientCount: recipients.length,
    rejectedCount: rejected.length,
    recipients,
    rejected,
    duplicates,
    countryAdded,
    emptyCells,
  };
}

/** The sample file offered for download */
export const SAMPLE_CSV = [
  'phone,first_name,last_name,email,city,order_id,discount_code',
  '+919876543210,Priya,Sharma,priya@example.com,Chennai,ORD-1001,DIWALI10',
  '+14155550123,John,Smith,john@example.com,San Francisco,ORD-1002,WELCOME5',
  '9876501234,Arjun,Kumar,arjun@example.com,Coimbatore,ORD-1003,DIWALI10',
].join('\r\n');

export const formatBytes = (bytes: number) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;
