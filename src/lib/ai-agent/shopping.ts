/**
 * Website chat shopping: what the visitor is looking for, read from their messages, and the store products that
 * fit it. Deterministic (no model call): "my budget is $100", "show me shoes", "women's shirt in size M", "black,
 * under 2000" are read here; the products are filtered by real variant prices, sizes, colours and stock from the
 * store, and the model only writes the recommendation around them (prices are checked again in the AI service).
 *
 * Criteria build up over the conversation: a newer message overrides a field it mentions and keeps the rest
 * ("budget $100" … "show me shoes" … "in black" = black shoes up to $100).
 */

export type Gender = "women" | "men" | "kids";

export interface ShoppingCriteria {
  /** Product words to search for ("shoe", "shirt"); "" = anything */
  terms: string;
  maxPrice: number | null;
  minPrice: number | null;
  /** Normalised size: "S", "M", "XL", "8", "42" */
  size: string | null;
  gender: Gender | null;
  colors: string[];
  /** The latest message asks for best sellers or help choosing ("help me choose", "what's popular") */
  bestsellers: boolean;
}

export interface CandidateVariant {
  id: string;
  price: number | null;
  compareAtPrice: number | null;
  available: boolean;
  /** Option name (lower case) → value, e.g. { size: "M", color: "Black" } */
  options: Record<string, string>;
}

/** A store product as fetched for matching (see shopifyService.agentCandidates) */
export interface Candidate {
  id: string;
  title: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  productType: string | null;
  tags: string[];
  vendor: string | null;
  currency: string;
  variants: CandidateVariant[];
}

/** One product to offer, with the variant that fits (its price, stock and checkout link) */
export interface PickedProduct {
  title: string;
  description: string | null;
  url: string;
  imageUrl: string | null;
  price: number | null;
  compareAtPrice: number | null;
  currency: string;
  available: boolean;
  variantId: string | null;
  /** e.g. "Size M · Black" when the visitor asked for a size or colour */
  variantLabel: string | null;
  /** Tagged as a best seller (or popular / top seller) in the store */
  bestseller: boolean;
}

export interface PickResult {
  products: PickedProduct[];
  /** All the visitor's requirements are met by every product offered */
  matched: boolean;
  /** Requirements dropped to find anything: "colour", "size", "budget", "gender"; the caller adds "product" when
   * the store has nothing of the kind asked for */
  relaxed: string[];
}

const NUM = String.raw`(\d[\d,]*(?:\.\d+)?)\s*(k\b)?`;
const CUR = String.raw`(?:rs\.?|₹|\$|usd|inr|aed|£|€)?\s*`;
const BETWEEN = new RegExp(String.raw`\b(?:between|from)\s*${CUR}${NUM}\s*(?:and|to|-|–)\s*${CUR}${NUM}`, "i");
const RANGE = new RegExp(String.raw`(?:rs\.?|₹|\$)\s*${NUM}\s*(?:-|–|to)\s*${CUR}${NUM}`, "i");
const MAX = new RegExp(
  String.raw`\b(?:under|below|less than|lower than|upto|up to|within|max(?:imum)?|not more than|no more than|cheaper than|budget(?:\s+is|\s+of)?|my budget is|around|about|approx(?:imately)?)\s*(?:of\s*|is\s*)?${CUR}${NUM}`,
  "i",
);
const MAX_AFTER = new RegExp(String.raw`(?:rs\.?|₹|\$)\s*${NUM}\s*(?:budget|max|or less|and below|or below)\b|\b${NUM}\s*(?:rs|rupees|dollars|usd|inr|bucks)?\s*(?:budget|max|or less|and below)\b`, "i");
const MIN = new RegExp(String.raw`\b(?:over|above|more than|at least|minimum|min|starting (?:from|at))\s*${CUR}${NUM}`, "i");

const SIZE_WORDS: Record<string, string> = { small: "S", medium: "M", large: "L", "x-large": "XL", "extra large": "XL", "extra small": "XS" };
const SIZE_RE = /\bsize\s*(?:is\s*|of\s*|:\s*)?(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|small|medium|large|x-large|extra large|extra small|\d{1,2}(?:\.5)?)\b/i;
const SIZE_BEFORE_RE = /\b(xxs|xs|s|m|l|xl|xxl|xxxl|2xl|3xl|4xl|small|medium|large|\d{1,2}(?:\.5)?)\s+size\b/i;
const SIZE_TOKEN_RE = /\b(xxs|xs|xl|xxl|xxxl|2xl|3xl|4xl)\b/i;
const SHOE_SIZE_RE = /\b(?:uk|us|eu|ind?)\s*(\d{1,2}(?:\.5)?)\b/i;

const GENDER: Record<Gender, RegExp> = {
  // "a gift for my wife" is shopping for women
  women: /\b(women|woman|womens|women'?s|ladies|lady|female|girls?|her|womenswear|wife|mom|mum|mother|sister|girlfriend|aunt)\b/i,
  men: /\b(men|man|mens|men'?s|gents|gentlemen|male|boys?|him|menswear|husband|dad|father|brother|boyfriend|uncle)\b/i,
  kids: /\b(kids?|children|child|baby|babies|toddlers?|infants?|son|daughter|nephew|niece)\b/i,
};
const COLORS = ["black", "white", "red", "blue", "green", "yellow", "pink", "purple", "orange", "brown", "grey", "gray", "beige",
  "navy", "maroon", "gold", "silver", "cream", "olive", "teal", "khaki", "tan", "lavender", "peach", "mustard"];

const STOP = new Set(
  ("a an the is are was were be i me my we you your it its this that these those to of in on for with at by from and or but if so do does " +
   "did can could should would will how what when where which who why please pls plz hi hello hey show want need looking look find any some " +
   "have has get got price prices cost costs much buy buying something anything good best nice one ones under below above over less more than " +
   "upto up within budget around about max maximum minimum min between rs inr usd dollars rupees bucks size sizes colour color colors colours " +
   "only also just like love gift gifts recommend suggest suggestions options option available stock new latest cheap cheaper affordable " +
   "range there here k ok okay thanks thank yes no now then too very really kind sort type types pair pairs piece item items product products " +
   "shop shopping store collection let see give tell send please uk us eu seller sellers bestseller bestsellers " +
   "popular trending arrival arrivals newest top rated featured sale deal deals offer offers discount special today wear " +
   "help choose choosing pick decide recommendation recommendations suggestion suggestions sell selling bought sold loved").split(/\s+/),
);

const money = (n: string, k?: string) => {
  const v = Number(n.replace(/,/g, ""));
  return Number.isFinite(v) ? v * (k ? 1000 : 1) : null;
};

function singular(w: string): string {
  if (w.length > 4 && /ies$/.test(w)) return w.slice(0, -3) + "y";
  if (w.length > 4 && /(sses|shes|ches|xes)$/.test(w)) return w.slice(0, -2);
  if (w.length > 3 && /[^s]s$/.test(w)) return w.slice(0, -1);
  return w;
}

/** What one message says (fields it doesn't mention stay undefined) */
function readOne(text: string): Partial<ShoppingCriteria> {
  const t = ` ${text.toLowerCase()} `;
  const out: Partial<ShoppingCriteria> = {};
  const between = t.match(BETWEEN) ?? t.match(RANGE);
  if (between) {
    const a = money(between[1], between[2]);
    const b = money(between[3], between[4]);
    if (a != null && b != null) [out.minPrice, out.maxPrice] = a <= b ? [a, b] : [b, a];
  } else {
    const max = t.match(MAX);
    const after = t.match(MAX_AFTER);
    if (max) {
      const v = money(max[1], max[2]);
      const approx = /\b(around|about|approx)/.test(max[0]);
      if (v != null) out.maxPrice = approx ? Math.round(v * 1.15) : v;
    } else if (after) {
      const v = money(after[1] ?? after[3], after[2] ?? after[4]);
      if (v != null) out.maxPrice = v;
    }
    const min = t.match(MIN);
    if (min) out.minPrice = money(min[1], min[2]);
  }

  const size = t.match(SIZE_RE) ?? t.match(SIZE_BEFORE_RE);
  const shoe = t.match(SHOE_SIZE_RE);
  const token = t.match(SIZE_TOKEN_RE);
  const raw = size?.[1] ?? shoe?.[1] ?? token?.[1];
  if (raw) out.size = normalizeSize(raw);

  for (const g of ["women", "men", "kids"] as Gender[]) {
    if (GENDER[g].test(t)) { out.gender = g; break; }
  }
  const colors = COLORS.filter((c) => new RegExp(`\\b${c}\\b`).test(t));
  if (colors.length) out.colors = colors.map((c) => (c === "gray" ? "grey" : c));

  const cleaned = t
    .replace(BETWEEN, " ").replace(RANGE, " ").replace(MAX, " ").replace(MAX_AFTER, " ").replace(MIN, " ")
    .replace(SIZE_RE, " ").replace(SIZE_BEFORE_RE, " ").replace(SHOE_SIZE_RE, " ")
    .replace(/[^\p{L}\p{N}\s-]/gu, " ");
  const words = cleaned
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP.has(w) && !/^\d/.test(w) && !COLORS.includes(w) && !SIZE_TOKEN_RE.test(w))
    .filter((w) => !Object.values(GENDER).some((re) => re.test(` ${w} `)))
    .map(singular);
  if (words.length) out.terms = Array.from(new Set(words)).slice(0, 4).join(" ");
  return out;
}

export function normalizeSize(raw: string): string {
  const v = raw.trim().toLowerCase();
  if (SIZE_WORDS[v]) return SIZE_WORDS[v];
  if (/^\d/.test(v)) return v.replace(/\.0$/, "");
  return v.toUpperCase().replace(/^2XL$/, "XXL").replace(/^3XL$/, "XXXL");
}

/** The visitor's requirements from their messages, oldest first: newer messages override what they mention */
export function parseCriteria(visitorMessages: string[]): ShoppingCriteria {
  const c: ShoppingCriteria = { terms: "", maxPrice: null, minPrice: null, size: null, gender: null, colors: [], bestsellers: false };
  for (const text of visitorMessages.slice(-8)) {
    const one = readOne(text);
    if (one.terms !== undefined) c.terms = one.terms;
    if (one.maxPrice !== undefined) {
      c.maxPrice = one.maxPrice;
      if (one.minPrice === undefined) c.minPrice = null;
    }
    if (one.minPrice !== undefined) c.minPrice = one.minPrice;
    if (one.size !== undefined) c.size = one.size;
    if (one.gender !== undefined) c.gender = one.gender;
    if (one.colors !== undefined) c.colors = one.colors;
  }
  if (c.minPrice != null && c.maxPrice != null && c.minPrice > c.maxPrice) c.minPrice = null;
  const latest = visitorMessages[visitorMessages.length - 1] ?? "";
  c.bestsellers = BESTSELLER_ASK.test(latest);
  return c;
}

const BESTSELLER_ASK = /\b(best ?-?sell\w*|top ?-?sell\w*|popular|trending|most (bought|sold|loved)|top picks?|help me (choose|pick|decide)|what should i (buy|get|choose)|recommend\w*|suggest\w*)\b/i;
const BESTSELLER_TAG = /\b(best ?-?sellers?|bestsellers?|top ?-?sellers?|popular|most ?-?sold)\b/i;

/** Tagged (or titled) as a best seller in the store */
export function isBestseller(p: Pick<Candidate, "title" | "tags">): boolean {
  return p.tags.some((t) => BESTSELLER_TAG.test(t)) || BESTSELLER_TAG.test(p.title);
}

const optionFor = (v: CandidateVariant, re: RegExp) => Object.entries(v.options).find(([k]) => re.test(k))?.[1] ?? null;

function sizeMatches(value: string | null, wanted: string): boolean {
  if (!value) return false;
  const parts = value.toLowerCase().split(/[\s/,|-]+/).map((p) => normalizeSize(p.replace(/^(uk|us|eu|in)/, "")));
  return parts.includes(wanted) || normalizeSize(value.replace(/^(uk|us|eu|in)\s*/i, "")) === wanted;
}

function productText(p: Candidate): string {
  return ` ${[p.title, p.productType, p.vendor, ...p.tags].filter(Boolean).join(" ").toLowerCase()} `;
}

function genderFit(p: Candidate, g: Gender | null): number {
  if (!g) return 1;
  const text = productText(p);
  if (GENDER[g].test(text) || /\bunisex\b/.test(text)) return 2;
  const other = (["women", "men", "kids"] as Gender[]).filter((x) => x !== g).some((x) => GENDER[x].test(text));
  return other ? 0 : 1;
}

/** The variant of `p` that fits, or null. `need` says which requirements must hold. */
function fit(p: Candidate, c: ShoppingCriteria, need: { size: boolean; color: boolean; budget: boolean }): CandidateVariant | null {
  const text = productText(p);
  let vs = p.variants;
  if (need.size && c.size) {
    vs = vs.filter((v) => sizeMatches(optionFor(v, /size/i), c.size!));
    if (!vs.length) return null;
  }
  if (need.color && c.colors.length) {
    const inTitle = c.colors.some((col) => text.includes(col));
    const byOption = vs.filter((v) => c.colors.some((col) => (optionFor(v, /colou?r/i) ?? "").toLowerCase().includes(col)));
    vs = byOption.length ? byOption : inTitle ? vs : [];
    if (!vs.length) return null;
  }
  if (need.budget && (c.maxPrice != null || c.minPrice != null)) {
    vs = vs.filter((v) => v.price != null && (c.maxPrice == null || v.price <= c.maxPrice) && (c.minPrice == null || v.price >= c.minPrice));
    if (!vs.length) return null;
  }
  return [...vs].sort((a, b) => Number(b.available) - Number(a.available) || (a.price ?? 0) - (b.price ?? 0))[0] ?? null;
}

function toPicked(p: Candidate, v: CandidateVariant | null, c: ShoppingCriteria): PickedProduct {
  const label = [
    c.size && v ? optionFor(v, /size/i) && `Size ${optionFor(v, /size/i)}` : null,
    c.colors.length && v ? optionFor(v, /colou?r/i) : null,
  ].filter(Boolean).join(" · ");
  const cheapest = [...p.variants].filter((x) => x.price != null).sort((a, b) => (a.price ?? 0) - (b.price ?? 0))[0];
  const chosen = v ?? p.variants.find((x) => x.available) ?? cheapest ?? null;
  return {
    title: p.title,
    description: p.description,
    url: p.url,
    imageUrl: p.imageUrl,
    price: chosen?.price ?? null,
    compareAtPrice: chosen?.compareAtPrice != null && chosen.price != null && chosen.compareAtPrice > chosen.price ? chosen.compareAtPrice : null,
    currency: p.currency,
    available: chosen?.available ?? false,
    variantId: chosen?.available ? chosen.id : null,
    variantLabel: label || null,
    bestseller: isBestseller(p),
  };
}

/**
 * The products to offer: every requirement met if possible; else the closest, dropping requirements in this
 * order (colour, size, gender, budget) and saying which were dropped, so the reply can be honest about it.
 */
export function pickProducts(candidates: Candidate[], c: ShoppingCriteria, limit = 6): PickResult {
  const steps: { relaxed: string[]; need: { size: boolean; color: boolean; budget: boolean }; gender: boolean }[] = [
    { relaxed: [], need: { size: true, color: true, budget: true }, gender: true },
    { relaxed: ["colour"], need: { size: true, color: false, budget: true }, gender: true },
    { relaxed: ["colour", "size"], need: { size: false, color: false, budget: true }, gender: true },
    // the right kind of product over budget beats one within budget for someone else
    { relaxed: ["colour", "size", "budget"], need: { size: false, color: false, budget: false }, gender: true },
    { relaxed: ["colour", "size", "budget", "gender"], need: { size: false, color: false, budget: false }, gender: false },
  ];
  for (const step of steps) {
    // a relaxation only counts if the visitor had that requirement
    const relaxed = step.relaxed.filter((r) =>
      r === "colour" ? c.colors.length > 0 : r === "size" ? !!c.size : r === "gender" ? !!c.gender : c.maxPrice != null || c.minPrice != null,
    );
    const scored = candidates
      .map((p, i) => ({ p, i, g: genderFit(p, c.gender), v: fit(p, c, step.need) }))
      .filter((x) => x.v && (!step.gender || x.g > 0))
      .sort((a, b) =>
        Number(b.v!.available) - Number(a.v!.available) || b.g - a.g ||
        (c.bestsellers ? Number(isBestseller(b.p)) - Number(isBestseller(a.p)) : 0) || a.i - b.i);
    if (scored.length) {
      let picked = scored;
      // nothing within budget: the cheapest alternatives, so "closest to your budget" is true
      if (relaxed.includes("budget")) picked = [...scored].sort((a, b) => (a.v!.price ?? 0) - (b.v!.price ?? 0));
      return { products: picked.slice(0, limit).map((x) => toPicked(x.p, x.v, c)), matched: relaxed.length === 0, relaxed };
    }
  }
  return { products: [], matched: false, relaxed: [] };
}

export function formatPrice(amount: number | null, currency: string): string | null {
  if (amount == null) return null;
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 ? 2 : 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount}`;
  }
}

/** "budget up to $100 · women · size M · black", or "" with no requirements */
export function describeCriteria(c: ShoppingCriteria, currency: string): string {
  const parts: string[] = [];
  if (c.minPrice != null && c.maxPrice != null) parts.push(`budget ${formatPrice(c.minPrice, currency)} to ${formatPrice(c.maxPrice, currency)}`);
  else if (c.maxPrice != null) parts.push(`budget up to ${formatPrice(c.maxPrice, currency)}`);
  else if (c.minPrice != null) parts.push(`from ${formatPrice(c.minPrice, currency)}`);
  if (c.gender) parts.push(c.gender === "kids" ? "for kids" : `for ${c.gender}`);
  if (c.size) parts.push(`size ${c.size}`);
  if (c.colors.length) parts.push(c.colors.join(" or "));
  if (c.terms) parts.push(`looking for: ${c.terms}`);
  if (c.bestsellers) parts.push("wants best sellers or help choosing");
  return parts.join(" · ");
}
