/**
 * Test-case CSV import. Forgiving on purpose, because files come from Excel, Google Sheets and Numbers:
 *  - comma, semicolon or tab separated (detected from the header line), quoted fields, "" escapes, CRLF;
 *  - header names matched loosely ("Question", "Customer question", "Query", "Expected answer", ...);
 *  - a file without a recognisable header but with text in the first column is read as one question per row;
 *  - rows without a question are skipped and counted instead of failing the whole file.
 */

export function detectDelimiter(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? "";
  const counts = [",", ";", "\t"].map((d) => ({ d, n: firstLine.split(d).length - 1 }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 0 ? counts[0].d : ",";
}

export function parseCsv(input: string, delimiter = detectDelimiter(input.replace(/^﻿/, ""))): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const text = input.replace(/^﻿/, "");
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field.trim() === "") { quoted = true; field = ""; }
    else if (ch === delimiter) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

/** Normalised header → test case field */
const KEYS: Record<string, string> = {
  question: "question", questions: "question", customerquestion: "question", query: "question", prompt: "question",
  message: "question", customermessage: "question", usermessage: "question", input: "question", q: "question",
  utterance: "question", text: "question",
  expected: "expected", expectedanswer: "expected", expectedreply: "expected", expectedresponse: "expected",
  expectation: "expected", answer: "expected", idealanswer: "expected", goodanswer: "expected", a: "expected",
  category: "category", type: "category", topic: "category",
  expectoutcome: "expectOutcome", expectedoutcome: "expectOutcome", outcome: "expectOutcome",
  mustinclude: "mustInclude", mustcontain: "mustInclude", include: "mustInclude", keywords: "mustInclude",
  mustnotinclude: "mustNotInclude", mustnotcontain: "mustNotInclude", exclude: "mustNotInclude",
  language: "language", replylanguage: "language", lang: "language",
  customerid: "asUser.id", customeremail: "asUser.email", email: "asUser.email",
  customerphone: "asUser.phone", phone: "asUser.phone", customername: "asUser.name",
};

const headerKey = (h: string) => KEYS[h.toLowerCase().replace(/[^a-z]/g, "")];

export interface ImportResult {
  cases: Record<string, any>[];
  skipped: number;
}

/** CSV text → test case objects (see TEST_CASE_CSV_HEADER for the columns). */
export function testCasesFromCsv(csv: string): ImportResult {
  const [header, ...rest] = parseCsv(csv);
  if (!header) throw new Error("The file is empty.");
  let keys: (string | undefined)[] = header.map(headerKey);
  let rows = rest;
  if (!keys.includes("question")) {
    // No header we know: one question per row from the first column (and the second as the expectation)
    const looksLikeHeader = header.length > 1 && header.every((h) => h.trim().length < 40 && !/[?]/.test(h));
    if (looksLikeHeader) {
      throw new Error(
        `Couldn't find a question column. Found: ${header.map((h) => `"${h.trim()}"`).join(", ")}. Name one column "question".`,
      );
    }
    keys = header.map((_, i) => (i === 0 ? "question" : i === 1 ? "expected" : undefined));
    rows = [header, ...rest];
  }
  let skipped = 0;
  const cases: Record<string, any>[] = [];
  for (const cells of rows) {
    const out: Record<string, any> = {};
    keys.forEach((key, i) => {
      const value = (cells[i] ?? "").trim();
      if (!key || !value) return;
      if (key.startsWith("asUser.")) (out.asUser ??= {})[key.slice(7)] = value;
      else out[key] = value;
    });
    if (!out.question) { skipped++; continue; }
    cases.push(out);
    if (cases.length === 500) break;
  }
  if (!cases.length) throw new Error("No rows with a question were found.");
  return { cases, skipped };
}

export const TEST_CASE_CSV_HEADER =
  "question,expected,category,expect_outcome,must_include,must_not_include,language,customer_id";

export const TEST_CASE_CSV_SAMPLE = `${TEST_CASE_CSV_HEADER}
What is your return policy?,Mentions the return window,Policy & FAQ,answered,return,,,
I want a refund,Hands over to the team,Handover,handover,,,,
Where is my order?,Shows the latest order status,Order status,answered,,,,
`;

/** Test cases as JSON (Shopify order exports are accepted too, see test-json.ts) */
export const TEST_CASE_JSON_SAMPLE = JSON.stringify(
  [
    { question: "What is your return policy?", expected: "Mentions the return window", category: "Policy & FAQ", must_include: ["return"] },
    { question: "I want a refund", category: "Handover", expect_outcome: "handover" },
  ],
  null,
  2,
);
