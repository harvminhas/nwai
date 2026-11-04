import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { resolveWindowMonths } from "@/lib/rangeUtils";
import { getParentCategory } from "@/lib/categoryTaxonomy";
import { merchantSlug } from "@/lib/applyRules";
import { resolveCanonicalMerchantSlug } from "@/lib/merchantUtils";
import { isCoreExcluded } from "@/lib/spendingMetrics";
import { buildMerchantAliasResolver } from "@/lib/merchantAliases";
import { normalizeMerchantForSimilarity } from "@/lib/merchantSimilarity";
import { normaliseName } from "@/lib/sourceMappings";

export const dynamic = "force-dynamic";

interface MerchantMember {
  name: string;
  slug: string;
  total: number;
  txCount: number;
  category: string;
}

interface MergeCluster {
  members: MerchantMember[];
  suggestedName: string;
}

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const profile = await getFinancialProfile(access.targetUid, db);
    
    const accountStatusMap = new Map(
      profile.accountStatusRecords.map(r => [r.accountSlug, { status: r.status, statusDate: r.statusDate }])
    );
    
    const windowResult = resolveWindowMonths(
      "12mo",
      profile.monthlyHistory,
      profile.statementHistory,
      accountStatusMap
    );
    
    const windowMonths = windowResult.months;

    // Load source mappings to exclude already-merged merchants
    const mappingsSnap = await db.collection(`users/${access.targetUid}/sourceMappings`).get();
    const mappings = mappingsSnap.docs.map(doc => doc.data() as { canonical: string; alias: string; status?: string; type?: string });
    const aliasResolver = buildMerchantAliasResolver(mappings);

    // Build merchant map (after alias resolution, grouped by category + canonical)
    const merchantMap = new Map<string, MerchantMember>();
    
    profile.expenseTxns
      .filter(t => {
        if (!windowMonths.includes(t.txMonth)) return false;
        if (isCoreExcluded(t.category)) return false;
        const parent = getParentCategory(t.category);
        if (parent === "Debt") return false;
        return true;
      })
      .forEach(t => {
        const resolvedMerchant = aliasResolver.resolve(t.merchant);
        const slug = merchantSlug(resolvedMerchant);
        const canonical = resolveCanonicalMerchantSlug(slug);
        const parent = getParentCategory(t.category);
        const key = `${parent}::${canonical}`;

        if (!merchantMap.has(key)) {
          merchantMap.set(key, {
            name: resolvedMerchant,
            slug: canonical,
            total: 0,
            txCount: 0,
            category: parent,
          });
        }

        const entry = merchantMap.get(key)!;
        entry.total += Math.abs(t.amount);
        entry.txCount += 1;
      });

    const merchants = Array.from(merchantMap.values());

    // Group by normalized name for similarity detection
    const normalizedGroups = new Map<string, MerchantMember[]>();
    for (const m of merchants) {
      const normalized = normalizeMerchantForSimilarity(m.name);
      if (!normalizedGroups.has(normalized)) {
        normalizedGroups.set(normalized, []);
      }
      normalizedGroups.get(normalized)!.push(m);
    }

    // Build clusters from groups with 2+ members
    const clusters: MergeCluster[] = Array.from(normalizedGroups.values())
      .filter(group => group.length >= 2)
      .map(group => {
        // Suggested name: longest member name, title-cased
        const longest = group.reduce((a, b) => a.name.length > b.name.length ? a : b);
        const suggestedName = normaliseName(longest.name);
        
        return {
          members: group.sort((a, b) => b.total - a.total),
          suggestedName,
        };
      })
      .sort((a, b) => {
        const aTotal = a.members.reduce((sum, m) => sum + m.total, 0);
        const bTotal = b.members.reduce((sum, m) => sum + m.total, 0);
        return bTotal - aTotal;
      })
      .slice(0, 25); // Top 25 clusters

    return NextResponse.json({ clusters, currency: profile.homeCurrency });
  } catch (err) {
    console.error("[merge-suggestions GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load suggestions" },
      { status: 500 }
    );
  }
}
