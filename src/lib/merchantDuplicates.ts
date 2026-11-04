/**
 * Duplicate-merchant matching rules.
 *
 * One implementation shared by every screen that suggests merging merchants,
 * so two screens can never disagree about what looks like the same place.
 *
 * The rules are conservative on purpose: a wrong merge files money under the
 * wrong name, while a missed one is a couple of clicks away in the manual
 * picker.
 */

import { normalizeMerchantForSimilarity } from "@/lib/merchantSimilarity";

export interface DuplicateCandidate {
  name: string;
  slug: string;
  total?: number;
  txCount?: number;
}

function normalisedWords(name: string): string[] {
  return normalizeMerchantForSimilarity(name).split(" ").filter(Boolean);
}

/** How many leading words both names share, and what share of the shorter name that is. */
function leadingWords(a: string[], b: string[]): { count: number; coverage: number } {
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  const shortest = Math.min(a.length, b.length);
  return { count, coverage: shortest > 0 ? count / shortest : 0 };
}

/**
 * True when two merchants look like the same place under different names.
 *
 *   1. Same once store numbers and reference codes are stripped
 *      ("COSTCO WHOLESALE W1261" / "COSTCO WHOLESALE")
 *   2. One name is a word-prefix of the other, at least two words
 *      ("TIM HORTONS" / "TIM HORTONS #3125 BRAMPTON")
 *   3. Shared opening words, and everything after them is a short token —
 *      a reference number, a month, or a truncated ending
 *      ("CURSOR USAGE MID DEC" / "CURSOR USAGE MAR",
 *       "SHOPPERS DRUG MART" / "SHOPPERS DRUG M")
 *   4. Shared opening words, and what follows is the same word cut short
 *      ("PRINCE MOTOR GARAGE" / "PRINCE MOTOR GA M")
 *
 * Distinct names after the shared opening — "CITY OF BRAMPTON" and
 * "CITY OF MISSISSAUGA" — stay apart.
 */
export function areSimilarMerchants(a: DuplicateCandidate, b: DuplicateCandidate): boolean {
  if (!a.slug || !b.slug || a.slug === b.slug) return false;

  const aWords = normalisedWords(a.name);
  const bWords = normalisedWords(b.name);
  if (aWords.length === 0 || bWords.length === 0) return false;

  const aNorm = aWords.join(" ");
  const bNorm = bWords.join(" ");
  if (aNorm.length < 4 || bNorm.length < 4) return false;

  // 1. Identical after stripping codes
  if (aNorm === bNorm) return true;

  // 2. One is a word-prefix of the other
  const shorter = aWords.length <= bWords.length ? aWords : bWords;
  const longer = aWords.length <= bWords.length ? bWords : aWords;
  if (shorter.length >= 2 && shorter.every((word, i) => longer[i] === word)) {
    if (shorter.join(" ").length >= 5) return true;
  }

  // Shared opening words
  const { count, coverage } = leadingWords(aWords, bWords);
  if (count < 2 || coverage < 0.5) return false;

  const aTail = aWords.slice(count);
  const bTail = bWords.slice(count);

  // 3. Everything left over is a short token
  const allShort = [...aTail, ...bTail].every((word) => word.length <= 4);
  if (allShort) return true;

  // 4. Same word, one side cut short
  const aJoined = aTail.join("");
  const bJoined = bTail.join("");
  if (aJoined.length >= 2 && bJoined.startsWith(aJoined)) return true;
  if (bJoined.length >= 2 && aJoined.startsWith(bJoined)) return true;

  return false;
}

/** Title-case a merchant name, but only when it was written in all capitals. */
export function prettyMerchantName(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return raw;
  const letters = trimmed.replace(/[^A-Za-z]/g, "");
  if (letters.length < 2 || letters !== letters.toUpperCase()) return trimmed;
  return trimmed
    .split(/\s+/)
    .map((word) => (word.length < 2 ? word : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

/**
 * A readable name covering every member, built from the words they all start
 * with. "CURSOR USAGE MID DEC" + "CURSOR USAGE MAR" -> "Cursor Usage".
 * Falls back to the biggest member's own name.
 */
export function suggestedMergeName(names: string[], fallback: string): string {
  const all = names.map(normalisedWords);
  let prefix: string[] = [];

  if (all.length > 0 && all.every((w) => w.length > 0)) {
    for (let i = 0; ; i++) {
      const candidate = all[0][i];
      if (!candidate || !all.every((w) => w[i] === candidate)) break;
      prefix.push(candidate);
    }
  }

  // Drop a dangling single letter left over from a cut-off word ("mcdonald s")
  while (prefix.length > 0 && prefix[prefix.length - 1].length < 2) prefix.pop();

  const joined = prefix.join(" ");
  if (joined.length < 4) return prettyMerchantName(fallback);

  return prefix.map((word) => (word.length < 2 ? word : word.charAt(0).toUpperCase() + word.slice(1))).join(" ");
}

export interface DuplicateGroup<T extends DuplicateCandidate> {
  members: T[];
  suggestedName: string;
}

/**
 * Group merchants that look like the same place.
 *
 * Each group is anchored on its biggest member and only holds merchants similar
 * to that anchor, so one loose match cannot chain unrelated names together.
 */
export function findDuplicateGroups<T extends DuplicateCandidate>(
  items: T[],
  options?: { maxGroups?: number; maxMembers?: number }
): Array<DuplicateGroup<T>> {
  const maxGroups = options?.maxGroups ?? 50;
  const maxMembers = options?.maxMembers ?? 8;

  const ranked = [...items].sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
  const claimed = new Set<string>();
  const groups: Array<DuplicateGroup<T>> = [];

  for (const anchor of ranked) {
    if (claimed.has(anchor.slug)) continue;
    const members = [anchor, ...ranked.filter((m) => !claimed.has(m.slug) && areSimilarMerchants(anchor, m))].slice(
      0,
      maxMembers
    );
    if (members.length < 2) continue;

    members.forEach((m) => claimed.add(m.slug));
    groups.push({
      members,
      suggestedName: suggestedMergeName(members.map((m) => m.name), anchor.name),
    });
  }

  return groups
    .sort((a, b) => {
      const aTotal = a.members.reduce((sum, m) => sum + (m.total ?? 0), 0);
      const bTotal = b.members.reduce((sum, m) => sum + (m.total ?? 0), 0);
      return bTotal - aTotal;
    })
    .slice(0, maxGroups);
}

/** Words too generic to suggest a match on their own. */
const NOISE_WORDS = new Set([
  // places and business words that say what a merchant is, not who it is
  "city", "town", "county", "village", "region", "district",
  "store", "stores", "shop", "shops", "market", "plaza", "mall", "centre", "center",
  "location", "branch", "station", "online", "payment", "purchase", "pos",
  "service", "services", "group", "company", "holdings", "enterprise", "enterprises",
  "food", "foods", "restaurant", "restaurants", "grocery", "pharmacy", "express",
  "inc", "ltd", "llc", "corp", "co", "com", "ca", "canada", "the", "and", "for",
  // everyday words that recur across unrelated brands, so sharing one proves nothing
  "queen", "dairy", "pizza", "burger", "chicken", "coffee", "cafe", "bar", "grill",
  "mart", "gas", "fuel", "car", "auto", "wash", "tire", "tires", "oil", "parts",
  "super", "plus", "fresh", "value", "dollar", "best", "golden", "lucky", "happy",
  "royal", "grand", "star", "sun", "garden", "house", "home", "world", "global",
]);

/** Meaningful words in a merchant name, shared-name bait removed. */
function nameWords(name: string): string[] {
  return normalisedWords(name).filter((w) => w.length >= 4 && !NOISE_WORDS.has(w));
}

/**
 * Merchants that share a meaningful word with this one, loosest first match.
 *
 * Deliberately looser than areSimilarMerchants: "ESSO CIRCLE K" and
 * "CHERRYCREST ESSO" are the same brand but share no opening word, so the
 * confident rules refuse them. The panel offers these unticked, for the user
 * to confirm, rather than silently merging or showing nothing at all.
 */
export function findRelatedMerchants<T extends DuplicateCandidate>(
  target: T,
  items: T[],
  options?: { max?: number }
): T[] {
  const max = options?.max ?? 8;
  const targetWords = new Set(nameWords(target.name));
  if (targetWords.size === 0) return [];

  const scored: Array<{ item: T; shared: number }> = [];
  for (const item of items) {
    if (!item.slug || item.slug === target.slug) continue;
    const shared = nameWords(item.name).filter((w) => targetWords.has(w)).length;
    if (shared === 0) continue;
    scored.push({ item, shared });
  }

  return scored
    .sort((a, b) => b.shared - a.shared || (b.item.total ?? 0) - (a.item.total ?? 0))
    .slice(0, max)
    .map((s) => s.item);
}