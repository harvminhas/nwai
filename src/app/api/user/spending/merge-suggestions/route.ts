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
import { findDuplicateGroups } from "@/lib/merchantDuplicates";

export const dynamic = "force-dynamic";

interface MerchantMember {
  name: string;
  slug: string;
  total: number;
  txCount: number;
  category: string;
  categories: string[];
}

interface MergeCluster {
  members: MerchantMember[];
  suggestedName: string;
}

/**
 * GET /api/user/spending/merge-suggestions
 *
 * Merges waiting to be made: merchants that look like the same place under
 * different names. Grouped by merchant, not by merchant + category, so a single
 * merchant that simply appears in two categories is never offered as a merge.
 *
 * Add ?all=1 to also return every merchant, for the panel's manual picker.
 */
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

    // Load source mappings so already-merged names resolve to their canonical
    const mappingsSnap = await db.collection(`users/${access.targetUid}/sourceMappings`).get();
    const mappings = mappingsSnap.docs.map(doc => doc.data() as { canonical: string; alias: string; status?: string; type?: string });
    const aliasResolver = buildMerchantAliasResolver(mappings);

    // One entry per canonical merchant, across every category it appears in
    const merchantMap = new Map<string, {
      names: Map<string, number>;
      slug: string;
      total: number;
      txCount: number;
      categories: Map<string, number>;
    }>();

    profile.expenseTxns
      .filter(t => {
        if (!windowMonths.includes(t.txMonth)) return false;
        if (isCoreExcluded(t.category)) return false;
        return getParentCategory(t.category) !== "Debt";
      })
      .forEach(t => {
        const resolvedMerchant = aliasResolver.resolve(t.merchant);
        const slug = resolveCanonicalMerchantSlug(merchantSlug(resolvedMerchant));
        if (!slug) return;

        if (!merchantMap.has(slug)) {
          merchantMap.set(slug, {
            names: new Map(),
            slug,
            total: 0,
            txCount: 0,
            categories: new Map(),
          });
        }

        const entry = merchantMap.get(slug)!;
        const amount = Math.abs(t.amount);
        entry.total += amount;
        entry.txCount += 1;
        entry.names.set(resolvedMerchant, (entry.names.get(resolvedMerchant) ?? 0) + 1);
        const parent = getParentCategory(t.category);
        entry.categories.set(parent, (entry.categories.get(parent) ?? 0) + amount);
      });

    const merchants: MerchantMember[] = Array.from(merchantMap.values()).map(m => {
      const orderedCategories = [...m.categories.entries()].sort((a, b) => b[1] - a[1]).map(([c]) => c);
      // Most frequently seen spelling is the readable name
      const name = [...m.names.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? m.slug;
      return {
        name,
        slug: m.slug,
        total: m.total,
        txCount: m.txCount,
        category: orderedCategories[0] ?? "Other",
        categories: orderedCategories,
      };
    });

    const clusters: MergeCluster[] = findDuplicateGroups(merchants, { maxGroups: 40 }).map(group => ({
      members: [...group.members].sort((a, b) => b.total - a.total),
      suggestedName: group.suggestedName,
    }));

    const includeAll = req.nextUrl.searchParams.get("all") === "1";

    return NextResponse.json({
      clusters,
      currency: profile.homeCurrency,
      ...(includeAll
        ? { merchants: merchants.sort((a, b) => b.total - a.total) }
        : {}),
    });
  } catch (err) {
    console.error("[merge-suggestions GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load suggestions" },
      { status: 500 }
    );
  }
}