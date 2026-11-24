"""Deterministic guardrails. These run in code, before and after the LLM, so they hold
even when the model misbehaves. Every rule here has cases in tests/eval_cases.yaml.
"""
import re
import unicodedata

_NEG = re.compile(r"(don'?t|do not|dont|no need|not|never|without|no)\b[\w\s,']{0,22}$", re.I)

HUMAN_PATTERNS = [
    r"\bhuman\b", r"\breal person\b", r"\blive (agent|person|chat)\b",
    r"\b(an?|the|real|live|human) agent\b", r"\bagent (please|pls|plz)\b",
    r"\b(customer )?(care|support) (executive|team|person|agent)\b", r"\brepresentative\b",
    r"\btalk (to|with) (someone|somebody|a person|support|staff|your team|a manager)\b",
    r"\bspeak (to|with) (someone|somebody|a person|an? agent|support|staff|a manager|your manager)\b",
    r"\bcall me\b", r"\bcall ?back\b", r"\bconnect me\b",
]
# Hinglish / Hindi / Tamil (transliterated). Skipped when the business limits this rule to English.
HUMAN_PATTERNS_REGIONAL = [
    r"\binsaan\b", r"\bkisi se baat\b", r"\bagent se baat\b", r"\bbanda se baat\b",
    r"\bcall (karo|kar do|karna)\b", r"\baal kitta\b", r"\bpesanum\b",
    r"इंसान", r"किसी से बात", r"एजेंट",
]

SENSITIVE = {
    "self_harm": r"\b(kill myself|suicid\w*|end my life|want to die|self[- ]?harm|hurt myself)\b",
    # Legal is the only sensitive topic a business may let the agent handle. Self-harm, fraud and safety
    # always go to a person (CRITICAL_SENSITIVE), whatever the policy says.
    "legal": r"\b(lawyer|advocate|legal (action|notice)|sue|suing|consumer (court|forum)|police|fir)\b",
    "fraud": r"\b(fraud|scam\w*|cheat(ed|ing)?|stolen|hacked|unauthori[sz]ed (payment|transaction|charge))\b",
    "safety": r"\b(allerg\w*|rash|skin (burn|reaction)|hospital|injur\w*|caught fire)\b",
    "abuse": r"\b(f+u+c+k\w*|sh[i1]t+y?|bastard|asshole|bitch|chutiya|madarchod|bhenchod|harami)\b",
}

CRITICAL_SENSITIVE = frozenset({"self_harm", "fraud", "safety"})

INJECTION_PATTERNS = [
    r"ignore (all |any |the |your |these )?(previous |prior |above |earlier )?(instructions|rules|prompts?|guidelines)",
    r"disregard (your|the|all|any) (instructions|rules|guidelines)",
    r"(system|developer|hidden) (prompt|message|instructions)",
    r"reveal (your|the) (prompt|instructions|rules|configuration)",
    # "you are now a/my/in ..." is a role swap; "so you are now saying..." is a customer talking. ("DAN" is
    # caught by "do anything now" below: as a bare word it is also a name.)
    r"\byou are now (an? |my |the |in |acting |playing )", r"\bjailbreak\b", r"\bdeveloper mode\b",
    r"act as (an? |the )?(admin|administrator|developer|manager|system|owner)",
    r"pretend (to be|you are|you're)", r"(new|updated|override) instructions?\s*:",
    r"note to (the )?(ai|assistant|bot|model)", r"\[(system|admin|developer)\]",
    r"forget (all |everything |your )?(you were told|previous|prior|earlier|instructions|rules)",
    # "what are your instructions" / "print the system prompt"; not "what are the instructions for washing linen"
    r"(print|show|repeat|output|tell me|what (is|are)) (me )?(your (system |initial |original |hidden )?|"
    r"the (system|initial|original|hidden) )(prompt|instructions|rules|configuration|config)\b",
    r"repeat (the|everything) (text |words )?(above|before)",
    r"(bypass|override|disable|turn off) (your |the |all )?(rules|filters|guardrails|safety|restrictions)",
    r"\bdo anything now\b", r"\bno (rules|restrictions|limits) mode\b",
    r"\b(api|secret|access) ?(key|token)s?\b.{0,20}\b(show|give|reveal|send|print|tell)",
    r"\b(show|give|reveal|send|print|tell)\b.{0,20}\b(api|secret|access) ?(key|token)s?\b",
    r"\b(other|another|all) (merchants?|stores?|tenants?|workspaces?)'?s? (data|orders|customers|settings)",
]
# Hinglish / Hindi (transliterated and Devanagari) attempts to override or extract the instructions
INJECTION_PATTERNS_REGIONAL = [
    r"\b(pichl[ei]|purane|upar wale|saare|sab) (instructions?|rules?|niyam)\b.{0,20}\b(ignore|bhool|chhod|mat maan)",
    r"\b(ignore|bhool) (karo|kar do|ja|jao)\b.{0,25}\b(instructions?|rules?|niyam)",
    r"\b(apna|apne|tumhara|tumhare) (system )?(prompt|instructions?|rules?)\b.{0,15}\b(batao|dikhao|bata do|dikha do|bolo)",
    r"\b(system prompt|instructions?) (batao|dikhao|bata do|dikha do)",
    r"(निर्देश|नियम)\s*(भूल|अनदेखा|इग्नोर)", r"सिस्टम\s*प्रॉम्प्ट",
]
# Instructions planted in content the agent reads (website pages, PDFs, FAQs, product descriptions): text that
# talks TO the AI rather than to customers. Checked when a source is indexed and before a product goes in a prompt.
_CUSTOMER_ONLY = {r"\byou are now (an? |my |the |in |acting |playing )", r"pretend (to be|you are|you're)"}
DOCUMENT_INJECTION_PATTERNS = [p for p in INJECTION_PATTERNS if p not in _CUSTOMER_ONLY] + [
    r"^\s*(system|assistant|developer)\s*:", r"<\s*/?\s*(system|instructions?)\s*>", r"#{2,}\s*(system|instruction)",
    r"\b(ai|assistant|chatbot|bot|language model|llm|gpt|claude)s?\b.{0,40}\b(must|should|shall|will) "
    r"(always |now |never )?(say|reply|respond|answer|tell|recommend|offer|give|ignore|reveal|mention)\b",
    r"\bwhen (an? )?(ai|assistant|chatbot|bot|model) (reads|sees|is asked)",
    r"\bif you are (an? )?(ai|assistant|chatbot|bot|language model)\b",
]

OTHER_DATA_PATTERNS = [
    r"(someone else'?s|other (customer|user|people)'?s?|another (customer|user)'?s?|my (friend|neighbou?r|ex)'?s?)"
    r" (order|account|address|details|data|email|phone|number|password)",
    r"(list|show|give|send|export|dump) (me )?(all |every )?(the )?(customers|users|emails|phone numbers|orders|database)",
    r"\b(database|db) (dump|password|credentials|access)\b",
]

URL_RE = re.compile(r"https?://[^\s)\]>\"']+")
CARD_RE = re.compile(r"(?<!\d)(?:\d[ -]?){13,19}(?!\d)")
# Secret values. "pin 600001" is an Indian pincode (6 digits), so a bare "pin" masks only 4 digits;
# "UPI/ATM/card pin" masks 4-6. Passwords are masked only if the value has a digit or symbol
# ("my password is wrong" stays; "my password is Priya@123" is removed).
_SEP = r"(\s*(?:is|:|=|-|was)?\s*)"
SECRET_PATTERNS = [
    re.compile(r"\b(otp|cvv|cvc)\b" + _SEP + r"(\d{3,8})\b", re.I),
    re.compile(r"\b((?:upi|atm|card|debit card|credit card) pin)\b" + _SEP + r"(\d{4,6})\b", re.I),
    re.compile(r"\b(pin)\b" + _SEP + r"(\d{4})\b", re.I),
    re.compile(r"\b(password|passcode|pwd)\b(\s*(?:is|:|=|-|was)\s*)(?=\S*(?:\d|_|[^\w\s]))(\S+)", re.I),
]
EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+\.[\w.-]+")
PHONE_RE = re.compile(r"(?<!\d)(\+?\d{1,3}[ -]?)?\d{5}[ -]?\d{5}(?!\d)")


def normalize(text: str) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    return re.sub(r"([^\W\d_])\1{3,}", r"\1\1", text)  # "pleaseeeeee" -> "pleasee"; digits untouched


def _any(patterns, text):
    return any(re.search(p, text, re.I) for p in patterns)


def asked_for_human(text: str, english_only: bool = False) -> bool:
    low = text.lower()
    for p in HUMAN_PATTERNS + ([] if english_only else HUMAN_PATTERNS_REGIONAL):
        for m in re.finditer(p, low, re.I):
            if not _NEG.search(low[: m.start()]):
                return True
    return False


def sensitive_category(text: str) -> str | None:
    for cat, p in SENSITIVE.items():
        if re.search(p, text, re.I):
            return cat
    return None


_ZERO_WIDTH = re.compile("[​-‏⁠﻿­]")
_LEET = str.maketrans({"0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", "$": "s"})


def detection_text(text: str) -> str:
    """The message as the pattern checks should see it: compatibility forms folded (full-width and styled letters),
    invisible characters removed, "i g n o r e" / "i.g.n.o.r.e" joined, and digit/symbol swaps inside words undone
    ("1gn0re"). Used only for detection; the customer's text itself is never changed by this."""
    t = _ZERO_WIDTH.sub("", unicodedata.normalize("NFKC", text or "")).lower()
    # 4+ single letters separated by spaces, dots, dashes or underscores: join them
    t = re.sub(r"\b(?:[a-z][\s._-]){3,}[a-z]\b", lambda m: re.sub(r"[\s._-]", "", m.group(0)), t)
    # digits or symbols inside a word with letters are swaps ("1gn0re"); plain numbers ("500") stay numbers
    words = [w.translate(_LEET) if re.search(r"[a-z]", w) and re.search(r"[0-9@$]", w) else w for w in t.split()]
    return " ".join(words)


def is_injection(text: str) -> bool:
    t = detection_text(text)
    # "DAN" (the jailbreak persona) only in capitals: "Dan" is a customer's name
    return _any(INJECTION_PATTERNS, t) or _any(INJECTION_PATTERNS_REGIONAL, t) or bool(re.search(r"\bDAN\b", text or ""))


def document_injection(text: str) -> bool:
    """Content (a knowledge passage or a product description) that carries instructions aimed at the AI."""
    t = _ZERO_WIDTH.sub("", unicodedata.normalize("NFKC", text or "")).lower()
    return any(re.search(p, t, re.I | re.M) for p in DOCUMENT_INJECTION_PATTERNS)


def asks_other_customers_data(text: str) -> bool:
    return _any(OTHER_DATA_PATTERNS, text)


def _luhn(digits: str) -> bool:
    total, alt = 0, False
    for d in reversed(digits):
        n = int(d)
        if alt:
            n = n * 2 - 9 if n * 2 > 9 else n * 2
        total += n
        alt = not alt
    return total % 10 == 0


def mask_secrets(text: str) -> tuple[str, list[str]]:
    """Remove card numbers, OTPs, PINs and passwords before anything is sent to the LLM or logged."""
    flags = []

    def card(m):
        digits = re.sub(r"\D", "", m.group(0))
        if 13 <= len(digits) <= 19 and _luhn(digits):
            flags.append("card_number_masked")
            return "[card number removed]" + (" " if m.group(0)[-1] in " -" else "")
        return m.group(0)

    text = CARD_RE.sub(card, text)

    def secret(m):
        flags.append("secret_masked")
        return f"{m.group(1)}{m.group(2)}[removed]"

    for pat in SECRET_PATTERNS:
        text = pat.sub(secret, text)
    return text, sorted(set(flags))


def mask_for_logs(text: str | None) -> str | None:
    if not text:
        return text
    text = EMAIL_RE.sub(lambda m: m.group(0)[:2] + "***@***", text)
    return PHONE_RE.sub(lambda m: "******" + re.sub(r"\D", "", m.group(0))[-4:], text)


def postprocess_reply(text: str, allowed_urls: set[str], max_chars: int) -> tuple[str, list[int], list[str]]:
    """Clean the model reply for a chat bubble. Returns (reply, cited_indexes, flags)."""
    flags = []
    cited = sorted({int(n) for n in re.findall(r"\[(\d{1,2})\]", text)})
    text = re.sub(r"\s*\[\d{1,2}\](\[\d{1,2}\])*", "", text)

    # chat windows show text as typed: "**Linen shirt**" would show its asterisks, "[Linen shirt](#)" its brackets.
    # A markdown link keeps its text, and its address when it's a real one (checked against the allowed links below)
    text = re.sub(r"\*\*(.+?)\*\*", r"\1", text)
    text = re.sub(r"\[([^\]\n]{1,200})\]\((https?://[^\s)]+)\)", r"\1 \2", text)
    text = re.sub(r"\[([^\]\n]{1,200})\]\([^)\n]*\)", r"\1", text)
    lines = [ln for ln in text.splitlines() if not re.match(r"^\s*\|.*\|\s*$", ln)]  # no tables
    if len(lines) != len(text.splitlines()):
        flags.append("table_removed")
    text = "\n".join(re.sub(r"^\s*#{1,6}\s*", "", ln) for ln in lines)

    def url(m):
        u = m.group(0).rstrip(".,;:!?")
        if any(u.startswith(a) or a.startswith(u) for a in allowed_urls):
            return m.group(0)
        flags.append("unknown_url_removed")
        return ""

    text = URL_RE.sub(url, text)
    text = re.sub(r"[ \t]+\n", "\n", re.sub(r"[ \t]{2,}", " ", text)).strip()

    if len(text) > max_chars:
        cut = text[:max_chars]
        end = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "), cut.rfind("\n"))
        text = (cut[: end + 1] if end > max_chars * 0.5 else cut.rstrip() + "…").strip()
        flags.append("reply_truncated")
    return text, cited, flags


NUM_RE = re.compile(r"\d+(?:[.,]\d+)*")


def _nums(text: str) -> set[str]:
    out = set()
    for m in NUM_RE.findall(text or ""):
        n = m.replace(",", "")
        out.add(n[:-2] if n.endswith(".0") else n)
    return out


def unsupported_numbers(reply: str, context: str, question: str = "") -> list[str]:
    """Numbers (prices, days, dates, limits) in the reply that appear in neither the retrieved
    articles nor the customer's message. A cheap, model-free hallucination signal."""
    return sorted(_nums(reply) - _nums(context) - _nums(question), key=lambda x: (len(x), x))


REFUND_REQUEST_PATTERNS = [
    r"\b(i|we)\s*(want|need|would like|demand|expect)\b.{0,25}\b(refund|money back|my money|reimburse\w*)\b",
    r"\b(give|send|return|transfer|process|issue|initiate|credit)\b.{0,15}\b(me|my)\b.{0,15}\b(refund|money)\b",
    r"\brefund (me|my (money|order|payment|amount))\b", r"\bmoney back\b",
    r"\b(paisa|paise|refund|amount)\s*(wapas|vapas|return)\b", r"\b(refund|paisa|paise)\s*(chahiye|do|dedo|de do)\b",
]
_REFUND_INFO = re.compile(r"\b(when|how long|how many|how do|how can|how does|status|policy|timeline|kab|kitne|kaise)\b", re.I)


def is_refund_request(text: str) -> bool:
    """'I want a refund' / 'give me my money back' (a request: only a person can approve it),
    not 'how long do refunds take?' (information: answered from the help articles)."""
    if _REFUND_INFO.search(text or ""):
        return False
    return _any(REFUND_REQUEST_PATTERNS, text or "")


# ---------------------------------------------------------------- policy-driven detectors

EXCHANGE_REQUEST_PATTERNS = [
    r"\b(i|we)\s*(want|need|would like|wanna)\b.{0,25}\b(exchange|replace\w*|swap|different size|another size|bigger size|smaller size)\b",
    r"\b(can|could|pls|please)\s+(i|you|we)?\s*.{0,15}\b(exchange|replace|swap)\b",
    r"\bchange\b.{0,15}\b(the |my |its |it'?s )?(size|colou?r)\b",
    r"\b(exchange|replace|swap)\s+(it|this|that|my|the)\b",
    r"\b(exchange|replace|size)\s*(karna|kar do|karo|chahiye|badalna|badal do|pannanum|pannunga)\b",
]
_EXCHANGE_INFO = re.compile(
    r"\b(policy|how long|how do|how does|how many|when|charges?|fees?|cost|do you (allow|offer|do|accept)|"
    r"is (there|it|exchange)|kab|kaise|kitne)\b", re.I)


def is_exchange_request(text: str) -> bool:
    """'Can I change the size to L?' (a request: our team arranges it), not 'what is your
    exchange policy?' (information: answered from the help articles)."""
    if _EXCHANGE_INFO.search(text or ""):
        return False
    return _any(EXCHANGE_REQUEST_PATTERNS, text or "")


_ANGRY_MEDIUM = re.compile(
    r"\b(worst|pathetic|useless|disgusting|ridiculous|horrible|terrible|awful|fed up|very angry|so angry|"
    r"frustrat\w*|unacceptable|nonsense|bakwas|bekaar|bekar|ghatiya|third class|waste of (money|time))\b", re.I)
_ANGRY_HIGH = re.compile(
    r"\b(disappoint\w*|not happy|unhappy|annoy\w*|upset|again and again|how many times|still (not|no|haven'?t)|"
    r"no response|nobody (replies|responds|answers))\b", re.I)
_LEVELS = {"low": 1, "medium": 2, "high": 3}


def angry_level(text: str) -> int:
    """0 calm, 1 abusive, 2 clearly angry, 3 unhappy. Compared against the business's sensitivity."""
    t = text or ""
    if re.search(SENSITIVE["abuse"], t, re.I):
        return 1
    if _ANGRY_MEDIUM.search(t):
        return 2
    letters = re.sub(r"[^A-Za-z]", "", t)
    if _ANGRY_HIGH.search(t) or t.count("!") >= 3 or (len(letters) >= 12 and letters.isupper()):
        return 3
    return 0


def is_angry(text: str, sensitivity: str) -> bool:
    """low catches abusive messages only; medium adds clear anger; high also catches unhappy customers."""
    lvl = angry_level(text)
    return 0 < lvl <= _LEVELS.get(sensitivity, 1)


GREETING_RE = re.compile(
    r"^(hi+|hello+|hey+|hola|namaste|namaskar|vanakkam|good (morning|afternoon|evening)|yo)"
    r"[\s!.,]*(there|team|all)?[\s!.]*$", re.I)


def is_greeting(text: str) -> bool:
    return bool(GREETING_RE.match((text or "").strip()))


_DECLINE = re.compile(r"\b(can'?t|cannot|can not|unable|not able|won'?t|don'?t|do not|isn'?t|not allowed)\b")
_TOPIC_STOP = {"with", "from", "that", "this", "your", "other", "about", "policy", "names", "exact", "beyond"}


def never_say_hits(reply: str, topics: list[str]) -> list[str]:
    """Cheap post-check for the business's "never say or promise" list: a topic counts as hit when
    every content word of it (first 5 letters) appears in the reply. The prompt is the main
    defence; this catches obvious slips without another model call."""
    low = (reply or "").lower()
    if _DECLINE.search(low):   # "I can't add extra discounts" is the right answer, not a slip
        return []
    hits = []
    for topic in topics:
        words = [w for w in re.findall(r"[a-z]+", topic.lower()) if len(w) > 3 and w not in _TOPIC_STOP]
        if words and all(w[:5] in low for w in words):
            hits.append(topic)
    return hits


# ---------------------------------------------------------------- output checks (replies written by the model)

# Credentials that must never appear in a reply: provider keys, cloud keys, bearer tokens, private keys, JWTs
CREDENTIAL_RE = re.compile(
    r"\b(sk-[A-Za-z0-9_-]{16,}|sk-ant-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|gsk_[A-Za-z0-9]{20,}"
    r"|xox[abp]-[A-Za-z0-9-]{10,}|ghp_[A-Za-z0-9]{30,}|shpat_[a-f0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,})"
    r"|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._-]{20,}")


def scan_output(reply: str, trusted_text: str) -> tuple[str, list[str]]:
    """Removes from a model-written reply what it must never contain: card numbers, OTP/PIN/password values,
    credentials, and email addresses or phone numbers that don't appear in the trusted text the reply was written
    from (the help articles or product list). The business's own support email in an article stays; anything the
    model made up or copied from elsewhere goes. Deterministic, no model call."""
    flags: list[str] = []
    text, masked = mask_secrets(reply or "")
    flags += [f"output_{f}" for f in masked]
    if CREDENTIAL_RE.search(text):
        text = CREDENTIAL_RE.sub("", text)
        flags.append("output_credential_removed")
    trusted_emails = {m.group(0).rstrip(".-").lower() for m in EMAIL_RE.finditer(trusted_text or "")}
    trusted_digits = {re.sub(r"\D", "", m.group(0))[-10:] for m in PHONE_RE.finditer(trusted_text or "")}
    # Contacts the reply wasn't given: the sentence carrying one goes (a bare "please write to" helps nobody)
    untrusted = []
    for m in EMAIL_RE.finditer(text):
        if m.group(0).rstrip(".-").lower() not in trusted_emails:     # "help@shop.in." ends a sentence
            untrusted.append(m.group(0).rstrip(".-"))
            flags.append("output_email_removed")
    for m in PHONE_RE.finditer(text):
        if re.sub(r"\D", "", m.group(0))[-10:] not in trusted_digits:
            untrusted.append(m.group(0))
            flags.append("output_phone_removed")
    if untrusted:
        kept = drop_sentences_with(text, untrusted)
        if not kept:                  # the whole reply was that sentence: remove just the contacts
            kept = text
            for tok in untrusted:
                kept = kept.replace(tok, "")
        text = kept
    if flags:
        text = re.sub(r"\(\s*\)|\[\s*\]", "", text)
        text = re.sub(r"[ \t]{2,}", " ", re.sub(r"\s+([.,;:!?])", r"\1", text)).strip()
    return text, sorted(set(flags))


# Amounts of money and percentages: "₹1,299", "Rs. 499", "INR 2000", "$20", "1299/-", "1,299 rupees", "20% off"
_MONEY = (r"(?:₹|rs\.?|inr|\$|usd|€|eur|£|gbp|aed|sgd)\s?\d[\d,]*(?:\.\d+)?"
          r"|\d[\d,]*(?:\.\d+)?\s?(?:/-|rupees?|rs\b|inr\b|dollars?)")
_PERCENT = r"\d+(?:\.\d+)?\s?(?:%|percent\b|per cent\b)"
AMOUNT_RE = re.compile(f"({_MONEY}|{_PERCENT})", re.I)


def _amount_value(token: str) -> str:
    m = re.search(r"\d[\d,]*(?:\.\d+)?", token)     # the number only: "Rs. 1,599" -> "1599", not ".1599"
    n = m.group(0).replace(",", "") if m else ""
    return n[:-3] if n.endswith(".00") else (n[:-2] if n.endswith(".0") else n)


def unsupported_amounts(reply: str, trusted_text: str, question: str = "") -> list[str]:
    """Money amounts and percentages in the reply whose value appears in neither the trusted data (prices from
    the store, the configured offer) nor the customer's own message. Prices must come from the store, never
    from the model."""
    allowed = _nums(trusted_text) | _nums(question)
    allowed |= {_amount_value(m.group(0)) for m in AMOUNT_RE.finditer(trusted_text or "")}
    return [m.group(0) for m in AMOUNT_RE.finditer(reply or "") if _amount_value(m.group(0)) not in allowed]


# A sentence ends at . ! ? followed by a space or the end, or at a line break; dots inside "help@shop.in", "1.5"
# or "Rs." before a number don't end it
_SENTENCE = re.compile(r".+?(?:(?<!Rs)(?<!rs)(?<!RS)[.!?]+(?=\s|$)|\n|$)\s*", re.S)


def sentences(text: str) -> list[str]:
    return [s for s in _SENTENCE.findall(text or "") if s.strip()]


def drop_sentences(reply: str, keep) -> str:
    """The reply with only the sentences for which keep(sentence) is true."""
    return re.sub(r"[ \t]{2,}", " ", "".join(s for s in sentences(reply) if keep(s))).strip()


def drop_sentences_with(reply: str, tokens: list[str]) -> str:
    """The reply without the sentences that contain any of these tokens."""
    if not tokens:
        return reply
    return drop_sentences(reply, lambda s: not any(t in s for t in tokens))


# ---------------------------------------------------------------- content moderation (configurable, deterministic)

PROFANITY = re.compile(
    SENSITIVE["abuse"][:-3] + r"|motherfucker|dickhead|dumbass|idiot|stupid bot|moron|kutt[ae]|kamina|saala|saali"
    r"|gaandu|bhosdi\w*|lund|randi|thevdiya|punda|otha|baadu)\b", re.I)
HARMFUL = {
    "violence": r"\b(kill|murder|stab|shoot|bomb|attack)\s+(you|him|her|them|someone|people|your (staff|team|ceo))\b"
                r"|\b(how to )?make (a )?(bomb|explosive|weapon)\b|\bburn (your|the) (store|office|warehouse)\b",
    "weapons_drugs": r"\b(buy|sell|get|order)\b.{0,20}\b(gun|pistol|revolver|cocaine|heroin|meth|mdma|ganja|weed|charas)\b",
    "sexual": r"\b(sex chat|nude|nudes|porn|sexy pics|send (me )?(your )?(nudes|pics of you)|hook ?up with you)\b",
    "hate": r"\b(all|those) (muslims|hindus|christians|sikhs|dalits|blacks|jews)\b.{0,30}\b(should|must|deserve|are)\b"
            r".{0,20}\b(die|killed|banned|thrown out|animals|dirty)\b",
}


def moderation_category(text: str) -> str | None:
    """'profanity', or a harmful-content category ('violence', 'weapons_drugs', 'sexual', 'hate'), or None."""
    t = detection_text(text)
    for cat, p in HARMFUL.items():
        if re.search(p, t, re.I):
            return cat
    return "profanity" if PROFANITY.search(t) else None


def has_profanity(reply: str) -> bool:
    return bool(PROFANITY.search(detection_text(reply)))


# ---------------------------------------------------------------- topics

def topic_hits(text: str, topics: list[str]) -> list[str]:
    """The business's restricted topics or competitor names mentioned in a message or reply: every content word of
    the topic (first 5 letters) appears as the start of a word. "Crypto payments" matches "can I pay with crypto?"."""
    said = [w for w in re.findall(r"[a-z0-9]+", detection_text(text)) if len(w) >= 3]

    def present(word: str) -> bool:   # "payments" is present as "payment", "payments" or "pay"
        return any(t[:5] == word[:5] or (len(t) >= 3 and word.startswith(t)) for t in said)

    hits = []
    for topic in topics:
        words = [w for w in re.findall(r"[a-z0-9]+", topic.lower()) if len(w) > 2 and w not in _TOPIC_STOP]
        if words and all(present(w) for w in words):
            hits.append(topic)
    return hits
