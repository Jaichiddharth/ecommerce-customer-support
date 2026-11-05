/**
 * Keyword matching for automation triggers and conditions: whole words / phrases, any language.
 * "hi" matches "Hi!", "hi there" and "say hi", but not "this" or "hill". A keyword may be a phrase
 * ("order status"); any run of whitespace in the message matches the spaces in it.
 */

const patterns = new Map<string, RegExp>();

export function keywordPattern(word: string): RegExp {
  let re = patterns.get(word);
  if (!re) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    // Letters, combining marks (Indic vowel signs etc.), digits and _ count as "inside a word"
    re = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`, "iu");
    if (patterns.size > 5_000) patterns.clear();
    patterns.set(word, re);
  }
  return re;
}

export function normalizeKeywords(keywords: unknown): string[] {
  return (Array.isArray(keywords) ? keywords : []).map((k) => String(k).trim().toLowerCase()).filter(Boolean);
}

export function matchesKeywords(text: string | null | undefined, keywords: unknown): boolean {
  const t = text ?? "";
  if (!t) return false;
  return normalizeKeywords(keywords).some((w) => keywordPattern(w).test(t));
}
