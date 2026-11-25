"""LLM + embeddings. Two providers:

* openai - real answers (costs money; every call is logged to ai.usage_log)
* fake   - free, deterministic, offline. Hashing embeddings + extractive answers.
           Use it for development, CI and for running the edge-case test set without
           spending your credit. It checks plumbing and guardrails, not answer quality.
"""
import hashlib
import math
import re
from collections.abc import Iterator
from dataclasses import dataclass

from .config import PRICES, get_settings
from .db import conn

HANDOVER_TOKEN = "HANDOVER"
ORDER_TOKEN = "ORDER_STATUS"  # the AI says this when the question is about the customer's own order (layer 3)

_STOP = set("""a an the is are was were be been am i me my we our you your it its this that to of in on
for with at by from and or but if so do does did can could should would will shall may might
how what when where which who why whom please pls plz hi hello hey tell about any some there
here have has had get got want need know""".split())


GROUNDEDNESS_MARKER = "You check whether a customer-service reply is supported"


@dataclass
class ChatResult:
    text: str
    model: str
    input_tokens: int
    output_tokens: int

    @property
    def cost(self) -> float:
        return cost_of(self.model, self.input_tokens, self.output_tokens)


def cost_of(model: str, inp: int, out: int) -> float:
    pin, pout = PRICES.get(model, (0.0, 0.0))
    return (inp * pin + out * pout) / 1_000_000


# Bring-your-own-model spend is an estimate for the business's own monthly limit: providers bill them directly.
# Unknown models are counted at a deliberately high rate so the limit errs on the safe side.
BYO_DEFAULT_PRICE = (3.00, 15.00)


def byo_cost(model: str, inp: int, out: int) -> float:
    pin, pout = PRICES.get(model, BYO_DEFAULT_PRICE)
    return (inp * pin + out * pout) / 1_000_000


# ---------------------------------------------------------------- budget

_spent_cache = {"at": 0.0, "value": 0.0}
SPENT_CACHE_S = 5.0


def spent_usd(fresh: bool = False) -> float:
    """Total recorded OpenAI spend. Cached for a few seconds so the budget check doesn't scan
    the usage table on every message."""
    import time
    now = time.time()
    if fresh or now - _spent_cache["at"] > SPENT_CACHE_S:
        with conn() as c:
            # the business's own-key calls are billed to them, not to UnoCX's budget
            row = c.execute("SELECT coalesce(sum(cost_usd),0) AS s FROM ai.usage_log WHERE kind NOT LIKE 'byo%%'").fetchone()
        _spent_cache.update(at=now, value=float(row["s"]))
    return _spent_cache["value"]


def budget_ok() -> bool:
    s = get_settings()
    if s.llm_provider != "openai":
        return True
    return spent_usd() < s.budget_usd


def log_usage(workspace_id: str | None, kind: str, model: str, inp: int, out: int):
    cost = byo_cost(model, inp, out) if kind.startswith("byo") else cost_of(model, inp, out)
    with conn() as c:
        c.execute(
            "INSERT INTO ai.usage_log (workspace_id, kind, model, input_tokens, output_tokens, cost_usd)"
            " VALUES (%s,%s,%s,%s,%s,%s)",
            (workspace_id, kind, model, inp, out, cost),
        )


def byo_spent_this_month(workspace_id: str) -> float:
    """Estimated spend on the business's own model key since the 1st of this month (UTC)."""
    with conn() as c:
        row = c.execute("SELECT coalesce(sum(cost_usd),0) AS s FROM ai.usage_log WHERE workspace_id=%s"
                        " AND kind LIKE 'byo%%' AND created_at >= date_trunc('month', now())", (workspace_id,)).fetchone()
    return float(row["s"])


# ---------------------------------------------------------------- tokens helpers

def words(text: str) -> list[str]:
    return re.findall(r"[\w\u0900-\u097F\u0B80-\u0BFF]+", text.lower())


def content_words(text: str) -> list[str]:
    return [_stem(w) for w in words(text) if w not in _STOP and len(w) > 1]


def _stem(w: str) -> str:
    for suf in ("ing", "ed", "es", "s"):
        if len(w) > len(suf) + 2 and w.endswith(suf):
            w = w[: -len(suf)]
            break
    return w[:-1] if len(w) > 4 and w.endswith("e") else w


# ---------------------------------------------------------------- fake provider

class FakeProvider:
    chat_model = "fake-chat"
    embed_model = "fake-embed"

    def embed(self, texts: list[str], workspace_id: str | None = None, kind: str = "embed"):
        dim = get_settings().embed_dim
        out = []
        for t in texts:
            v = [0.0] * dim
            for w in content_words(t):
                self._add(v, "w:" + w, 1.0, dim)
                for i in range(max(1, len(w) - 3)):          # char 4-grams tolerate typos
                    self._add(v, "c:" + w[i:i + 4], 0.35, dim)
            n = math.sqrt(sum(x * x for x in v)) or 1.0
            out.append([x / n for x in v])
        return out

    @staticmethod
    def _add(v, key, weight, dim):
        h = int(hashlib.md5(key.encode()).hexdigest(), 16)
        v[h % dim] += weight if (h >> 64) & 1 else -weight

    def moderate(self, text: str) -> list[str]:
        return []     # offline: the deterministic word lists in guardrails.py decide

    def chat(self, messages, chunks, question, model: str | None = None) -> ChatResult:
        if messages[0]["content"].startswith(GROUNDEDNESS_MARKER):   # stand-in judge: word overlap
            reply = messages[1]["content"].split("REPLY:", 1)[-1]
            art = set(content_words(messages[1]["content"].split("REPLY:", 1)[0]))
            words_ = set(content_words(reply))
            ok = not words_ or len(words_ & art) / len(words_) >= 0.6
            return ChatResult("SUPPORTED" if ok else "UNSUPPORTED: the reply has claims not in the articles",
                              self.chat_model, 50, 5)
        # Stand-in for layer 3: when the prompt allows order lookups and the question mentions the
        # customer's own order, answer ORDER_STATUS like the real model is instructed to.
        if "\nORDER RECORD:\n" in messages[0]["content"]:   # order details: the record line the question names
            text = self._order_detail(messages[0]["content"], question)
        elif "\nPRODUCTS:\n" in messages[0]["content"]:      # shopping assistant: recommend matching products
            text = self._recommend(messages[0]["content"], question)
        elif ORDER_TOKEN in messages[0]["content"] and re.search(
                r"\b(my|mera|meri)\b.*\b(order|parcel|package|delivery|shipment|stuff|purchase|items?|saman)\b",
                question, re.I) and re.search(
                r"\b(where|when|status|arriv\w*|com(e|ing)|reach\w*|track\w*|eta|kab|kahan|way|taking|waiting|"
                r"news|update|still|show up|left|handed|close|milega|pahunch\w*)\b", question, re.I):
            text = ORDER_TOKEN
        else:
            text = self._extract(chunks, question)
        inp = sum(len(m["content"]) for m in messages) // 4
        return ChatResult(text, self.chat_model, inp, len(text) // 4)

    def chat_stream(self, messages, chunks, question, model: str | None = None) -> Iterator[str | ChatResult]:
        res = self.chat(messages, chunks, question)
        for piece in re.findall(r"\S+\s*", res.text):
            yield piece
        yield res

    @staticmethod
    def _order_detail(system: str, question: str) -> str:
        record = system.split("ORDER RECORD:\n", 1)[1]
        number = record.splitlines()[0].split(":", 1)[-1].strip()
        q = set(re.findall(r"[a-z0-9]+", question.lower())) - {"order", "number", "status", "my", "the", "what", "was"}
        best, hits = None, 0
        for line in record.splitlines()[2:]:   # the line whose name shares the most words with the question
            key, _, value = line.partition(":")
            n = len(set(re.findall(r"[a-z0-9]+", key.lower())) & q)
            if n > hits:
                best, hits = (key.strip(), value.strip()), n
        if best:
            return f"For order {number}, the {best[0].lower()} is {best[1]}."
        return f"I don't have that detail for order {number}. I can connect you with our team."

    @staticmethod
    def _recommend(system: str, question: str) -> str:
        products = re.findall(r"^\[(P\d+)\] ([^|\n]+)\|[^\n]*?\| (in stock|sold out)", system.split("\nPRODUCTS:\n", 1)[1], re.M)
        q = set(content_words(question))
        fits = [(ref, title.strip()) for ref, title, stock in products
                if stock == "in stock" and q & set(content_words(title))] or \
               [(ref, title.strip()) for ref, title, stock in products if stock == "in stock"][:2]
        if not fits:
            return "I couldn't find that in our catalogue right now. What are you shopping for?"
        picks = " and ".join(f"the {title} [{ref}]" for ref, title in fits[:2])
        return f"I'd suggest {picks}. Would you like help choosing a size?"

    @staticmethod
    def _extract(chunks, question) -> str:
        if not chunks:
            return HANDOVER_TOKEN
        q = set(content_words(question))
        # pick the chunk (of the top 3) that shares most words with the question
        best = max(chunks[:3], key=lambda c: len(q & set(content_words(c["text"]))))
        overlap = len(q & set(content_words(best["text"])))
        if q and overlap / len(q) < 0.3:      # mimic the real model saying "not in the articles"
            return HANDOVER_TOKEN
        body = best["text"].split("\n", 1)[-1]          # drop the heading-path / "Q:" line
        body = re.sub(r"^\s*A:\s*", "", body)
        sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n+", body) if len(s.strip()) > 20]
        if not sentences:
            return best["text"][:400] + " [1]"
        scored = sorted(range(len(sentences)),
                        key=lambda i: -len(q & set(content_words(sentences[i]))))
        keep = sorted(scored[:3])
        return " ".join(sentences[i].lstrip("#-* ") for i in keep) + " [1]"


# ---------------------------------------------------------------- openai provider

class OpenAIProvider:
    def __init__(self):
        from openai import OpenAI

        s = get_settings()
        if not s.openai_api_key or s.openai_api_key.startswith("sk-..."):
            raise RuntimeError("OPENAI_API_KEY is not set")
        self.client = OpenAI(api_key=s.openai_api_key, timeout=s.llm_timeout_s, max_retries=1)
        self.chat_model = s.chat_model
        self.embed_model = s.embed_model
        self.s = s

    def embed(self, texts: list[str], workspace_id: str | None = None, kind: str = "embed"):
        out = []
        for i in range(0, len(texts), 96):
            batch = [t[:8000] for t in texts[i:i + 96]]
            r = self.client.embeddings.create(model=self.embed_model, input=batch,
                                              dimensions=self.s.embed_dim)
            out.extend(d.embedding for d in r.data)
            log_usage(workspace_id, kind, self.embed_model, r.usage.total_tokens, 0)
        return out

    def moderate(self, text: str) -> list[str]:
        """Flagged categories from the provider's moderation endpoint (free; called only when enabled)."""
        r = self.client.moderations.create(model="omni-moderation-latest", input=text[:4000])
        res = r.results[0]
        if not res.flagged:
            return []
        cats = res.categories.model_dump() if hasattr(res.categories, "model_dump") else dict(res.categories)
        return sorted(k for k, v in cats.items() if v)

    def chat(self, messages, chunks, question, model: str | None = None) -> ChatResult:
        model = model or self.chat_model
        r = self.client.chat.completions.create(
            model=model, messages=messages, temperature=0.2,
            max_tokens=self.s.max_output_tokens,
        )
        return ChatResult(r.choices[0].message.content or "", model,
                          r.usage.prompt_tokens, r.usage.completion_tokens)

    def chat_stream(self, messages, chunks, question, model: str | None = None) -> Iterator[str | ChatResult]:
        model = model or self.chat_model
        stream = self.client.chat.completions.create(
            model=model, messages=messages, temperature=0.2,
            max_tokens=self.s.max_output_tokens, stream=True,
            stream_options={"include_usage": True},
        )
        parts, inp, out = [], 0, 0
        for ev in stream:
            if ev.usage:
                inp, out = ev.usage.prompt_tokens, ev.usage.completion_tokens
            if ev.choices and ev.choices[0].delta.content:
                parts.append(ev.choices[0].delta.content)
                yield ev.choices[0].delta.content
        yield ChatResult("".join(parts), model, inp, out)


# ---------------------------------------------------------------- bring your own model

# Every supported provider speaks the OpenAI chat-completions protocol at these addresses.
BYO_BASE_URLS = {
    "openai": None,
    "anthropic": "https://api.anthropic.com/v1/",
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/",
    "groq": "https://api.groq.com/openai/v1",
}


class ByoProvider(OpenAIProvider):
    """The business's own provider key (Model tab > Bring your own model). Chat only: knowledge search keeps
    UnoCX's embeddings, so changing provider never needs a re-index."""

    def __init__(self, llm, client=None):   # llm: models.LlmOverride
        s = get_settings()
        if client is None:
            from openai import OpenAI
            client = OpenAI(api_key=llm.api_key.get_secret_value(), base_url=BYO_BASE_URLS[llm.provider],
                            timeout=s.llm_timeout_s, max_retries=0)
        self.client = client
        self.chat_model = llm.model
        self.embed_model = s.embed_model
        self.provider_name = llm.provider
        self.s = s

    def embed(self, texts, workspace_id=None, kind="embed"):
        raise RuntimeError("bring-your-own models are used for chat only")

    def chat_stream(self, messages, chunks, question, model: str | None = None):
        if self.provider_name == "openai":
            yield from super().chat_stream(messages, chunks, question, model)
            return
        # Not every provider reports usage on streams: estimate it when missing
        model = model or self.chat_model
        stream = self.client.chat.completions.create(model=model, messages=messages, temperature=0.2,
                                                     max_tokens=self.s.max_output_tokens, stream=True)
        parts, inp, out = [], 0, 0
        for ev in stream:
            if getattr(ev, "usage", None):
                inp, out = ev.usage.prompt_tokens, ev.usage.completion_tokens
            if ev.choices and ev.choices[0].delta.content:
                parts.append(ev.choices[0].delta.content)
                yield ev.choices[0].delta.content
        text = "".join(parts)
        yield ChatResult(text, model, inp or sum(len(m["content"]) for m in messages) // 4, out or len(text) // 4)


def byo_check(llm, client=None) -> dict:
    """Test connection: one tiny call with the business's key. Returns ok, model, latency or a readable error."""
    import time
    t0 = time.time()
    try:
        p = ByoProvider(llm, client)
        r = p.client.chat.completions.create(model=llm.model, max_tokens=5, temperature=0,
                                             messages=[{"role": "user", "content": "Reply with the word OK."}])
        return {"ok": True, "model": llm.model, "latency_ms": int((time.time() - t0) * 1000),
                "reply": (r.choices[0].message.content or "").strip()[:40]}
    except Exception as e:   # the provider's own message, without the key
        return {"ok": False, "error": provider_error(e, llm)}


def provider_error(e: Exception, llm) -> str:
    status = getattr(e, "status_code", None)
    if status in (401, 403):
        return "The provider rejected this API key."
    if status == 404:
        return f'The model "{llm.model}" was not found for this key.'
    if status == 429:
        return "The provider says this key is over its rate limit or out of credit."
    msg = str(e).replace(llm.api_key.get_secret_value(), "***")
    return msg[:200] or e.__class__.__name__


_provider = None


def model_for(tier: str | None) -> str | None:
    """Chat model for the business's plan tier. None = the provider's default (standard)."""
    s = get_settings()
    if s.llm_provider != "openai":
        return None
    return s.chat_model_advanced if tier == "advanced" else s.chat_model


def provider():
    global _provider
    if _provider is None:
        _provider = OpenAIProvider() if get_settings().llm_provider == "openai" else FakeProvider()
    return _provider


def reset_provider():
    global _provider
    _provider = None
