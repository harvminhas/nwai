import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { aggregateSpendingByCategory } from "@/lib/spendingAggregation";

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
    const profile = await getFinancialProfile(uid, db);

    // Determine date range
    const now = new Date();
    const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    
    let monthsBack = 12;
    if (window === "3mo") monthsBack = 3;
    if (window === "6mo") monthsBack = 6;
    if (window === "all") monthsBack = 9999; // all time
    
    const cutoffDate = new Date(now);
    cutoffDate.setMonth(cutoffDate.getMonth() - monthsBack);
    const cutoffYm = `${cutoffDate.getFullYear()}-${String(cutoffDate.getMonth() + 1).padStart(2, "0")}`;

    // Filter transactions to window
    const filteredTxns = window === "all" 
      ? profile.expenseTxns
      : profile.expenseTxns.filter(t => t.txMonth >= cutoffYm && t.txMonth < currentYm);

    // Count actual months with data
    const monthsSet = new Set(filteredTxns.map(t => t.txMonth));
    const actualMonths = monthsSet.size || 1;

    // Aggregate with proper debt handling
    const categories = aggregateSpendingByCategory(
      filteredTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      actualMonths
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
