import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildIncomeSummary } from "@/lib/incomeSummary";
import { computeBucketBreakdown, compute3MonthTrend, getMonthsForWindow as getBucketMonths, type TimeWindow } from "@/lib/bucketBreakdown";
import { computeWindowSavings } from "@/lib/savingsCalculations";
import { formatMonthYear } from "@/lib/dateFormatting";
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
    
    // Load income deposit reviews
    const incomeReviewsSnap = await db
      .collection(`users/${decoded.uid}/reviews`)
      .where("type", "==", "income_deposit")
      .get();
    const incomeDepositReviews = new Map<string, string>();
    incomeReviewsSnap.docs.forEach(doc => {
      incomeDepositReviews.set(doc.id, doc.get("classification"));
    });

    // Income drawer data
    if (bucket === "income") {
      // Build income summary using unified data layer with income deposit reviews
      const summary = buildIncomeSummary(
        profile.incomeTxns,
        profile.accountSnapshots,
        profile.homeCurrency,
        incomeDepositReviews
      );
      
      // Map to drawer data format
      const now = new Date();
      const allMonths: string[] = [];
      
      for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        allMonths.push(ym);
      }
      
      // Get window months based on drawer window parameter
      let windowMonths: string[];
      if (window === "last3") {
        windowMonths = summary.last3Months;
      } else if (window === "ytd") {
        const ytdMonths = summary.monthlyHistory
          .filter(m => m.yearMonth >= `${currentYear}-01` && m.yearMonth < summary.currentMonth)
          .map(m => m.yearMonth);
        windowMonths = ytdMonths;
      } else { // 12month
        const complete = summary.monthlyHistory.filter(m => m.yearMonth < summary.currentMonth);
        windowMonths = complete.slice(-12).map(m => m.yearMonth);
      }
      
      const last12Months = allMonths.map(ym => {
        const monthData = summary.monthlyHistory.find(m => m.yearMonth === ym);
        const hasData = monthData !== undefined;
        const isCurrent = ym === summary.currentMonth;
        
        return {
          month: ym,
          regularIncome: monthData?.regular || 0,
          oneOffIncome: monthData?.oneOff || 0,
          isInWindow: windowMonths.includes(ym),
          isCurrentMonth: isCurrent,
          hasData: hasData && (monthData?.total || 0) > 0,
        };
      });
      
      // Build metrics compatible with existing drawer format
      const windowTotal = windowMonths.reduce((sum, ym) => {
        const monthData = summary.monthlyHistory.find(m => m.yearMonth === ym);
        return sum + (monthData?.regular || 0);
      }, 0);
      
      const metrics = {
        averageMonthly: summary.typicalMonthly,
        currentMonthly: summary.typicalMonthly,
        monthsTracked: windowMonths.length,
        currentMonthsTracked: windowMonths.length,
        currentBasisLabel: `last ${windowMonths.length} months`,
        currentDiffersFromAverage: false,
        windowAmount: Math.round(windowTotal / windowMonths.length),
        windowLabel: window === "last3" ? "last 3 months" : window === "ytd" ? "year-to-date" : "12-month avg",
        windowMonths,
        regularSources: summary.regularSources.map(s => ({ 
          source: s.description, 
          category: s.category, 
          amount: s.monthlyEquivalent 
        })),
        oneOffSources: summary.oneOffSources.map(s => ({ 
          source: s.description, 
          category: s.category, 
          amount: s.total, 
          isOneOff: true 
        })),
        ytdTotal: 0,
        ytdRegular: 0,
        ytdOneOff: 0,
        projectedFullYear: 0,
      };

      const response: IncomeDrawerData = {
        type: "income",
        window,
        metrics,
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
      
      // Load savings confirmations
      const savingsReviewsSnap = await db
        .collection(`users/${decoded.uid}/reviews`)
        .where("type", "==", "savings_item")
        .get();
      
      const confirmedItems = new Map<string, boolean>();
      savingsReviewsSnap.docs.forEach(doc => {
        const classification = doc.get("classification");
        // "is_savings" → true (count it), anything else → false (exclude it)
        confirmedItems.set(doc.id, classification === "is_savings");
      });
      
      // Compute window savings with per-month reconciliation
      const windowSavings = computeWindowSavings(
        profile.monthlyHistory,
        profile.accountBalanceHistory,
        profile.expenseTxns,
        completeMonths,
        confirmedItems
      );
      
      const response: SavingsDrawerData = {
        type: "savings",
        window,
        windowSavings,
        homeCurrency: profile.homeCurrency,
        basisLabel: completeMonths.length > 0
          ? `Monthly average, ${formatMonthYear(completeMonths[0]).split(' ')[0]}–${formatMonthYear(completeMonths[completeMonths.length - 1])}`
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
        ? `Monthly average, ${formatMonthYear(months[0]).split(' ')[0]}–${formatMonthYear(months[months.length - 1])}` 
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
