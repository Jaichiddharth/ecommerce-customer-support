/**
 * Sample data for testing the AI agent (AI agent > Test data): sample orders and products uploaded as CSV or JSON.
 * Uploading replaces the previous data of that kind and regenerates the checks made from it; the test chat and the
 * widget preview can answer from it instead of the live store.
 */
import type { AuthUser } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { aiAgentRepository } from "@/lib/db/repositories";
import { aiRequest, workspaceIdFor } from "@/lib/ai-agent/service-client";
import {
  orderDetailChecks,
  ordersToChecks,
  parseSampleOrders,
  productDetailChecks,
  parseSampleProducts,
  productsToChecks,
  sampleOrderCount,
  searchSampleProducts,
  type ColumnReport,
  type SampleCustomer,
  type SampleProduct,
} from "@/lib/ai-agent/sample-data";
import { aiAgentService } from "./ai-agent.service";

export type SampleKind = "orders" | "products";
const MAX_FILE_CHARS = 20_000_000;
const SOURCE: Record<SampleKind, "sample_orders" | "sample_products"> = { orders: "sample_orders", products: "sample_products" };

/** Every column of the test data as a table (first rows), for AI agent > Test data */
export interface SampleTable {
  headers: string[];
  rows: string[][];
  /** Rows in the data (the table shows the first ones) */
  total: number;
}

const TABLE_ROWS = 100;

function ordersTable(customers: SampleCustomer[]): SampleTable | null {
  const orders = customers.flatMap((c) => c.orders);
  if (!orders.some((o) => o.details || o.item_details)) return null;
  const headers: string[] = [];
  const seen = new Set<string>();
  const add = (k: string) => { if (!seen.has(k)) { seen.add(k); headers.push(k); } };
  for (const o of orders.slice(0, 500)) {
    Object.keys(o.details ?? {}).forEach(add);
    (o.item_details ?? []).forEach((i) => Object.keys(i).forEach(add));
  }
  const rows = orders.slice(0, TABLE_ROWS).map((o) => [
    o.order_number,
    o.partially_shipped ? "Partly shipped" : o.status,
    ...headers.map((h) => o.details?.[h] ?? [...new Set((o.item_details ?? []).map((i) => i[h]).filter(Boolean))].join(" · ")),
  ]);
  return { headers: ["Order", "Status (worked out)", ...headers], rows, total: orders.length };
}

function productsTable(items: SampleProduct[]): SampleTable | null {
  if (!items.some((p) => p.details)) return null;
  const headers: string[] = [];
  const seen = new Set<string>();
  for (const p of items.slice(0, 500)) for (const k of Object.keys(p.details ?? {})) if (!seen.has(k)) { seen.add(k); headers.push(k); }
  const rows = items.slice(0, TABLE_ROWS).map((p) => [
    p.title, p.price ?? "", p.available ? "In stock" : "Sold out", ...headers.map((h) => p.details?.[h] ?? ""),
  ]);
  return { headers: ["Title", "Price", "Stock", ...headers], rows, total: items.length };
}

export interface SampleDataView {
  orders: {
    count: number;
    customers: { ref: string; name: string | null; email: string | null; phone: string | null; orders: number; latest: string | null }[];
    preview: { order: string; customer: string; status: string; items: string; date: string; tracking: string | null }[];
    fileName: string | null;
    updatedAt: Date;
    table: SampleTable | null;
  } | null;
  products: {
    count: number;
    preview: { title: string; price: string | null; compareAtPrice: string | null; available: boolean; imageUrl: string | null }[];
    fileName: string | null;
    updatedAt: Date;
    table: SampleTable | null;
  } | null;
}

export interface SampleUploadResult {
  view: SampleDataView;
  kind: SampleKind;
  count: number;
  skipped: number;
  checksCreated: number;
  /** The data was saved but its checks couldn't be generated (e.g. the test set is full) */
  checksError: string | null;
  /** CSV orders: which of the file's columns were read */
  columns: ColumnReport | null;
}

export class AiSampleDataService {
  async get(user: AuthUser): Promise<SampleDataView> {
    const rows = await aiAgentRepository.listSampleData(user.organizationId);
    const orders = rows.find((r) => r.kind === "orders");
    const products = rows.find((r) => r.kind === "products");
    const customers = (orders?.data as SampleCustomer[] | undefined) ?? [];
    const items = (products?.data as SampleProduct[] | undefined) ?? [];
    return {
      orders: orders
        ? {
            count: orders.itemCount,
            customers: customers.slice(0, 300).map((c) => {
              const latest = [...c.orders].sort((a, b) => String(b.order_date).localeCompare(String(a.order_date)))[0];
              return { ref: c.ref, name: c.name, email: c.email, phone: c.phone, orders: c.orders.length, latest: latest ? `${latest.order_number} · ${latest.status}` : null };
            }),
            preview: customers
              .flatMap((c) => c.orders.map((o) => ({ o, c })))
              .sort((a, b) => String(b.o.order_date).localeCompare(String(a.o.order_date)))
              .slice(0, 8)
              .map(({ o, c }) => ({
                order: o.order_number,
                customer: c.name || c.email || c.phone || "Guest",
                status: o.partially_shipped ? "Partly shipped" : o.delivery_status === "out_for_delivery" ? "Out for delivery" : o.status,
                items: o.items,
                date: o.order_date,
                tracking: o.courier ? `${o.courier}${o.tracking_number ? ` · ${o.tracking_number}` : ""}` : null,
              })),
            fileName: orders.fileName,
            updatedAt: orders.updatedAt,
            table: ordersTable(customers),
          }
        : null,
      products: products
        ? {
            count: products.itemCount,
            preview: items.slice(0, 8).map((p) => ({ title: p.title, price: p.price, compareAtPrice: p.compare_at_price, available: p.available, imageUrl: p.image_url })),
            fileName: products.fileName,
            updatedAt: products.updatedAt,
            table: productsTable(items),
          }
        : null,
    };
  }

  async upload(user: AuthUser, kind: SampleKind, body: any): Promise<SampleUploadResult> {
    const format = body?.format === "json" ? "json" : body?.format === "csv" ? "csv" : null;
    if (!format) throw AppError.validation("Choose a CSV or JSON file.", "format");
    const text = typeof body?.text === "string" ? body.text : "";
    if (!text.trim()) throw AppError.validation("The file is empty.", "text");
    if (text.length > MAX_FILE_CHARS) throw AppError.validation("The file is too large (max 20 MB).", "text");
    const fileName = typeof body?.fileName === "string" ? body.fileName.slice(0, 200) : null;

    let items: SampleCustomer[] | SampleProduct[];
    let skipped: number;
    let count: number;
    let columns: ColumnReport | null = null;
    try {
      if (kind === "orders") {
        // Old datasets: dates moved forward so the newest order is recent (unless the upload says not to)
        const parsed = parseSampleOrders(text, format, { shiftDates: body?.shiftDates !== false });
        items = parsed.items;
        skipped = parsed.skipped;
        count = sampleOrderCount(parsed.items);
        columns = parsed.columns ?? null;
      } else {
        const parsed = parseSampleProducts(text, format);
        items = parsed.items;
        skipped = parsed.skipped;
        count = parsed.items.length;
      }
    } catch (err) {
      throw AppError.validation(err instanceof Error ? err.message : "The file could not be read.", "text");
    }

    await aiAgentRepository.saveSampleData(user.organizationId, kind, { items, itemCount: count, fileName, updatedById: user.id });

    // Replace the checks made from the previous data with ones from this data
    let checksCreated = 0;
    let checksError: string | null = null;
    try {
      await this.deleteChecks(user, kind);
      const checks = kind === "orders"
        ? [...ordersToChecks(items as SampleCustomer[], "sample_orders"), ...orderDetailChecks(items as SampleCustomer[], "sample_orders")]
        : [...productsToChecks(items as SampleProduct[]), ...productDetailChecks(items as SampleProduct[])];
      if (checks.length) checksCreated = ((await aiAgentService.createTestCases(user, checks)) as { created: string[] }).created.length;
    } catch (err) {
      checksError = err instanceof AppError ? err.message : "The checks couldn't be generated.";
    }
    return { view: await this.get(user), kind, count, skipped, checksCreated, checksError, columns };
  }

  async remove(user: AuthUser, kind: SampleKind): Promise<SampleDataView> {
    await aiAgentRepository.deleteSampleData(user.organizationId, kind);
    await this.deleteChecks(user, kind);
    return this.get(user);
  }

  private async deleteChecks(user: AuthUser, kind: SampleKind) {
    await aiRequest("/v1/tests/cases", { method: "DELETE", query: { workspace_id: workspaceIdFor(user.organizationId), source: SOURCE[kind] } });
  }

  /** One sample customer with their orders (test chat: "Use sample data") */
  async customer(organizationId: number, ref: string): Promise<SampleCustomer | null> {
    const row = await aiAgentRepository.findSampleData(organizationId, "orders");
    return ((row?.data as SampleCustomer[] | undefined) ?? []).find((c) => c.ref === ref) ?? null;
  }

  /** The sample products a message is about, as the store search would return them; empty without sample products */
  async catalogFor(organizationId: number, text: string) {
    const row = await aiAgentRepository.findSampleData(organizationId, "products");
    const products = (row?.data as SampleProduct[] | undefined) ?? [];
    return products.length ? searchSampleProducts(products, text) : [];
  }
}

export const aiSampleDataService = new AiSampleDataService();
