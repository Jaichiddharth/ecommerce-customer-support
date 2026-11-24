"""Reply-language detection is done in code so the model can't guess wrong."""
import pytest

from app.language import conversation_language, detect_language, reply_instruction


@pytest.mark.parametrize("text,lang", [
    ("hi what if i was delivered with different product color?", "English"),   # the reported bug
    ("Hi, is COD available for my order?", "English"),
    ("hello, how long do refunds take?", "English"),
    ("Can I return a kurta I bought last week?", "English"),
    ("return kitne din mein kar sakte hai?", "Hinglish"),
    ("refund kab aayega", "Hinglish"),
    ("mera order kahan hai?", "Hinglish"),
    ("hi, mujhe refund chahiye", "Hinglish"),
    ("मेरा रिफंड कितने दिनों में आएगा?", "Hindi"),
    ("பொருளைத் திருப்பி அனுப்ப எத்தனை நாட்கள் உள்ளன?", "Tamil"),
    ("COD irukka? evlo amount varaikum?", "Tanglish"),
    ("hi", None),
    ("ok thanks", None),
    ("👍", None),
])
def test_detect_language(text, lang):
    assert detect_language(text) == lang


def test_short_message_keeps_conversation_language():
    assert conversation_language("7 days?", ["return kitne din mein kar sakte hai?"]) == "Hinglish"
    assert conversation_language("ok", ["மேலும் விவரம் வேண்டும்"]) == "Tamil"
    assert conversation_language("7 days?", []) == "English"
    assert conversation_language("hi what if i got a different colour?", ["refund kab aayega"]) == "English"


def test_reply_instruction():
    assert "English only" in reply_instruction("match_customer", "English")
    assert "English letters, not Devanagari" in reply_instruction("match_customer", "Hinglish")
    assert reply_instruction("Hindi", "English").startswith("Always reply in Hindi")
