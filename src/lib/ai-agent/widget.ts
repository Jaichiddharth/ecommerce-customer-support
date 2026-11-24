/**
 * Website chat widget (AI agent > Chat widget): what a business customises, shared by the dashboard form and the
 * server. No secrets live here: the settings are sent to every visitor's browser.
 */

export type SalesGoal = "helpful" | "balanced" | "proactive";

export interface WidgetSettings {
  /** The assistant's name, e.g. "Mia" */
  name: string;
  /** Header line under the name, e.g. "Usually replies instantly" */
  subtitle: string;
  /** First message the visitor sees when they open the chat */
  greeting: string;
  /** Small bubble next to the launcher that invites the visitor to chat; empty = none */
  teaser: string;
  /** Seconds before the teaser shows (0 = immediately) */
  teaserDelaySec: number;
  color: string;
  position: "right" | "left";
  /** Buttons under the greeting */
  starterButtons: string[];
  sales: {
    /** Recommend products from the store and help the visitor buy */
    enabled: boolean;
    goal: SalesGoal;
    /** Offer the assistant may mention, e.g. "WELCOME10 for 10% off your first order"; empty = none */
    offer: string;
  };
  /** Shopify store whose products are recommended; null = the workspace's only store */
  storeId: number | null;
  /** Handover: "Continue on WhatsApp" with this number (digits with country code); empty = none */
  whatsappNumber: string;
  /** Sites allowed to show the widget (e.g. "mystore.com"); empty = any site */
  allowedDomains: string[];
}

export const DEFAULT_WIDGET: WidgetSettings = {
  name: "Shopping assistant",
  subtitle: "Replies instantly",
  greeting: "Hi there! 👋 Looking for something special? I can help you find the right product, check sizes or track an order.",
  teaser: "Need help choosing? I can recommend something 👀",
  teaserDelaySec: 8,
  color: "#3440a8",
  position: "right",
  starterButtons: ["Best sellers", "Help me choose", "Any offers?", "Track my order"],
  sales: { enabled: true, goal: "balanced", offer: "" },
  storeId: null,
  whatsappNumber: "",
  allowedDomains: [],
};

export const SALES_GOALS: { value: SalesGoal; label: string; hint: string }[] = [
  { value: "helpful", label: "Helpful", hint: "Recommends products only when the visitor is looking for one." },
  { value: "balanced", label: "Balanced", hint: "Suggests a product when it fits the conversation naturally." },
  { value: "proactive", label: "Proactive", hint: "Looks for chances to recommend products and add-ons, without pressure." },
];

const str = (v: unknown, max: number, fallback: string) => (typeof v === "string" ? v.trim().slice(0, max) : fallback);

/** "https://www.MyStore.com/path" → "www.mystore.com"; null when it isn't a host name */
export function normalizeDomain(input: string): string | null {
  const host = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, "").split(/[/?#]/)[0].replace(/:\d+$/, "");
  const wildcard = host.startsWith("*.") ? "*." : "";
  const bare = wildcard ? host.slice(2) : host;
  if (bare === "localhost") return host;
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/.test(bare) ? wildcard + bare : null;
}

/** Anything (stored row, request body) → complete, valid settings */
export function normalizeWidget(input: unknown): WidgetSettings {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const d = DEFAULT_WIDGET;
  const sales = i.sales ?? {};
  const buttons = Array.isArray(i.starterButtons)
    ? Array.from(new Set(i.starterButtons.filter((b: unknown) => typeof b === "string").map((b: string) => b.trim().slice(0, 40)).filter(Boolean))) as string[]
    : d.starterButtons;
  const domains = Array.isArray(i.allowedDomains)
    ? Array.from(new Set(i.allowedDomains.map((x: unknown) => (typeof x === "string" ? normalizeDomain(x) : null)).filter(Boolean))) as string[]
    : d.allowedDomains;
  const delay = Number(i.teaserDelaySec);
  return {
    name: str(i.name, 40, d.name) || d.name,
    subtitle: str(i.subtitle, 60, d.subtitle),
    greeting: str(i.greeting, 400, d.greeting) || d.greeting,
    teaser: str(i.teaser, 120, d.teaser),
    teaserDelaySec: Number.isFinite(delay) ? Math.min(120, Math.max(0, Math.round(delay))) : d.teaserDelaySec,
    color: typeof i.color === "string" && /^#[0-9a-f]{6}$/i.test(i.color) ? i.color.toLowerCase() : d.color,
    position: i.position === "left" ? "left" : "right",
    starterButtons: buttons.slice(0, 4),
    sales: {
      enabled: typeof sales.enabled === "boolean" ? sales.enabled : d.sales.enabled,
      goal: (["helpful", "balanced", "proactive"] as const).includes(sales.goal) ? sales.goal : d.sales.goal,
      offer: str(sales.offer, 200, d.sales.offer),
    },
    storeId: Number.isInteger(i.storeId) && i.storeId > 0 ? i.storeId : null,
    whatsappNumber: typeof i.whatsappNumber === "string" ? i.whatsappNumber.replace(/\D/g, "").slice(0, 15) : d.whatsappNumber,
    allowedDomains: domains.slice(0, 20),
  };
}

/** What the visitor's browser gets (the frame): no store ids or allowed-domain lists */
export function publicWidgetConfig(s: WidgetSettings) {
  return {
    name: s.name,
    subtitle: s.subtitle,
    greeting: s.greeting,
    teaser: s.teaser,
    teaserDelaySec: s.teaserDelaySec,
    color: s.color,
    position: s.position,
    starterButtons: s.starterButtons,
    whatsappNumber: s.whatsappNumber,
  };
}
export type PublicWidgetConfig = ReturnType<typeof publicWidgetConfig>;
