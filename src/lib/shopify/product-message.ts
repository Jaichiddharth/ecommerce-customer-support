import type { SharedShopifyProduct } from "../db/schema/messages";

/**
 * Text of a shared-product message. Used by the server to send it and by the UI to preview it,
 * so the agent reviews exactly what the customer receives.
 * Channels without product cards get this as plain text (WhatsApp sends it as the image caption).
 */

export type ProductMessageInput = Pick<
  SharedShopifyProduct,
  "title" | "variantTitle" | "options" | "sku" | "price" | "currencyCode" | "available" | "productUrl"
>;

export function formatShopifyPrice(amount: string | number, currencyCode: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${amount} ${currencyCode}`;
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency: currencyCode }).format(value);
  } catch {
    return `${value.toFixed(2)} ${currencyCode}`;
  }
}

/** "Size: L · Color: Blue"; empty for single-variant products ("Default Title") */
export function formatVariantOptions(options: { name: string; value: string }[]): string {
  return options
    .filter((o) => !(o.name === "Title" && o.value === "Default Title"))
    .map((o) => `${o.name}: ${o.value}`)
    .join(" · ");
}

export function buildProductMessageText(product: ProductMessageInput): string {
  const lines = [`*${product.title.trim()}*`];
  const options = formatVariantOptions(product.options);
  if (options) lines.push(options);
  lines.push(formatShopifyPrice(product.price, product.currencyCode));
  if (product.sku) lines.push(`SKU: ${product.sku}`);
  if (!product.available) lines.push("Currently out of stock");
  if (product.productUrl) lines.push("", product.productUrl);
  // WhatsApp captions are limited to 1024 characters
  return lines.join("\n").slice(0, 1024);
}
