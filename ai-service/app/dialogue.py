"""Conversation-level safety nets, applied to every chat:

  * never send the same reply twice in a row (change approach, then escalate)
  * notice an unhappy customer ("that's not what I asked", "this is taking forever")
  * remember what the bot just offered, so "yes", "no", "the clothing one" mean something
  * stay quiet once a chat has been handed to a person, until it is resumed

The conversation's memory is ai.agent_runs (each reply's trace.dialogue) and ai.conversation_state.
"""
import difflib
import re

from .db import conn

YES_RE = re.compile(r"^\s*(yes|yeah|yep|yup|y|ok|okay|sure|please|yes please|go ahead|please do|do it|"
                    r"haan|han|ha|ji|ji haan|theek hai|thik hai|sari|seri|correct|right)\b[\s.!,]*(please|pls)?[\s.!]*$", re.I)
NO_RE = re.compile(r"^\s*(no|nope|nah|no thanks|no thank you|not now|nahi|nahin|vendam|illa)\b[\s.!,]*$", re.I)
COMPLAINT_RE = re.compile(r"\b(raise|file|register|make|lodge|log|create)\s+(a\s+|the\s+)?complaint\b|"
                          r"\bcomplaint\s+(please|pls|karo|kar do|darj)\b", re.I)
MISUNDERSTOOD = [
    r"\bnot what i (asked|meant|wanted|said)\b", r"\byou (already|just) (told|said|gave)\b",
    r"\b(same|that) (answer|reply|thing|message) (again|again\?)", r"\bsame (answer|reply|thing)\b",
    r"\b(doesn'?t|does not|didn'?t|did not|not) help(ful|ing|s)?\b", r"\buseless\b",
    r"\bare you (even )?(listening|reading)\b", r"\bread my (message|question)\b", r"\bwrong answer\b",
    r"\bthat'?s not (it|right|my question)\b", r"\bi asked (something else|a different)\b",
    r"\bnot (answering|understanding)\b", r"\byou (don'?t|do not) understand\b",
]
URGENT = [
    r"\btaking (forever|too long|so long|ages)\b", r"\bi need it (now|today|urgently|asap|immediately)\b",
    r"\b(very|so|too) late\b", r"\bstill waiting\b", r"\bfed up\b", r"\bfrustrat\w*\b", r"\bridiculous\b",
    r"\bworst (service|experience|company)\b", r"\bunacceptable\b", r"\bhow long (do|should|will|must) i (have to )?wait\b",
    r"\bkitna (time|der|wait)\b",
]
_MIS = [re.compile(p, re.I) for p in MISUNDERSTOOD]
_URG = [re.compile(p, re.I) for p in URGENT]
ORDINALS = {"first": 0, "1st": 0, "second": 1, "2nd": 1, "third": 2, "3rd": 2}  # "one" is a pronoun here


# ---------------------------------------------------------------- the customer wrapping up

# Phrases that end a chat outright ("bye", "that's all") vs. ones that only thank or acknowledge ("thanks", "got it").
# A message counts only when nothing else is left after removing them, so "thanks, where is my order?" is a question.
_BYE_PHRASES = [
    r"that'?s (all|it|everything)( for (now|today))?", r"that is (all|it|everything)", r"(nothing|no) (else|more)",
    r"no (more |other |further )?questions?", r"(i'?m|i am|we'?re|we are|all) (done|good|set|all set|sorted|clear)",
    r"all (good|set|done|sorted|clear)", r"no(pe)?,? i'?m good", r"(good)?bye+", r"good bye", r"bye bye", r"ok bye",
    r"see (you|ya|u)( later| soon)?", r"ttyl", r"take care", r"have a (good|great|nice|lovely) (day|one|evening|night|weekend)",
    r"you too", r"bas( itna hi)?", r"aur kuch nahi", r"kuch nahi", r"no that'?s all", r"no thanks?", r"no thank (you|u)",
    r"not now", r"i'?m fine", r"sorted", r"done",
]
_THANKS_PHRASES = [
    r"thank(s|z|x)?( a lot| a ton| so much| very much| again| loads)?", r"thank (you|u|u so much|you so much|you very much)",
    r"thx", r"tnx", r"tq", r"ty", r"tysm", r"many thanks", r"much appreciated", r"appreciate (it|that|the help)",
    r"cheers", r"dhanyavaa?d", r"dhanyawaa?d", r"shukriya", r"nandri", r"nanri", r"thanks for (the |your )?(help|info|information|update|reply|support)",
    r"(that|this) (helps|helped|is helpful|was helpful|is great|was great)", r"(very )?helpful",
]
_ACK_PHRASES = [
    r"ok(ay)?", r"okk+", r"k", r"got it", r"understood", r"noted", r"perfect", r"great", r"awesome", r"cool", r"nice",
    r"fine", r"alright", r"all right", r"sure", r"good", r"super", r"wonderful", r"excellent", r"makes sense",
    r"theek hai", r"thik hai", r"accha", r"acha", r"hmm+", r"oh ok(ay)?",
]
_FILLER = {"so", "much", "very", "a", "lot", "for", "the", "help", "your", "you", "guys", "team", "again", "really",
           "sir", "madam", "mam", "maam", "bro", "its", "it", "is", "was", "that", "this", "just", "and", "then",
           "yes", "yeah", "yep", "oh", "ah", "all", "now", "for now", "ji", "dear", "buddy", "friend"}


# A thumbs-up or folded hands on its own is the customer's "ok" / "thank you"
_EMOJI_WORDS = {"🙏": "thanks", "👍": "ok", "👌": "ok", "✅": "ok", "👋": "bye", "❤️": "thanks", "❤": "thanks",
                "😊": "", "🙂": "", "😀": "", "😄": "", "🤝": "thanks"}


def _alt(phrases: list[str]) -> re.Pattern:
    return re.compile(r"\b(?:" + "|".join(phrases) + r")\b", re.I)


_BYE_RE, _THANKS_RE, _ACK_RE = _alt(_BYE_PHRASES), _alt(_THANKS_PHRASES), _alt(_ACK_PHRASES)


def closing_kind(text: str) -> str | None:
    """How a message wraps the chat up, if that's all it does:
    'bye' (they're done: "that's all, thanks", "bye"), 'thanks' ("thank you!"), 'ack' ("ok", "got it"), or None
    when it says anything more ("thanks, and where is my order?" is a question, not a goodbye)."""
    t = (text or "").lower().replace("’", "'")
    if len(t) > 120 or "?" in t:
        return None
    for emoji, word in _EMOJI_WORDS.items():
        t = t.replace(emoji, f" {word} ")
    t = re.sub(r"\s+", " ", re.sub(r"[^\w\s']", " ", t))
    kinds = []
    for kind, rx in (("bye", _BYE_RE), ("thanks", _THANKS_RE), ("ack", _ACK_RE)):
        if rx.search(t):
            kinds.append(kind)
            t = rx.sub(" ", t)
    rest = [w for w in re.findall(r"[\w']+", t) if w not in _FILLER]
    if rest or not kinds:
        return None
    return kinds[0]


def is_yes(text: str) -> bool:
    return bool(YES_RE.match(text or ""))


def is_no(text: str) -> bool:
    return bool(NO_RE.match(text or ""))


def wants_complaint(text: str) -> bool:
    return bool(COMPLAINT_RE.search(text or ""))


def misunderstood(text: str) -> bool:
    return any(p.search(text or "") for p in _MIS)


def urgent(text: str) -> bool:
    return any(p.search(text or "") for p in _URG)


# ---------------------------------------------------------------- memory

def last_run(workspace_id: str, conversation_id: str) -> dict | None:
    """The bot's previous reply in this conversation (last 24 h): outcome, route, flags, trace."""
    with conn() as c:
        return c.execute(
            "SELECT outcome, route, handover_reason, flags, trace FROM ai.agent_runs WHERE workspace_id=%s "
            "AND conversation_id=%s AND created_at > now() - interval '24 hours' ORDER BY created_at DESC LIMIT 1",
            (workspace_id, conversation_id)).fetchone()


def last_offer(run: dict | None) -> dict:
    return ((run or {}).get("trace") or {}).get("dialogue") or {}


def handed_over(workspace_id: str, conversation_id: str) -> str | None:
    """The handover reason if a person owns this chat (handed over in the last 24 h and not resumed)."""
    with conn() as c:
        row = c.execute("SELECT reason FROM ai.conversation_state WHERE workspace_id=%s AND conversation_id=%s "
                        "AND status='handed_over' AND updated_at > now() - interval '24 hours'",
                        (workspace_id, conversation_id)).fetchone()
    return row["reason"] if row else None


def set_state(workspace_id: str, conversation_id: str, status: str, reason: str | None = None):
    with conn() as c:
        c.execute("INSERT INTO ai.conversation_state (workspace_id, conversation_id, status, reason) VALUES (%s,%s,%s,%s) "
                  "ON CONFLICT (workspace_id, conversation_id) DO UPDATE SET status=EXCLUDED.status, "
                  "reason=EXCLUDED.reason, updated_at=now()", (workspace_id, conversation_id, status, reason))


# ---------------------------------------------------------------- repetition

def _norm(t: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", "", (t or "").lower())).strip()


def repeats(reply: str, previous_bot_replies: list[str], threshold: float = 0.9) -> bool:
    """True if the reply is (almost) the same as one of the bot's last two replies."""
    a = _norm(reply)
    for prev in previous_bot_replies[-2:]:
        b = _norm(prev)
        if a and b and (a == b or difflib.SequenceMatcher(None, a, b).ratio() >= threshold):
            return True
    return False


# ---------------------------------------------------------------- choosing among listed orders

def pick_option(text: str, options: list[dict]) -> str | None:
    """'the clothing one' / 'the second one' / 'the delivered one' / '2' -> that order number, if unambiguous."""
    t = (text or "").lower()
    words = set(re.findall(r"[a-z0-9]+", t))
    for field in ("category", "status"):                     # descriptive words win over positions
        hits = [o for o in options if o.get(field) and o[field].lower() in t]
        if len(hits) == 1:
            return hits[0]["order"]
        if len(hits) > 1:
            return None                                       # e.g. two clothing orders: still ambiguous
    if "last" in words and options:
        return options[-1]["order"]
    for w, i in ORDINALS.items():
        if w in words and i < len(options):
            return options[i]["order"]
    m = re.fullmatch(r"\s*(?:option|number|no\.?|#)?\s*([1-3])\s*[.!]?\s*", t)
    if m and int(m.group(1)) <= len(options):
        return options[int(m.group(1)) - 1]["order"]
    return None


def narrow_options(text: str, options: list[dict]) -> list[dict]:
    """Options matching a description that fits several ('the clothing one' with two clothing orders)."""
    t = (text or "").lower()
    for field in ("category", "status"):
        hits = [o for o in options if o.get(field) and o[field].lower() in t]
        if len(hits) > 1:
            return hits
    return []
