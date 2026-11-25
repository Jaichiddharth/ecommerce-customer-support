/**
 * Sample data for testing the AI agent without real customers or a live store (AI agent > Test data):
 *  - sample orders, for order-status (WISMO) answers: a Shopify orders export (CSV or JSON) or a simple template;
 *  - sample products, for the shopping assistant: a Shopify products export (CSV or JSON) or a simple template.
 * Help and FAQ answers come from the agent's Knowledge, as in production.
 *
 * The test chat and the widget preview can answer from this data, and checks (test cases) are generated from it
 * automatically, so nobody has to write test questions by hand.
 */
import type { AgentCommerceContext, AgentOrder, AgentOrderStatus } from "./commerce/types";
import { toAgentAddress, toAgentOrder } from "./commerce/shopify";
import { parseCsv } from "./csv";

type Node = Record<string, any>;

export const MAX_SAMPLE_ORDERS = 5000;
export const MAX_SAMPLE_PRODUCTS = 2000;
const MAX_ORDERS_PER_CUSTOMER = 50;
export const MAX_ORDER_CHECKS = 50;
/** Checks that ask about another column of the order (payment mode, category, discount...) */
export const MAX_DETAIL_CHECKS = 25;
export const MAX_PRODUCT_CHECKS = 30;
export const MAX_PRODUCT_DETAIL_CHECKS = 15;
const CATALOG_SIZE = 6;
const SAMPLE_STORE = { ref: "sample:orders", platform: "shopify", name: "Sample orders" };

export interface SampleCustomer {
  ref: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  orders: AgentOrder[];
}

export interface SampleProduct {
  title: string;
  price: string | null;
  compare_at_price: string | null;
  description: string | null;
  url: string | null;
  image_url: string | null;
  buy_url: string | null;
  available: boolean;
  /** Tags and product type, for matching visitors' words */
  keywords: string;
  /** Test data only: every other column of the file (brand, size, colour, rating...), by its header as written */
  details?: Record<string, string>;
}

export interface ParseResult<T> {
  items: T[];
  /** Rows / objects that couldn't be used (no order number, no title) */
  skipped: number;
  /** CSV files: which columns were read */
  columns?: ColumnReport;
}

// ---------------------------------------------------------------- shared

export function parseJson(text: string): unknown {
  const clean = text.replace(/^﻿/, "").trim();
  if (!clean) throw new Error("The file is empty.");
  try {
    return JSON.parse(clean);
  } catch (err) {
    // Shopify bulk operations export one JSON object per line
    const lines = clean.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length > 1) {
      try {
        return lines.map((l) => JSON.parse(l));
      } catch { /* fall through to the original error */ }
    }
    throw new Error(`This isn't valid JSON (${err instanceof Error ? err.message.replace(/^JSON\.parse: /, "") : "parse error"}).`);
  }
}

const norm = (h: string) => h.toLowerCase().replace(/[^a-z0-9]/g, "");
const str = (v: unknown, max = 200): string | null => (v === undefined || v === null || String(v).trim() === "" ? null : String(v).trim().slice(0, max));
const stripHtml = (html: unknown) => str(String(html ?? "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " "), 300);

/** CSV text → rows as objects keyed by normalised header ("Lineitem name" → "lineitemname"), and the headers as written */
function csvTable(text: string): { rows: Node[]; headers: Map<string, string> } {
  const [header, ...rows] = parseCsv(text);
  if (!header) throw new Error("The file is empty.");
  const keys = header.map(norm);
  const headers = new Map<string, string>();
  keys.forEach((k, i) => { if (k && !headers.has(k)) headers.set(k, header[i].trim()); });
  return { rows: rows.map((cells) => Object.fromEntries(keys.map((k, i) => [k, (cells[i] ?? "").trim()]))), headers };
}
const csvObjects = (text: string): Node[] => csvTable(text).rows;

export function formatPrice(amount: unknown, currency?: string | null): string | null {
  const s = str(amount, 40);
  if (!s) return null;
  const n = Number(s.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(n) || !/\d/.test(s)) return s;
  if (!currency) return /^[\d.,\s]+$/.test(s) ? n.toLocaleString("en-IN", { maximumFractionDigits: 2 }) : s;
  try {
    return new Intl.NumberFormat("en-IN", { style: "currency", currency, maximumFractionDigits: n % 1 ? 2 : 0 }).format(n);
  } catch {
    return `${currency} ${n}`;
  }
}

// ---------------------------------------------------------------- orders: Shopify JSON (REST, GraphQL, bulk)

const isOrder = (o: unknown): o is Node =>
  !!o && typeof o === "object" && typeof (o as Node).name === "string" &&
  ["line_items", "lineItems", "fulfillment_status", "displayFulfillmentStatus", "financial_status", "displayFinancialStatus", "fulfillments", "created_at", "createdAt"]
    .some((k) => k in (o as Node));

/** Every Shopify order object in a JSON document, whichever Admin API shape it came in */
export function findOrders(doc: unknown): Node[] {
  const out: Node[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    if (isOrder(v)) { out.push(v); return; }
    const o = v as Node;
    for (const key of ["orders", "order", "data", "nodes", "edges", "node", "customer"]) if (key in o) visit(o[key], depth + 1);
  };
  visit(doc, 0);
  return out;
}

const REST_DELIVERY: Record<string, string> = {
  in_transit: "in_transit", out_for_delivery: "out_for_delivery", attempted_delivery: "attempted_delivery",
  ready_for_pickup: "ready_for_pickup", failure: "failure", label_printed: "in_transit", confirmed: "in_transit",
};

const emptyOrder = (number: string, orderDate: string | null): AgentOrder => ({
  order_number: number.slice(0, 60),
  order_id: null,
  items: "your items",
  quantity: 1,
  total: null,
  currency: null,
  status: "Pending",
  delivery_status: null,
  partially_shipped: false,
  order_date: orderDate ?? new Date().toISOString(),
  shipping_date: null,
  expected_delivery: null,
  delivered_at: null,
  cancelled_at: null,
  courier: null,
  tracking_number: null,
  tracking_url: null,
});

/** A REST Admin API order in the AI service's shape (GraphQL orders go through toAgentOrder) */
export function restOrderToAgent(o: Node): AgentOrder {
  const lines: Node[] = Array.isArray(o.line_items) ? o.line_items : [];
  const first = lines[0]?.title ? String(lines[0].title).slice(0, 120) : "your items";
  const fulfillments: Node[] = (Array.isArray(o.fulfillments) ? o.fulfillments : []).filter((f) => f.status !== "cancelled" && f.status !== "failure");
  const order: AgentOrder = {
    ...emptyOrder(String(o.name ?? o.order_number ?? "") || "your order", o.created_at ?? o.processed_at ?? null),
    order_id: o.admin_graphql_api_id ?? (o.id ? `gid://shopify/Order/${o.id}` : null),
    items: lines.length > 1 ? `${first} + ${lines.length - 1} more` : first,
    quantity: lines.reduce((n, li) => n + Number(li.quantity ?? 0), 0) || 1,
    total: o.total_price !== undefined ? Number(o.total_price) : null,
    currency: o.currency ?? null,
    shipping_address: toAgentAddress(o.shipping_address),
  };
  if (o.cancelled_at) return { ...order, status: "Cancelled", cancelled_at: o.cancelled_at };
  if (!fulfillments.length) return order;
  const latest = [...fulfillments].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
  const delivered = fulfillments.every((f) => f.shipment_status === "delivered");
  const tracking = {
    courier: latest.tracking_company ?? null,
    tracking_number: latest.tracking_number ?? latest.tracking_numbers?.[0] ?? null,
    tracking_url: [latest.tracking_url, ...(latest.tracking_urls ?? [])].find((u) => typeof u === "string" && u.startsWith("https://")) ?? null,
  };
  if (o.fulfillment_status === "fulfilled" && delivered) {
    return { ...order, status: "Delivered", delivered_at: latest.updated_at ?? null, courier: tracking.courier, tracking_number: tracking.tracking_number };
  }
  return {
    ...order,
    status: "Shipped",
    partially_shipped: o.fulfillment_status === "partial",
    delivery_status: REST_DELIVERY[latest.shipment_status] ?? null,
    shipping_date: latest.created_at ?? null,
    ...tracking,
  };
}

function jsonOrderToAgent(o: Node): AgentOrder {
  return "line_items" in o || "fulfillment_status" in o || "financial_status" in o ? restOrderToAgent(o) : toAgentOrder(o);
}

function jsonCustomerOf(o: Node) {
  const c: Node = o.customer ?? {};
  const email = c.email ?? c.defaultEmailAddress?.emailAddress ?? o.email ?? o.contact_email ?? null;
  const phone = c.phone ?? c.defaultPhoneNumber?.phoneNumber ?? o.phone ?? o.billing_address?.phone ?? null;
  const name = c.displayName ?? ([c.first_name ?? c.firstName, c.last_name ?? c.lastName].filter(Boolean).join(" ") || o.billing_address?.name || null);
  const ref = c.admin_graphql_api_id ?? (c.id ? String(c.id) : null) ?? email ?? phone ?? `guest:${o.name}`;
  return { ref: String(ref), name: str(name, 100), email: str(email), phone: str(phone, 30) };
}

// ---------------------------------------------------------------- orders: CSV (Shopify export or template)

const STATUS_ALIASES: Record<string, AgentOrderStatus> = {
  pending: "Pending", unfulfilled: "Pending", processing: "Pending", confirmed: "Pending", placed: "Pending", new: "Pending",
  shipped: "Shipped", fulfilled: "Shipped", partial: "Shipped", partiallyfulfilled: "Shipped", intransit: "Shipped", dispatched: "Shipped",
  outfordelivery: "Shipped", delivered: "Delivered", cancelled: "Cancelled", canceled: "Cancelled", returned: "Returned", refunded: "Returned",
};
const DELIVERY_ALIASES: Record<string, string> = { intransit: "in_transit", outfordelivery: "out_for_delivery", attempteddelivery: "attempted_delivery", readyforpickup: "ready_for_pickup" };

const get = (r: Node, ...keys: string[]) => keys.map((k) => r[k]).find((v) => v !== undefined && v !== null && String(v).trim() !== "");

/** Shopify's Orders export CSV: one row per line item, the order's details on its first row */
function shopifyOrdersCsv(rows: Node[], headers?: Map<string, string>): { order: AgentOrder; who: ReturnType<typeof jsonCustomerOf> }[] {
  const byName = new Map<string, { first: Node; lines: Node[] }>();
  for (const r of rows) {
    const name = str(r.name, 60);
    if (!name) continue;
    const entry = byName.get(name) ?? { first: r, lines: [] };
    entry.lines.push(r);
    byName.set(name, entry);
  }
  return Array.from(byName.entries()).map(([name, { first, lines }]) => {
    const items = lines.map((l) => str(l.lineitemname, 120)).filter(Boolean) as string[];
    const fulfillment = norm(String(first.fulfillmentstatus ?? ""));
    let order: AgentOrder = {
      ...emptyOrder(name, parseDate(first.createdat)),
      items: items.length > 1 ? `${items[0]} + ${items.length - 1} more` : items[0] ?? "your items",
      quantity: lines.reduce((n, l) => n + (Number(l.lineitemquantity) || 0), 0) || 1,
      total: first.total ? Number(first.total) : null,
      currency: str(first.currency, 10),
      shipping_address: toAgentAddress({
        name: first.shippingname, address1: first.shippingaddress1 || first.shippingstreet, address2: first.shippingaddress2,
        city: first.shippingcity, province: first.shippingprovincename || first.shippingprovince, zip: first.shippingzip,
        country: first.shippingcountry, phone: first.shippingphone,
      }),
    };
    if (first.cancelledat) order = { ...order, status: "Cancelled", cancelled_at: parseDate(first.cancelledat) };
    else if (fulfillment === "fulfilled" || fulfillment === "partial") {
      order = { ...order, status: "Shipped", partially_shipped: fulfillment === "partial", shipping_date: parseDate(first.fulfilledat) };
    }
    const email = str(first.email);
    const phone = str(get(first, "phone", "billingphone", "shippingphone"), 30);
    const who = { ref: email ?? phone ?? `guest:${name}`, name: str(get(first, "billingname", "shippingname"), 100), email, phone };
    if (headers) Object.assign(order, rowDetails(lines, headers, (r, k) => String(r[k] ?? "").trim()));
    return { order, who };
  });
}

/** What a store export column means for an order, by normalised header (first match wins) */
const ORDER_COLUMNS = {
  number: ["ordernumber", "orderno", "ordernum", "orderid", "order", "orderref", "orderreference", "ordercode", "number"],
  items: ["items", "item", "orderitem", "orderitems", "itemname", "itemtitle", "itemdescription", "product", "products", "productname", "producttitle", "productdescription", "lineitemname", "lineitem", "description"],
  itemFallback: ["subcategory", "productsubcategory", "productcategory", "category", "producttype", "sku", "productid", "itemid"],
  quantity: ["quantity", "qty", "units", "itemquantity", "orderquantity", "lineitemquantity", "noofitems"],
  orderTotal: ["ordertotal", "total", "totalamount", "grandtotal", "ordervalue", "orderamount", "totalprice", "amount"],
  lineTotal: ["sales", "linetotal", "itemtotal", "lineamount", "itemamount", "price", "itemprice", "sellingprice"],
  currency: ["currency", "currencycode"],
  status: ["status", "orderstatus", "fulfillmentstatus", "deliverystatus", "shipmentstatus", "shippingstatus", "trackingstatus"],
  orderDate: ["orderdate", "createdat", "orderedat", "orderedon", "orderplacedat", "orderplaceddate", "orderplacedon", "purchasedate", "orderdatetime", "ordertime", "placedat", "date"],
  shippingDate: ["shippingdate", "shipdate", "shippedat", "shippedon", "shippeddate", "dispatchdate", "dispatchedat", "dispatchedon", "fulfilledat", "fulfillmentdate"],
  expected: ["expecteddelivery", "expecteddeliverydate", "estimateddelivery", "estimateddeliverydate", "eta", "edd", "promiseddeliverydate", "deliveryby"],
  delivered: ["deliveredat", "deliverydate", "delivereddate", "deliveredon", "actualdeliverydate"],
  cancelled: ["cancelledat", "canceledat", "cancelleddate", "canceleddate", "cancelledon", "cancellationdate"],
  returned: ["returnedat", "returndate", "returneddate", "returnedon"],
  courier: ["courier", "carrier", "trackingcompany", "couriername", "courierpartner", "shippingpartner", "logisticspartner", "deliverypartner", "shippingcarrier", "shippingcompany"],
  tracking: ["trackingnumber", "trackingno", "trackingid", "trackingcode", "awb", "awbnumber", "awbno", "waybill", "waybillnumber", "consignmentnumber"],
  trackingUrl: ["trackingurl", "trackinglink", "trackurl"],
  customerRef: ["customerid", "customerref", "customernumber", "customercode", "clientid", "buyerid", "userid", "customer"],
  customerName: ["customername", "fullname", "buyername", "clientname", "billingname", "shippingname", "recipientname", "customer"],
  // The shipping address: shown only to the customer who placed the order (never to the AI model). Billing
  // addresses are not kept.
  shipName: ["shippingname", "shiptoname", "recipientname", "deliveryname", "consigneename"],
  shipLine1: ["shippingaddress1", "shippingaddressline1", "shippingaddress", "shippingstreet", "deliveryaddress", "shiptoaddress",
    "addressline1", "address1", "address", "street"],
  shipLine2: ["shippingaddress2", "shippingaddressline2", "addressline2", "address2", "landmark", "area", "locality"],
  shipCity: ["shippingcity", "deliverycity", "city", "town"],
  shipProvince: ["shippingprovince", "shippingstate", "deliverystate", "state", "province", "region"],
  shipZip: ["shippingzip", "shippingpincode", "shippingpostcode", "deliverypincode", "pincode", "pin", "zip", "zipcode", "postalcode", "postcode"],
  shipCountry: ["shippingcountry", "deliverycountry", "country"],
  shipPhone: ["shippingphone", "deliveryphone", "recipientphone"],
  firstName: ["firstname", "customerfirstname"],
  lastName: ["lastname", "customerlastname"],
  email: ["email", "customeremail", "emailaddress", "emailid", "buyeremail"],
  phone: ["phone", "customerphone", "phonenumber", "mobile", "mobilenumber", "mobileno", "contactnumber", "contactno", "whatsapp", "whatsappnumber", "billingphone", "shippingphone"],
} as const;
type OrderField = keyof typeof ORDER_COLUMNS;

/** How a CSV's columns were used, by their header as written in the file. Every column is kept (test data). */
export interface ColumnReport {
  /** Read for order-status answers (order number, dates, status, courier, tracking, customer...) */
  used: string[];
  /** Every other column: kept with the order, so the test chat can answer questions about it */
  kept: string[];
  /** The file had no order number column: rows were numbered #1001, #1002... */
  numbered: boolean;
  /** Days every date was moved forward so the newest order is recent (null: dates as in the file) */
  dateShiftDays: number | null;
}

export interface SampleParseOptions {
  /** Move every date forward by the same number of days so the newest order is from yesterday (old datasets) */
  shiftDates?: boolean;
}

const DAY_MS = 86_400_000;

/** A date column's value moved by `shiftMs`, written as YYYY-MM-DD (with the time when the file had one) */
function shiftedText(raw: string, shiftMs: number, dayFirst: boolean): string {
  const iso = parseDate(raw, dayFirst);
  if (!iso) return raw;
  const d = new Date(new Date(iso).getTime() + shiftMs).toISOString();
  return /\d{1,2}:\d{2}/.test(raw) ? `${d.slice(0, 10)} ${d.slice(11, 16)}` : d.slice(0, 10);
}

/**
 * Every column of an order's rows, by header as written: values shared by all its rows go in `details`, values that
 * differ between rows (one row per item) in `item_details`, one entry per row.
 */
function rowDetails(lines: Node[], headers: Map<string, string>, value: (r: Node, key: string) => string) {
  const details: Record<string, string> = {};
  const varying: [string, string][] = [];
  for (const [key, label] of headers) {
    const vals = lines.map((l) => value(l, key));
    const distinct = new Set(vals.filter((v) => v !== ""));
    if (distinct.size === 0) continue;
    if (distinct.size === 1 && vals.every((v) => v === vals[0] || v === "")) details[label] = [...distinct][0].slice(0, 500);
    else varying.push([key, label]);
  }
  const item_details = varying.length
    ? lines.map((l) => Object.fromEntries(varying.map(([k, label]) => [label, value(l, k).slice(0, 300)]).filter(([, v]) => v !== "")))
    : undefined;
  return { details, item_details };
}

/**
 * Dates as stores and spreadsheets write them: ISO, day-first (22/11/2026, 22-11-26, 22.11.2026) or month-first
 * (11/22/2026), with or without a time, "22 Nov 2026", or an Excel serial number (46348). Whether a file is
 * day- or month-first is decided once for the whole file (see detectDayFirst); day-first when nothing tells.
 */
export function parseDate(v: unknown, dayFirst = true): string | null {
  const s = str(v, 60);
  if (!s) return null;
  if (/^\d{5}(\.\d+)?$/.test(s)) {
    const serial = Number(s);
    if (serial > 20000 && serial < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(serial * 86400000)).toISOString();
  }
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T,]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?)?$/i);
  if (m) {
    let [a, b] = [Number(m[1]), Number(m[2])];
    if (a > 12 && b <= 12) dayFirst = true;
    else if (b > 12 && a <= 12) dayFirst = false;
    const [day, month] = dayFirst ? [a, b] : [b, a];
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    let hour = m[4] ? Number(m[4]) : 0;
    if (m[7]) hour = (hour % 12) + (m[7].toLowerCase() === "pm" ? 12 : 0);
    const d = new Date(Date.UTC(year, month - 1, day, hour, m[5] ? Number(m[5]) : 0, m[6] ? Number(m[6]) : 0));
    if (month < 1 || month > 12 || day < 1 || day > 31 || d.getUTCDate() !== day) return null;
    return d.toISOString();
  }
  const d = new Date(s.replace(/^(\d{1,2})-([a-z]{3,})-(\d{2,4})/i, "$1 $2 $3"));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Whether the file's slash dates are day-first: any first part over 12 says yes, any second part over 12 says no */
function detectDayFirst(rows: Node[], cols: string[]): boolean {
  for (const r of rows.slice(0, 2000)) {
    for (const c of cols) {
      const m = String(r[c] ?? "").match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
      if (!m) continue;
      if (Number(m[1]) > 12) return true;
      if (Number(m[2]) > 12) return false;
    }
  }
  return true;
}

const STATUS_RANK: Record<AgentOrderStatus, number> = { Pending: 0, Shipped: 1, Delivered: 2, Returned: 3, Cancelled: 4 };

/**
 * Any store's orders export (or the template): one row per order or one row per item. Rows with the same order
 * number are merged into one order: items and quantities add up, and the order counts as partly shipped when only
 * some of its items have shipped. Without a status column the status comes from the dates (shipped, delivered,
 * cancelled, returned).
 */
function genericOrdersCsv(
  rows: Node[],
  headers: Map<string, string>,
  opts: SampleParseOptions = {},
): { entries: { order: AgentOrder | null; who: ReturnType<typeof jsonCustomerOf> }[]; columns: ColumnReport } {
  const present = new Set(headers.keys());
  const colsFor = (f: OrderField) => ORDER_COLUMNS[f].filter((k) => present.has(k)) as string[];
  const col = Object.fromEntries((Object.keys(ORDER_COLUMNS) as OrderField[]).map((f) => [f, colsFor(f)])) as Record<OrderField, string[]>;
  // "Customer" is the customer's id when there's no other id column and its values look like ids, else their name
  if (col.customerRef.includes("customer") && col.customerName.includes("customer")) {
    const looksLikeId = rows.slice(0, 50).every((r) => !r.customer || /^[A-Z0-9_-]*\d[A-Z0-9_-]*$/i.test(String(r.customer)));
    if (looksLikeId) col.customerName = col.customerName.filter((c) => c !== "customer");
    else col.customerRef = col.customerRef.filter((c) => c !== "customer");
  }
  if (col.orderTotal.length) col.lineTotal = [];
  const dateCols = [...col.orderDate, ...col.shippingDate, ...col.expected, ...col.delivered, ...col.cancelled, ...col.returned];
  const dayFirst = detectDayFirst(rows, dateCols);
  const val = (r: Node, f: OrderField) => col[f].map((c) => r[c]).find((v) => v !== undefined && v !== null && String(v).trim() !== "");
  // Old datasets: move every date forward together so the newest order is from yesterday, which gives the mix of
  // statuses a live store has (being prepared, shipped, delivered) instead of everything delivered years ago
  let shiftMs = 0;
  if (opts.shiftDates) {
    const newest = rows.reduce((max, r) => {
      const d = parseDate(val(r, "orderDate"), dayFirst);
      return d && d > max ? d : max;
    }, "");
    const gap = newest ? Date.now() - DAY_MS - new Date(newest).getTime() : 0;
    if (gap > 3 * DAY_MS) shiftMs = Math.round(gap / DAY_MS) * DAY_MS;
  }
  const when = (r: Node, f: OrderField) => {
    const d = parseDate(val(r, f), dayFirst);
    return d && shiftMs ? new Date(new Date(d).getTime() + shiftMs).toISOString() : d;
  };
  const num = (v: unknown) => { const n = Number(String(v ?? "").replace(/[^\d.-]/g, "")); return v !== undefined && v !== "" && Number.isFinite(n) ? n : null; };
  const now = Date.now();
  const past = (iso: string | null) => !!iso && new Date(iso).getTime() <= now;

  const rowStatus = (r: Node): { status: AgentOrderStatus; delivery: string | null; partial: boolean } => {
    const key = norm(String(val(r, "status") ?? ""));
    const named = STATUS_ALIASES[key];
    if (named) return { status: named, delivery: DELIVERY_ALIASES[key] ?? null, partial: key.startsWith("partial") };
    if (when(r, "cancelled")) return { status: "Cancelled", delivery: null, partial: false };
    if (when(r, "returned")) return { status: "Returned", delivery: null, partial: false };
    if (past(when(r, "delivered"))) return { status: "Delivered", delivery: null, partial: false };
    if (past(when(r, "shippingDate"))) return { status: "Shipped", delivery: null, partial: false };
    return { status: "Pending", delivery: null, partial: false };
  };

  const fallbackUsed = new Set<string>();
  const groups = new Map<string, Node[]>();
  const noNumber: Node[] = [];
  // No order number column (many open datasets): each row is one order, numbered #1001, #1002...
  const numbered = col.number.length === 0;
  rows.forEach((r, i) => {
    const n = numbered ? String(1001 + i) : str(val(r, "number"), 60);
    if (!n) { noNumber.push(r); return; }
    const g = groups.get(n);
    if (g) g.push(r);
    else groups.set(n, [r]);
  });
  const dateKeys = new Set(dateCols);
  const cell = (r: Node, key: string) => {
    const v = String(r[key] ?? "").trim();
    return v && shiftMs && dateKeys.has(key) ? shiftedText(v, shiftMs, dayFirst) : v;
  };

  const entries = Array.from(groups.entries()).map(([number, lines]) => {
    const first = lines[0];
    const firstName = [val(first, "firstName"), val(first, "lastName")].filter(Boolean).join(" ");
    const email = str(val(first, "email"));
    const phone = str(val(first, "phone"), 30);
    const name = str(val(first, "customerName"), 100) ?? str(firstName, 100);
    const who = { ref: str(val(first, "customerRef"), 100) ?? email ?? phone ?? `guest:${number}`, name, email, phone };

    const items = Array.from(new Set(lines.map((l) => {
      const named = str(val(l, "items"), 120);
      if (named) return named;
      // No item name on this row: its category, sub-category or SKU is better than "your items"
      const fallback = col.itemFallback.find((c) => str(l[c]));
      if (fallback) fallbackUsed.add(fallback);
      return fallback ? str(l[fallback], 120) : null;
    }).filter(Boolean) as string[]));
    const statuses = lines.map(rowStatus);
    const live = statuses.filter((s) => s.status !== "Cancelled");
    const base = live.length ? live : statuses;
    const moving = base.filter((s) => s.status !== "Pending");
    const pendingSome = moving.length < base.length;
    // The least advanced item that has moved decides (an order isn't delivered until all of it is); some shipped and
    // some not yet = partly shipped
    const lead = moving.length ? moving.reduce((a, b) => (STATUS_RANK[b.status] < STATUS_RANK[a.status] ? b : a)) : base[0];
    const status: AgentOrderStatus = !live.length ? "Cancelled" : lead.status;
    const firstOf = (f: OrderField) => lines.map((l) => when(l, f)).filter(Boolean).sort()[0] ?? null;
    const lastOf = (f: OrderField) => lines.map((l) => when(l, f)).filter(Boolean).sort().pop() ?? null;
    const orderTotal = num(val(first, "orderTotal"));
    // A unit price column ("price") counts once per unit; a line total ("sales") as it is
    const unitPrice = ["price", "itemprice", "sellingprice"].includes(col.lineTotal[0] ?? "");
    const lineSum = lines.reduce((sum, l) => sum + (num(val(l, "lineTotal")) ?? 0) * (unitPrice ? num(val(l, "quantity")) ?? 1 : 1), 0);
    const trackingUrl = str(lines.map((l) => val(l, "trackingUrl")).find(Boolean), 500);

    const order: AgentOrder = {
      ...emptyOrder(number.startsWith("#") || /[a-z]/i.test(number) ? number : `#${number}`, firstOf("orderDate")),
      items: items.length > 1 ? `${items[0]} + ${items.length - 1} more` : items[0] ?? "your items",
      quantity: lines.reduce((n, l) => n + (num(val(l, "quantity")) ?? (col.quantity.length ? 0 : 1)), 0) || 1,
      total: orderTotal ?? (lineSum ? Math.round(lineSum * 100) / 100 : null),
      currency: str(val(first, "currency"), 10),
      status,
      delivery_status: status === "Shipped" ? lead.delivery : null,
      partially_shipped: status === "Shipped" && (lead.partial || pendingSome),
      shipping_date: status === "Pending" ? null : firstOf("shippingDate"),
      expected_delivery: status === "Pending" || status === "Shipped" ? lastOf("expected") : null,
      delivered_at: status === "Delivered" ? lastOf("delivered") : null,
      cancelled_at: status === "Cancelled" ? lastOf("cancelled") : null,
      courier: str(lines.map((l) => val(l, "courier")).find(Boolean), 100),
      tracking_number: str(lines.map((l) => val(l, "tracking")).find(Boolean), 100),
      tracking_url: trackingUrl && trackingUrl.startsWith("https://") ? trackingUrl : null,
      shipping_address: toAgentAddress({
        name: val(first, "shipName") ?? name, address1: val(first, "shipLine1"), address2: val(first, "shipLine2"),
        city: val(first, "shipCity"), province: val(first, "shipProvince"), zip: val(first, "shipZip"),
        country: val(first, "shipCountry"), phone: val(first, "shipPhone") ?? phone,
      }),
      // Test data: every column, so the test chat can answer about any of them
      ...rowDetails(lines, headers, cell),
    };
    return { order: order as AgentOrder | null, who };
  });
  for (const r of noNumber) entries.push({ order: null, who: { ref: "", name: null, email: null, phone: null } });

  const usedKeys = new Set([...(Object.keys(col) as OrderField[]).filter((f) => f !== "itemFallback").flatMap((f) => col[f]), ...fallbackUsed]);
  const columns: ColumnReport = { used: [], kept: [], numbered, dateShiftDays: shiftMs ? Math.round(shiftMs / DAY_MS) : null };
  for (const [key, label] of headers) (usedKeys.has(key) ? columns.used : columns.kept).push(label);
  return { entries, columns };
}

/** Sample orders from a CSV or JSON file, grouped by customer */
export function parseSampleOrders(text: string, format: "csv" | "json", opts: SampleParseOptions = {}): ParseResult<SampleCustomer> {
  let entries: { order: AgentOrder | null; who: ReturnType<typeof jsonCustomerOf> }[];
  let columns: ColumnReport | undefined;
  if (format === "json") {
    const raw = findOrders(parseJson(text));
    if (!raw.length) throw new Error("Couldn't find any Shopify orders in this file.");
    entries = raw.map((o) => {
      try {
        return { order: jsonOrderToAgent(o), who: jsonCustomerOf(o) };
      } catch {
        return { order: null, who: jsonCustomerOf(o) };
      }
    });
  } else {
    const { rows, headers } = csvTable(text);
    if (!rows.length) throw new Error("The file has a header row but no data rows.");
    if (headers.has("lineitemname") && headers.has("name")) entries = shopifyOrdersCsv(rows, headers);
    // Any other CSV: an order number column groups rows into orders; without one, each row is an order
    else ({ entries, columns } = genericOrdersCsv(rows, headers, opts));
  }
  let skipped = 0;
  const customers = new Map<string, SampleCustomer>();
  let total = 0;
  for (const { order, who } of entries) {
    if (!order || order.order_number === "your order" || total >= MAX_SAMPLE_ORDERS) { skipped++; continue; }
    const c = customers.get(who.ref) ?? { ...who, ref: who.ref.slice(0, 200), orders: [] };
    if (c.orders.length >= MAX_ORDERS_PER_CUSTOMER) { skipped++; continue; }
    c.orders.push(order);
    customers.set(who.ref, c);
    total++;
  }
  if (!total) throw new Error("No orders with an order number were found in this file.");
  return { items: Array.from(customers.values()), skipped, columns };
}

export const sampleOrderCount = (customers: SampleCustomer[]) => customers.reduce((n, c) => n + c.orders.length, 0);

/** The commerce context of one sample customer, as a connected store would provide it */
export function sampleCommerce(customer: SampleCustomer): AgentCommerceContext {
  return {
    status: "ok",
    stores: [{ ...SAMPLE_STORE, status: "ok", customer_ref: customer.ref, customer_name: customer.name, orders: customer.orders }],
  };
}

// ---------------------------------------------------------------- products

function restProduct(p: Node, currency: string | null): SampleProduct | null {
  const title = str(p.title);
  if (!title) return null;
  const variants: Node[] = Array.isArray(p.variants) ? p.variants : p.variants?.nodes ?? [];
  const prices = variants.map((v) => Number(v.price?.amount ?? v.price)).filter((n) => Number.isFinite(n));
  const compare = variants.map((v) => Number(v.compare_at_price ?? v.compareAtPrice?.amount ?? v.compareAtPrice)).filter((n) => Number.isFinite(n) && n > 0);
  const gqlMin = p.priceRangeV2?.minVariantPrice;
  const cur = currency ?? gqlMin?.currencyCode ?? str(p.currency, 10) ?? null;
  const flat = (v: unknown) => (v === undefined || v === null || v === "" ? null : Number(String(v).replace(/[^\d.]/g, "")));
  const price = prices.length ? Math.min(...prices) : gqlMin?.amount != null ? Number(gqlMin.amount) : flat(p.price);
  const was = compare.length ? Math.min(...compare) : flat(p.compare_at_price ?? p.compareAtPrice);
  const available = variants.length
    ? variants.some((v) => v.available === true || v.availableForSale === true || Number(v.inventory_quantity ?? v.inventoryQuantity ?? 1) > 0 || v.inventory_policy === "continue")
    : typeof p.available === "boolean" ? p.available : p.status ? String(p.status).toLowerCase() === "active" : true;
  const image = p.image?.src ?? p.images?.[0]?.src ?? p.featuredMedia?.preview?.image?.url ?? p.featuredImage?.url ?? p.image_url ?? null;
  return {
    title,
    price: price != null ? formatPrice(price, cur) : null,
    compare_at_price: was != null && price != null && was > price ? formatPrice(was, cur) : null,
    description: stripHtml(p.body_html ?? p.description ?? p.descriptionHtml),
    url: [p.onlineStoreUrl, p.url].find((u) => typeof u === "string" && u.startsWith("https://")) ?? null,
    image_url: typeof image === "string" && image.startsWith("https://") ? image : null,
    buy_url: null,
    available,
    keywords: [p.product_type ?? p.productType, Array.isArray(p.tags) ? p.tags.join(" ") : p.tags, p.vendor].filter(Boolean).join(" ").slice(0, 300),
  };
}

function findProducts(doc: unknown): Node[] {
  const out: Node[] = [];
  const visit = (v: unknown, depth: number) => {
    if (depth > 6 || !v || typeof v !== "object") return;
    if (Array.isArray(v)) { v.forEach((x) => visit(x, depth + 1)); return; }
    const o = v as Node;
    if (typeof o.title === "string" && ("variants" in o || "handle" in o || "price" in o || "body_html" in o || "priceRangeV2" in o)) { out.push(o); return; }
    for (const key of ["products", "product", "data", "nodes", "edges", "node"]) if (key in o) visit(o[key], depth + 1);
  };
  visit(doc, 0);
  return out;
}

/** Shopify's Products export CSV: one row per variant/image, the product's details on its first row */
function shopifyProductsCsv(rows: Node[], headers: Map<string, string>): (SampleProduct | null)[] {
  const byHandle = new Map<string, Node[]>();
  for (const r of rows) {
    const h = str(r.handle, 200);
    if (!h) continue;
    byHandle.set(h, [...(byHandle.get(h) ?? []), r]);
  }
  return Array.from(byHandle.values()).map((group) => {
    const first = group.find((r) => str(r.title)) ?? group[0];
    if (String(first.status ?? "active").toLowerCase() === "archived") return null;
    const details: Record<string, string> = {};
    for (const [key, label] of headers) {
      if (["title", "bodyhtml"].includes(key)) continue;
      const vals = [...new Set(group.map((r) => String(r[key] ?? "").trim()).filter(Boolean))];
      if (vals.length) details[label] = vals.join(", ").slice(0, 200);
    }
    const product = restProduct({
      title: first.title,
      body_html: first.bodyhtml,
      product_type: first.type || first.productcategory,
      tags: first.tags,
      vendor: first.vendor,
      image: { src: group.map((r) => r.imagesrc).find(Boolean) },
      variants: group.filter((r) => r.variantprice).map((r) => ({
        price: r.variantprice,
        compare_at_price: r.variantcompareatprice,
        inventory_quantity: r.variantinventoryqty === "" || r.variantinventoryqty === undefined ? 1 : Number(r.variantinventoryqty),
        inventory_policy: r.variantinventorypolicy,
      })),
    }, null);
    return product ? { ...product, details } : null;
  });
}

/** Product columns read into the product itself; every other column is kept in `details` */
const PRODUCT_READ = new Set(["title", "name", "product", "productname", "currency", "price", "sellingprice", "mrp", "compareatprice",
  "originalprice", "wasprice", "available", "instock", "stock", "availability", "url", "link", "producturl", "imageurl", "image",
  "imagesrc", "description", "details", "bodyhtml"]);

/** The column that names the product: a usual title column, else the first one whose header says name/title/product */
function titleKey(headers: Map<string, string>): string | null {
  for (const k of ["title", "name", "product", "productname"]) if (headers.has(k)) return k;
  const keys = [...headers.keys()].filter((k) => !/(id|code|sku|no|number|url|link|image)$/.test(k));
  for (const re of [/title/, /name/, /product/]) {
    const k = keys.find((x) => re.test(x));
    if (k) return k;
  }
  return null;
}

function productDetails(r: Node, headers: Map<string, string>, skip: Set<string>): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const [key, label] of headers) {
    const v = String(r[key] ?? "").trim();
    if (v && !skip.has(key)) out[label] = v.slice(0, 200);
  }
  return Object.keys(out).length ? out : undefined;
}

function templateProductsCsv(rows: Node[], headers: Map<string, string>): (SampleProduct | null)[] {
  const tKey = titleKey(headers) ?? [...headers.keys()][0];
  const skip = new Set([...PRODUCT_READ, tKey]);
  return rows.map((r) => {
    const title = str(r[tKey]) ?? str(get(r, "title", "name", "product", "productname"));
    if (!title) return null;
    const currency = str(get(r, "currency"), 10);
    const price = get(r, "price", "sellingprice", "mrp");
    const compare = get(r, "compareatprice", "mrp", "originalprice", "wasprice");
    const avail = norm(String(get(r, "available", "instock", "stock", "availability") ?? "yes"));
    const url = str(get(r, "url", "link", "producturl"), 500);
    const image = str(get(r, "imageurl", "image", "imagesrc"), 800);
    return {
      title,
      price: formatPrice(price, currency),
      compare_at_price: compare && compare !== price && Number(compare) > Number(price) ? formatPrice(compare, currency) : null,
      description: stripHtml(get(r, "description", "details", "bodyhtml")),
      url: url && url.startsWith("https://") ? url : null,
      image_url: image && image.startsWith("https://") ? image : null,
      buy_url: null,
      available: !["no", "false", "0", "soldout", "outofstock", "n"].includes(avail),
      keywords: [get(r, "type", "category", "producttype"), get(r, "tags"), get(r, "vendor", "brand")].filter(Boolean).join(" ").slice(0, 300),
      details: productDetails(r, headers, skip),
    };
  });
}

/** Sample products from a CSV or JSON file */
export function parseSampleProducts(text: string, format: "csv" | "json"): ParseResult<SampleProduct> {
  let found: (SampleProduct | null)[];
  if (format === "json") {
    const doc = parseJson(text);
    const raw = findProducts(doc);
    if (!raw.length) throw new Error("Couldn't find any products (objects with a title) in this file.");
    found = raw.map((p) => restProduct(p, null));
  } else {
    const { rows, headers } = csvTable(text);
    if (!rows.length) throw new Error("The file has a header row but no data rows.");
    // Shopify's export, else any CSV: the title/name column (or the first column) names each product
    if (headers.has("handle") && headers.has("variantprice")) found = shopifyProductsCsv(rows, headers);
    else found = templateProductsCsv(rows, headers);
  }
  const items = found.filter((p): p is SampleProduct => !!p).slice(0, MAX_SAMPLE_PRODUCTS);
  if (!items.length) throw new Error("No products with a title were found in this file.");
  return { items, skipped: found.length - items.length };
}

const STOP = new Set(
  "a an the is are was were be i me my we you your it this that to of in on for with at by from and or but if so do does did can could should would will how what when where which who why please pls hi hello hey show want need looking any some have has get got price prices cost much buy something good best one ones me".split(" "),
);

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.length > 4 && /(?<!s)s$/.test(w) ? w.replace(/(ies|es|s)$/, (m) => (m === "ies" ? "y" : "")) : w));
}

/** The sample products a visitor's message is about (as the store search would return), tagged P1..P6 */
export function searchSampleProducts(products: SampleProduct[], text: string, n = CATALOG_SIZE) {
  const q = words(text);
  const scored = products
    .map((p, i) => {
      const title = p.title.toLowerCase();
      const meta = `${p.keywords} ${p.description ?? ""} ${Object.values(p.details ?? {}).join(" ")}`.toLowerCase();
      const score = q.reduce((s, w) => s + (title.includes(w) ? 3 : 0) + (meta.includes(w) ? 1 : 0), 0);
      return { p, i, score };
    })
    .sort((a, b) => b.score - a.score || a.i - b.i);
  const hits = scored.filter((x) => x.score > 0);
  return (hits.length ? hits : scored).slice(0, n).map(({ p }, i) => toCatalogItem(p, i));
}

export const toCatalogItem = (p: SampleProduct, i: number) => ({
  ref: `P${i + 1}`,
  title: p.title,
  price: p.price,
  compare_at_price: p.compare_at_price,
  description: p.description,
  url: p.url,
  image_url: p.image_url,
  buy_url: p.buy_url,
  available: p.available,
  ...(p.details ? { details: p.details } : {}),
});

// ---------------------------------------------------------------- checks generated from sample data

/** What a correct answer must say for each status (alternatives separated by |, as the grader expects) */
const STATUS_WORDS: Record<AgentOrderStatus, string> = {
  Pending: "prepared|hasn't shipped|not shipped",
  Shipped: "shipped|on its way|out for delivery|dispatched",
  Delivered: "delivered",
  Cancelled: "cancelled|canceled",
  Returned: "returned",
};
const ORDER_QUESTIONS = ["Where is my order {n}?", "What's the status of order {n}?", "Has my order {n} shipped yet?"];

/** Columns a detail check shouldn't ask about: status, dates, ids and contact details (other checks cover those) */
const NOT_ASKED = /order ?(id|no|num|number|ref)|row ?id|^id$|index|date|time|status|customer|name|email|phone|mobile|address|street|city|pin|zip|postal|tracking|courier|awb|url|link|image/i;

/** Columns worth a check: short readable values ("Second Class", "COD", "Furniture", "261.96") */
function askable(details: Record<string, string> | undefined): [string, string][] {
  return Object.entries(details ?? {}).filter(([k, v]) => !NOT_ASKED.test(k) && v.length >= 1 && v.length <= 40 && /[\p{L}\p{N}]/u.test(v));
}

const DETAIL_QUESTIONS = ["What is the {k} of my order {n}?", "Can you tell me the {k} for order {n}?", "For my order {n}, what was the {k}?"];

/** Checks that ask about another column of the customer's order: the answer must quote the file's value */
export function orderDetailChecks(customers: SampleCustomer[], source?: "sample_orders") {
  const out = [];
  const keyUse = new Map<string, number>();
  for (const c of customers) {
    for (const o of c.orders) {
      if (out.length >= MAX_DETAIL_CHECKS) return out;
      const fields = askable(o.details);
      if (!fields.length) continue;
      // Spread the checks over the columns: the least-asked column of this order
      const [k, v] = [...fields].sort((a, b) => (keyUse.get(a[0]) ?? 0) - (keyUse.get(b[0]) ?? 0))[0];
      keyUse.set(k, (keyUse.get(k) ?? 0) + 1);
      out.push({
        question: DETAIL_QUESTIONS[out.length % DETAIL_QUESTIONS.length].replace("{k}", k.toLowerCase()).replace("{n}", o.order_number),
        expected: `Says the ${k} of ${o.order_number} is ${v}`,
        category: "Order details",
        expectOutcome: "answered",
        mustInclude: [v],
        asUser: { id: c.ref, ...(c.name ? { name: c.name } : {}), ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}) },
        commerce: sampleCommerce(c),
        ...(source ? { source } : {}),
      });
    }
  }
  return out;
}

/** One order-status check per order (latest order of each customer first), each carrying the customer's orders */
export function ordersToChecks(customers: SampleCustomer[], source?: "sample_orders") {
  const picks: { c: SampleCustomer; o: AgentOrder }[] = [];
  const queues = customers.map((c) => [...c.orders].sort((a, b) => String(b.order_date).localeCompare(String(a.order_date))));
  for (let round = 0; picks.length < MAX_ORDER_CHECKS && queues.some((q) => q.length > round); round++) {
    queues.forEach((q, i) => { if (q[round] && picks.length < MAX_ORDER_CHECKS) picks.push({ c: customers[i], o: q[round] }); });
  }
  return picks.map(({ c, o }, i) => ({
    question: ORDER_QUESTIONS[i % ORDER_QUESTIONS.length].replace("{n}", o.order_number),
    expected: `Gives the status of ${o.order_number}: ${o.status.toLowerCase()}`,
    category: "Order status",
    expectOutcome: "answered",
    mustInclude: [o.order_number, STATUS_WORDS[o.status]],
    asUser: { id: c.ref, ...(c.name ? { name: c.name } : {}), ...(c.email ? { email: c.email } : {}), ...(c.phone ? { phone: c.phone } : {}) },
    commerce: sampleCommerce(c),
    ...(source ? { source } : {}),
  }));
}

/** Shopping checks about another column of a product ("What's the brand of the Cotton tee?") */
export function productDetailChecks(products: SampleProduct[]) {
  const out = [];
  const keyUse = new Map<string, number>();
  const step = Math.max(1, Math.floor(products.length / MAX_PRODUCT_DETAIL_CHECKS));
  for (let i = 0; i < products.length && out.length < MAX_PRODUCT_DETAIL_CHECKS; i += step) {
    const p = products[i];
    const fields = askable(p.details);
    if (!fields.length) continue;
    const [k, v] = [...fields].sort((a, b) => (keyUse.get(a[0]) ?? 0) - (keyUse.get(b[0]) ?? 0))[0];
    keyUse.set(k, (keyUse.get(k) ?? 0) + 1);
    const catalog = [toCatalogItem(p, 0), ...searchSampleProducts(products, p.title).filter((c) => c.title !== p.title).slice(0, CATALOG_SIZE - 1)];
    out.push({
      question: `What's the ${k.toLowerCase()} of the ${p.title}?`,
      expected: `Says the ${k} of the ${p.title} is ${v}`,
      category: "Product details",
      expectOutcome: "answered",
      mustInclude: [v],
      catalog: catalog.map((c, j) => ({ ...c, ref: `P${j + 1}` })),
      source: "sample_products" as const,
    });
  }
  return out;
}

/** Shopping checks: a visitor asks for a product; the assistant must offer it (or say it's sold out) */
export function productsToChecks(products: SampleProduct[]) {
  const step = Math.max(1, Math.floor(products.length / MAX_PRODUCT_CHECKS));
  const picks = products.filter((_, i) => i % step === 0).slice(0, MAX_PRODUCT_CHECKS);
  const QUESTIONS = ["Do you have the {t}?", "I'm looking for {t}", "Can you show me the {t}?"];
  return picks.map((p, i) => {
    // The product plus other products as alternatives, as a store search would return them
    const catalog = searchSampleProducts(products, p.title).filter((c) => c.title !== p.title);
    for (const other of products) {
      if (catalog.length >= CATALOG_SIZE - 1) break;
      if (other.title !== p.title && !catalog.some((c) => c.title === other.title)) catalog.push(toCatalogItem(other, 0));
    }
    catalog.splice(i % (catalog.length + 1), 0, toCatalogItem(p, 0));
    return {
      question: QUESTIONS[i % QUESTIONS.length].replace("{t}", p.title),
      expected: p.available ? `Recommends the ${p.title}` : `Says the ${p.title} is sold out and suggests an alternative`,
      category: "Shopping",
      expectOutcome: "answered",
      mustInclude: p.available ? [p.title] : ["sold out|out of stock|unavailable|not available"],
      catalog: catalog.map((c, j) => ({ ...c, ref: `P${j + 1}` })),
      source: "sample_products" as const,
    };
  });
}
