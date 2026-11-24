/**
 * Website chat: an inbox channel (type `webchat`). The business adds it under Settings › Channels, configures the
 * widget there and pastes one script tag on any website. Visitors chat with the AI agent as a shopping assistant
 * (products from the connected Shopify store, matched to their budget, size, gender and colour); order questions
 * are sent to the business's WhatsApp. Every visitor is an inbox contact and every chat a ticket: the team sees it
 * live, takes over when the AI hands over (or whenever they like) and replies from the inbox; the widget polls for
 * those replies.
 *
 * Public surface (no login): /api/widget/<publicKey>/loader.js, /frame, /chat and /messages. The public key only
 * identifies the widget; a visitor is identified by a random 128-bit id kept in the widget's storage, so one
 * visitor can never read another's chat. The frame may only be embedded on the business's allowed sites (any site
 * when none are listed).
 */
import { randomBytes } from "node:crypto";
import type { AuthUser } from "@/lib/security/auth";
import { AppError } from "@/lib/errors";
import { createLogger } from "@/lib/logger";
import { publish } from "@/lib/realtime";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { aiAgentRepository, conversationRepository, customerRepository, messageRepository, organizationRepository } from "@/lib/db/repositories";
import { channelRepository } from "@/lib/db/repositories/channel.repository";
import { shopifyRepository, type ShopifyStoreWithUser } from "@/lib/db/repositories/shopify.repository";
import {
  ChannelStatus,
  ConversationHandler,
  MessageStatus,
  ShopifyStoreStatus,
  TicketStatus,
  type AiWidget,
  type Customer,
  type Ticket,
} from "@/lib/db/schema";
import { isClosedTicketStatus } from "@/types/ticket";
import { aiRequest, workspaceIdFor } from "@/lib/ai-agent/service-client";
import { DEFAULT_POLICY, HANDOVER_REASON_LABELS, normalizePolicy, toServiceSettings } from "@/lib/ai-agent/policy";
import { DEFAULT_WIDGET, normalizeWidget, publicWidgetConfig, type WidgetSettings } from "@/lib/ai-agent/widget";
import { describeCriteria, formatPrice, parseCriteria, pickProducts, type Candidate, type PickedProduct } from "@/lib/ai-agent/shopping";
import { aiAgentService, type AgentReply } from "./ai-agent.service";
import { shopifyService } from "./shopify.service";
import { aiSampleDataService } from "./ai-sample-data.service";

const log = createLogger("AiWidget");

const MAX_HISTORY = 12;
const MAX_MESSAGE_CHARS = 1000;
const CATALOG_SIZE = 6;
const CANDIDATES = 40;
const CATALOG_TTL_MS = 60_000;
const PRODUCT_LOOKUP_TIMEOUT_MS = 5_000;
/** Per visitor (IP + widget) and per widget, per minute */
const VISITOR_LIMIT = 20;
const WIDGET_LIMIT = 300;
/** Polls for team replies, per visitor id, per minute */
const POLL_LIMIT = 40;
const VISITOR_RE = /^[a-f0-9]{32}$/;
const ORDER_HELP_TEXT = "Hi! I need help with my order.";

export interface WidgetView {
  enabled: boolean;
  publicKey: string | null;
  channelId: number | null;
  settings: WidgetSettings;
  stores: { id: number; name: string; needsReauth: boolean }[];
  whatsappNumbers: { number: string; label: string }[];
}

type WidgetProduct = { title: string; price: string | null; compareAtPrice: string | null; imageUrl: string | null; url: string | null; buyUrl: string | null; available: boolean; variant?: string | null };

/** A chat line as the widget shows it */
export interface WidgetMessage {
  id: number;
  role: "user" | "assistant" | "agent";
  content: string;
  /** A teammate's first name */
  name?: string | null;
  products?: WidgetProduct[];
  suggestions?: string[];
  whatsappUrl?: string | null;
  at: string;
}

export interface WidgetThread {
  messages: WidgetMessage[];
  /** team: a person is handling the chat (the widget polls faster and shows it) */
  mode: "ai" | "team";
  ended: boolean;
}

/** Dashboard preview reply (nothing is saved) */
export interface WidgetReply {
  reply: string;
  outcome: string;
  suggestions: string[];
  products: WidgetProduct[];
  handover: boolean;
  ended: boolean;
  whatsappUrl: string | null;
}

type CatalogItem = { ref: string; title: string; price: string | null; compare_at_price: string | null; description: string | null; url: string | null; image_url: string | null; buy_url: string | null; available: boolean };

interface AgentAnswer {
  reply: AgentReply | null;
  products: WidgetProduct[];
  whatsappUrl: string | null;
}

// ---------------------------------------------------------------- products

const candidateCache = new Map<string, { until: number; value: { items: Candidate[]; matchedTerm: boolean } }>();

async function candidatesFor(store: ShopifyStoreWithUser, term: string, bestsellers: boolean) {
  const key = `${store.id}|${term}|${bestsellers ? "b" : ""}`;
  const hit = candidateCache.get(key);
  if (hit && hit.until > Date.now()) return hit.value;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      shopifyService.agentCandidates(store, term, CANDIDATES, { bestsellers }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("product lookup timed out")), PRODUCT_LOOKUP_TIMEOUT_MS);
      }),
    ]);
    candidateCache.set(key, { until: Date.now() + CATALOG_TTL_MS, value });
    if (candidateCache.size > 2_000) candidateCache.delete(candidateCache.keys().next().value!);
    return value;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function toCatalog(products: PickedProduct[]): CatalogItem[] {
  return products.map((p, i) => ({
    ref: `P${i + 1}`,
    title: p.title,
    price: formatPrice(p.price, p.currency),
    compare_at_price: formatPrice(p.compareAtPrice, p.currency),
    // the variant that fits ("Size M · Black") and "Best seller" lead the description, so the reply can say them
    description: [p.variantLabel, p.bestseller ? "Best seller" : null, p.description].filter(Boolean).join(". ").slice(0, 300) || null,
    url: p.url,
    image_url: p.imageUrl,
    buy_url: shopifyService.agentBuyUrl(p.url, p.variantId),
    available: p.available,
  }));
}

const whatsappLink = (digits: string | null) =>
  digits ? `https://wa.me/${digits}?text=${encodeURIComponent(ORDER_HELP_TEXT)}` : null;

// ---------------------------------------------------------------- service

export class AiWidgetService {
  // ------------------------------------------------------------ channel (Settings › Channels)

  /** Adds the Website chat channel, or reconnects it; one per organisation */
  async connectChannel(user: AuthUser): Promise<WidgetView> {
    const widget = await aiAgentRepository.findWidget(user.organizationId);
    let channelId = widget?.channelId ?? null;
    const existing = channelId ? await channelRepository.findById(channelId, user.organizationId) : null;
    if (existing) {
      if (existing.status !== ChannelStatus.CONNECTED || !existing.isActive) await channelRepository.reconnectWebchatChannel(existing.id, user.organizationId);
    } else {
      channelId = (await channelRepository.createWebchatChannel(user.organizationId)).id;
    }
    await aiAgentRepository.upsertWidget(user.organizationId, widget?.publicKey ?? newKey(), {
      enabled: true,
      settings: widget ? normalizeWidget(widget.settings) : DEFAULT_WIDGET,
      channelId,
    });
    publish(user.organizationId, { type: "channel.updated", channelId: channelId! });
    return this.getWidget(user);
  }

  /** The channel was disconnected: the widget stops answering on websites */
  async channelDisconnected(organizationId: number, channelId: number): Promise<void> {
    const widget = await aiAgentRepository.findWidgetByChannel(organizationId, channelId);
    if (widget) await aiAgentRepository.upsertWidget(organizationId, widget.publicKey, { enabled: false, settings: widget.settings });
  }

  async getWidget(user: AuthUser): Promise<WidgetView> {
    const [widget, stores, channels] = await Promise.all([
      aiAgentRepository.findWidget(user.organizationId),
      shopifyRepository.findActiveStores(user.organizationId),
      channelRepository.listByOrgAndType(user.organizationId, "whatsapp"),
    ]);
    return {
      enabled: widget?.enabled ?? false,
      publicKey: widget?.publicKey ?? null,
      channelId: widget?.channelId ?? null,
      settings: widget ? normalizeWidget(widget.settings) : DEFAULT_WIDGET,
      stores: stores.map((s) => ({ id: s.id, name: s.name || s.shopDomain, needsReauth: s.status === ShopifyStoreStatus.REAUTH_REQUIRED })),
      whatsappNumbers: channels
        .filter((c) => c.phoneNumber)
        .map((c) => ({ number: String(c.phoneNumber).replace(/\D/g, ""), label: `${c.name || "WhatsApp"} · ${c.phoneNumber}` })),
    };
  }

  async saveWidget(user: AuthUser, body: any): Promise<WidgetView> {
    const settings = normalizeWidget(body?.settings);
    if (settings.storeId !== null && !(await shopifyRepository.findActiveStore(user.organizationId, settings.storeId))) {
      throw AppError.validation("Choose one of your connected Shopify stores.", "storeId");
    }
    const existing = await aiAgentRepository.findWidget(user.organizationId);
    if (!existing?.channelId) throw AppError.validation("Add the Website chat channel first (Settings › Channels).");
    await aiAgentRepository.upsertWidget(user.organizationId, existing.publicKey, { enabled: body?.enabled === true, settings });
    return this.getWidget(user);
  }

  // ------------------------------------------------------------ public widget

  /** The widget behind a public key, if it's switched on and its channel is connected */
  async liveWidget(publicKey: string): Promise<{ widget: AiWidget & { channelId: number }; settings: WidgetSettings } | null> {
    if (!/^wk_[\w-]{10,40}$/.test(publicKey)) return null;
    const widget = await aiAgentRepository.findWidgetByKey(publicKey);
    if (!widget?.enabled || !widget.channelId) return null;
    const channel = await channelRepository.findById(widget.channelId, widget.organizationId);
    if (!channel || channel.status !== ChannelStatus.CONNECTED || channel.isActive === false) return null;
    return { widget: widget as AiWidget & { channelId: number }, settings: normalizeWidget(widget.settings) };
  }

  publicConfig(settings: WidgetSettings) {
    return publicWidgetConfig(settings);
  }

  /** A visitor's message: saved to the inbox; the AI answers unless the team is handling the chat */
  async visitorChat(publicKey: string, body: any, visitorIp: string): Promise<WidgetThread> {
    const live = await this.liveWidget(publicKey);
    if (!live) throw AppError.notFound("This chat isn't available.");
    const [visitorOk, widgetOk] = await Promise.all([
      consumeRateLimit(`widget-visitor|${publicKey}|${visitorIp}`, VISITOR_LIMIT),
      consumeRateLimit(`widget|${publicKey}`, WIDGET_LIMIT),
    ]);
    if (!visitorOk || !widgetOk) {
      throw new AppError("RATE_LIMITED", { message: "You're sending messages very quickly. Please wait a moment.", expected: true });
    }
    const visitorId = visitorIdOf(body?.visitorId);
    const text = typeof body?.text === "string" ? body.text.trim().slice(0, MAX_MESSAGE_CHARS) : "";
    if (!text) throw AppError.validation("Type a message.", "text");
    const page = typeof body?.page === "string" && /^https?:\/\//.test(body.page) ? body.page.slice(0, 500) : null;
    const { organizationId, channelId } = live.widget;

    const { customer, created } = await customerRepository.findOrCreateByExternalId(
      organizationId, channelId, `web:${visitorId}`, `Website visitor ${visitorId.slice(0, 4).toUpperCase()}`,
    );
    const inbound = await messageRepository.createMessage({
      organizationId,
      customerId: customer.id,
      channelId,
      senderType: "customer",
      textContent: text,
      status: MessageStatus.DELIVERED,
      metadata: page ? { widget: { page } } : null,
    });
    if (!inbound) throw new AppError("INTERNAL_ERROR", { message: "Your message couldn't be sent. Please try again." });
    publish(organizationId, { type: "message.new", customerId: customer.id, customer: { id: customer.id, name: customer.name, phone: null, channelId }, message: inbound });
    if (created) log.info("New website chat visitor", { organizationId, customerId: customer.id });

    let ticket = inbound.ticketId ? await conversationRepository.findById(inbound.ticketId, organizationId) : null;
    const config = await aiAgentRepository.findConfig(organizationId);
    if (ticket && config?.enabled && !(await conversationRepository.isWithTeam(ticket))) {
      ticket = await this.aiTurn(live.widget, live.settings, customer, ticket);
    }
    return this.thread(organizationId, customer, inbound.id - 1, ticket);
  }

  /** New lines of a visitor's chat after message `after` (the widget polls this for the team's replies) */
  async visitorMessages(publicKey: string, visitorIdRaw: unknown, after: number): Promise<WidgetThread> {
    const live = await this.liveWidget(publicKey);
    if (!live) throw AppError.notFound("This chat isn't available.");
    const visitorId = visitorIdOf(visitorIdRaw);
    if (!(await consumeRateLimit(`widget-poll|${publicKey}|${visitorId}`, POLL_LIMIT))) {
      return { messages: [], mode: "ai", ended: false };
    }
    const customer = await customerRepository.findByExternalId(live.widget.organizationId, live.widget.channelId, `web:${visitorId}`);
    if (!customer) return { messages: [], mode: "ai", ended: false };
    return this.thread(live.widget.organizationId, customer, Math.max(0, after), null);
  }

  /** Dashboard preview: the unsaved settings, the live agent, nothing saved; optionally sample products */
  async previewChat(user: AuthUser, body: any): Promise<WidgetReply> {
    const settings = normalizeWidget(body?.settings);
    const messages = (Array.isArray(body?.messages) ? body.messages : [])
      .filter((m: any) => (m?.role === "user" || m?.role === "assistant") && typeof m?.content === "string" && m.content.trim())
      .slice(-MAX_HISTORY)
      .map((m: any) => ({ role: m.role as "user" | "assistant", content: String(m.content).slice(0, MAX_MESSAGE_CHARS) }));
    if (!messages.length || messages[messages.length - 1].role !== "user") throw AppError.validation("Type a message.", "messages");
    const session = typeof body?.sessionId === "string" ? body.sessionId.replace(/[^\w-]/g, "").slice(0, 40) : "";
    if (session.length < 8) throw AppError.validation("Missing chat session.", "sessionId");
    const a = await this.askAgent(user.organizationId, settings, messages, `webpreview_${user.id}_${session}`, true, body?.useSampleProducts === true);
    const r = a.reply;
    return {
      reply: r?.reply ?? "",
      outcome: r?.outcome ?? "answered",
      suggestions: (r?.suggestions ?? []).slice(0, 4),
      products: a.products,
      handover: r?.outcome === "handover",
      ended: r?.ended === true,
      whatsappUrl: a.whatsappUrl,
    };
  }

  // ------------------------------------------------------------ internals

  /** One AI turn on a live chat: the answer saved to the ticket, the ticket updated (handover / ended) */
  private async aiTurn(widget: AiWidget & { channelId: number }, settings: WidgetSettings, customer: Customer, ticket: Ticket): Promise<Ticket> {
    const orgId = widget.organizationId;
    const history = await this.history(orgId, customer.id, ticket.id);
    if (!history.length) return ticket;
    let answer: AgentAnswer;
    try {
      answer = await this.askAgent(orgId, settings, history, `web_${widget.channelId}_${customer.id}_${ticket.id}`, false, false);
    } catch (err) {
      log.warn("AI agent couldn't answer a website chat; handing it to the team", { err, organizationId: orgId, ticketId: ticket.id });
      return this.handover(ticket, "AI agent unavailable", null);
    }
    const r = answer.reply;
    if (!r) return ticket;                     // AI paused: the team answers from the inbox
    const text = r.reply.trim();
    if (text) {
      const msg = await messageRepository.createMessage({
        organizationId: orgId,
        customerId: customer.id,
        channelId: widget.channelId,
        ticketId: ticket.id,
        senderType: "ai",
        textContent: text,
        status: MessageStatus.SENT,
        metadata: {
          aiAgent: { runId: r.run_id, outcome: r.outcome, route: r.route, confidence: r.confidence },
          quickReplies: r.outcome !== "handover" && !r.ended ? (r.suggestions ?? []).slice(0, 4) : [],
          widget: { products: answer.products, whatsappUrl: answer.whatsappUrl },
        },
      });
      if (msg) publish(orgId, { type: "message.new", customerId: customer.id, message: { ...msg, senderName: "AI agent" } });
    }
    if (r.outcome === "handover") {
      return this.handover(ticket, HANDOVER_REASON_LABELS[r.handover_reason ?? ""] ?? "Needs a person", r.handover_summary);
    }
    let updated = (await conversationRepository.update(ticket.id, orgId, {
      handledBy: ConversationHandler.AI,
      needsHuman: false,
      aiConfidence: r.confidence ?? null,
      aiModel: r.usage?.model ?? null,
    })) ?? ticket;
    publish(orgId, { type: "conversation.updated", conversationId: ticket.id, customerId: customer.id });
    if (r.ended && !isClosedTicketStatus(updated.status)) {
      const resolved = await conversationRepository.update(ticket.id, orgId, { status: TicketStatus.RESOLVED });
      if (resolved) {
        await conversationRepository.logEvent(resolved, {
          action: "resolved", actorType: "system", actorId: null, actorName: "AI agent", previousStatus: updated.status, status: resolved.status,
        });
        updated = resolved;
      }
    }
    return updated;
  }

  private async handover(ticket: Ticket, reason: string, summary: string | null): Promise<Ticket> {
    const updated = (await conversationRepository.update(ticket.id, ticket.organizationId, {
      handledBy: ConversationHandler.AI,
      needsHuman: true,
      aiSummary: summary?.slice(0, 2000) ?? null,
    })) ?? ticket;
    await conversationRepository.logEvent(updated, { action: "ai_handover", actorType: "system", actorId: null, actorName: "AI agent", reason });
    return updated;
  }

  /** The ticket's recent text as a chat for the agent (visitor → user; AI and teammates → assistant), ending with the visitor */
  private async history(orgId: number, customerId: number, ticketId: number) {
    const { messages: page } = await messageRepository.listPageByCustomer(customerId, orgId, { limit: 30 });
    const chat: { role: "user" | "assistant"; content: string }[] = [];
    for (const m of page) {
      if (m.isInternalNote || m.ticketId !== ticketId) continue;
      const content = m.textContent?.trim();
      if (!content) continue;
      if (m.senderType === "customer") chat.push({ role: "user", content: content.slice(0, MAX_MESSAGE_CHARS) });
      else if (m.senderType === "ai" || m.senderType === "agent") chat.push({ role: "assistant", content: content.slice(0, MAX_MESSAGE_CHARS) });
    }
    while (chat.length && chat[chat.length - 1].role !== "user") chat.pop();
    return chat.slice(-MAX_HISTORY);
  }

  /** The visitor's chat lines after message id `after`, as the widget shows them */
  private async thread(orgId: number, customer: Customer, after: number, ticket: Ticket | null): Promise<WidgetThread> {
    const { messages: page } = await messageRepository.listPageByCustomer(customer.id, orgId, { limit: 40 });
    const lines: WidgetMessage[] = [];
    for (const m of page) {
      if (m.id <= after || m.isInternalNote || !m.textContent?.trim()) continue;
      if (m.senderType !== "customer" && m.senderType !== "ai" && m.senderType !== "agent") continue;
      const w = (m.metadata as { widget?: { products?: WidgetProduct[]; whatsappUrl?: string | null }; quickReplies?: string[] } | null) ?? null;
      lines.push({
        id: m.id,
        role: m.senderType === "customer" ? "user" : m.senderType === "ai" ? "assistant" : "agent",
        content: m.textContent,
        name: m.senderType === "agent" ? ((m as { senderName?: string | null }).senderName ?? "").split(" ")[0] || "Our team" : null,
        products: w?.widget?.products ?? undefined,
        suggestions: m.senderType === "ai" ? w?.quickReplies ?? [] : undefined,
        whatsappUrl: w?.widget?.whatsappUrl ?? null,
        at: m.createdAt.toISOString(),
      });
    }
    const latestTicketId = page.filter((m) => m.ticketId).at(-1)?.ticketId ?? null;
    const t = ticket ?? (latestTicketId ? await conversationRepository.findById(latestTicketId, orgId) : null);
    return {
      messages: lines,
      mode: t && (await conversationRepository.isWithTeam(t)) ? "team" : "ai",
      ended: t ? isClosedTicketStatus(t.status) : false,
    };
  }

  /** Asks the AI agent, with the products that fit what the visitor asked for; null reply when the agent is paused */
  private async askAgent(
    organizationId: number,
    settings: WidgetSettings,
    messages: { role: "user" | "assistant"; content: string }[],
    conversationId: string,
    preview: boolean,
    sampleProducts: boolean,
  ): Promise<AgentAnswer> {
    const [config, org] = await Promise.all([aiAgentRepository.findConfig(organizationId), organizationRepository.findById(organizationId)]);
    if (!config?.enabled && !preview) return { reply: null, products: [], whatsappUrl: null };
    const live = config?.liveVersionId ? await aiAgentRepository.findVersion(organizationId, config.liveVersionId) : null;
    const policy = live ? normalizePolicy(live.policy) : DEFAULT_POLICY;
    const base = toServiceSettings(policy, org?.name ?? "our store", org?.plan);
    const serviceSettings = {
      ...base,
      // The widget's own buttons and greeting replace the WhatsApp ones
      policy: { ...base.policy, starter_chips: settings.starterButtons.length ? settings.starterButtons : base.policy.starter_chips, welcome_message: settings.greeting },
      llm: await aiAgentService.llmFor(organizationId, policy),
    };
    const whatsappUrl = whatsappLink(await this.whatsappNumber(organizationId, settings));

    let catalog: CatalogItem[] = [];
    let picked: PickedProduct[] = [];
    let criteria: { text: string | null; matched: boolean; relaxed: string[] } = { text: null, matched: true, relaxed: [] };
    if (settings.sales.enabled) {
      const visitorSaid = messages.filter((m) => m.role === "user").map((m) => m.content);
      if (sampleProducts) {
        catalog = await aiSampleDataService.catalogFor(organizationId, visitorSaid[visitorSaid.length - 1] ?? "");
      } else {
        const store = await this.storeFor(organizationId, settings);
        if (store) {
          try {
            const wanted = parseCriteria(visitorSaid);
            const found = await candidatesFor(store, wanted.terms, wanted.bestsellers);
            const pick = pickProducts(found.items, wanted, CATALOG_SIZE);
            picked = pick.products;
            const relaxed = !found.matchedTerm && wanted.terms ? ["product", ...pick.relaxed] : pick.relaxed;
            catalog = toCatalog(pick.products);
            criteria = { text: describeCriteria(wanted, found.items[0]?.currency ?? "USD") || null, matched: pick.matched && relaxed.length === 0, relaxed };
          } catch (err) {
            log.warn("Widget product lookup failed; answering without products", { err, organizationId, storeId: store.id });
          }
        }
      }
    }

    const r = await aiRequest<AgentReply & { products?: Array<Record<string, any>>; action?: { type?: string; url?: string } | null }>("/v1/chat", {
      timeoutMs: 40_000,
      body: {
        workspace_id: workspaceIdFor(organizationId),
        conversation_id: conversationId,
        user: {},
        messages,
        settings: serviceSettings,
        channel: "web",
        test: preview,
        catalog,
        sales: {
          enabled: settings.sales.enabled,
          assistant_name: settings.name,
          offer: settings.sales.offer || null,
          goal: settings.sales.goal,
          criteria: criteria.text,
          criteria_matched: criteria.matched,
          relaxed: criteria.relaxed,
          order_help_url: whatsappUrl,
        },
      },
    });
    const products = (Array.isArray(r?.products) ? r.products : []).slice(0, 3).map((p: Record<string, any>): WidgetProduct => {
      const item = picked.find((c) => c.title === p.title);
      return {
        title: p.title,
        price: p.price ?? null,
        compareAtPrice: p.compare_at_price ?? null,
        imageUrl: p.image_url ?? null,
        url: p.url ?? null,
        buyUrl: p.buy_url ?? null,
        available: p.available !== false,
        variant: item?.variantLabel ?? null,
      };
    });
    const orderHelp = r?.action?.type === "whatsapp" && typeof r.action.url === "string" ? r.action.url : null;
    // Only order questions get the WhatsApp button: on a handover the team replies in this same chat
    return { reply: r, products, whatsappUrl: orderHelp };
  }

  /** Where order questions go: the widget's WhatsApp number, else the organisation's (only) connected WhatsApp */
  private async whatsappNumber(organizationId: number, settings: WidgetSettings): Promise<string | null> {
    if (settings.whatsappNumber) return settings.whatsappNumber;
    const channels = await channelRepository.listByOrgAndType(organizationId, "whatsapp");
    const live = channels.filter((c) => c.phoneNumber && c.status === ChannelStatus.CONNECTED);
    return live.length ? String(live[0].phoneNumber).replace(/\D/g, "") || null : null;
  }

  private async storeFor(organizationId: number, settings: WidgetSettings): Promise<ShopifyStoreWithUser | null> {
    if (settings.storeId) return shopifyRepository.findActiveStore(organizationId, settings.storeId);
    const stores = await shopifyRepository.findActiveStores(organizationId);
    return stores.length === 1 ? stores[0] : null;
  }
}

function newKey() {
  return `wk_${randomBytes(18).toString("base64url")}`;
}

function visitorIdOf(v: unknown): string {
  const id = typeof v === "string" ? v.toLowerCase() : "";
  if (!VISITOR_RE.test(id)) throw AppError.validation("Missing chat session.", "visitorId");
  return id;
}

export const aiWidgetService = new AiWidgetService();
