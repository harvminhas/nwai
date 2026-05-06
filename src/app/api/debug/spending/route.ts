import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { buildAndCacheFinancialProfile } from "@/lib/financialProfile";
import { CORE_EXCLUDE_RE } from "@/lib/spendingMetrics";
import { canUseDebugTools } from "@/lib/debugPlanGate";

/**
 * GET /api/debug/spending
 *
 * Returns the raw financial profile cache with before/after transfer-exclusion
 * breakdown so you can verify exactly what numbers the spending page and
 * insights route see — and why toggling "Excl. transfers" changes the total.
 *
 * Optionally pass ?rebuild=1 to force a fresh cache build before reading.
 */
export async function GET(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    if (!(await canUseDebugTools(uid, decoded.email, db))) {
      return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });
    }

    const forceRebuild = new URL(request.url).searchParams.get("rebuild") === "1";
    const profile = forceRebuild
      ? await buildAndCacheFinancialProfile(uid, db)
      : await (async () => {
          const { getFinancialProfile } = await import("@/lib/financialProfile");
          return getFinancialProfile(uid, db);
        })();

    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

    // ── Per-month summary ──────────────────────────────────────────────────────
    const monthSummary = profile.monthlyHistory.map((h) => ({
      yearMonth: h.yearMonth,
      allExpenses: h.expensesTotal,
      coreExpenses: h.coreExpensesTotal,
      excluded: +(h.expensesTotal - h.coreExpensesTotal).toFixed(2),
      income: h.incomeTotal,
    }));

    // ── Current month transactions detail ─────────────────────────────────────
    const currentTxns = profile.expenseTxns.filter((t) => t.txMonth === thisMonth);
    const isExcluded = (cat: string) => CORE_EXCLUDE_RE.test((cat ?? "").trim());

    const txDetail = currentTxns.map((t) => ({
      date: t.date,
      merchant: t.merchant,
      category: t.category,
      amount: t.amount,
      excluded: isExcluded(t.category),
      accountLabel: t.accountLabel,
    }));

    const currentAll  = currentTxns.reduce((s, t) => s + t.amount, 0);
    const currentCore = currentTxns
      .filter((t) => !isExcluded(t.category))
      .reduce((s, t) => s + t.amount, 0);

    // ── Negative-amount transactions in cache (should be empty after fix) ──────
    const negatives = profile.expenseTxns.filter((t) => t.amount <= 0).map((t) => ({
      date: t.date,
      merchant: t.merchant,
      category: t.category,
      amount: t.amount,
      txMonth: t.txMonth,
    }));

    // ── Excluded categories breakdown for current month ────────────────────────
    const excludedCats = new Map<string, number>();
    for (const t of currentTxns) {
      if (isExcluded(t.category)) {
        excludedCats.set(t.category, (excludedCats.get(t.category) ?? 0) + t.amount);
      }
    }

    return NextResponse.json({
      cacheMetadata: {
        updatedAt: profile.updatedAt,
        schemaVersion: profile.schemaVersion ?? "(none — rebuild needed)",
        sourceVersion: profile.sourceVersion,
        ageSeconds: Math.round((Date.now() - new Date(profile.updatedAt).getTime()) / 1000),
        totalTxns: profile.expenseTxns.length,
        monthsInHistory: profile.monthlyHistory.length,
        negativeAmountTxns: negatives.length,
      },
      accountSnapshots: profile.accountSnapshots.map((s) => ({
        slug: s.slug,
        bankName: s.bankName,
        accountName: s.accountName,
        accountType: s.accountType,
        currency: s.currency ?? "CAD",
        balance: s.balance,
        statementMonth: s.statementMonth,
      })),
      homeCurrency: profile.homeCurrency ?? "USD",
      fxRates: profile.fxRates ?? {},
      currentMonth: {
        month: thisMonth,
        totalBefore: +currentAll.toFixed(2),
        totalAfterExcludingTransfers: +currentCore.toFixed(2),
        difference: +(currentAll - currentCore).toFixed(2),
        excludedByCategory: Object.fromEntries(
          Array.from(excludedCats.entries()).map(([k, v]) => [k, +v.toFixed(2)])
        ),
        transactions: txDetail,
      },
      negativeAmountTransactions: negatives,
      monthSummary,
    });
  } catch (err) {
    console.error("[debug/spending]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
