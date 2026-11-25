/**
 * AI agent guardrail settings on the app side:
 *  1. normalizePolicy: new fields get safe defaults, phone masking can't be switched off, junk is dropped
 *  2. toServiceSettings: advanced guardrails reach the AI service only on plans that include them
 *  3. consumeRateLimit: the shared (Postgres) widget limit counts across calls and blocks over the limit
 * Run: npm run test:ai-guardrails  (needs DATABASE_URL for part 3)
 */
import assert from "node:assert/strict";
import { sql } from "drizzle-orm";
import { DEFAULT_POLICY, normalizePolicy, toServiceSettings } from "../src/lib/ai-agent/policy";
import { parseSampleOrders, parseSampleProducts } from "../src/lib/ai-agent/sample-data";

async function main() {
  // 1. defaults and validation
  const old = normalizePolicy({ privacy: { maskPhoneInLogs: false }, persona: { tone: "shouty", replyLength: "huge" } });
  assert.equal(old.privacy.maskPhoneInLogs, true, "phone masking is a platform rule");
  assert.equal(old.persona.tone, "friendly");
  assert.equal(old.persona.replyLength, "medium");
  assert.deepEqual(old.topics, { businessOnly: true, restricted: [], competitors: [] });
  assert.deepEqual(old.moderation, { profanity: true, harmful: true, outputFilter: true });
  assert.deepEqual(old.advanced, { groundednessCheck: false, injectionClassifier: false, aiModeration: false });
  const custom = normalizePolicy({ topics: { restricted: ["Crypto", "crypto", " ", 5, "Wholesale"], competitors: ["X".repeat(200)] } });
  assert.deepEqual(custom.topics.restricted, ["Crypto", "crypto", "Wholesale"]);
  assert.equal(custom.topics.competitors[0].length, 80);
  console.log("✓ policy defaults and validation");

  // 2. plan gating
  const wantsAll = normalizePolicy({ ...DEFAULT_POLICY, advanced: { groundednessCheck: true, injectionClassifier: true, aiModeration: true } });
  const growth = toServiceSettings(wantsAll, "Shop", "growth").policy;
  assert.deepEqual(growth.advanced, { groundedness_check: false, injection_classifier: false, ai_moderation: false });
  const pro = toServiceSettings(wantsAll, "Shop", "Pro").policy;
  assert.deepEqual(pro.advanced, { groundedness_check: true, injection_classifier: true, ai_moderation: true });
  assert.equal(toServiceSettings(wantsAll, "Shop").policy.advanced.groundedness_check, false, "no plan, no advanced checks");
  assert.equal(growth.mask_phone_in_logs, true);
  assert.equal(growth.tone, "friendly");
  assert.deepEqual(growth.topics, { business_only: true, restricted: [], competitors: [] });
  console.log("✓ advanced guardrails follow the plan");

  // 2b. shipping address settings and sample data
  assert.equal(normalizePolicy({ skills: { addressChangeUrl: "http://insecure.example" } }).skills.addressChangeUrl, "");
  assert.equal(normalizePolicy({ skills: { addressChangeUrl: "javascript:alert(1)" } }).skills.addressChangeUrl, "");
  const linked = normalizePolicy({ skills: { addressChangeUrl: "https://shop.example/account/addresses" } });
  const sent = toServiceSettings(linked, "Shop", "growth").policy;
  assert.equal(sent.address_enabled, true);
  assert.equal(sent.address_change_url, "https://shop.example/account/addresses");
  assert.equal(toServiceSettings(DEFAULT_POLICY, "Shop").policy.address_change_url, null);
  const csv = `Order ID,Order Item,Order Date,Customer ID,Customer Name,Phone,Shipping Address,Landmark,City,State,Pincode,Billing Address
ORD-1,Linen shirt,14/11/2026,C1,Asha,+919800000001,"Flat 4B, 12 MG Road",Near Metro,Bengaluru,Karnataka,560001,"Office, 5 Park St"`;
  const parsed = parseSampleOrders(csv, "csv");
  const addr = parsed.items[0].orders[0].shipping_address;
  assert.deepEqual(addr, { name: "Asha", line1: "Flat 4B, 12 MG Road", line2: "Near Metro", city: "Bengaluru", province: "Karnataka", zip: "560001", country: null, phone_last4: "0001" });
  // Test data keeps every column of the file (it's an uploaded test set, not a live store)
  assert.equal(parsed.items[0].orders[0].details?.["Billing Address"], "Office, 5 Park St");
  assert.ok(parsed.columns?.kept.includes("Billing Address"));
  console.log("✓ shipping address settings and sample data");

  // 2c. any CSV as test data: no order number column, old dates moved forward, item rows, any products file
  const kaggle = `Row ID,Order Date,Ship Date,Ship Mode,Segment,Category,Product Name,Sales,Payment Mode
1,08-11-2016,11-11-2016,Second Class,Consumer,Furniture,Bookcase,261.96,COD
2,12-06-2016,16-06-2016,Standard Class,Corporate,Office Supplies,Labels,14.62,Online`;
  const anyCsv = parseSampleOrders(kaggle, "csv", { shiftDates: true });
  const orders = anyCsv.items.flatMap((c) => c.orders);
  assert.deepEqual(orders.map((o) => o.order_number).sort(), ["#1001", "#1002"], "rows are numbered when there's no order id");
  assert.equal(anyCsv.columns?.numbered, true);
  const newest = orders.find((o) => o.details?.["Product Name"] === "Bookcase")!;
  assert.equal(newest.details?.["Payment Mode"], "COD");
  assert.ok(Date.now() - new Date(newest.order_date).getTime() < 3 * 86_400_000, "newest order moved to yesterday");
  assert.equal(newest.details?.["Order Date"], newest.order_date.slice(0, 10), "date columns show the moved date");
  assert.ok((anyCsv.columns?.dateShiftDays ?? 0) > 3000);
  const asIs = parseSampleOrders(kaggle, "csv", { shiftDates: false }).items.flatMap((c) => c.orders);
  assert.ok(asIs.every((o) => o.order_date.startsWith("2016")), "dates kept as in the file when not moved");

  const lines = `Order ID,Order Date,Product,Category,Quantity,Region
A-1,2026-11-20,Pen,Office,2,West
A-1,2026-11-20,Desk,Furniture,1,West`;
  const grouped = parseSampleOrders(lines, "csv").items[0].orders[0];
  assert.equal(grouped.details?.Region, "West", "shared columns are order details");
  assert.deepEqual(grouped.item_details?.map((i) => i.Category), ["Office", "Furniture"], "differing columns are per item");

  const products = parseSampleProducts(`Product ID,Product Title,Brand,Color,Size,Rating,Price
P1,Cotton tee,Acme,Red,M,4.5,499`, "csv");
  assert.equal(products.items[0].title, "Cotton tee");
  assert.deepEqual(products.items[0].details, { "Product ID": "P1", Brand: "Acme", Color: "Red", Size: "M", Rating: "4.5" });
  console.log("✓ any CSV as test data (all columns, numbering, date shift)");

  // 3. shared rate limit
  if (!process.env.DATABASE_URL) {
    console.log("- rate limit skipped (no DATABASE_URL)");
    return;
  }
  const { consumeRateLimit } = await import("../src/lib/security/rate-limit");
  const { db } = await import("../src/lib/db");
  const key = `test|${Date.now()}`;
  const results = [];
  for (let i = 0; i < 4; i++) results.push(await consumeRateLimit(key, 3));
  assert.deepEqual(results, [true, true, true, false]);
  assert.equal(await consumeRateLimit(`${key}|other`, 3), true, "keys are counted separately");
  await db.execute(sql`DELETE FROM rate_limit_hits WHERE "key" LIKE ${key + "%"}`);
  console.log("✓ shared rate limit");
}

main().then(() => process.exit(0), (err) => { console.error(err); process.exit(1); });
