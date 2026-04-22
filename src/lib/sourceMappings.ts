/**
 * Source mapping utilities.
 *
 * A SourceMapping records that one or more alias names are the same entity as
 * a canonical name — e.g. "MAM PAY" aliases to "MAM".
 *
 * Mappings are stored in Firestore at users/{uid}/sourceMappings/{id} and
 * applied at query time (no cache rebuild needed for income sources).
 */

export type MappingType = "income" | "expense";
export type MappingStatus = "confirmed" | "rejected";

export interface SourceMapping {
  id: string;
  pairKey?: string;    // stable pair key used as the Firestore doc ID
  type: MappingType;
  canonical: string;   // the name to keep
  alias: string;       // the name that maps to canonical
  status: MappingStatus;
  affectsCache: boolean; // true only when category changes — requires rebuild
  createdAt: string;   // ISO timestamp
}

/** A suggestion produced by the prefix-match scan — not yet confirmed/rejected. */
export interface SourceSuggestion {
  /** Deterministic key used to look up existing decisions */
  pairKey: string;
  type: MappingType;
  canonical: string;
  alias: string;
  confidence: "high" | "medium"; // high = one is a prefix of the other; medium = shared first word
  /** true when merging this pair would change a category and require a cache rebuild */
  affectsCache?: boolean;
}

// ── normalisation ─────────────────────────────────────────────────────────────

/** Lowercase, strip punctuation, collapse spaces. */
export function normaliseName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}

/** Stable pair key regardless of argument order. */
export function pairKey(a: string, b: string): string {
  const [x, y] = [normaliseName(a), normaliseName(b)].sort();
  return `${x}|||${y}`;
}

// ── suffix strip ──────────────────────────────────────────────────────────────

/** Common suffixes that do NOT distinguish a source — strip before comparing. */
const STRIP_SUFFIXES = /\s+(pay|payment|deposit|dep|direct|dd|pmnt|pmt|inc|ltd|llc|corp|co)$/i;

function stripSuffix(s: string): string {
  return s.replace(STRIP_SUFFIXES, "").trim();
}

// ── matching ──────────────────────────────────────────────────────────────────

/**
 * Given a list of source/merchant names that appear in the data, return
 * suggested pairs that are likely duplicates. Already-decided pairs (from
 * `existingMappings`) are excluded.
 *
 * Matching rules (in priority order):
 *  1. HIGH  — one normalised name is a prefix of the other AND shared prefix ≥ 3 chars
 *  2. HIGH  — names are identical after suffix stripping
 *  3. MEDIUM — names share the same first word (≥ 4 chars)
 */
export function buildSuggestions(
  sources: string[],
  existingMappings: SourceMapping[],
  type: MappingType
): SourceSuggestion[] {
  const decided = new Set(existingMappings.map((m) => m.pairKey ?? pairKey(m.canonical, m.alias)));
  const suggestions: SourceSuggestion[] = [];
  const seenPairs = new Set<string>();

  const normed = sources.map((s) => ({
    original: s,
    norm: normaliseName(s),
    stripped: normaliseName(stripSuffix(s)),
    firstWord: normaliseName(s).split(" ")[0] ?? "",
  }));

  for (let i = 0; i < normed.length; i++) {
    for (let j = i + 1; j < normed.length; j++) {
      const a = normed[i];
      const b = normed[j];

      const key = pairKey(a.original, b.original);
      if (decided.has(key) || seenPairs.has(key)) continue;

      let confidence: "high" | "medium" | null = null;

      // Rule 1: prefix match — shorter is a prefix of longer, min 5 chars and
      // prefix must cover ≥ 50% of the longer name (avoids "TD" matching everything)
      const shorter = a.norm.length <= b.norm.length ? a.norm : b.norm;
      const longer  = a.norm.length <= b.norm.length ? b.norm : a.norm;
      if (shorter.length >= 5 && longer.startsWith(shorter) && shorter.length / longer.length >= 0.5) {
        confidence = "high";
      }

      // Rule 2: identical after suffix strip (min 3 chars — suffix-strip is already precise)
      if (!confidence && a.stripped === b.stripped && a.stripped.length >= 3) {
        confidence = "high";
      }

      // Rule 3 (shared first word) removed — too many false positives for common
      // prefixes like "TD", "RBC", "BELL" across unrelated products.

      if (!confidence) continue;

      // canonical = the shorter / stripped name (cleaner label)
      const canonical = a.norm.length <= b.norm.length ? a.original : b.original;
      const alias     = a.norm.length <= b.norm.length ? b.original : a.original;

      seenPairs.add(key);
      suggestions.push({ pairKey: key, type, canonical, alias, confidence });
    }
  }

  // All suggestions are high-confidence; sort alphabetically by canonical name
  return suggestions.sort((a, b) => a.canonical.localeCompare(b.canonical));
}

/**
 * Given a source name, resolve it to its canonical name via confirmed mappings.
 * If no mapping exists, returns the original name unchanged.
 */
export function resolveCanonical(source: string, mappings: SourceMapping[]): string {
  const confirmed = mappings.filter((m) => m.status === "confirmed");
  for (const m of confirmed) {
    if (normaliseName(source) === normaliseName(m.alias)) return m.canonical;
  }
  return source;
}
