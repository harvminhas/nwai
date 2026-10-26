import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { computeDetailedIncomeMetrics, getMonthsForWindow, type IncomeTimeWindow } from "@/lib/incomeMetrics";
import { computeBucketBreakdown, compute3MonthTrend, getMonthsForWindow as getBucketMonths, type TimeWindow } from "@/lib/bucketBreakdown";
import { computeMonthlySavings, computeAverageSavings } from "@/lib/savingsCalculations";
import type { MoneyCoachBucket } from "@/lib/moneyCoachBuckets";
import type { IncomeDrawerData, BucketDrawerData, SavingsDrawerData, DrawerErrorResponse } from "@/lib/drawerTypes";
import type { DebtPaymentReview } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/dashboard-drawers?window=last3&bucket=fixed
 * Returns detailed drawer data for income or a specific bucket.
 */
export async function GET(req: NextRequest): Promise<NextResponse<IncomeDrawerData | BucketDrawerData | SavingsDrawerData | DrawerErrorResponse>> {
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

    // Load user debt payment reviews
    const reviewsSnap = await db.collection(`users/${decoded.uid}/debtPaymentReviews`).get();
    const userReviews: DebtPaymentReview[] = reviewsSnap.docs.map((doc) => ({
      txFingerprint: doc.id,
      accountSlug: doc.get("accountSlug"),
      classification: doc.get("classification"),
      date: doc.get("date"),
      amount: doc.get("amount"),
      reviewedAt: doc.get("reviewedAt"),
    }));

    // Income drawer data
    if (bucket === "income") {
      const incomeWindow = window as IncomeTimeWindow;
      
      // Get current year-month to exclude from historical calculations
      const now = new Date();
      const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      
      const detailedMetrics = computeDetailedIncomeMetrics(
        profile.monthlyHistory,
        profile.incomeTxns,
        incomeWindow,
        currentYear,
        true, // core only
        currentYearMonth // exclude current month from last3/12month
      );

      // Get 12-month history for chart
      // Generate all 12 calendar months, newest first, including missing months
      const allMonths: string[] = [];
      
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        allMonths.push(ym);
      }
      
      // Create a map of actual data
      const incomeByMonth = new Map(
        profile.monthlyHistory.map(h => [h.yearMonth, h.incomeTotal])
      );
      
      const last12Months = allMonths.map(ym => {
        const hasData = incomeByMonth.has(ym);
        const income = incomeByMonth.get(ym) || 0;
        const isCurrent = ym === currentYearMonth;
        
        return {
          month: ym,
          regularIncome: income,
          oneOffIncome: 0, // TODO: detect one-offs from transactions
          isInWindow: detailedMetrics.windowMonths.includes(ym),
          isCurrentMonth: isCurrent,
          hasData: hasData && income > 0,
        };
      });

      const response: IncomeDrawerData = {
        type: "income",
        window,
        metrics: detailedMetrics,
        chartData: last12Months,
        homeCurrency: profile.homeCurrency,
      };

      return NextResponse.json(response);
    }

    // Savings drawer data (special handling with NET balance approach)
    if (bucket === "savings") {
      // Get complete months for the window (exclude current incomplete month)
      const now = new Date();
      const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      
      let completeMonths: string[];
      
      if (window === "last3") {
        completeMonths = profile.monthlyHistory
          .filter(h => h.yearMonth < currentMonth)
          .slice(-3)
          .map(h => h.yearMonth);
      } else if (window === "12month") {
        completeMonths = profile.monthlyHistory
          .filter(h => h.yearMonth < currentMonth)
          .slice(-12)
          .map(h => h.yearMonth);
      } else { // ytd
        completeMonths = profile.monthlyHistory
          .filter(h => 
            h.yearMonth.startsWith(String(currentYear)) && 
            h.yearMonth < currentMonth
          )
          .map(h => h.yearMonth);
      }
      
      if (completeMonths.length === 0) {
        return NextResponse.json({ error: "No complete months available for selected window" }, { status: 404 });
      }
      
      // Compute savings for each month
      const monthlyResults = completeMonths.map(month => {
        const result = computeMonthlySavings(
          profile.monthlyHistory,
          profile.accountBalanceHistory,
          profile.expenseTxns,
          month
        );
        return {
          month,
          total: result.total,
          netCashChange: result.netCashChange,
          netDebtChange: result.netDebtChange,
          contributionsToOutside: result.contributionsToOutside,
          isInWindow: true,
        };
      });
      
      // Compute average savings for the period
      const avgSavings = computeAverageSavings(
        profile.monthlyHistory,
        profile.accountBalanceHistory,
        profile.expenseTxns,
        completeMonths
      );
      
      // Get detailed breakdown for the entire period (aggregate all accounts)
      const lastMonthResult = monthlyResults[monthlyResults.length - 1];
      const lastMonthFull = computeMonthlySavings(
        profile.monthlyHistory,
        profile.accountBalanceHistory,
        profile.expenseTxns,
        lastMonthResult.month
      );
      
      const response: SavingsDrawerData = {
        type: "savings",
        window,
        monthlyBreakdown: monthlyResults,
        periodBreakdown: lastMonthFull.details,
        monthlyAverage: avgSavings,
        needsConfirmation: lastMonthFull.needsConfirmation,
        homeCurrency: profile.homeCurrency,
        basisLabel: completeMonths.length > 0
          ? `Monthly average, ${completeMonths[0]} to ${completeMonths[completeMonths.length - 1]}`
          : "No data",
      };
      
      return NextResponse.json(response);
    }

    // Bucket drawer data (for non-savings buckets)
    const months = getBucketMonths(profile.monthlyHistory, window, currentYear);
    
    if (months.length === 0) {
      return NextResponse.json({ error: "No data available for selected time window" }, { status: 404 });
    }

    const breakdown = computeBucketBreakdown(
      bucket,
      profile.expenseTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      months,
      profile.homeCurrency,
      userReviews,
      profile.fxRates ?? {},
      profile.merchantCadence,
      profile.confirmedSubscriptions
    );

    const trend = compute3MonthTrend(
      bucket,
      profile.expenseTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      profile.monthlyHistory,
      profile.homeCurrency,
      userReviews,
      profile.fxRates ?? {},
      profile.merchantCadence,
      profile.confirmedSubscriptions
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
