/**
 * Quick replies on WhatsApp: tappable options under a message (the AI agent's suggestions, e.g. "Track my order",
 * "No, that's all"). Up to 3 short options go out as reply buttons; more, or longer ones, as a list message.
 * Each option's full text travels in its id, so a tap reads back as exactly what the option said even when
 * WhatsApp's title limit shortened it on screen.
 * https://developers.facebook.com/docs/whatsapp/cloud-api/messages/interactive-reply-buttons-messages
 */

const ID_PREFIX = "qr:";
const MAX_BUTTONS = 3;
const BUTTON_TITLE_MAX = 20;
const MAX_ROWS = 10;
const ROW_TITLE_MAX = 24;
const ID_MAX = 256;
/** Interactive body text limit (buttons); longer replies go out as plain text without options */
const BODY_MAX = 1024;
const LIST_BUTTON_LABEL = "Choose an option";

const clip = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`);

/** Clean, unique options within WhatsApp's limits */
export function normalizeQuickReplies(options: unknown): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const o of Array.isArray(options) ? options : []) {
    const text = typeof o === "string" ? o.replace(/\s+/g, " ").trim().slice(0, ID_MAX - ID_PREFIX.length) : "";
    const key = text.toLowerCase();
    if (!text || seen.has(key)) continue;
    seen.add(key);
    out.push(text);
    if (out.length === MAX_ROWS) break;
  }
  return out;
}

/** The `interactive` object of a WhatsApp message with these options, or null when it can't carry them */
export function buildQuickReplyInteractive(bodyText: string, options: string[]): Record<string, unknown> | null {
  const body = bodyText.trim();
  const opts = normalizeQuickReplies(options);
  if (!body || body.length > BODY_MAX || opts.length === 0) return null;

  if (opts.length <= MAX_BUTTONS && opts.every((o) => o.length <= BUTTON_TITLE_MAX)) {
    return {
      type: "button",
      body: { text: body },
      action: { buttons: opts.map((o) => ({ type: "reply", reply: { id: ID_PREFIX + o, title: o } })) },
    };
  }
  return {
    type: "list",
    body: { text: body },
    action: {
      button: LIST_BUTTON_LABEL,
      sections: [{ rows: opts.map((o) => ({ id: ID_PREFIX + o, title: clip(o, ROW_TITLE_MAX) })) }],
    },
  };
}

/**
 * What the customer "said" by tapping an option (button or list row) of an inbound interactive message:
 * the full option text for our own quick replies, otherwise the title WhatsApp showed. Null for other messages.
 */
export function quickReplyText(interactive: any): string | null {
  const reply = interactive?.type === "button_reply" ? interactive.button_reply : interactive?.type === "list_reply" ? interactive.list_reply : null;
  if (!reply) return null;
  const id = typeof reply.id === "string" ? reply.id : "";
  const text = id.startsWith(ID_PREFIX) ? id.slice(ID_PREFIX.length) : typeof reply.title === "string" ? reply.title : "";
  return text.trim() || null;
}
