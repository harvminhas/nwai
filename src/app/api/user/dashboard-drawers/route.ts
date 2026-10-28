import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { loadUserReviewContext } from "@/lib/userReviewContext";
import { buildIncomeSummary } from "@/lib/incomeSummary";
import { computeBucketBreakdown, compute3MonthTrend, getMonthsForWindow as getBucketMonths, type TimeWindow } from "@/lib/bucketBreakdown";
import { computeWindowSavings } from "@/lib/savingsCalculations";
import { formatMonthYear } from "@/lib/dateFormatting";
import type { MoneyCoachBucket } from "@/lib/moneyCoachBuckets";
import type { IncomeDrawerData, BucketDrawerData, SavingsDrawerData, DrawerErrorResponse } from "@/lib/drawerTypes";

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

    // Load all user review context (income, debt, savings)
    const reviewContext = await loadUserReviewContext(decoded.uid, db);

    // Income drawer data
    if (bucket === "income") {
      // Build income summary using unified data layer with income deposit reviews
      const summary = buildIncomeSummary(
        profile.incomeTxns,
        profile.accountSnapshots,
        profile.homeCurrency,
        reviewContext.incomeDepositReviews
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
          regularIncome: monthData?.total || 0, // Use total (regular + bonus) not just regular
          oneOffIncome: monthData?.bonus || 0,  // Track bonus separately for reference
          isInWindow: windowMonths.includes(ym),
          isCurrentMonth: isCurrent,
          hasData: hasData && (monthData?.total || 0) > 0,
        };
      });
      
      // Build metrics compatible with existing drawer format
      const windowTotal = windowMonths.reduce((sum, ym) => {
        const monthData = summary.monthlyHistory.find(m => m.yearMonth === ym);
        return sum + (monthData?.total || 0); // Use total (regular + bonus + pending, excluding 'not_income')
      }, 0);
      
      // Build transaction-level source groups for the selected window
      // Include ALL counted income (bonus included), exclude 'not_income' and transfers
      const bonusTxnIds = new Set(summary.bonusTransactions.map(t => 
        `${t.date}:${t.source}:${t.amount}:${t.accountSlug || 'unknown'}`
      ));
      const unreviewedTxnIds = new Set(summary.unreviewedDeposits.map(d => d.txId));
      
      // Filter transactions to window months
      const windowTxns = profile.incomeTxns.filter(t => {
        const txMonth = t.date.substring(0, 7); // "YYYY-MM"
        return windowMonths.includes(txMonth);
      });
      
      // Group by source
      const sourceGroups = new Map<string, { 
        source: string; 
        total: number; 
        transactions: Array<{
          date: string;
          amount: number;
          accountSlug: string;
          isBonus: boolean;
          needsReview: boolean;
        }>
      }>();
      
      for (const txn of windowTxns) {
        const txId = `${txn.date}:${txn.source}:${txn.amount}:${txn.accountSlug || 'unknown'}`;
        const isBonus = bonusTxnIds.has(txId);
        const needsReview = unreviewedTxnIds.has(txId);
        
        // Check if this transaction is classified as 'not_income'
        const classification = reviewContext.incomeDepositReviews.get(txId);
        if (classification === 'not_income') continue;
        
        // Find source info to check if it's a transfer
        const sourceInfo = [...summary.regularSources, ...summary.oneOffSources]
          .find(s => s.transactions.some(st => st.source === txn.source));
        
        // Skip transfers (both marked sources and transfer patterns)
        if (sourceInfo?.isTransfer) continue;
        // Also skip if source name matches transfer pattern (TFR-TO, SEND E-TFR, etc.)
        if (/\bTFR[-\s]?(TO|FR|FROM)\b|\bE[-\s]?TFR\b|\bETFR\b|\bXFER\b|\bTRANSFER\b/i.test(txn.source)) continue;
        
        if (!sourceGroups.has(txn.source)) {
          sourceGroups.set(txn.source, {
            source: txn.source,
            total: 0,
            transactions: []
          });
        }
        
        const group = sourceGroups.get(txn.source)!;
        group.total += txn.amount;
        group.transactions.push({
          date: txn.date,
          amount: txn.amount,
          accountSlug: txn.accountSlug || 'unknown',
          isBonus,
          needsReview
        });
      }
      
      // Convert to array and sort by total amount descending
      const sourcesList = Array.from(sourceGroups.values())
        .sort((a, b) => b.total - a.total);
      
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
        sourcesList, // New: transaction-level source groups for the window
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
      
      // Compute window savings with per-month reconciliation (using shared review context)
      const windowSavings = computeWindowSavings(
        profile.monthlyHistory,
        profile.accountBalanceHistory,
        profile.expenseTxns,
        completeMonths,
        reviewContext.savingsConfirmedItems
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
      reviewContext.debtPaymentReviews,
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
      reviewContext.debtPaymentReviews,
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
