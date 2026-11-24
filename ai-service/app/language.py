"""Decide the reply language in code, not in the model.

Letting the LLM "match the customer's language" is unreliable: a greeting like "hi" (also the ISO
code for Hindi) in an Indian-store context occasionally tips it into Hinglish. We detect the
language here, deterministically and for free, and tell the model exactly which one to use.
"""
import re

DEVANAGARI = re.compile(r"[\u0900-\u097F]")
TAMIL_SCRIPT = re.compile(r"[\u0B80-\u0BFF]")
LATIN_WORD = re.compile(r"[a-z']+")

# Romanised Hindi words that are rare in English. Deliberately excludes "hi", "main", "par",
# "se", "to", "me", "do", "so" and other words that are common English.
HINGLISH = set("""
hai hain kya kaise kaisa kaisi kab kahan kyun kyu kyon nahi nahin nhi mera meri mere mujhe muje humko
hume humein aap aapka aapki aapke aapko apna apni karna karo karein karenge kar kr krna sakte sakta
sakti chahiye kitna kitne kitni mein raha rahi rahe gaya gayi diya diye liya abhi aaj bhai bhi aur
toh tha thi hoga hogi hua hui wala wali wale paisa paise kaun kuch accha acha theek thik haan ka ki
ke ko bata batao bataye milega milegi aayega aayegi kyunki lekin agar matlab yaar ji
""".split())

# Romanised Tamil words that are rare in English.
TANGLISH = set("""
irukka iruku irukku irukkum evlo evvalavu enna eppo eppadi epdi venum vendum illa illai panna pannunga
pannanum sollunga sollu enga enge varaikum kudupeengala kudunga vanga podunga aagum aaguma theriyuma
seri romba naan enaku enakku unga ungal vandhuchu varala kidaikkum kidaikuma pannalama mudiyuma
""".split())

# Messages made only of these words don't tell us the language.
NEUTRAL = set("""hi hii hello hey hlo ok okay k thanks thank thx ty yes no yeah yep nope hmm pls please
cod upi emi gst otp id ok? order refund""".split())

LANG_INSTRUCTIONS = {
    "English": "The customer is writing in English. Reply in English only.",
    "Hinglish": "The customer is writing in Hinglish (Hindi written in English letters). Reply in Hinglish "
                "using English letters, not Devanagari.",
    "Hindi": "The customer is writing in Hindi (Devanagari script). Reply in Hindi using Devanagari script.",
    "Tamil": "The customer is writing in Tamil (Tamil script). Reply in Tamil using Tamil script.",
    "Tanglish": "The customer is writing in Tanglish (Tamil written in English letters). Reply in Tanglish "
                "using English letters, not Tamil script.",
}


def detect_language(text: str) -> str | None:
    """English | Hinglish | Hindi | Tamil | Tanglish, or None if the message is too short to tell."""
    t = text or ""
    dev, tam = len(DEVANAGARI.findall(t)), len(TAMIL_SCRIPT.findall(t))
    if dev >= 3 and dev >= tam:
        return "Hindi"
    if tam >= 3:
        return "Tamil"
    words = LATIN_WORD.findall(t.lower())
    if not words:
        return None
    h = sum(w in HINGLISH for w in words)
    ta = sum(w in TANGLISH for w in words)
    if ta and ta >= h:
        return "Tanglish"
    if h >= 2 or (h == 1 and h / len(words) >= 0.25):
        return "Hinglish"
    if all(w in NEUTRAL for w in words):
        return None
    return "English"


def conversation_language(latest: str, previous_user_messages: list[str]) -> str:
    """Language of the latest message; if it's too short to tell ("ok", "7 days?"), the most
    recent earlier message that was clear; otherwise English."""
    lang = detect_language(latest)
    short = len(LATIN_WORD.findall((latest or "").lower())) <= 2
    if lang and not (lang == "English" and short):
        return lang
    # Too short to be sure ("ok", "7 days?", "and COD?"): keep the conversation's language.
    for msg in reversed(previous_user_messages):
        prev = detect_language(msg)
        if prev:
            return prev
    return lang or "English"


def reply_instruction(language_setting: str, detected: str) -> str:
    if language_setting and language_setting != "match_customer":
        return f"Always reply in {language_setting}, whatever language the customer writes in."
    return LANG_INSTRUCTIONS.get(detected, LANG_INSTRUCTIONS["English"])
