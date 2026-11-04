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
import type { DebtPaymentReview } from "@/lib/types";

export const dynamic = "force-dynamic";

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
  currency: string;
  actualPaidTotal?: number;
}

// Helper to compute Debt category monthly series (used at both level 2 and level 3)
function computeDebtCategoryMonthlySeries(
  windowMonths: string[],
  monthByYm: Map<string, any>,
  categories: any[]
): MonthlySeries[] {
  const childCategories = categories
    .filter(cat => getParentCategory(cat.category) === "Debt")
    .map(cat => cat.category);
  
  return windowMonths.map(ym => {
    const monthData = monthByYm.get(ym);
    const monthTotal = childCategories.reduce((sum, childCat) => {
      const catInMonth = monthData?.categories.find((c: any) => c.category === childCat);
      return sum + (catInMonth?.amount || 0);
    }, 0);
    return { yearMonth: ym, amount: monthTotal };
  });
}

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const level = url.searchParams.get("level") || "all";
  const categoryParam = url.searchParams.get("category") || "";
  const merchantParam = url.searchParams.get("merchant") || "";

  if (!["all", "category", "merchant"].includes(level)) {
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

    // Compute all-spending monthly series once (aligned with windowMonths)
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
      const rankedItems: RankedItem[] = Array.from(parentCategoryMap.entries())
        .map(([parent, data]) => {
          const catAvg = data.total / windowMonths.length;
          const last3 = data.monthlySeries.slice(-3);
          const last3Avg = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
          const trend = last3Avg - catAvg;

          return {
            name: parent,
            slug: parent.toLowerCase().replace(/\s+/g, "-"),
            total: data.total,
            share: allTotal > 0 ? data.total / allTotal : 0,
            trend,
            monthlySeries: data.monthlySeries,
          };
        })
        .sort((a, b) => b.total - a.total);

      return NextResponse.json({
        level: "all",
        breadcrumb: [{ label: "All spending" }],
        total: allTotal,
        avgPerMonth: allAvg,
        monthlySeries: allSpendingMonthlySeries,
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

      if (childCategories.length === 0) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }

      // Build category monthly series (sum of all child categories)
      const categoryMonthlySeries: MonthlySeries[] = parentCategory === "Debt"
        ? computeDebtCategoryMonthlySeries(windowMonths, monthByYm, summary.categories)
        : windowMonths.map(ym => {
            const monthData = monthByYm.get(ym);
            const monthTotal = childCategories.reduce((sum, childCat) => {
              const catInMonth = monthData?.categories.find(c => c.category === childCat);
              return sum + (catInMonth?.amount || 0);
            }, 0);
            return { yearMonth: ym, amount: monthTotal };
          });

      const categoryTotal = categoryMonthlySeries.reduce((sum, m) => sum + m.amount, 0);
      const categoryAvg = categoryTotal / windowMonths.length;

      // Special handling for Debt category (no merchants, only scheduled payments to debt accounts)
      if (parentCategory === "Debt") {
        const scheduledPayments = computeScheduledDebtPayments(
          profile.accountSnapshots,
          profile.debtPaymentHistory,
          userReviews,
          profile.fxRates || {},
          profile.homeCurrency
        );

        const sumOfPayments = scheduledPayments.reduce((sum, p) => sum + p.amount, 0);

        // Build debt account rows
        // Allocate proportionally so rows add up exactly to the header total (which comes from
        // the shared summary's categoryMonthlySeries), not from recomputed scheduled amounts
        const rankedItems: RankedItem[] = scheduledPayments.map(payment => {
          const proportion = sumOfPayments > 0 ? payment.amount / sumOfPayments : 0;
          const accountTotal = categoryTotal * proportion;
          
          const monthlySeries: MonthlySeries[] = categoryMonthlySeries.map(m => ({
            yearMonth: m.yearMonth,
            amount: m.amount * proportion,
          }));

          const avg = accountTotal / windowMonths.length;
          const last3 = monthlySeries.slice(-3);
          const last3Avg = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
          const trend = last3Avg - avg;

          return {
            name: payment.accountName || payment.accountSlug,
            slug: payment.accountSlug,
            subLabel: payment.method, // Use method verbatim (already includes qualifiers)
            total: accountTotal,
            share: categoryTotal > 0 ? accountTotal / categoryTotal : 0,
            trend,
            monthlySeries,
          };
        }).sort((a, b) => b.total - a.total);

        return NextResponse.json({
          level: "category",
          kind: "debt" as const,
          breadcrumb: [
            { label: "All spending", href: "/account/spending" },
            { label: "Debt" },
          ],
          total: categoryTotal,
          avgPerMonth: categoryAvg,
          monthlySeries: categoryMonthlySeries,
          comparisonSeries: allSpendingMonthlySeries,
          rankedItems,
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
    } else {
      // Level 3: Merchant → Transactions (scoped to parent category)
      const parentCategory = categoryParam;

      // Special handling for Debt account drill-down
      if (parentCategory === "Debt") {
        const accountSlug = merchantParam; // It's an account slug, not a merchant
        
        // Find the account in snapshots
        const account = profile.accountSnapshots.find(a => a.slug === accountSlug);
        if (!account) {
          return NextResponse.json({ error: "Account not found" }, { status: 404 });
        }

        // Get scheduled payments (call once and reuse)
        const scheduledPayments = computeScheduledDebtPayments(
          profile.accountSnapshots,
          profile.debtPaymentHistory,
          userReviews,
          profile.fxRates || {},
          profile.homeCurrency
        );
        
        const scheduled = scheduledPayments.find(p => p.accountSlug === accountSlug);
        if (!scheduled) {
          return NextResponse.json({ error: "Account not found in scheduled payments" }, { status: 404 });
        }

        // Compute Debt category monthly series using shared helper
        const categoryMonthlySeries = computeDebtCategoryMonthlySeries(
          windowMonths,
          monthByYm,
          summary.categories
        );
        const categoryTotal = categoryMonthlySeries.reduce((sum, m) => sum + m.amount, 0);

        // Use SAME proportional allocation as level 2 (ensures totals match exactly)
        const sumOfPayments = scheduledPayments.reduce((sum, p) => sum + p.amount, 0);
        const proportion = sumOfPayments > 0 ? scheduled.amount / sumOfPayments : 0;
        
        // Derive header and monthly series from proportional allocation
        const monthlySeries: MonthlySeries[] = categoryMonthlySeries.map(m => ({
          yearMonth: m.yearMonth,
          amount: m.amount * proportion,
        }));
        
        const total = categoryTotal * proportion;
        const avgPerMonth = total / windowMonths.length;

        // Rows = one per month in the window, showing allocated amount
        const rankedItems: RankedItem[] = windowMonths
          .map((ym, idx) => {
            const [year, month] = ym.split("-");
            const monthLabel = new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString("en-US", { 
              month: "short", 
              year: "numeric" 
            });
            
            return {
              name: monthLabel,
              slug: ym,
              total: monthlySeries[idx].amount,
              share: total > 0 ? monthlySeries[idx].amount / total : 0,
              trend: 0,
              monthlySeries: [],
            };
          })
          .reverse(); // Newest first

        // Calculate actual paid total from history (if differs from scheduled)
        const paymentHistory = profile.debtPaymentHistory.filter(
          entry => entry.accountSlug === accountSlug && windowMonths.includes(entry.statementMonth)
        );
        
        let actualPaidTotal: number | undefined;
        if (paymentHistory.length > 0) {
          const home = profile.homeCurrency.toUpperCase();
          const toHome = (amount: number, currency?: string): number => {
            const cur = (currency ?? home).toUpperCase();
            if (cur === home) return amount;
            const rate = (profile.fxRates || {})[cur];
            return rate ? amount * rate : amount;
          };
          
          const actualTotal = paymentHistory.reduce(
            (sum, entry) => sum + toHome(entry.paymentsMade, entry.currency),
            0
          );
          
          // Only include if differs by more than $1
          if (Math.abs(actualTotal - total) > 1) {
            actualPaidTotal = actualTotal;
          }
        }

        return NextResponse.json({
          level: "merchant",
          kind: "debt" as const,
          breadcrumb: [
            { label: "All spending", href: "/account/spending" },
            { label: "Debt", href: "/account/spending?category=Debt" },
            { label: account.accountName || accountSlug },
          ],
          total,
          avgPerMonth,
          monthlySeries,
          comparisonSeries: categoryMonthlySeries,
          rankedItems,
          actualPaidTotal,
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
