"""How replies sound: the business's tone preset and preferred reply length (Guardrails > Behaviour)."""
from .models import ChatSettings

TONES = {
    "professional": "Professional and courteous: clear, precise, no slang or emojis",
    "friendly": "Friendly and warm: simple words, upbeat, helpful",
    "casual": "Casual and relaxed: conversational, light, like a helpful friend (no slang that could confuse)",
    "premium": "Premium and refined: polished, gracious and calm, never pushy",
}
LENGTH_WORDS = {"short": "under 60 words", "medium": "under 120 words", "detailed": "under 200 words"}


def voice(st: ChatSettings) -> str:
    """The tone instruction: the preset, plus the business's own brand-voice notes. "custom" uses the notes only."""
    notes = (st.brand_voice or "").strip()
    tone = st.policy.tone
    if tone == "custom" or tone not in TONES:
        return notes or TONES["friendly"]
    return f"{TONES[tone]}. {notes}" if notes else TONES[tone]
