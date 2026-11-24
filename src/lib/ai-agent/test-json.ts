/**
 * Test-case JSON import. Accepts either
 *  1. test cases: an array (or { cases: [...] }) of objects with a question and optional expectations, or
 *  2. Shopify orders, as Shopify gives them out: the REST Admin API ({ orders: [...] } / { order: {...} }),
 *     the GraphQL Admin API ({ data: { orders: { nodes | edges } } }), a plain array of orders, or a bulk
 *     export (one JSON object per line).
 * Orders become order-status test cases ("Where is my order #1001?") that carry their own order data, so the
 * agent's WISMO answers can be tested without a live store or real customers.
 */
import type { ImportResult } from "./csv";
import { findOrders, ordersToChecks, parseJson, parseSampleOrders } from "./sample-data";

type Node = Record<string, any>;

const isTestCase = (o: unknown) => !!o && typeof o === "object" && ["question", "q", "prompt", "query"].some((k) => typeof (o as Node)[k] === "string");

function casesFromOrders(text: string): ImportResult {
  const parsed = parseSampleOrders(text, "json");
  return { cases: ordersToChecks(parsed.items), skipped: parsed.skipped };
}

// ---------------------------------------------------------------- test cases

const pick = (o: Node, ...keys: string[]) => keys.map((k) => o[k]).find((v) => v !== undefined && v !== null && v !== "");

function casesFromObjects(items: Node[]): ImportResult {
  let skipped = 0;
  const cases: Record<string, any>[] = [];
  for (const o of items) {
    const question = pick(o, "question", "q", "prompt", "query");
    if (typeof question !== "string" || !question.trim()) { skipped++; continue; }
    cases.push({
      question,
      expected: pick(o, "expected", "expected_answer", "expectedAnswer", "answer"),
      category: pick(o, "category"),
      expectOutcome: pick(o, "expectOutcome", "expect_outcome", "outcome"),
      mustInclude: pick(o, "mustInclude", "must_include"),
      mustNotInclude: pick(o, "mustNotInclude", "must_not_include"),
      language: pick(o, "language"),
      asUser: pick(o, "asUser", "as_user", "customer"),
    });
    if (cases.length === 500) break;
  }
  if (!cases.length) throw new Error("No test cases with a question were found.");
  return { cases, skipped };
}

/** JSON text → test case objects, from test cases or from Shopify orders */
export function testCasesFromJson(text: string): ImportResult & { kind: "cases" | "orders" } {
  const doc = parseJson(text);
  const list = Array.isArray(doc) ? doc : Array.isArray((doc as Node)?.cases) ? (doc as Node).cases : Array.isArray((doc as Node)?.testCases) ? (doc as Node).testCases : null;
  if (list && list.some(isTestCase)) return { ...casesFromObjects(list), kind: "cases" };
  if (findOrders(doc).length) return { ...casesFromOrders(text), kind: "orders" };
  throw new Error('Couldn\'t find test cases (objects with a "question") or Shopify orders in this file.');
}
