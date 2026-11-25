/**
 * Monthly cost estimate for Settings › Billing & usage: AI model usage and WhatsApp (Meta) charges.
 * UnoCX's own plan pricing isn't final, so it isn't part of the total.
 *
 * Pure functions (no I/O) so the screen and tests share one calculation.
 */

export type Currency = "INR" | "USD";

/**
 * WhatsApp rates per message by the customers' country, from Meta's rate cards effective 1 Oct 2026 (India in INR,
 * United States in USD). Check Meta's pricing page for changes.
 */
export const META_RATES = {
  india: { label: "India", currency: "INR", marketing: 0.8631, utility: 0.115, authentication: 0.115 },
  us: { label: "United States", currency: "USD", marketing: 0.025, utility: 0.0034, authentication: 0.0034 },
} as const;
export type Market = keyof typeof META_RATES;
/** Service messages (replies inside the 24-hour window) free per business phone number each month; billed at the utility rate after */
export const FREE_SERVICE_MESSAGES_PER_NUMBER = 1_000;
export const META_PRICING_URL = "https://developers.facebook.com/docs/whatsapp/pricing";
export const DEFAULT_USD_TO_INR = 88;

export interface EstimateInput {
  currency: Currency;
  /** Rupees per US dollar (AI model prices are in USD) */
  usdToInr: number;

  whatsappConversations: number;
  webchatConversations: number;
  /** Messages the business sends per conversation (AI or team) */
  repliesPerConversation: number;

  /** 0–100: conversations the AI agent answers */
  aiSharePct: number;
  /** 0–100: AI replies written by the model; the rest come from flows, saved answers and guardrails (free) */
  modelReplySharePct: number;
  /** USD per 1M tokens */
  modelPrice: { input: number; output: number };
  inputTokensPerReply: number;
  outputTokensPerReply: number;
  /** The workspace pays the model provider directly (bring your own key): not billed through UnoCX */
  byo: boolean;

  /** Per message, in `currency` */
  rates: { marketing: number; utility: number; authentication: number };
  marketingTemplates: number;
  utilityTemplates: number;
  authenticationTemplates: number;
  whatsappNumbers: number;
}

export interface EstimateLine {
  key: string;
  label: string;
  detail: string;
  /** In the chosen currency; null = not priced yet (UnoCX plan) */
  amount: number | null;
}

export interface Estimate {
  lines: EstimateLine[];
  total: number;
  conversations: number;
  perConversation: number | null;
  aiReplies: number;
  billableServiceMessages: number;
}

const n = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/** Model cost of one AI reply in USD */
export function costPerReplyUsd(price: { input: number; output: number }, inputTokens: number, outputTokens: number): number {
  return (n(inputTokens) * n(price.input) + n(outputTokens) * n(price.output)) / 1_000_000;
}

/** A USD amount in the chosen currency */
export function fromUsd(usd: number, currency: Currency, usdToInr: number): number {
  return currency === "INR" ? usd * n(usdToInr) : usd;
}

/** An amount from one currency to another */
export function convert(amount: number, from: Currency, to: Currency, usdToInr: number): number {
  if (from === to) return amount;
  const rate = n(usdToInr) || DEFAULT_USD_TO_INR;
  return from === "USD" ? amount * rate : amount / rate;
}

/** Meta's rates for a country, in the chosen currency */
export function marketRates(market: Market, currency: Currency, usdToInr: number) {
  const r = META_RATES[market];
  return {
    marketing: convert(r.marketing, r.currency, currency, usdToInr),
    utility: convert(r.utility, r.currency, currency, usdToInr),
    authentication: convert(r.authentication, r.currency, currency, usdToInr),
  };
}

export function estimate(i: EstimateInput): Estimate {
  const conversations = n(i.whatsappConversations) + n(i.webchatConversations);
  const replies = n(i.repliesPerConversation);
  const aiShare = Math.min(100, n(i.aiSharePct)) / 100;

  const aiReplies = Math.round(conversations * aiShare * replies);
  const modelReplies = Math.round(aiReplies * Math.min(100, n(i.modelReplySharePct)) / 100);
  const aiUsd = modelReplies * costPerReplyUsd(i.modelPrice, i.inputTokensPerReply, i.outputTokensPerReply);
  const ai = i.byo ? 0 : fromUsd(aiUsd, i.currency, i.usdToInr);

  // Every reply on WhatsApp (AI or team) is a service message; the first 1,000 per number each month are free
  const serviceMessages = Math.round(n(i.whatsappConversations) * replies);
  const freeService = FREE_SERVICE_MESSAGES_PER_NUMBER * Math.max(1, Math.round(n(i.whatsappNumbers)));
  const billableService = Math.max(0, serviceMessages - freeService);

  const marketing = n(i.marketingTemplates) * n(i.rates.marketing);
  const utility = n(i.utilityTemplates) * n(i.rates.utility);
  const authentication = n(i.authenticationTemplates) * n(i.rates.authentication);
  const service = billableService * n(i.rates.utility);

  const count = (v: number) => Math.round(v).toLocaleString("en-IN");
  const lines: EstimateLine[] = [
    {
      key: "ai",
      label: "AI agent (model usage)",
      detail: i.byo
        ? `${count(aiReplies)} AI replies, billed by your own model provider`
        : `${count(aiReplies)} AI replies, ${count(modelReplies)} written by the model`,
      amount: ai,
    },
    {
      key: "service",
      label: "WhatsApp replies (service)",
      detail: `${count(serviceMessages)} replies, ${count(Math.min(serviceMessages, freeService))} free · ${count(billableService)} charged`,
      amount: service,
    },
    { key: "marketing", label: "WhatsApp marketing templates", detail: `${count(n(i.marketingTemplates))} messages`, amount: marketing },
    { key: "utility", label: "WhatsApp utility templates", detail: `${count(n(i.utilityTemplates))} messages`, amount: utility },
    { key: "authentication", label: "WhatsApp authentication templates", detail: `${count(n(i.authenticationTemplates))} messages`, amount: authentication },
    { key: "plan", label: "UnoCX plan", detail: "Pricing yet to be decided", amount: null },
  ];
  const total = lines.reduce((s, l) => s + (l.amount ?? 0), 0);
  return {
    lines,
    total,
    conversations,
    perConversation: conversations ? total / conversations : null,
    aiReplies,
    billableServiceMessages: billableService,
  };
}

export function formatMoney(amount: number, currency: Currency): string {
  const small = Math.abs(amount) > 0 && Math.abs(amount) < 1;
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: small ? 4 : 2,
  }).format(amount);
}
