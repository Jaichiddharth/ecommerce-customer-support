/**
 * AI agent policy: everything a business customises on the AI agent screens.
 *
 * Shared by the dashboard (forms) and the server (validation, storage, sending it to the
 * Python AI service with every chat). Platform rules are NOT part of the policy and can't be
 * switched off: self-harm, fraud and safety handover, prompt-injection and other-customers'-data
 * refusals (in messages and in knowledge/product text), card/OTP/credential masking in messages,
 * replies and logs, phone/email masking in logs, prices only from store data, data retention, and
 * refunds and exchanges always going to a person.
 */

export type Sensitivity = "low" | "medium" | "high";
/** byo: the business's own provider key (Model tab); replies fall back to Standard if it fails */
export type ModelTier = "standard" | "advanced" | "byo";
export type ReplyLanguage = "match" | "english";
export type ReplyHours = "24x7" | "outside_business_hours";
export type Tone = "professional" | "friendly" | "casual" | "premium" | "custom";
export type ReplyLength = "short" | "medium" | "detailed";

export interface HandoverRules {
  askHuman: { on: boolean; scope: "any_language" | "english_only" };
  angryTone: { on: boolean; sensitivity: Sensitivity };
  /** Legal topics only: self-harm, fraud and safety always go to a person (platform rule) */
  sensitiveTopics: { on: boolean };
  lowConfidence: { on: boolean; threshold: number };
  turnLimit: { on: boolean; turns: number };
  highValueOrder: { on: boolean; amount: number };
  repeatContact: { on: boolean; hours: number };
}

export interface AgentPolicy {
  modelTier: ModelTier;
  skills: {
    faq: boolean;
    wismo: boolean;
    welcomeMessage: string;
    starterChips: string[];
    /** Show customers the shipping address of their own order, and how to change it */
    addressLookup: boolean;
    /** Where customers change the address (https). Empty: the reply shows the placeholder "Sample link" */
    addressChangeUrl: string;
  };
  persona: {
    brandVoice: string;
    replyLanguage: ReplyLanguage;
    languages: string[];
    replyHours: ReplyHours;
    maxReplyChars: number;
    tone: Tone;
    replyLength: ReplyLength;
  };
  handover: HandoverRules;
  neverSay: string[];
  topics: {
    /** Questions unrelated to the store get a polite "I can only help with..." (and are never knowledge gaps) */
    businessOnly: boolean;
    /** Subjects the agent always declines, offering the team */
    restricted: string[];
    /** Companies the agent never recommends, compares with or mentions */
    competitors: string[];
  };
  moderation: { profanity: boolean; harmful: boolean; outputFilter: boolean };
  /** Optional checks: sent to the AI service only when the organisation's plan includes them (ADVANCED_GUARDRAIL_PLANS) */
  advanced: { groundednessCheck: boolean; injectionClassifier: boolean; aiModeration: boolean };
  privacy: {
    /** Always on (platform rule); kept so stored policies and the form keep their shape */
    maskPhoneInLogs: true;
    hideAddress: true;
    neverSendPaymentDetails: true;
    noProviderTraining: true;
    retentionDays: number;
  };
}

export const SUPPORTED_LANGUAGES = ["English", "Tamil", "Hindi", "Hinglish", "Tanglish"] as const;
export const SENSITIVITY_OPTIONS: Sensitivity[] = ["low", "medium", "high"];
export const CONFIDENCE_OPTIONS = [0.5, 0.6, 0.7, 0.8];
export const TURN_OPTIONS = [3, 4, 5, 6, 8, 10];
export const RETENTION_OPTIONS = [30, 90, 180, 365];
export const MAX_NEVER_SAY = 30;
export const BRAND_VOICE_MAX = 200;
export const MAX_TOPICS = 30;
export const TONE_OPTIONS: { value: Tone; label: string; hint: string }[] = [
  { value: "friendly", label: "Friendly", hint: "Warm, simple words, upbeat" },
  { value: "professional", label: "Professional", hint: "Clear and courteous, no slang or emojis" },
  { value: "casual", label: "Casual", hint: "Relaxed and conversational" },
  { value: "premium", label: "Premium", hint: "Polished, gracious, never pushy" },
  { value: "custom", label: "Custom", hint: "Only your brand-voice notes" },
];
export const LENGTH_OPTIONS: { value: ReplyLength; label: string }[] = [
  { value: "short", label: "Short (about 60 words)" },
  { value: "medium", label: "Medium (about 120 words)" },
  { value: "detailed", label: "Detailed (about 200 words)" },
];
/** Plans that include the advanced guardrails (policy.advanced) */
export const ADVANCED_GUARDRAIL_PLANS = ["pro", "enterprise"] as const;
export const advancedGuardrailsIncluded = (plan: string | null | undefined) =>
  (ADVANCED_GUARDRAIL_PLANS as readonly string[]).includes((plan || "").toLowerCase());

export const DEFAULT_POLICY: AgentPolicy = {
  modelTier: "standard",
  skills: {
    faq: true,
    wismo: true,
    welcomeMessage: "Hi {name}! I'm the virtual assistant. I can help with your orders, returns, sizes and delivery.",
    starterChips: ["Track my order", "Returns & exchange", "Size guide", "Talk to support"],
    addressLookup: true,
    addressChangeUrl: "",
  },
  persona: {
    brandVoice: 'Friendly, short and helpful. Use "we".\nAddress customers by first name.\nNo slang, no promises beyond policy.',
    replyLanguage: "match",
    languages: ["English", "Tamil", "Hindi", "Hinglish"],
    replyHours: "24x7",
    maxReplyChars: 600,
    tone: "friendly",
    replyLength: "medium",
  },
  handover: {
    askHuman: { on: true, scope: "any_language" },
    angryTone: { on: true, sensitivity: "medium" },
    sensitiveTopics: { on: true },
    lowConfidence: { on: true, threshold: 0.5 },
    turnLimit: { on: true, turns: 5 },
    highValueOrder: { on: true, amount: 10000 },
    repeatContact: { on: false, hours: 24 },
  },
  neverSay: [
    "Discounts not in policy",
    "Exact delivery dates",
    "Refund approval",
    "Competitor names",
    "Medical or skin claims",
    "Other customers' orders",
    "Prices for wholesale",
    "Personal opinions",
  ],
  topics: { businessOnly: true, restricted: [], competitors: [] },
  moderation: { profanity: true, harmful: true, outputFilter: true },
  advanced: { groundednessCheck: false, injectionClassifier: false, aiModeration: false },
  privacy: {
    maskPhoneInLogs: true,
    hideAddress: true,
    neverSendPaymentDetails: true,
    noProviderTraining: true,
    retentionDays: 90,
  },
};

/** AI resolutions included per month, by organisation plan. */
export const PLAN_AI_RESOLUTIONS: Record<string, number | null> = {
  starter: 100,
  growth: 300,
  pro: 1000,
  enterprise: null, // unlimited / contract
};

export const CREDITS_PER_RESOLUTION: Record<ModelTier, number> = { standard: 1, advanced: 2, byo: 0 };

// ---------------------------------------------------------------- validation

const clampNum = (v: unknown, min: number, max: number, fallback: number) => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const oneOf = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const text = (v: unknown, max: number, fallback: string) =>
  typeof v === "string" ? v.slice(0, max) : fallback;
/** A valid https URL (max 500 characters), else "" */
export const httpsUrl = (v: unknown): string => {
  if (typeof v !== "string" || !v.trim()) return "";
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" && v.trim().length <= 500 ? u.toString() : "";
  } catch {
    return "";
  }
};
const list = (v: unknown, maxItems: number, maxLen: number, fallback: string[]) =>
  Array.isArray(v)
    ? Array.from(new Set(v.filter((x): x is string => typeof x === "string").map((x) => x.trim().slice(0, maxLen)).filter(Boolean))).slice(0, maxItems)
    : fallback;

/**
 * Turn anything (a stored row from an older version, or a request body) into a complete, valid
 * policy. Unknown fields are dropped, missing ones take the defaults, numbers are clamped.
 */
export function normalizePolicy(input: unknown): AgentPolicy {
  const i = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const d = DEFAULT_POLICY;
  const sk = i.skills ?? {};
  const pe = i.persona ?? {};
  const h = i.handover ?? {};
  const pr = i.privacy ?? {};
  const tp = i.topics ?? {};
  const md = i.moderation ?? {};
  const ad = i.advanced ?? {};
  const languages = list(pe.languages, 10, 30, d.persona.languages).filter((l) =>
    (SUPPORTED_LANGUAGES as readonly string[]).includes(l),
  );

  return {
    modelTier: oneOf(i.modelTier, ["standard", "advanced", "byo"] as const, d.modelTier),
    skills: {
      faq: bool(sk.faq, d.skills.faq),
      wismo: bool(sk.wismo, d.skills.wismo),
      welcomeMessage: text(sk.welcomeMessage, 500, d.skills.welcomeMessage),
      starterChips: list(sk.starterChips, 6, 40, d.skills.starterChips),
      addressLookup: bool(sk.addressLookup, d.skills.addressLookup),
      addressChangeUrl: httpsUrl(sk.addressChangeUrl),
    },
    persona: {
      brandVoice: text(pe.brandVoice, BRAND_VOICE_MAX, d.persona.brandVoice),
      replyLanguage: oneOf(pe.replyLanguage, ["match", "english"] as const, d.persona.replyLanguage),
      languages: languages.length ? languages : ["English"],
      replyHours: oneOf(pe.replyHours, ["24x7", "outside_business_hours"] as const, d.persona.replyHours),
      maxReplyChars: clampNum(pe.maxReplyChars, 200, 2000, d.persona.maxReplyChars),
      tone: oneOf(pe.tone, ["professional", "friendly", "casual", "premium", "custom"] as const, d.persona.tone),
      replyLength: oneOf(pe.replyLength, ["short", "medium", "detailed"] as const, d.persona.replyLength),
    },
    handover: {
      askHuman: {
        on: bool(h.askHuman?.on, d.handover.askHuman.on),
        scope: oneOf(h.askHuman?.scope, ["any_language", "english_only"] as const, d.handover.askHuman.scope),
      },
      angryTone: {
        on: bool(h.angryTone?.on, d.handover.angryTone.on),
        sensitivity: oneOf(h.angryTone?.sensitivity, SENSITIVITY_OPTIONS, d.handover.angryTone.sensitivity),
      },
      sensitiveTopics: { on: bool(h.sensitiveTopics?.on, d.handover.sensitiveTopics.on) },
      lowConfidence: {
        on: bool(h.lowConfidence?.on, d.handover.lowConfidence.on),
        threshold: clampNum(h.lowConfidence?.threshold, 0, 1, d.handover.lowConfidence.threshold),
      },
      turnLimit: {
        on: bool(h.turnLimit?.on, d.handover.turnLimit.on),
        turns: Math.round(clampNum(h.turnLimit?.turns, 1, 50, d.handover.turnLimit.turns)),
      },
      highValueOrder: {
        on: bool(h.highValueOrder?.on, d.handover.highValueOrder.on),
        amount: clampNum(h.highValueOrder?.amount, 0, 10_000_000, d.handover.highValueOrder.amount),
      },
      repeatContact: {
        on: bool(h.repeatContact?.on, d.handover.repeatContact.on),
        hours: Math.round(clampNum(h.repeatContact?.hours, 1, 168, d.handover.repeatContact.hours)),
      },
    },
    neverSay: list(i.neverSay, MAX_NEVER_SAY, 80, d.neverSay),
    topics: {
      businessOnly: bool(tp.businessOnly, d.topics.businessOnly),
      restricted: list(tp.restricted, MAX_TOPICS, 80, d.topics.restricted),
      competitors: list(tp.competitors, MAX_TOPICS, 80, d.topics.competitors),
    },
    moderation: {
      profanity: bool(md.profanity, d.moderation.profanity),
      harmful: bool(md.harmful, d.moderation.harmful),
      outputFilter: bool(md.outputFilter, d.moderation.outputFilter),
    },
    advanced: {
      groundednessCheck: bool(ad.groundednessCheck, d.advanced.groundednessCheck),
      injectionClassifier: bool(ad.injectionClassifier, d.advanced.injectionClassifier),
      aiModeration: bool(ad.aiModeration, d.advanced.aiModeration),
    },
    privacy: {
      maskPhoneInLogs: true,
      hideAddress: true,
      neverSendPaymentDetails: true,
      noProviderTraining: true,
      retentionDays: Math.round(clampNum(pr.retentionDays, 7, 3650, d.privacy.retentionDays)),
    },
  };
}

// ---------------------------------------------------------------- AI service mapping

/**
 * `settings` object of the AI service's ChatRequest (snake_case, see ai-service/app/models.py).
 * `plan` is the organisation's plan: advanced guardrails are sent only when it includes them, whatever the
 * stored policy says (the AI service trusts these flags).
 */
export function toServiceSettings(policy: AgentPolicy, companyName: string, plan?: string | null) {
  const p = policy;
  const advanced = advancedGuardrailsIncluded(plan);
  return {
    company_name: (companyName || "our store").slice(0, 100),
    brand_voice: p.persona.brandVoice.replace(/\s+/g, " ").trim().slice(0, 200) || "Friendly, short, helpful",
    language: p.persona.replyLanguage === "english" ? "English" : "match_customer",
    policy: {
      handover: {
        ask_human: p.handover.askHuman.on,
        ask_human_scope: p.handover.askHuman.scope,
        angry_tone: p.handover.angryTone.on,
        angry_sensitivity: p.handover.angryTone.sensitivity,
        sensitive_topics: p.handover.sensitiveTopics.on,
        low_confidence: p.handover.lowConfidence.on,
        confidence_threshold: p.handover.lowConfidence.threshold,
        turn_limit: p.handover.turnLimit.on,
        max_turns: p.handover.turnLimit.turns,
        high_value_order: p.handover.highValueOrder.on,
        high_value_amount: p.handover.highValueOrder.amount,
        repeat_contact: p.handover.repeatContact.on,
        repeat_window_hours: p.handover.repeatContact.hours,
      },
      never_say: p.neverSay,
      allowed_languages: p.persona.replyLanguage === "english" ? ["English"] : withScriptVariants(p.persona.languages),
      max_reply_chars: p.persona.maxReplyChars,
      // The own model itself travels as settings.llm (added by the server, never stored in the policy)
      model_tier: p.modelTier === "advanced" ? "advanced" : "standard",
      wismo_enabled: p.skills.wismo,
      faq_enabled: p.skills.faq,
      welcome_message: p.skills.welcomeMessage.trim() || null,
      starter_chips: p.skills.starterChips.length ? p.skills.starterChips : null,
      address_enabled: p.skills.addressLookup,
      address_change_url: p.skills.addressChangeUrl || null,
      mask_phone_in_logs: true,
      retention_days: p.privacy.retentionDays,
      tone: p.persona.tone,
      reply_length: p.persona.replyLength,
      topics: { business_only: p.topics.businessOnly, restricted: p.topics.restricted, competitors: p.topics.competitors },
      moderation: { profanity: p.moderation.profanity, harmful: p.moderation.harmful, output_filter: p.moderation.outputFilter },
      advanced: {
        groundedness_check: advanced && p.advanced.groundednessCheck,
        injection_classifier: advanced && p.advanced.injectionClassifier,
        ai_moderation: advanced && p.advanced.aiModeration,
      },
    },
  };
}

/** "Tamil" also allows Tanglish (Tamil in English letters); the service detects them separately. */
function withScriptVariants(languages: string[]): string[] {
  const out = new Set(languages);
  if (out.has("Tamil")) out.add("Tanglish");
  out.add("English");
  return Array.from(out);
}

/** Readable labels for handover reasons returned by the AI service. */
export const HANDOVER_REASON_LABELS: Record<string, string> = {
  customer_asked_human: "Asked for a person",
  sensitive_topic: "Legal, fraud or safety",
  no_answer: "No answer in knowledge",
  turn_limit: "Turn limit reached",
  budget_exceeded: "AI budget reached",
  error: "Technical problem",
  refund_request: "Refund request",
  unresolved: "Couldn't resolve",
  exchange_request: "Exchange request",
  angry_tone: "Complaint / angry tone",
  high_value_order: "Order value above limit",
  repeat_contact: "Repeat contact",
  low_confidence: "Low-confidence answer",
  skill_disabled: "Skill switched off",
};
