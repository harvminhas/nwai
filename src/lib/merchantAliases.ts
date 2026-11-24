/**
 * Merchant alias resolution
 * 
 * Reads confirmed source mappings from Firestore and builds a resolver
 * that follows alias chains up to 10 hops to find the canonical name.
 * 
 * Used by both /api/user/spending/merchants and /api/user/spending/drilldown
 * to ensure consistent merchant merging across all views.
 */

import { merchantSlug } from "@/lib/applyRules";
import { resolveCanonicalMerchantSlug, resolveMerchantAlias } from "@/lib/merchantUtils";

export interface MerchantAliasResolver {
  /**
   * Resolve a merchant name to its canonical name.
   * If no alias exists, returns the input name unchanged.
   */
  resolve(merchantName: string): string;
  
  /**
   * Get all alias slugs that resolve to a given canonical slug.
   * Useful for matching stale URLs or finding all variants.
   */
  getAliasesFor(canonicalSlug: string): string[];
}

/**
 * Build a merchant alias resolver from Firestore source mappings.
 * 
 * @param mappings - Array of {canonical, alias, status, type} from users/{uid}/sourceMappings
 * @returns A resolver that can map merchant names to their canonical names
 */
export function buildMerchantAliasResolver(
  mappings: Array<{ canonical: string; alias: string; status?: string; type?: string }>
): MerchantAliasResolver {
  // Build alias → canonical name map keyed by merchantSlug (one level)
  const rawAliasMap = new Map<string, string>();
  for (const m of mappings) {
    if (m.canonical && m.alias && m.status === "confirmed" && (!m.type || m.type === "expense")) {
      rawAliasMap.set(merchantSlug(m.alias), m.canonical);
    }
  }

  // Resolve full chains so multi-hop merges work
  // e.g. "SCOTIALN VSA A6K6W2" → "SCOTIALN VSA" → "SCOTIALN"
  // should resolve to "SCOTIALN VSA A6K6W2" → "SCOTIALN" directly
  const aliasToCanonical = new Map<string, string>();
  for (const [aliasSlug, firstCanonical] of rawAliasMap) {
    let current = firstCanonical;
    const visited = new Set<string>([aliasSlug]);
    for (let hop = 0; hop < 10; hop++) {
      const nextCanonical = rawAliasMap.get(merchantSlug(current));
      if (!nextCanonical || visited.has(merchantSlug(current))) break;
      visited.add(merchantSlug(current));
      current = nextCanonical;
    }
    aliasToCanonical.set(aliasSlug, current);
  }

  // Build reverse map: canonical slug → alias slugs
  const canonicalToAliases = new Map<string, string[]>();
  for (const [aliasSlug, canonicalName] of aliasToCanonical) {
    const canSlug = merchantSlug(canonicalName);
    if (!canonicalToAliases.has(canSlug)) {
      canonicalToAliases.set(canSlug, []);
    }
    canonicalToAliases.get(canSlug)!.push(aliasSlug);
  }

  return {
    resolve(merchantName: string): string {
      const slug = merchantSlug(merchantName);
      return aliasToCanonical.get(slug) ?? merchantName;
    },

    getAliasesFor(canonicalSlug: string): string[] {
      return canonicalToAliases.get(canonicalSlug) ?? [];
    },
  };
}

/**
 * User-set display names from `users/{uid}/merchantDisplayNames/{slug}`.
 * Same map Spending merchants and the merchant detail page use.
 */
export function merchantDisplayNamesFromRecords(
  records: Iterable<{ id: string; displayName?: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const rec of records) {
    const name = rec.displayName?.trim();
    if (name) map.set(rec.id, name);
  }
  return map;
}

/**
 * Saved rename for a merchant slug, or undefined to keep the statement name.
 * Lookup is the same Map.get(slug) the Spending merchants API uses.
 */
export function merchantDisplayNameForSlug(
  slug: string,
  displayNames?: ReadonlyMap<string, string> | null,
  alsoSlug?: string,
): string | undefined {
  if (!displayNames || displayNames.size === 0) return undefined;
  return displayNames.get(slug) ?? (alsoSlug ? displayNames.get(alsoSlug) : undefined);
}

/**
 * Canonical merchant key + display name used by the Spending page.
 *
 * Matches drilldown grouping: user-confirmed source mappings first, then
 * built-in aliases (`amazon-ca` → Amazon) via {@link resolveCanonicalMerchantSlug}
 * and {@link resolveMerchantAlias}. When `displayNames` is provided, a saved
 * merchant rename (merchant detail page) replaces the statement name.
 */
export function resolveSpendingMerchant(
  merchantName: string,
  aliasResolver?: Pick<MerchantAliasResolver, "resolve"> | null,
  displayNames?: ReadonlyMap<string, string> | null,
): { slug: string; name: string } {
  const resolved = aliasResolver?.resolve(merchantName) ?? merchantName;
  const slug = merchantSlug(resolved);
  const canonicalSlug = resolveCanonicalMerchantSlug(slug);
  const statementName = resolveMerchantAlias(slug, resolved);
  return {
    slug: canonicalSlug,
    name: merchantDisplayNameForSlug(canonicalSlug, displayNames, slug) ?? statementName,
  };
}
