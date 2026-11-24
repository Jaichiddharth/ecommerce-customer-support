"""The customer wrapping up a chat: thanks, acknowledgements, goodbyes, and the one-tap "No, that's all" button."""
import uuid

import pytest

from app.dialogue import closing_kind


@pytest.mark.parametrize("text,kind", [
    ("thank you", "thanks"), ("Thank you so much!!", "thanks"), ("ok thanks", "thanks"),
    ("Okay thank you for the help", "thanks"), ("thx", "thanks"), ("got it, thanks", "thanks"),
    ("dhanyavad", "thanks"), ("nandri", "thanks"), ("Thank you 🙏", "thanks"), ("🙏", "thanks"),
    ("that helps", "thanks"), ("super, thanks a lot", "thanks"),
    ("No, that's all", "bye"), ("that's all", "bye"), ("thats it thanks", "bye"), ("Thanks bye", "bye"),
    ("nothing else", "bye"), ("no thanks", "bye"), ("I'm good", "bye"), ("all good", "bye"),
    ("have a nice day", "bye"), ("Thank you. That is all", "bye"),
    ("ok", "ack"), ("perfect", "ack"), ("great", "ack"), ("👍", "ack"),
    # anything more than wrapping up is a real message
    ("Where is my order", None), ("thanks, where is my order?", None), ("thank you but my order is late", None),
    ("my order is done", None), ("ok but when will it arrive", None), ("Track my order", None),
    ("no", None), ("yes", None), ("not received", None),
])
def test_closing_kind(text, kind):
    assert closing_kind(text) == kind


# ---------------------------------------------------------------- the whole conversation (needs Postgres, fake LLM)

try:
    import psycopg

    from app.config import get_settings
    psycopg.connect(get_settings().database_url, connect_timeout=3).close()
    DB_OK = get_settings().llm_provider == "fake"
except Exception:
    DB_OK = False

needs_db = pytest.mark.skipif(not DB_OK, reason="needs Postgres and LLM_PROVIDER=fake")
WS = "ws_unocx"
DONE = "No, that's all"


@pytest.fixture(scope="module")
def client():
    from fastapi.testclient import TestClient

    from app.main import app
    with TestClient(app) as c:
        c.headers.update({"Authorization": f"Bearer {get_settings().service_token}"})
        yield c


# A customer of a connected store (order data sent with the request), so answers need no seeded articles
STORE = {"stores": [{"ref": "shopify:1", "platform": "shopify", "name": "Main store", "customer_ref": "gid://shopify/Customer/7",
                     "customer_name": "Asha", "orders": [{"order_number": "#1001", "items": "Linen shirt", "quantity": 1,
                                                          "status": "Pending", "order_date": "2026-11-17T10:00:00Z"}]}]}
CUSTOMER = {"user": {"name": "Asha K", "phone": "919800000000"}, "commerce": STORE}


class Chat:
    def __init__(self, client, **kw):
        self.client, self.kw = client, {**CUSTOMER, **kw}
        self.id = "wrap-" + uuid.uuid4().hex[:8]
        self.messages: list[dict] = []

    def say(self, text: str) -> dict:
        self.messages.append({"role": "user", "content": text})
        r = self.client.post("/v1/chat", json={"workspace_id": WS, "conversation_id": self.id,
                                               "messages": self.messages, "test": True, **self.kw})
        assert r.status_code == 200, r.text
        body = r.json()
        if body["reply"]:
            self.messages.append({"role": "assistant", "content": body["reply"]})
        return body


@needs_db
def test_thanks_then_done_ends_the_chat(client):
    chat = Chat(client)
    first = chat.say("where is my order")
    assert first["outcome"] == "answered" and first["suggestions"][-1] == DONE and len(first["suggestions"]) <= 3

    thanks = chat.say("thank you")
    assert thanks["outcome"] == "clarify" and "anything else" in thanks["reply"].lower()
    assert thanks["suggestions"][0] == DONE and not thanks["ended"]

    done = chat.say(DONE)
    assert done["ended"] and done["outcome"] == "answered" and "have a great day" in done["reply"].lower()
    assert done["suggestions"] == []

    # More thanks after the goodbye: no reply, so the chat doesn't go round in circles
    quiet = chat.say("thanks 🙏")
    assert quiet["reply"] == "" and quiet["ended"]


@needs_db
def test_goodbye_in_one_message(client):
    chat = Chat(client)
    chat.say("where is my order")
    bye = chat.say("ok thanks, bye")
    assert bye["ended"] and "chat_ended" in bye["flags"]


@needs_db
def test_yes_after_anything_else_offers_the_starter_buttons(client):
    chat = Chat(client)
    chat.say("where is my order")
    chat.say("thanks")
    more = chat.say("yes")
    assert more["outcome"] == "clarify" and not more["ended"] and more["suggestions"]


@needs_db
def test_thanks_with_a_question_is_answered_not_closed(client):
    chat = Chat(client)
    r = chat.say("thanks, where is my order?")
    assert not r["ended"] and "anything else" not in r["reply"].lower()


@needs_db
def test_greeting_always_gets_welcome_and_buttons(client):
    r = Chat(client).say("hi")
    assert r["outcome"] == "answered" and r["suggestions"]
    assert "rephrase" not in r["reply"].lower()
