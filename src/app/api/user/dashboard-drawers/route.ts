import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { computeDetailedIncomeMetrics, getMonthsForWindow, type IncomeTimeWindow } from "@/lib/incomeMetrics";
import { computeBucketBreakdown, compute3MonthTrend, getMonthsForWindow as getBucketMonths, type TimeWindow } from "@/lib/bucketBreakdown";
import type { MoneyCoachBucket } from "@/lib/moneyCoachBuckets";
import type { IncomeDrawerData, BucketDrawerData, DrawerErrorResponse } from "@/lib/drawerTypes";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/dashboard-drawers?window=last3&bucket=fixed
 * Returns detailed drawer data for income or a specific bucket.
 */
export async function GET(req: NextRequest): Promise<NextResponse<IncomeDrawerData | BucketDrawerData | DrawerErrorResponse>> {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const { searchParams } = new URL(req.url);
    const window = (searchParams.get("window") as TimeWindow) || "last3";
    const bucket = searchParams.get("bucket") as MoneyCoachBucket | "income" | null;

    if (!bucket) {
      return NextResponse.json({ error: "Missing bucket parameter" }, { status: 400 });
    }

    const profile = await getFinancialProfile(decoded.uid, db);
    const currentYear = new Date().getFullYear();

    // Income drawer data
    if (bucket === "income") {
      const incomeWindow = window as IncomeTimeWindow;
      const detailedMetrics = computeDetailedIncomeMetrics(
        profile.monthlyHistory,
        profile.incomeTxns,
        incomeWindow,
        currentYear,
        true // core only
      );

      // Get 12-month history for chart
      const last12Months = profile.monthlyHistory
        .filter(h => h.incomeTotal > 0)
        .slice(-12)
        .map(h => ({
          month: h.yearMonth,
          regularIncome: h.incomeTotal,
          oneOffIncome: 0, // TODO: detect one-offs from transactions
          isInWindow: detailedMetrics.windowMonths.includes(h.yearMonth),
          isCurrentMonth: h.yearMonth === new Date().toISOString().slice(0, 7),
        }));

      const response: IncomeDrawerData = {
        type: "income",
        window,
        metrics: detailedMetrics,
        chartData: last12Months,
        homeCurrency: profile.homeCurrency,
      };

      return NextResponse.json(response);
    }

    // Bucket drawer data
    const months = getBucketMonths(profile.monthlyHistory, window, currentYear);
    
    if (months.length === 0) {
      return NextResponse.json({ error: "No data available for selected time window" }, { status: 404 });
    }

    const breakdown = computeBucketBreakdown(
      bucket,
      profile.expenseTxns,
      profile.accountSnapshots,
      months,
      profile.homeCurrency
    );

    const trend = compute3MonthTrend(
      bucket,
      profile.expenseTxns,
      profile.accountSnapshots,
      profile.monthlyHistory
    );

    const response: BucketDrawerData = {
      type: "bucket",
      bucket,
      window,
      breakdown,
      trend,
      homeCurrency: profile.homeCurrency,
      basisLabel: months.length > 0 
        ? `Monthly average, ${months[0]} to ${months[months.length - 1]}` 
        : "No data",
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Dashboard drawers error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load drawer data" },
      { status: 500 }
    );
  }
}
