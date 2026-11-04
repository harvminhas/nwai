/**
 * GET /api/user/spending/drilldown?level=all|category|merchant&category=&merchant=
 * Returns 12-month drill-down data for spending page.
 * 
 * Uses shared spending data layer to ensure figures match dashboard/spending pages.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { resolveWindowMonths } from "@/lib/rangeUtils";
import { buildSpendingSummary } from "@/lib/spendingSummary";
import { getParentCategory } from "@/lib/categoryTaxonomy";
import { merchantSlug } from "@/lib/applyRules";
import { resolveMerchantAlias, resolveCanonicalMerchantSlug } from "@/lib/merchantUtils";
import { isCoreExcluded } from "@/lib/spendingMetrics";
import { computeScheduledDebtPayments } from "@/lib/debtPayments";
import { classifyDebtAccount } from "@/lib/debtPaymentKinds";
import type { DebtPaymentReview } from "@/lib/types";

export const dynamic = "force-dynamic";

// Helper to format currency amounts
function formatCurrency(amount: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency.toUpperCase(),
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(amount);
}

interface MonthlySeries {
  yearMonth: string;
  amount: number;
}

interface RankedItem {
  name: string;
  slug: string;
  total: number;
  share: number;
  trend: number;
  monthlySeries: MonthlySeries[];
  subLabel?: string;
  extras?: Array<{ yearMonth: string; amount: number }>;
  kind?: "loan" | "card";
}

interface CadenceStats {
  dayOfWeek?: { day: string; count: number; amount: number }[];
  sentence?: string;
}

interface AccountBreakdown {
  label: string;
  slug: string;
  total: number;
  share: number;
  count: number;
}

interface DebtExcluded {
  inactiveAccounts: number;
}

interface DebtGroup {
  key: string;
  label: string;
  counted: boolean;
  total: number;
  subLabel: string;
  items: RankedItem[];
}

interface DrilldownResponse {
  level: "all" | "category" | "merchant";
  breadcrumb: { label: string; href?: string }[];
  total: number;
  avgPerMonth: number;
  monthlySeries: MonthlySeries[];
  comparisonSeries?: MonthlySeries[];
  rankedItems: RankedItem[];
  cadence?: CadenceStats;
  accounts?: AccountBreakdown[];
  otherCategoriesTotal?: number;
  kind?: "debt";
  basis?: "actual";
  currency: string;
  excluded?: DebtExcluded;
  groups?: DebtGroup[];
  oneOffTotal?: number;
  oneOffLabel?: string;
}

// Helper to compute actual debt payments split by loan/card/oneOff
// Used at level=all (to override Debt row), level=category (Debt header), and level=merchant (account detail)
function computeActualDebtPayments(
  debtPaymentHistory: Array<{ accountSlug: string; statementMonth: string; paymentsMade: number; currency: string }>,
  accountSnapshots: Array<{ slug: string; accountName?: string; accountType: string }>,
  windowMonths: string[],
  fxRates: Record<string, number>,
  homeCurrency: string
): {
  loanTotal: number;
  cardRegularTotal: number;
  oneOffTotal: number;
  loanMonthlySeries: MonthlySeries[];
  cardMonthlySeries: MonthlySeries[];
  oneOffMonthlySeries: MonthlySeries[];
  accounts: Array<{
    accountSlug: string;
    accountName?: string;
    kind: "loan" | "card";
    regularTotal: number;
    regularMonthlySeries: MonthlySeries[];
    paymentCount: number;
    extras: Array<{ yearMonth: string; amount: number }>;
  }>;
} {
  const home = homeCurrency.toUpperCase();
  const toHome = (amount: number, currency?: string): number => {
    const cur = (currency ?? home).toUpperCase();
    if (cur === home) return amount;
    const rate = fxRates[cur];
    return rate ? amount * rate : amount;
  };

  // Group by account
  const accountMap = new Map<string, {
    accountName?: string;
    accountType?: string;
    payments: Array<{ yearMonth: string; amount: number }>;
  }>();

  debtPaymentHistory
    .filter(entry => windowMonths.includes(entry.statementMonth))
    .forEach(entry => {
      const amount = toHome(entry.paymentsMade, entry.currency);
      if (amount === 0) return; // Skip zero payments

      if (!accountMap.has(entry.accountSlug)) {
        const account = accountSnapshots.find(a => a.slug === entry.accountSlug);
        accountMap.set(entry.accountSlug, {
          accountName: account?.accountName,
          accountType: account?.accountType,
          payments: [],
        });
      }

      accountMap.get(entry.accountSlug)!.payments.push({
        yearMonth: entry.statementMonth,
        amount,
      });
    });

  // Build per-account regular/extra splits
  const accounts = Array.from(accountMap.entries()).map(([slug, data]) => {
    const kind: "loan" | "card" = data.accountType 
      ? classifyDebtAccount(data.accountType)
      : "loan"; // Default to loan if account not found (safer)

    // Compute regular amount: median of positive payments
    const positiveAmounts = data.payments.map(p => p.amount).filter(a => a > 0).sort((a, b) => a - b);
    const regularAmount = positiveAmounts.length > 0
      ? (positiveAmounts.length % 2 === 0
          ? (positiveAmounts[positiveAmounts.length / 2 - 1] + positiveAmounts[positiveAmounts.length / 2]) / 2
          : positiveAmounts[Math.floor(positiveAmounts.length / 2)])
      : 0;

    // Split each month: regular (up to regularAmount), extra (above that)
    // If < 3 months of history, treat all as regular
    const hasEnoughHistory = data.payments.length >= 3;
    const extras: Array<{ yearMonth: string; amount: number }> = [];

    const regularMonthlySeries: MonthlySeries[] = windowMonths.map(ym => {
      const payment = data.payments.find(p => p.yearMonth === ym);
      if (!payment) return { yearMonth: ym, amount: 0 };

      const monthAmount = payment.amount;
      const regularContribution = hasEnoughHistory && regularAmount > 0
        ? Math.min(monthAmount, regularAmount)
        : monthAmount;
      const extraContribution = monthAmount - regularContribution;

      if (extraContribution > 0) {
        extras.push({ yearMonth: ym, amount: extraContribution });
      }

      return { yearMonth: ym, amount: regularContribution };
    });

    const regularTotal = regularMonthlySeries.reduce((sum, m) => sum + m.amount, 0);

    return {
      accountSlug: slug,
      accountName: data.accountName,
      kind,
      regularTotal,
      regularMonthlySeries,
      paymentCount: data.payments.length,
      extras,
    };
  });

  // Aggregate by kind
  const loanAccounts = accounts.filter(a => a.kind === "loan");
  const cardAccounts = accounts.filter(a => a.kind === "card");

  const loanTotal = loanAccounts.reduce((sum, acc) => sum + acc.regularTotal, 0);
  const cardRegularTotal = cardAccounts.reduce((sum, acc) => sum + acc.regularTotal, 0);
  const oneOffTotal = accounts.reduce((sum, acc) => 
    sum + acc.extras.reduce((s, e) => s + e.amount, 0), 0);

  const loanMonthlySeries: MonthlySeries[] = windowMonths.map((ym, idx) => ({
    yearMonth: ym,
    amount: loanAccounts.reduce((sum, acc) => sum + acc.regularMonthlySeries[idx].amount, 0),
  }));

  const cardMonthlySeries: MonthlySeries[] = windowMonths.map((ym, idx) => ({
    yearMonth: ym,
    amount: cardAccounts.reduce((sum, acc) => sum + acc.regularMonthlySeries[idx].amount, 0),
  }));

  const oneOffMonthlySeries: MonthlySeries[] = windowMonths.map(ym => {
    const total = accounts.reduce((sum, acc) => {
      const extra = acc.extras.find(e => e.yearMonth === ym);
      return sum + (extra?.amount || 0);
    }, 0);
    return { yearMonth: ym, amount: total };
  });

  // Invariants: loanTotal === sum(loan accounts' regularTotal), each regularTotal === sum(regularMonthlySeries)
  return {
    loanTotal,
    cardRegularTotal,
    oneOffTotal,
    loanMonthlySeries,
    cardMonthlySeries,
    oneOffMonthlySeries,
    accounts,
  };
}

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const level = url.searchParams.get("level") || "all";
  const categoryParam = url.searchParams.get("category") || "";
  const merchantParam = url.searchParams.get("merchant") || "";
  const searchQuery = url.searchParams.get("q") || "";

  if (!["all", "category", "merchant", "search"].includes(level)) {
    return NextResponse.json({ error: "Invalid level" }, { status: 400 });
  }

  try {
    const profile = await getFinancialProfile(access.targetUid, db);
    
    // Build account status map exactly as spending-summary does
    const accountStatusMap = new Map(
      profile.accountStatusRecords.map(r => [r.accountSlug, { status: r.status, statusDate: r.statusDate }])
    );
    
    // Get 12 complete months using proper completeness rules
    const windowResult = resolveWindowMonths(
      "12mo",
      profile.monthlyHistory,
      profile.statementHistory,
      accountStatusMap
    );
    
    const windowMonths = windowResult.months;
    
    if (windowMonths.length === 0) {
      return NextResponse.json({
        level,
        breadcrumb: [{ label: "All spending" }],
        total: 0,
        avgPerMonth: 0,
        monthlySeries: [],
        rankedItems: [],
        currency: profile.homeCurrency,
      });
    }

    // Load user debt payment reviews
    const reviewsSnap = await db.collection(`users/${access.targetUid}/debtPaymentReviews`).get();
    const userReviews: DebtPaymentReview[] = reviewsSnap.docs.map((doc) => ({
      txFingerprint: doc.id,
      accountSlug: doc.get("accountSlug"),
      classification: doc.get("classification"),
      date: doc.get("date"),
      amount: doc.get("amount"),
      reviewedAt: doc.get("reviewedAt"),
    }));

    // Build spending summary using shared function (handles currency conversion, debt payments, etc.)
    const summary = buildSpendingSummary(
      profile.expenseTxns,
      profile.accountSnapshots,
      profile.debtPaymentHistory,
      userReviews,
      profile.fxRates || {},
      profile.homeCurrency,
      windowMonths
    );

    // Build lookup map for monthlyHistory (arrays may not align with windowMonths)
    const monthByYm = new Map(summary.monthlyHistory.map(m => [m.yearMonth, m]));

    // Compute actual debt payments ONCE for entire request (reused across all levels)
    const actualDebt = computeActualDebtPayments(
      profile.debtPaymentHistory,
      profile.accountSnapshots,
      windowMonths,
      profile.fxRates || {},
      profile.homeCurrency
    );

    // Derive scheduled debt per month from summary (synthetic "Loan payments" category)
    const scheduledDebtPerMonth = windowMonths.map(ym => {
      const monthData = monthByYm.get(ym);
      const loanPaymentsCat = monthData?.categories.find(c => c.category === "Loan payments");
      return loanPaymentsCat?.amount || 0;
    });

    // Build debt-adjusted all-spending series: original - scheduled + loanMonthlySeries only
    // (cards and one-offs never enter All spending — only loan payments count)
    const adjustedAllSeries: MonthlySeries[] = windowMonths.map((ym, idx) => ({
      yearMonth: ym,
      amount: Math.max(0, (monthByYm.get(ym)?.total || 0) - scheduledDebtPerMonth[idx] + actualDebt.loanMonthlySeries[idx].amount),
    }));

    const adjustedAllTotal = adjustedAllSeries.reduce((sum, m) => sum + m.amount, 0);
    const adjustedAllAvg = adjustedAllTotal / windowMonths.length;

    // Keep original unadjusted series for non-Debt categories' comparison
    const allSpendingMonthlySeries: MonthlySeries[] = windowMonths.map(ym => ({
      yearMonth: ym,
      amount: monthByYm.get(ym)?.total || 0,
    }));

    const allTotal = allSpendingMonthlySeries.reduce((sum, m) => sum + m.amount, 0);
    const allAvg = allTotal / windowMonths.length;

    if (level === "all") {
      // Level 1: All spending → Parent Categories
      // Group by parent category
      const parentCategoryMap = new Map<string, { 
        total: number; 
        monthlySeries: MonthlySeries[];
        childCategories: Set<string>;
      }>();

      summary.categories.forEach(cat => {
        const parent = getParentCategory(cat.category);
        if (!parentCategoryMap.has(parent)) {
          parentCategoryMap.set(parent, {
            total: 0,
            monthlySeries: windowMonths.map(ym => ({ yearMonth: ym, amount: 0 })),
            childCategories: new Set(),
          });
        }
        const parentData = parentCategoryMap.get(parent)!;
        parentData.total += cat.total;
        parentData.childCategories.add(cat.category);

        // Add this category's monthly amounts to parent's series
        windowMonths.forEach((ym, idx) => {
          const month = monthByYm.get(ym);
          const catInMonth = month?.categories.find(c => c.category === cat.category);
          if (catInMonth) {
            parentData.monthlySeries[idx].amount += catInMonth.amount;
          }
        });
      });

      // Rank parent categories
      let rankedItems: RankedItem[] = Array.from(parentCategoryMap.entries())
        .map(([parent, data]) => {
          const catAvg = data.total / windowMonths.length;
          const last3 = data.monthlySeries.slice(-3);
          const last3Avg = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
          const trend = last3Avg - catAvg;

          return {
            name: parent,
            slug: parent.toLowerCase().replace(/\s+/g, "-"),
            total: data.total,
            share: adjustedAllTotal > 0 ? data.total / adjustedAllTotal : 0,
            trend,
            monthlySeries: data.monthlySeries,
          };
        });

      // Override Debt row with loan payments only (so parent equals child header)
      // Use the actualDebt computed once for entire request
      const debtRowIndex = rankedItems.findIndex(item => item.name === "Debt");
      
      const catAvg = actualDebt.loanTotal / windowMonths.length;
      const last3 = actualDebt.loanMonthlySeries.slice(-3);
      const last3Avg = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
      const trend = last3Avg - catAvg;

      const debtRow: RankedItem = {
        name: "Debt",
        slug: "debt",
        total: actualDebt.loanTotal, // Loan payments only (matches Debt category header)
        share: adjustedAllTotal > 0 ? actualDebt.loanTotal / adjustedAllTotal : 0,
        trend,
        monthlySeries: actualDebt.loanMonthlySeries,
        subLabel: "loans only", // UI will replace trend with this
      };

      // Debt must always stay on the list: card payments and one-offs live inside it
      // even when no loan payment was made in the period, so it has to remain clickable.
      if (debtRowIndex >= 0) {
        rankedItems[debtRowIndex] = debtRow;
      } else {
        rankedItems.push(debtRow);
      }

      // Sort by total after Debt override/insertion
      rankedItems.sort((a, b) => b.total - a.total);

      return NextResponse.json({
        level: "all",
        breadcrumb: [{ label: "All spending" }],
        total: adjustedAllTotal,
        avgPerMonth: adjustedAllAvg,
        monthlySeries: adjustedAllSeries,
        rankedItems,
        currency: profile.homeCurrency,
      });
    } else if (level === "category") {
      // Level 2: Category → Merchants
      // Find all child categories that belong to this parent
      const parentCategory = categoryParam;
      const childCategories = summary.categories
        .filter(cat => getParentCategory(cat.category) === parentCategory)
        .map(cat => cat.category);

      // Debt comes from payment history, not the summary's scheduled "Loan payments" row,
      // so it must still open when every card is paid in full.
      if (childCategories.length === 0 && parentCategory !== "Debt") {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }

      // Build category monthly series (sum of all child categories)
      // Note: Debt is handled separately above and returns early, so this never runs for Debt
      const categoryMonthlySeries: MonthlySeries[] = windowMonths.map(ym => {
        const monthData = monthByYm.get(ym);
        const monthTotal = childCategories.reduce((sum, childCat) => {
          const catInMonth = monthData?.categories.find(c => c.category === childCat);
          return sum + (catInMonth?.amount || 0);
        }, 0);
        return { yearMonth: ym, amount: monthTotal };
      });

      const categoryTotal = categoryMonthlySeries.reduce((sum, m) => sum + m.amount, 0);
      const categoryAvg = categoryTotal / windowMonths.length;

      // Special handling for Debt category (loan/card/oneOff split)
      if (parentCategory === "Debt") {
        // Use actualDebt computed once for entire request
        
        // Build loan account rows
        const loanAccounts = actualDebt.accounts.filter(a => a.kind === "loan");
        const loanItems: RankedItem[] = loanAccounts.map(account => {
          const total = account.regularTotal;
          const avg = total / windowMonths.length;
          const last3 = account.regularMonthlySeries.slice(-3);
          const last3Avg = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
          const trend = last3Avg - avg;

          // SubLabel: regular amount per month plus payment count
          const regularPerMonth = total / windowMonths.length;
          const subLabel = `usual payment - ${formatCurrency(regularPerMonth, profile.homeCurrency)}/mo - ${account.paymentCount} payment${account.paymentCount !== 1 ? 's' : ''}`;

          return {
            name: account.accountName || account.accountSlug,
            slug: account.accountSlug,
            subLabel,
            total,
            share: actualDebt.loanTotal > 0 ? total / actualDebt.loanTotal : 0,
            trend,
            monthlySeries: account.regularMonthlySeries,
            extras: account.extras,
            kind: "loan" as const,
          };
        }).sort((a, b) => b.total - a.total);

        // Build card account rows
        const cardAccounts = actualDebt.accounts.filter(a => a.kind === "card");
        const cardItems: RankedItem[] = cardAccounts.map(account => {
          const total = account.regularTotal;
          const avg = total / windowMonths.length;
          const last3 = account.regularMonthlySeries.slice(-3);
          const last3Avg = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
          const trend = last3Avg - avg;

          const regularPerMonth = total / windowMonths.length;
          const subLabel = `estimated from ${account.paymentCount} payment${account.paymentCount !== 1 ? 's' : ''} - ${formatCurrency(regularPerMonth, profile.homeCurrency)}/mo`;

          return {
            name: account.accountName || account.accountSlug,
            slug: account.accountSlug,
            subLabel,
            total,
            share: actualDebt.cardRegularTotal > 0 ? total / actualDebt.cardRegularTotal : 0,
            trend,
            monthlySeries: account.regularMonthlySeries,
            extras: account.extras,
            kind: "card" as const,
          };
        }).sort((a, b) => b.total - a.total);

        // Build groups
        const groups: DebtGroup[] = [
          {
            key: "loans",
            label: "Loan payments",
            counted: true,
            total: actualDebt.loanTotal,
            subLabel: "counted in spending",
            items: loanItems,
          },
          {
            key: "cards",
            label: "Card payments",
            counted: false,
            total: actualDebt.cardRegularTotal,
            subLabel: "estimated payments, not counted - purchases already spent",
            items: cardItems,
          },
        ];

        // Count inactive accounts
        const debtTypes = ["credit", "credit_card", "mortgage", "loan", "auto_loan", "student_loan", "personal_loan", "line_of_credit"];
        const activeAccounts = new Set(actualDebt.accounts.map(a => a.accountSlug));
        const inactiveAccounts = profile.accountSnapshots.filter(acc => {
          if (!debtTypes.includes(acc.accountType)) return false;
          if (acc.balance !== 0) return false;
          if (activeAccounts.has(acc.slug)) return false;
          return true;
        }).length;

        const excluded: DebtExcluded | undefined = inactiveAccounts > 0
          ? { inactiveAccounts }
          : undefined;

        return NextResponse.json({
          level: "category",
          kind: "debt" as const,
          basis: "actual" as const,
          breadcrumb: [
            { label: "All spending", href: "/account/spending" },
            { label: "Debt" },
          ],
          total: actualDebt.loanTotal, // Loan payments only (counted in spending)
          avgPerMonth: actualDebt.loanTotal / windowMonths.length,
          monthlySeries: actualDebt.loanMonthlySeries,
          comparisonSeries: adjustedAllSeries, // Same basis as All spending (loans counted, cards not)
          rankedItems: [], // Not used when groups present
          groups,
          oneOffTotal: actualDebt.oneOffTotal,
          oneOffLabel: "One-off payments, not counted - already in spending",
          excluded,
          currency: profile.homeCurrency,
        });
      }

      // Build merchant map from profile.expenseTxns, scoped to this parent category
      // This ensures merchant totals add up exactly to category total
      const merchantMap = new Map<string, {
        name: string;
        canonicalSlug: string;
        total: number;
        monthlySeries: MonthlySeries[];
        transactions: Array<{ date: string; merchant: string; category: string; amount: number; accountLabel?: string }>;
      }>();

      // Filter to window months and this parent category only
      const scopedTxns = profile.expenseTxns.filter(t => {
        if (!windowMonths.includes(t.txMonth)) return false;
        if (isCoreExcluded(t.category)) return false;
        if (getParentCategory(t.category) === "Debt") return false; // Skip synthetic debt
        return getParentCategory(t.category) === parentCategory;
      });

      // Group by canonical merchant slug
      for (const txn of scopedTxns) {
        const slug = merchantSlug(txn.merchant);
        const canonicalSlug = resolveCanonicalMerchantSlug(slug);
        const canonicalName = resolveMerchantAlias(slug, txn.merchant);

        if (!merchantMap.has(canonicalSlug)) {
          merchantMap.set(canonicalSlug, {
            name: canonicalName,
            canonicalSlug,
            total: 0,
            monthlySeries: windowMonths.map(ym => ({ yearMonth: ym, amount: 0 })),
            transactions: [],
          });
        }

        const merchData = merchantMap.get(canonicalSlug)!;
        const absAmount = Math.abs(txn.amount);
        merchData.total += absAmount;
        merchData.transactions.push({
          date: txn.date,
          merchant: canonicalName,
          category: txn.category,
          amount: absAmount,
          accountLabel: txn.accountLabel,
        });

        // Add to monthly series
        const monthIdx = windowMonths.indexOf(txn.txMonth);
        if (monthIdx >= 0) {
          merchData.monthlySeries[monthIdx].amount += absAmount;
        }
      }

      // Rank merchants
      const rankedItems: RankedItem[] = Array.from(merchantMap.values())
        .map(data => {
          const merchAvg = data.total / windowMonths.length;
          const last3 = data.monthlySeries.slice(-3);
          const last3Avg = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
          const trend = last3Avg - merchAvg;

          return {
            name: data.name,
            slug: data.canonicalSlug,
            total: data.total,
            share: categoryTotal > 0 ? data.total / categoryTotal : 0,
            trend,
            monthlySeries: data.monthlySeries,
          };
        })
        .sort((a, b) => b.total - a.total);

      // Verify invariant: sum(merchant rows) === category header total
      const merchantsTotal = rankedItems.reduce((sum, item) => sum + item.total, 0);

      // Check if merchants add up to category total (should be exact now)
      const remainder = categoryTotal - merchantsTotal;
      if (Math.abs(remainder) > 1) {
        // Add "Other" row for remainder with proper monthly distribution
        const otherMonthlySeries: MonthlySeries[] = windowMonths.map((ym, idx) => {
          const categoryAmount = categoryMonthlySeries[idx].amount;
          const knownMerchantsAmount = rankedItems.reduce((sum, item) => {
            return sum + (item.monthlySeries[idx]?.amount || 0);
          }, 0);
          return {
            yearMonth: ym,
            amount: Math.max(0, categoryAmount - knownMerchantsAmount),
          };
        });

        rankedItems.push({
          name: "Other",
          slug: "other",
          total: remainder,
          share: categoryTotal > 0 ? remainder / categoryTotal : 0,
          trend: 0,
          monthlySeries: otherMonthlySeries,
        });
      }

      // Cadence stats and account breakdown
      const allTxns = Array.from(merchantMap.values()).flatMap(m => m.transactions);
      const cadence = computeCadenceStats(allTxns, parentCategory);
      const accounts = computeAccountsBreakdown(scopedTxns, categoryTotal);

      return NextResponse.json({
        level: "category",
        breadcrumb: [
          { label: "All spending", href: "/account/spending" },
          { label: parentCategory },
        ],
        total: categoryTotal,
        avgPerMonth: categoryAvg,
        monthlySeries: categoryMonthlySeries,
        comparisonSeries: allSpendingMonthlySeries,
        rankedItems,
        cadence,
        accounts,
        currency: profile.homeCurrency,
      });
    } else if (level === "merchant") {
      // Level 3: Merchant → Transactions (scoped to parent category)
      const parentCategory = categoryParam;

      // Special handling for Debt account drill-down (regular + extras)
      if (parentCategory === "Debt") {
        const accountSlug = merchantParam; // It's an account slug, not a merchant
        
        // Find the account in snapshots
        const account = profile.accountSnapshots.find(a => a.slug === accountSlug);
        if (!account) {
          return NextResponse.json({ error: "Account not found" }, { status: 404 });
        }

        // Use actualDebt computed once for entire request
        
        // Find this account in actual payments
        const accountData = actualDebt.accounts.find(a => a.accountSlug === accountSlug);
        if (!accountData) {
          return NextResponse.json({ error: "Account not found in payment history" }, { status: 404 });
        }

        // Header total = regularTotal (same as level 2 row)
        const total = accountData.regularTotal;
        const monthlySeries = accountData.regularMonthlySeries;
        const avgPerMonth = total / windowMonths.length;

        // Build extras map for quick lookup
        const extrasMap = new Map(accountData.extras.map(e => [e.yearMonth, e.amount]));

        // Rows = months with regular payments (extras shown as sub-rows via extras field)
        const rankedItems: RankedItem[] = monthlySeries
          .filter(m => m.amount > 0 || extrasMap.has(m.yearMonth)) // Show month if regular or extra exists
          .map(m => {
            const [year, month] = m.yearMonth.split("-");
            const monthLabel = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString("en-US", { 
              month: "short", 
              year: "numeric" 
            });

            const extra = extrasMap.get(m.yearMonth);
            const subLabel = extra ? `+${formatCurrency(extra, profile.homeCurrency)} extra` : undefined;
            
            return {
              name: monthLabel,
              slug: m.yearMonth,
              subLabel,
              total: m.amount, // Regular only
              share: total > 0 ? m.amount / total : 0,
              trend: 0,
              monthlySeries: [],
              extras: extra ? [{ yearMonth: m.yearMonth, amount: extra }] : undefined,
            };
          })
          .reverse(); // Newest first

        // Comparison series: loan accounts compare to all loans, card accounts to all cards
        const comparisonSeries = accountData.kind === "loan" 
          ? actualDebt.loanMonthlySeries 
          : actualDebt.cardMonthlySeries;

        return NextResponse.json({
          level: "merchant",
          kind: "debt" as const,
          basis: "actual" as const,
          breadcrumb: [
            { label: "All spending", href: "/account/spending" },
            { label: "Debt", href: "/account/spending?category=Debt" },
            { label: account.accountName || accountSlug },
          ],
          total,
          avgPerMonth,
          monthlySeries,
          comparisonSeries,
          rankedItems,
          currency: profile.homeCurrency,
        });
      }

      // Get all transactions for this merchant in window months (all categories)
      const allMerchantTxns = profile.expenseTxns.filter(t => {
        if (!windowMonths.includes(t.txMonth)) return false;
        if (isCoreExcluded(t.category)) return false;
        if (getParentCategory(t.category) === "Debt") return false;
        const slug = merchantSlug(t.merchant);
        const canonicalSlug = resolveCanonicalMerchantSlug(slug);
        return canonicalSlug === merchantParam;
      });

      if (allMerchantTxns.length === 0) {
        return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
      }

      // Scope to parent category
      const scopedTxns = allMerchantTxns.filter(t => 
        getParentCategory(t.category) === parentCategory
      );

      if (scopedTxns.length === 0) {
        return NextResponse.json({ error: "Merchant not found in this category" }, { status: 404 });
      }

      const merchantName = resolveMerchantAlias(merchantSlug(scopedTxns[0].merchant), scopedTxns[0].merchant);

      // Build merchant monthly series (scoped to this parent category)
      const merchantMonthlySeries: MonthlySeries[] = windowMonths.map(ym => {
        const monthTotal = scopedTxns
          .filter(txn => txn.txMonth === ym)
          .reduce((sum, txn) => sum + Math.abs(txn.amount), 0);
        return { yearMonth: ym, amount: monthTotal };
      });

      const merchantTotal = scopedTxns.reduce((sum, t) => sum + Math.abs(t.amount), 0);
      const merchantAvg = merchantTotal / windowMonths.length;

      // Calculate spend in other parent categories
      const otherCategoriesTotal = allMerchantTxns
        .filter(t => getParentCategory(t.category) !== parentCategory)
        .reduce((sum, t) => sum + Math.abs(t.amount), 0);

      // Build category comparison series (same as category level)
      const categoryMonthlySeries: MonthlySeries[] = windowMonths.map(ym => {
        const monthData = monthByYm.get(ym);
        const allChildCats = summary.categories
          .filter(cat => getParentCategory(cat.category) === parentCategory)
          .map(cat => cat.category);
        const monthTotal = allChildCats.reduce((sum, childCat) => {
          const catInMonth = monthData?.categories.find(c => c.category === childCat);
          return sum + (catInMonth?.amount || 0);
        }, 0);
        return { yearMonth: ym, amount: monthTotal };
      });

      // Transaction list (newest first, scoped to this parent category)
      const rankedItems: RankedItem[] = scopedTxns
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map(txn => {
          const absAmount = Math.abs(txn.amount);
          return {
            name: `${new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })} • ${txn.accountLabel || ""}`,
            slug: `${txn.date}-${txn.amount}`,
            total: absAmount,
            share: merchantTotal > 0 ? absAmount / merchantTotal : 0,
            trend: 0,
            monthlySeries: [],
          };
        });

      // Verify invariant: sum(transactions shown) === header total
      const txnSum = rankedItems.reduce((sum, item) => sum + item.total, 0);
      // txnSum should equal merchantTotal

      // Cadence stats and account breakdown
      const cadence = computeCadenceStats(scopedTxns.map(t => ({
        date: t.date,
        merchant: merchantName,
        category: t.category,
        amount: Math.abs(t.amount),
      })), merchantName);
      const accounts = computeAccountsBreakdown(scopedTxns, merchantTotal);

      return NextResponse.json({
        level: "merchant",
        breadcrumb: [
          { label: "All spending", href: "/account/spending" },
          { label: parentCategory, href: `/account/spending?category=${encodeURIComponent(parentCategory)}` },
          { label: merchantName },
        ],
        total: merchantTotal,
        avgPerMonth: merchantAvg,
        monthlySeries: merchantMonthlySeries,
        comparisonSeries: categoryMonthlySeries,
        rankedItems,
        cadence,
        accounts,
        otherCategoriesTotal: otherCategoriesTotal > 0 ? otherCategoriesTotal : undefined,
        currency: profile.homeCurrency,
      });
    } else if (level === "search") {
      // Level 4: Search across all merchants
      const query = searchQuery.trim().toLowerCase();
      
      if (query.length < 2) {
        return NextResponse.json({
          level: "search",
          breadcrumb: [
            { label: "All spending", href: "/account/spending" },
            { label: "Search" },
          ],
          total: 0,
          avgPerMonth: 0,
          monthlySeries: [],
          rankedItems: [],
          currency: profile.homeCurrency,
          query,
        });
      }

      // Build merchant map keyed by category + canonical slug
      // (a merchant can appear in multiple categories, show one row per merchant-in-category)
      const merchantMap = new Map<string, {
        name: string;
        canonicalSlug: string;
        parentCategory: string;
        total: number;
        transactions: Array<{ date: string; merchant: string; category: string; amount: number; accountLabel?: string }>;
      }>();

      // Filter to window months, exclude core-excluded categories and Debt
      const scopedTxns = profile.expenseTxns.filter(t => {
        if (!windowMonths.includes(t.txMonth)) return false;
        if (isCoreExcluded(t.category)) return false;
        const parent = getParentCategory(t.category);
        if (parent === "Debt") return false; // Debt is not searchable
        return true;
      });

      scopedTxns.forEach(t => {
        const parent = getParentCategory(t.category);
        const slug = merchantSlug(t.merchant);
        // Use same canonical resolution as category branch: resolveCanonicalMerchantSlug(merchantSlug(...))
        const canonical = resolveCanonicalMerchantSlug(slug);
        const key = `${parent}::${canonical}`; // Key by category + canonical slug

        if (!merchantMap.has(key)) {
          // Use same display name resolution as category branch
          const displayName = resolveMerchantAlias(slug, t.merchant);
          merchantMap.set(key, {
            name: displayName,
            canonicalSlug: canonical,
            parentCategory: parent,
            total: 0,
            transactions: [],
          });
        }

        const entry = merchantMap.get(key)!;
        entry.total += Math.abs(t.amount);
        entry.transactions.push({
          date: t.date,
          merchant: t.merchant,
          category: t.category,
          amount: Math.abs(t.amount),
          accountLabel: t.accountLabel,
        });
      });

      // Filter merchants by query (case-insensitive substring match on display name or canonical slug)
      const matchedMerchants = Array.from(merchantMap.values()).filter(m => {
        const displayNameLower = m.name.toLowerCase();
        const canonicalLower = m.canonicalSlug.toLowerCase();
        return displayNameLower.includes(query) || canonicalLower.includes(query);
      });

      // Rank by total, then by category (so same merchant in multiple categories shows together)
      const rankedItems: RankedItem[] = matchedMerchants
        .map(m => ({
          name: m.name,
          slug: m.canonicalSlug,
          category: m.parentCategory,
          total: m.total,
          share: 0, // Not meaningful in search context
          trend: 0,
          monthlySeries: [],
          subLabel: `${m.transactions.length} transaction${m.transactions.length !== 1 ? 's' : ''}`,
          txCount: m.transactions.length,
        }))
        .sort((a, b) => {
          // Sort by total desc, then category asc (groups same merchant together)
          if (b.total !== a.total) return b.total - a.total;
          return a.category.localeCompare(b.category);
        });

      const totalMatched = rankedItems.reduce((sum, item) => sum + item.total, 0);

      return NextResponse.json({
        level: "search",
        breadcrumb: [
          { label: "All spending", href: "/account/spending" },
          { label: `Search: "${query}"` },
        ],
        total: totalMatched,
        avgPerMonth: totalMatched / windowMonths.length,
        monthlySeries: [], // No chart for search
        rankedItems,
        currency: profile.homeCurrency,
        query,
      });
    }
  } catch (err) {
    console.error("[drilldown GET]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load drilldown data" },
      { status: 500 }
    );
  }
}

function computeCadenceStats(
  transactions: Array<{ date: string; merchant: string; category: string; amount: number }>,
  label: string
): CadenceStats {
  const dayOfWeekCounts = new Map<string, number>();
  const dayOfWeekAmounts = new Map<string, number>();
  const dayOfMonthCounts = new Map<number, number>();
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  
  for (const txn of transactions) {
    const date = new Date(txn.date);
    const dow = days[date.getDay()];
    const dom = date.getDate();
    const absAmount = Math.abs(txn.amount);
    dayOfWeekCounts.set(dow, (dayOfWeekCounts.get(dow) || 0) + 1);
    dayOfWeekAmounts.set(dow, (dayOfWeekAmounts.get(dow) || 0) + absAmount);
    dayOfMonthCounts.set(dom, (dayOfMonthCounts.get(dom) || 0) + 1);
  }

  const dayOfWeek = days.map(day => ({
    day,
    count: dayOfWeekCounts.get(day) || 0,
    amount: dayOfWeekAmounts.get(day) || 0,
  }));

  // Check for clear patterns only
  const maxDowCount = Math.max(...dayOfWeek.map(d => d.count));
  const topDow = dayOfWeek.find(d => d.count === maxDowCount);
  
  const maxDomCount = Math.max(...Array.from(dayOfMonthCounts.values()), 0);
  const topDom = Array.from(dayOfMonthCounts.entries()).find(([, count]) => count === maxDomCount)?.[0];

  let sentence: string | undefined;
  const avgAmount = transactions.reduce((sum, t) => sum + t.amount, 0) / transactions.length;

  // Day-of-month pattern (≥60% threshold)
  if (topDom && maxDomCount >= transactions.length * 0.6) {
    const suffix = topDom === 1 || topDom === 21 || topDom === 31 ? "st" 
      : topDom === 2 || topDom === 22 ? "nd" 
      : topDom === 3 || topDom === 23 ? "rd" 
      : "th";
    sentence = `Charges on the ${topDom}${suffix} of each month, $${Math.round(avgAmount)}`;
  } 
  // Weekday pattern (≥40% threshold for single day, ≥50% for two days)
  else if (topDow && maxDowCount >= transactions.length * 0.4) {
    sentence = `Usually ${topDow.day}, about $${Math.round(avgAmount)}`;
  } else {
    // Check for two-day pattern
    const sorted = [...dayOfWeek].sort((a, b) => b.count - a.count);
    const top2Count = sorted[0].count + sorted[1].count;
    if (top2Count >= transactions.length * 0.5) {
      sentence = `Most of your ${label} happens on ${sorted[0].day} and ${sorted[1].day}`;
    }
  }

  return { dayOfWeek, sentence };
}

function computeAccountsBreakdown(
  transactions: Array<{ accountLabel?: string; accountSlug?: string; amount: number }>,
  levelTotal: number
): AccountBreakdown[] {
  const accountMap = new Map<string, { label: string; total: number; count: number }>();

  for (const txn of transactions) {
    const slug = txn.accountSlug || "unknown";
    const label = txn.accountLabel || "Unknown Account";
    const absAmount = Math.abs(txn.amount);

    if (!accountMap.has(slug)) {
      accountMap.set(slug, { label, total: 0, count: 0 });
    }

    const acc = accountMap.get(slug)!;
    acc.total += absAmount;
    acc.count += 1;
  }

  return Array.from(accountMap.entries())
    .map(([slug, data]) => ({
      label: data.label,
      slug,
      total: data.total,
      share: levelTotal > 0 ? data.total / levelTotal : 0,
      count: data.count,
    }))
    .sort((a, b) => b.total - a.total);
}
