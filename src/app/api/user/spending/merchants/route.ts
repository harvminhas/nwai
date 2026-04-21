import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getYearMonth } from "@/lib/consolidate";
import { applyRulesAndRecalculate, merchantSlug, txnKey } from "@/lib/applyRules";
import { normaliseName } from "@/lib/sourceMappings";
import { buildAccountSlug } from "@/lib/accountSlug";
import { inferCurrencyFromBankName } from "@/lib/currencyUtils";
import type { ParsedStatementData, ExpenseTransaction } from "@/lib/types";

export interface MerchantSummary {
  slug: string;
  name: string;          // canonical display name (most-used spelling)
  /** Dominant category (highest spend). Kept for backward compat. */
  category: string;
  /** All unique categories across this merchant's transactions. */
  categories: string[];
  /** ISO 4217 currency of the merchant's native account (e.g. "CAD", "USD") */
  currency: string;
  total: number;
  count: number;         // transaction count
  avgAmount: number;
  lastDate: string | null;
  firstDate: string | null;
  /** Total per yearMonth: [{ ym, total, count }] */
  monthly: { ym: string; total: number; count: number }[];
  /** All transactions, newest first */
  transactions: (ExpenseTransaction & { ym: string })[];
}

function accountDisplayLabel(parsed: ParsedStatementData): string {
  if (parsed.accountName) return parsed.accountName;
  const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
  const bank = (parsed.bankName ?? "").trim();
  if (slug === "unknown") return bank || "Unknown Account";
  return [bank, `••••${slug}`].filter(Boolean).join(" ");
}

function docYearMonth(d: FirebaseFirestore.DocumentData): string {
  const parsed = d.parsedData as ParsedStatementData | undefined;
  let ym = parsed?.statementDate ? getYearMonth(parsed.statementDate) : "";
  if (!ym) {
    const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
    if (raw) {
      const t =
        typeof raw === "object" && "toISOString" in raw
          ? (raw as Date).toISOString()
          : String(raw);
      ym = t.slice(0, 7);
    }
  }
  return ym;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(request.url);
  const slugFilter  = searchParams.get("slug")?.trim()  ?? null; // optional: single merchant
  const monthFilter = searchParams.get("month")?.trim() ?? null; // optional: YYYY-MM scope

  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    // Load category rules, confirmed source mappings, and txn overrides in parallel
    const [rulesSnap, mappingsSnap, overridesSnap] = await Promise.all([
      db.collection("users").doc(uid).collection("categoryRules").get(),
      db.collection(`users/${uid}/sourceMappings`).get(),
      db.collection(`users/${uid}/txnCategoryOverrides`).get(),
    ]);
    const rulesMap = new Map<string, string>();
    for (const r of rulesSnap.docs) {
      const d = r.data();
      if (d.slug && d.category) rulesMap.set(d.slug as string, d.category as string);
    }
    // Build txn override map: txnKey → category
    const txnOverrides = new Map<string, string>();
    for (const doc of overridesSnap.docs) {
      const d = doc.data() as { category: string };
      if (d.category) txnOverrides.set(doc.id, d.category);
    }

    // Build alias → canonical name map keyed by merchantSlug, then resolve chains
    // e.g.  "SCOTIALN VSA A6K6W2" → "SCOTIALN VSA" → "SCOTIALN"
    // should resolve to "SCOTIALN VSA A6K6W2" → "SCOTIALN" directly.
    const rawAliasMap = new Map<string, string>(); // aliasSlug → canonicalName (one level)
    for (const doc of mappingsSnap.docs) {
      const d = doc.data() as { canonical: string; alias: string; status?: string; type?: string };
      if (d.canonical && d.alias && d.status === "confirmed" && (!d.type || d.type === "expense")) {
        rawAliasMap.set(merchantSlug(d.alias), d.canonical);
      }
    }

    // Resolve full chains so multi-hop merges work
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

    // Load all completed statements
    const stmtSnap = await db
      .collection("statements")
      .where("userId", "==", uid)
      .where("status", "==", "completed")
      .get();

    // Deduplicate: keep only the most-recently-uploaded doc per account × statement-month.
    // This mirrors extractAllTransactions and prevents double-counting re-uploads.
    const bestDocPerSlugYm = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();
    for (const doc of stmtSnap.docs) {
      const d = doc.data();
      const parsed = d.parsedData as ParsedStatementData | undefined;
      if (!parsed) continue;
      const stmtYm = docYearMonth(d);
      if (!stmtYm) continue;
      const acctSlug = buildAccountSlug(parsed.bankName, parsed.accountId);
      const key = `${acctSlug}|${stmtYm}`;
      const existing = bestDocPerSlugYm.get(key);
      if (!existing) {
        bestDocPerSlugYm.set(key, doc);
      } else {
        const existTs = existing.data().uploadedAt?.toDate?.()?.getTime() ?? 0;
        const thisTs  = d.uploadedAt?.toDate?.()?.getTime() ?? 0;
        if (thisTs > existTs) bestDocPerSlugYm.set(key, doc);
      }
    }

    // Read homeCurrency from user profile (for display reference only — no conversion needed)
    const profileSnap = await db.collection("users").doc(uid).get();
    const homeCurrency: string = profileSnap.data()?.country === "CA" ? "CAD" : "USD";

    const inferStmtCurrency = (parsed: ParsedStatementData) =>
      inferCurrencyFromBankName(parsed.bankName, parsed.currency, homeCurrency);

    // Aggregate by merchant slug. Each merchant belongs to one account → one currency.
    // Store native amounts as-is; no FX conversion needed.
    const map = new Map<string, {
      names: Record<string, number>;
      category: string;
      currency: string;
      total: number;
      count: number;
      dates: string[];
      monthly: Map<string, { total: number; count: number }>;
      transactions: (ExpenseTransaction & { ym: string })[];
    }>();

    for (const doc of bestDocPerSlugYm.values()) {
      const d = doc.data();
      const parsed = d.parsedData as ParsedStatementData;
      const stmtYm = docYearMonth(d);
      const stmtCurrency = inferStmtCurrency(parsed);

      if ((parsed.accountType ?? "").toLowerCase() === "investment") continue;

      const stmtId = doc.id;
      // accountSlug is stable across re-uploads (same bankName + accountId = same slug).
      // txnKey uses accountSlug so category overrides survive statement re-uploads.
      const acctSlug = buildAccountSlug(parsed.bankName, parsed.accountId);
      // Inject stmtId + accountSlug BEFORE applyRulesAndRecalculate so txnKey lookups work
      const parsedWithIds: typeof parsed = parsed.expenses
        ? {
            ...parsed,
            expenses: {
              ...parsed.expenses,
              transactions: (parsed.expenses.transactions ?? []).map((t) => ({
                ...t,
                stmtId,
                accountSlug: acctSlug,
              })),
            },
          }
        : parsed;
      // Don't pass txnOverrides here — the transactions still have raw (pre-alias) merchant
      // names, so any key built inside applyRulesAndRecalculate would use the wrong slug.
      // Overrides are applied below, after alias resolution, using the canonical merchant name.
      const withRules = applyRulesAndRecalculate(parsedWithIds, rulesMap);
      const label = accountDisplayLabel(parsed);
      const txns: ExpenseTransaction[] = (withRules.expenses?.transactions ?? []).map((t) => ({
        ...t,
        accountLabel: label,
        currency: stmtCurrency,
        stmtId,
        accountSlug: acctSlug,
      }));

      for (const txn of txns) {
        // Resolve alias → canonical via confirmed source mappings (slug-based lookup)
        const canonicalName = aliasToCanonical.get(merchantSlug(txn.merchant));
        const effectiveMerchant = canonicalName ?? txn.merchant;
        const txnWithCanonical = canonicalName ? { ...txn, merchant: effectiveMerchant } : txn;
        // Apply per-transaction override AFTER alias resolution so the key uses the canonical
        // merchant name — exactly the name the PUT route received from the UI.
        const overrideCategory = txnOverrides.get(txnKey(acctSlug, txnWithCanonical));
        const effectiveTxn = overrideCategory
          ? { ...txnWithCanonical, category: overrideCategory }
          : txnWithCanonical;

        const slug = merchantSlug(effectiveMerchant);
        if (!slug) continue;
        // When a slug filter is set we still aggregate ALL merchants so we can
        // compute similar-merchant suggestions; we just skip transaction storage
        // for non-target merchants to keep memory usage reasonable.
        const isTarget = !slugFilter || slug === slugFilter;
        if (slugFilter && !isTarget) {
          // Lightweight aggregation only — totals, no transaction list
          const txYm = effectiveTxn.date ? effectiveTxn.date.slice(0, 7) : stmtYm;
          if (monthFilter && txYm !== monthFilter) continue;
          const amt = Math.abs(effectiveTxn.amount);
          let entry = map.get(slug);
          if (!entry) {
            entry = { names: {}, category: effectiveTxn.category ?? "other", currency: stmtCurrency, total: 0, count: 0, dates: [], monthly: new Map(), transactions: [] };
            map.set(slug, entry);
          }
          entry.names[effectiveMerchant] = (entry.names[effectiveMerchant] ?? 0) + 1;
          entry.category = effectiveTxn.category ?? entry.category;
          entry.total += amt;
          entry.count += 1;
          if (effectiveTxn.date) entry.dates.push(effectiveTxn.date);
          const mo = entry.monthly.get(txYm) ?? { total: 0, count: 0 };
          mo.total += amt; mo.count += 1;
          entry.monthly.set(txYm, mo);
          continue;
        }

        const txYm = effectiveTxn.date ? effectiveTxn.date.slice(0, 7) : stmtYm;
        if (monthFilter && txYm !== monthFilter) continue;

        const amt = Math.abs(effectiveTxn.amount);

        let entry = map.get(slug);
        if (!entry) {
          entry = {
            names: {},
            category: effectiveTxn.category ?? "other",
            currency: stmtCurrency,
            total: 0,
            count: 0,
            dates: [],
            monthly: new Map(),
            transactions: [],
          };
          map.set(slug, entry);
        }

        entry.names[effectiveMerchant] = (entry.names[effectiveMerchant] ?? 0) + 1;
        entry.category = effectiveTxn.category ?? entry.category;
        entry.total += amt;
        entry.count += 1;
        if (effectiveTxn.date) entry.dates.push(effectiveTxn.date);

        const mo = entry.monthly.get(txYm) ?? { total: 0, count: 0 };
        mo.total += amt;
        mo.count += 1;
        entry.monthly.set(txYm, mo);

        entry.transactions.push({ ...effectiveTxn, ym: txYm });
      }
    }

    // Build result array
    const merchants: MerchantSummary[] = Array.from(map.entries()).map(([slug, e]) => {
      const name = Object.entries(e.names).sort((a, b) => b[1] - a[1])[0]?.[0] ?? slug;
      const sortedDates = [...e.dates].sort();
      const monthly = Array.from(e.monthly.entries())
        .map(([ym, v]) => ({ ym, ...v }))
        .sort((a, b) => a.ym.localeCompare(b.ym));
      const transactions = [...e.transactions].sort((a, b) =>
        (b.date ?? b.ym).localeCompare(a.date ?? a.ym)
      );
      // All unique categories across transactions (for per-txn category model)
      const categoryTotals = new Map<string, number>();
      for (const t of transactions) {
        const cat = t.category || "Other";
        categoryTotals.set(cat, (categoryTotals.get(cat) ?? 0) + Math.abs(t.amount));
      }
      const categories = [...categoryTotals.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([c]) => c);
      const dominantCategory = categories[0] ?? e.category;

      return {
        slug,
        name,
        category: dominantCategory,
        categories,
        currency: e.currency,
        total: e.total,
        count: e.count,
        avgAmount: e.count > 0 ? e.total / e.count : 0,
        lastDate: sortedDates.at(-1) ?? null,
        firstDate: sortedDates[0] ?? null,
        monthly,
        transactions,
      };
    });

    merchants.sort((a, b) => b.total - a.total);

    if (slugFilter) {
      const target = merchants.find((m) => m.slug === slugFilter) ?? merchants[0] ?? null;

      // Find similar merchants using:
      //   Rule 1 (relaxed): shorter is a prefix of longer, ≥5 chars, ≥30% coverage
      //   Rule 2: first word matches exactly, ≥5 chars
      const normName = (s: string) =>
        s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      const firstWord = (s: string) => normName(s).split(" ")[0] ?? "";

      const similarMerchants: MerchantSummary[] = target
        ? merchants.filter((m) => {
            if (m.slug === target.slug) return false;
            const a = normName(target.name);
            const b = normName(m.name);
            const shorter = a.length <= b.length ? a : b;
            const longer  = a.length <= b.length ? b : a;
            // Rule 1: prefix, relaxed to 30% coverage
            if (shorter.length >= 5 && longer.startsWith(shorter) && shorter.length / longer.length >= 0.3) return true;
            // Rule 2: shared first word ≥5 chars
            const fw = firstWord(target.name);
            if (fw.length >= 5 && fw === firstWord(m.name)) return true;
            return false;
          })
        : [];

      // Category peers — top merchants in the same category (excluding target)
      let categoryPeers: { name: string; slug: string; total: number; currency: string }[] = [];
      let categoryTotal = 0;
      if (target) {
        const targetCat = (target.category || "other").toLowerCase().trim();
        const sameCat = merchants.filter(
          (m) => (m.category || "other").toLowerCase().trim() === targetCat,
        );
        categoryTotal = sameCat.reduce((s, m) => s + m.total, 0);
        categoryPeers = sameCat
          .filter((m) => m.slug !== slugFilter)
          .sort((a, b) => b.total - a.total)
          .slice(0, 5)
          .map((m) => ({ name: m.name, slug: m.slug, total: m.total, currency: m.currency }));
      }

      return NextResponse.json({ merchant: target, similarMerchants, categoryPeers, categoryTotal, homeCurrency });
    }
    return NextResponse.json({ merchants, homeCurrency });
  } catch (err) {
    console.error("merchants route error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
