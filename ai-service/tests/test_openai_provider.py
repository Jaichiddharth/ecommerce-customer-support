"""Checks the OpenAI provider's request/response handling with a stubbed client (no network, no cost)."""
from types import SimpleNamespace as NS

import pytest

from app import llm


class StubClient:
    def __init__(self):
        self.calls = []
        self.embeddings = NS(create=self._embed)
        self.chat = NS(completions=NS(create=self._chat))

    def _embed(self, model, input, dimensions):
        self.calls.append(("embed", model, len(input), dimensions))
        return NS(data=[NS(embedding=[0.1] * dimensions) for _ in input], usage=NS(total_tokens=10 * len(input)))

    def _chat(self, model, messages, temperature, max_tokens, stream=False, stream_options=None):
        self.calls.append(("chat", model, stream, max_tokens))
        if not stream:
            return NS(choices=[NS(message=NS(content="Refunds take 5-7 days [1]."))],
                      usage=NS(prompt_tokens=1200, completion_tokens=20))
        parts = ["Refunds ", "take ", "5-7 days [1]."]
        evs = [NS(usage=None, choices=[NS(delta=NS(content=p))]) for p in parts]
        evs.append(NS(usage=NS(prompt_tokens=1200, completion_tokens=20), choices=[]))
        return iter(evs)


@pytest.fixture
def prov(monkeypatch):
    monkeypatch.setattr(llm, "log_usage", lambda *a, **k: None)
    s = llm.get_settings()
    monkeypatch.setattr(s, "openai_api_key", "sk-test")
    p = llm.OpenAIProvider()
    p.client = StubClient()
    return p


def test_embed_batches_and_dimensions(prov):
    vecs = prov.embed(["a"] * 200)
    assert len(vecs) == 200 and len(vecs[0]) == llm.get_settings().embed_dim
    assert [c[2] for c in prov.client.calls] == [96, 96, 8]


def test_chat_and_cost(prov):
    r = prov.chat([{"role": "user", "content": "x"}], [], "x")
    assert r.text.startswith("Refunds") and r.input_tokens == 1200
    assert r.cost == pytest.approx((1200 * 0.15 + 20 * 0.60) / 1e6)


def test_stream_yields_text_then_result(prov):
    out = list(prov.chat_stream([{"role": "user", "content": "x"}], [], "x"))
    assert "".join(o for o in out if isinstance(o, str)) == "Refunds take 5-7 days [1]."
    assert isinstance(out[-1], llm.ChatResult) and out[-1].output_tokens == 20


def test_missing_key_raises(monkeypatch):
    monkeypatch.setattr(llm.get_settings(), "openai_api_key", "")
    with pytest.raises(RuntimeError):
        llm.OpenAIProvider()
