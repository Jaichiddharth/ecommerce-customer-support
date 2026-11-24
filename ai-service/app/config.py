from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict

# USD per 1M tokens. Check https://openai.com/api/pricing and update if prices change.
PRICES = {
    "gpt-4o-mini": (0.15, 0.60),
    "gpt-4.1-mini": (0.40, 1.60),
    "gpt-4.1-nano": (0.10, 0.40),
    "gpt-4.1": (2.00, 8.00),
    "gpt-4o": (2.50, 10.00),
    "text-embedding-3-small": (0.02, 0.0),
    "text-embedding-3-large": (0.13, 0.0),
    "fake-chat": (0.0, 0.0),
    "fake-embed": (0.0, 0.0),
}


APP_VERSION = "1.5.0"
WEAK_TOKENS = {"", "dev-token", "change-me", "change-me-long-random-string"}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore", env_ignore_empty=True)

    # "development" or "production". Production refuses to start with unsafe settings.
    app_env: str = "development"
    # None = on in development, off in production
    enable_playground: bool | None = None

    database_url: str = "postgresql://unocx:unocx@localhost:5432/unocx"
    service_token: str = "dev-token"

    llm_provider: str = "fake"  # "openai" | "fake"
    openai_api_key: str = ""
    chat_model: str = "gpt-4o-mini"
    chat_model_advanced: str = "gpt-4.1"   # "Advanced" tier: long multi-step chats, Indian languages
    embed_model: str = "text-embedding-3-small"
    embed_dim: int = 1536
    llm_timeout_s: float = 12.0

    budget_usd: float = 7.50
    max_output_tokens: int = 350
    rate_limit_per_min: int = 12

    max_turns: int = 10
    max_reply_chars: int = 900
    max_input_chars: int = 2000
    history_messages: int = 6
    cache_min_votes: int = 2
    cache_similarity: float = 0.92

    # Relevance gate. Cosine similarity of the best chunk must reach this to answer.
    # OpenAI embeddings and the fake hashing embedder live on different scales.
    min_similarity_openai: float = 0.30
    min_similarity_fake: float = 0.12

    # Order-intent matching by meaning (layer 2). "order" at or above the first value AND closer to
    # order examples than policy examples by the margin; "maybe" (ask the AI, layer 3) at or above the
    # second. Tune with the order-intent sweep in the eval report.
    order_intent_openai: float = 0.50
    order_maybe_openai: float = 0.40
    order_intent_fake: float = 0.50
    order_maybe_fake: float = 0.35
    order_intent_margin: float = 0.03

    # Secret for hashing cached questions. Empty = derived from SERVICE_TOKEN. Changing it (or the
    # token) simply starts the embedding cache afresh.
    cache_hash_secret: str = ""

    cors_origins: str = "http://localhost:3000"

    # Data retention: conversation text (runs, knowledge gaps, test replies, handover state, resolved complaints)
    # older than the workspace's retention_days is deleted by an hourly sweep. Workspaces that never sent a value
    # use this default. The sweep can be switched off for one-off maintenance (RETENTION_SWEEP=false).
    retention_default_days: int = 365
    retention_sweep: bool = True
    retention_sweep_interval_s: int = 3600

    # Off-topic detection (Guardrails > Topics): a question the knowledge doesn't cover counts as off-topic when
    # its embedding is at least this close to the off-topic examples and closer to them than to the store
    # examples by the margin (app/topics.py). Measured on text-embedding-3-small (2026-11): 16 of 20 off-topic
    # questions caught, 0 of 20 unusual store questions ("invoice with GST", "engraving on a ring").
    off_topic_openai: float = 0.30
    off_topic_fake: float = 0.30
    off_topic_margin: float = 0.10

    # Advanced injection classifier: blocks when the message is at least this close to known attempts AND closer
    # to them than to store questions by the margin. Similarity alone can't separate them ("your store policy on
    # refunds" scores 0.58, like an attack); with the margin, 7 of 8 reworded attempts and 0 of 30 normal questions.
    injection_similarity_openai: float = 0.53
    injection_similarity_fake: float = 0.55
    injection_margin: float = 0.15

    # Answer order questions from the demo `commerce` schema when the app sends no order data with a
    # request (a workspace without a connected store). Turn off in production once stores are connected.
    demo_orders: bool = True

    @property
    def playground_enabled(self) -> bool:
        return self.enable_playground if self.enable_playground is not None else self.app_env != "production"

    def production_problems(self) -> list[str]:
        """Settings that are fine for a laptop but dangerous in production."""
        if self.app_env != "production":
            return []
        problems = []
        if self.service_token in WEAK_TOKENS or len(self.service_token) < 24:
            problems.append("SERVICE_TOKEN is missing, a default value, or shorter than 24 characters")
        if self.llm_provider != "openai":
            problems.append("LLM_PROVIDER must be 'openai' in production (fake mode returns copied sentences)")
        if self.llm_provider == "openai" and not self.openai_api_key.startswith("sk-"):
            problems.append("OPENAI_API_KEY is missing")
        if "unocx:unocx@" in self.database_url:
            problems.append("DATABASE_URL uses the default demo password (unocx:unocx)")
        return problems

    @property
    def order_intent_thresholds(self) -> tuple[float, float]:
        if self.llm_provider == "openai":
            return self.order_intent_openai, self.order_maybe_openai
        return self.order_intent_fake, self.order_maybe_fake

    @property
    def min_similarity(self) -> float:
        return self.min_similarity_openai if self.llm_provider == "openai" else self.min_similarity_fake

    @property
    def off_topic_threshold(self) -> float:
        return self.off_topic_openai if self.llm_provider == "openai" else self.off_topic_fake

    @property
    def injection_similarity(self) -> float:
        return self.injection_similarity_openai if self.llm_provider == "openai" else self.injection_similarity_fake


@lru_cache
def get_settings() -> Settings:
    return Settings()
