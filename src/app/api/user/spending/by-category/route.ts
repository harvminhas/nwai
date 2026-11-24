import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { monthsForCashFlowAverage } from "@/lib/cashFlowAverage";
import { getCurrentMonth } from "@/lib/monthAnchor";
import { aggregateSpendingByCategory } from "@/lib/spendingAggregation";
import { loadMerchantRenameContext } from "@/app/api/user/merchantRenameContext";

/**
 * GET /api/user/spending/by-category
 * 
 * Returns spending aggregated by category with proper debt handling.
 * For loan/mortgage categories: uses computeScheduledDebtPayments (learned regular payment)
 * instead of summing raw transactions.
 * 
 * Query params:
 *   - window: "3mo" | "6mo" | "12mo" | "all" (default: "12mo")
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    const { searchParams } = new URL(request.url);
    const window = searchParams.get("window") ?? "12mo";

    // Get financial profile (cached)
    const [profile, renameCtx] = await Promise.all([
      getFinancialProfile(uid, db),
      loadMerchantRenameContext(uid, db),
    ]);

    const currentYm = getCurrentMonth();
    const availableMonths = [...new Set(profile.expenseTxns.map((t) => t.txMonth))].sort();
    let monthsBack = 12;
    if (window === "3mo") monthsBack = 3;
    if (window === "6mo") monthsBack = 6;
    if (window === "all") monthsBack = Math.max(availableMonths.length, 1);

    const rangeMonths = monthsForCashFlowAverage(availableMonths, { lastNComplete: monthsBack });
    const cutoffYm = rangeMonths[0] ?? null;
    const filteredTxns = profile.expenseTxns.filter((t) => rangeMonths.includes(t.txMonth));

    // Count actual months with data
    const monthsSet = new Set(filteredTxns.map(t => t.txMonth));
    const actualMonths = monthsSet.size || 1;

    // Aggregate with proper debt handling
    const categories = aggregateSpendingByCategory(
      filteredTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      actualMonths,
      renameCtx,
    );

    return NextResponse.json({
      categories,
      window,
      months: actualMonths,
      cutoffYm: window === "all" ? null : cutoffYm,
      currentYm,
      homeCurrency: profile.homeCurrency,
    });
  } catch (err) {
    console.error("by-category route error", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
