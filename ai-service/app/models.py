"""API contract shared with the Next.js team. Change only after agreeing with them."""
from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, SecretStr, field_validator

Outcome = Literal["answered", "clarify", "handover", "blocked"]
HandoverReason = Literal[
    "customer_asked_human", "sensitive_topic", "no_answer", "turn_limit",
    "budget_exceeded", "error", "refund_request", "unresolved",
    "exchange_request", "angry_tone", "high_value_order", "repeat_contact", "low_confidence", "skill_disabled",
]
Route = Literal["flow", "cache", "rag", "guardrail", "fallback", "tool", "sales"]


class Message(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(default="", max_length=20000)


class UserInfo(BaseModel):
    id: str | None = None        # for order lookups: the store's customer id
    name: str | None = None
    email: str | None = None
    phone: str | None = None     # with country code, e.g. +919000000678 (WhatsApp sender)
    plan: str | None = None


class PageInfo(BaseModel):
    path: str | None = None
    title: str | None = None


class HandoverPolicy(BaseModel):
    """Handover rules the business switches on and tunes in the dashboard (Guardrails tab).
    Defaults reproduce the behaviour before policies existed."""
    ask_human: bool = True
    ask_human_scope: Literal["any_language", "english_only"] = "any_language"
    angry_tone: bool = True
    angry_sensitivity: Literal["low", "medium", "high"] = "low"   # low = abusive words only
    sensitive_topics: bool = True            # legal, fraud, medical/safety
    low_confidence: bool = False
    confidence_threshold: float = Field(default=0.5, ge=0, le=1)
    turn_limit: bool = True
    max_turns: int | None = Field(default=None, ge=1, le=50)
    high_value_order: bool = False
    high_value_amount: float = Field(default=10000, ge=0)
    repeat_contact: bool = False
    repeat_window_hours: int = Field(default=24, ge=1, le=168)


class TopicPolicy(BaseModel):
    """What the agent talks about (Guardrails > Topics)."""
    # Questions about something else entirely (not the store, its products, orders or policies) get a polite
    # "I can only help with ..." instead of a search miss, and never show up as knowledge gaps
    business_only: bool = True
    # Subjects customers may raise that the agent always declines, offering the team instead
    restricted: list[str] = Field(default_factory=list, max_length=30)
    # Competitor names the agent never recommends or discusses; replies that name one are replaced
    competitors: list[str] = Field(default_factory=list, max_length=30)


class ModerationPolicy(BaseModel):
    """Content moderation (deterministic word lists, no model call)."""
    profanity: bool = True        # abusive messages get a calm boundary reply (or the angry-tone handover)
    harmful: bool = True          # violence, weapons and drugs, sexual and hateful messages are declined
    output_filter: bool = True    # a model reply containing profanity is replaced


class AdvancedGuardrails(BaseModel):
    """Optional checks, available on the plans that include them. The app only sends True when the workspace's
    plan includes the check and the business switched it on, so this service trusts the flags as given."""
    # A second, short model call that checks a help answer against its articles; only for answers that already
    # look weak (confidence near the threshold, or numbers not found in the articles)
    groundedness_check: bool = False
    # Compares the message's embedding (already computed for search) with known injection attempts: catches
    # reworded attempts the patterns miss, at no extra cost
    injection_classifier: bool = False
    # The model provider's moderation endpoint, only for messages the word lists didn't already decide
    ai_moderation: bool = False


Tone = Literal["professional", "friendly", "casual", "premium", "custom"]
ReplyLength = Literal["short", "medium", "detailed"]


class AgentPolicy(BaseModel):
    """Per-workspace configuration sent by the Next.js app with every request. Platform rules are not
    configurable and always apply: self-harm, fraud and safety handover, prompt-injection and other customers'
    data refusals, card/OTP/credential masking in messages, replies and logs, price checks against store data,
    and refunds and exchanges going to a person."""
    handover: HandoverPolicy = HandoverPolicy()
    never_say: list[str] = Field(default_factory=list, max_length=30)
    allowed_languages: list[str] | None = None   # e.g. ["English", "Tamil"]; others get English
    max_reply_chars: int | None = Field(default=None, ge=200, le=2000)
    model_tier: Literal["standard", "advanced"] = "standard"
    wismo_enabled: bool = True
    faq_enabled: bool = True
    welcome_message: str | None = Field(default=None, max_length=500)
    starter_chips: list[str] | None = Field(default=None, max_length=6)
    # Kept for older apps; ignored. Phone numbers and emails are always masked in the AI logs (platform rule).
    mask_phone_in_logs: bool = True
    # How long conversation text is kept (runs, knowledge gaps, test replies). None: the platform default
    # (RETENTION_DEFAULT_DAYS). Enforced by an hourly sweep (app/retention.py).
    retention_days: int | None = Field(default=None, ge=7, le=3650)
    # Show customers the shipping address of their own order and how to change it (app/address.py)
    address_enabled: bool = True
    # Where customers change it; None: the reply shows the placeholder "Sample link"
    address_change_url: str | None = Field(default=None, max_length=500, pattern=r"^https://")
    tone: Tone = "friendly"                   # "custom" uses brand_voice only
    reply_length: ReplyLength = "medium"
    topics: TopicPolicy = TopicPolicy()
    moderation: ModerationPolicy = ModerationPolicy()
    advanced: AdvancedGuardrails = AdvancedGuardrails()


LlmProviderName = Literal["openai", "anthropic", "gemini", "groq"]


class LlmOverride(BaseModel):
    """Bring your own model: the business's own provider key, used for the reply-writing call only (knowledge
    search keeps UnoCX's embeddings). The key is never logged or stored by this service; it arrives with each
    request from the app, which keeps it encrypted."""
    provider: LlmProviderName
    model: str = Field(min_length=1, max_length=100)
    api_key: SecretStr = Field(min_length=8, max_length=500)
    monthly_limit_usd: float | None = Field(default=None, ge=0, le=1_000_000)


class ChatSettings(BaseModel):
    company_name: str = Field(default="our store", max_length=100)
    brand_voice: str = Field(default="Friendly, short, helpful", max_length=200)
    language: str = "match_customer"   # or a fixed language name, e.g. "English"
    max_turns: int | None = None
    source_ids: list[str] | None = None  # restrict retrieval to these knowledge sources
    policy: AgentPolicy = AgentPolicy()
    llm: LlmOverride | None = None     # None: UnoCX's own model for the plan tier


OrderStatus = Literal["Pending", "Shipped", "Delivered", "Returned", "Cancelled"]


class CommerceAddress(BaseModel):
    """The order's shipping address. Shown only to the customer who owns the order, in a reply built by code
    (app/address.py): it is never put in a model prompt, and it is blanked out of logs and of the chat history
    sent to the model later."""
    name: str | None = Field(default=None, max_length=120)
    line1: str | None = Field(default=None, max_length=200)
    line2: str | None = Field(default=None, max_length=200)
    city: str | None = Field(default=None, max_length=120)
    province: str | None = Field(default=None, max_length=120)
    zip: str | None = Field(default=None, max_length=20)
    country: str | None = Field(default=None, max_length=120)
    phone_last4: str | None = Field(default=None, pattern=r"^\d{4}$")


class CommerceOrder(BaseModel):
    """One order, already normalised by the Next.js app from the store platform (Shopify today).
    Prices are not shown in replies; the shipping address only to its owner (see CommerceAddress)."""
    order_number: str = Field(min_length=1, max_length=60)   # as the customer sees it: "#1001"
    order_id: str | None = Field(default=None, max_length=200)  # platform id, e.g. gid://shopify/Order/1
    items: str = Field(default="your items", max_length=200)  # "Linen shirt + 2 more"
    quantity: int = Field(default=1, ge=0, le=100000)
    total: float | None = None                               # only for the "high-value order" handover rule
    currency: str | None = Field(default=None, max_length=10)
    status: OrderStatus
    # finer delivery state from the carrier, when known: in_transit, out_for_delivery, attempted_delivery,
    # ready_for_pickup, failure ...
    delivery_status: str | None = Field(default=None, max_length=40)
    partially_shipped: bool = False
    order_date: datetime
    shipping_date: datetime | None = None
    expected_delivery: datetime | None = None
    delivered_at: datetime | None = None
    cancelled_at: datetime | None = None
    courier: str | None = Field(default=None, max_length=100)
    tracking_number: str | None = Field(default=None, max_length=100)
    tracking_url: str | None = Field(default=None, max_length=500)
    shipping_address: CommerceAddress | None = None
    # Test data only (AI agent > Test data): every column of the uploaded file for this order, by its header as
    # written, and one entry per item row for columns that differ between items. Connected stores don't send these.
    details: dict[str, str] | None = None
    item_details: list[dict[str, str]] | None = Field(default=None, max_length=200)

    @field_validator("details")
    @classmethod
    def _cap_details(cls, v):
        if not v:
            return v
        return {str(k)[:100]: str(val)[:500] for k, val in list(v.items())[:150]}

    @field_validator("item_details")
    @classmethod
    def _cap_items(cls, v):
        if not v:
            return v
        return [{str(k)[:100]: str(val)[:300] for k, val in list(d.items())[:60]} for d in v[:200]]


class CommerceStore(BaseModel):
    """What one connected store knows about the customer in this conversation."""
    ref: str = Field(min_length=1, max_length=100)            # "shopify:12" (platform:store id in the app)
    platform: str = Field(default="shopify", max_length=30)   # shopify today; woocommerce, ... later
    name: str | None = Field(default=None, max_length=200)
    # unavailable = the store couldn't be read right now (token expired, timeout)
    status: Literal["ok", "unavailable"] = "ok"
    customer_ref: str | None = Field(default=None, max_length=200)  # None: no customer of this store matches
    customer_name: str | None = Field(default=None, max_length=200)
    orders: list[CommerceOrder] = Field(default_factory=list, max_length=50)  # newest first is not required


class CommerceContext(BaseModel):
    """Order data for this conversation, looked up by the Next.js app (it holds the store tokens and decides
    which stores a channel uses). When present it replaces the built-in demo order data entirely.
      ok         one or more stores were checked (a store may still have no matching customer)
      no_store   the workspace has stores, but none applies to this conversation's channel
    """
    status: Literal["ok", "no_store"] = "ok"
    stores: list[CommerceStore] = Field(default_factory=list, max_length=10)


class CatalogProduct(BaseModel):
    """A product the app found in the business's store for this message (chat widget sales assistant)."""
    ref: str = Field(min_length=1, max_length=40)            # "P1": how the model refers to it
    title: str = Field(min_length=1, max_length=200)
    price: str | None = Field(default=None, max_length=40)   # formatted, e.g. "₹1,499"
    compare_at_price: str | None = Field(default=None, max_length=40)
    description: str | None = Field(default=None, max_length=400)
    url: str | None = Field(default=None, max_length=500)
    image_url: str | None = Field(default=None, max_length=800)
    buy_url: str | None = Field(default=None, max_length=500)   # straight to checkout with this product
    available: bool = True
    # Test data only: every other column of the uploaded products file (brand, size, colour, rating...)
    details: dict[str, str] | None = None

    @field_validator("details")
    @classmethod
    def _cap_details(cls, v):
        if not v:
            return v
        return {str(k)[:60]: str(val)[:200] for k, val in list(v.items())[:40]}


class SalesSettings(BaseModel):
    """The chat widget's shopping assistant: recommends products from `catalog` and helps the visitor buy."""
    enabled: bool = True
    assistant_name: str | None = Field(default=None, max_length=60)
    offer: str | None = Field(default=None, max_length=300)    # e.g. "WELCOME10 for 10% off your first order"
    goal: Literal["helpful", "balanced", "proactive"] = "balanced"
    # What the visitor asked for, read by the app from the conversation ("budget up to $100 · for women · size M")
    criteria: str | None = Field(default=None, max_length=300)
    # Every product in `catalog` meets all of it; else `relaxed` says what had to be dropped to find anything
    # ("product": the store has nothing of that kind; "colour", "size", "budget", "gender")
    criteria_matched: bool = True
    relaxed: list[str] = Field(default_factory=list, max_length=6)
    # Website chat: order questions are not answered there; they go to the business's WhatsApp (a wa.me link)
    order_help_url: str | None = Field(default=None, max_length=500, pattern=r"^https://")


class ChatRequest(BaseModel):
    workspace_id: str = Field(min_length=1, max_length=100)
    conversation_id: str = Field(min_length=1, max_length=200)
    user: UserInfo = UserInfo()
    page: PageInfo | None = None
    messages: list[Message] = Field(min_length=1, max_length=200)
    settings: ChatSettings = ChatSettings()
    channel: str | None = Field(default=None, max_length=30)   # whatsapp | instagram | web | test
    test: bool = False   # dashboard test chats: logged with the "test" flag, excluded from metrics
    commerce: CommerceContext | None = None   # None: use the demo order data (if loaded for the workspace)
    catalog: list[CatalogProduct] = Field(default_factory=list, max_length=8)
    sales: SalesSettings | None = None        # chat widget: act as a shopping assistant


class Citation(BaseModel):
    source_id: str
    chunk_id: int | None = None
    title: str | None = None
    url: str | None = None


class Usage(BaseModel):
    model: str | None = None
    input_tokens: int = 0
    output_tokens: int = 0
    cost_usd: float = 0.0


class ChatResponse(BaseModel):
    run_id: str
    conversation_id: str
    outcome: Outcome
    handover_reason: HandoverReason | None = None
    handover_summary: str | None = None      # shown to the human agent in the inbox
    reply: str
    route: Route
    citations: list[Citation] = []
    suggestions: list[str] = []              # quick-reply chips for the UI (WhatsApp: reply buttons)
    ended: bool = False                      # the customer finished the chat ("that's all, thanks"): nothing open
    products: list[CatalogProduct] = []      # products recommended in the reply (chat widget cards)
    action: dict[str, Any] | None = None     # e.g. {"type": "form", "form": "contact_support", ...}
    flags: list[str] = []                    # e.g. ["prompt_injection", "card_number_masked"]
    usage: Usage = Usage()
    latency_ms: int = 0
    confidence: float | None = None          # 0-1 support for the answer (1.0 for rule-based replies)
    trace: dict[str, Any] = {}               # stage timings, retrieval results; used by evals and debugging


class FeedbackRequest(BaseModel):
    workspace_id: str
    run_id: str
    helpful: bool
    comment: str | None = Field(default=None, max_length=1000)


class SourceCreate(BaseModel):
    workspace_id: str
    type: Literal["text", "markdown", "faq", "url"]
    title: str = Field(min_length=1, max_length=300)
    content: str | None = None   # text / markdown body, or FAQ as JSON [{"q":..,"a":..}] or "Q: .. A: .." text
    uri: str | None = None       # for url sources; also used as the citation link for text sources


class FlowCreate(BaseModel):
    workspace_id: str
    name: str
    keywords: list[str] = Field(min_length=1)
    match_type: Literal["exact", "fuzzy"] = "exact"
    max_words: int | None = None   # only match short messages (e.g. greetings) so "hi, my refund?" goes to the AI
    reply_text: str
    outcome: Outcome = "answered"
    action: dict[str, Any] | None = None
    suggestions: list[str] = []
    priority: int = 100
    enabled: bool = True
