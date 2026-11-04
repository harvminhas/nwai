/**
 * GET /api/user/spending/drilldown?level=all|category|merchant&category=&merchant=
 * Returns 12-month drill-down data for spending page.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { resolveWindowMonths } from "@/lib/rangeUtils";
import { merchantSlug } from "@/lib/applyRules";

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
  trend: number; // avg last 3 months - overall monthly avg
  monthlySeries: MonthlySeries[];
}

interface CadenceStats {
  dayOfWeek?: { day: string; count: number }[];
  dayOfMonth?: { day: number; count: number }[];
  sentence?: string;
}

interface DrilldownResponse {
  level: "all" | "category" | "merchant";
  breadcrumb: { label: string; href?: string }[];
  total: number;
  avgPerMonth: number;
  monthlySeries: MonthlySeries[];
  comparisonSeries?: MonthlySeries[]; // Parent level for comparison
  rankedItems: RankedItem[];
  cadence?: CadenceStats;
  currency: string;
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
    
    // Get last 12 complete months using the existing utility
    const resolved = resolveWindowMonths(
      "12mo",
      profile.monthlyHistory || [],
      undefined,
      undefined
    );
    
    const last12Months = resolved.months;
    
    if (last12Months.length === 0) {
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

    // Filter expense transactions to last 12 months
    const txns = profile.expenseTxns.filter(t => last12Months.includes(t.txMonth));

    // Build response based on level
    if (level === "all") {
      // Level 1: All spending -> Categories
      const allMonthTotals = new Map<string, number>();
      
      for (const txn of txns) {
        const current = allMonthTotals.get(txn.txMonth) || 0;
        allMonthTotals.set(txn.txMonth, current + txn.amount);
      }

      const monthlySeries: MonthlySeries[] = last12Months.map(ym => ({
        yearMonth: ym,
        amount: allMonthTotals.get(ym) || 0,
      }));

      const total = monthlySeries.reduce((sum, m) => sum + m.amount, 0);
      const avgPerMonth = total / last12Months.length;

      // Group by category
      const categoryMap = new Map<string, typeof txns>();
      for (const txn of txns) {
        const cat = txn.category;
        const existing = categoryMap.get(cat) || [];
        existing.push(txn);
        categoryMap.set(cat, existing);
      }

      // Rank categories
      const rankedItems: RankedItem[] = Array.from(categoryMap.entries())
        .map(([cat, catTxns]) => {
          const catMonthTotals = new Map<string, number>();
          for (const txn of catTxns) {
            const current = catMonthTotals.get(txn.txMonth) || 0;
            catMonthTotals.set(txn.txMonth, current + txn.amount);
          }

          const catSeries: MonthlySeries[] = last12Months.map(ym => ({
            yearMonth: ym,
            amount: catMonthTotals.get(ym) || 0,
          }));

          const catTotal = catSeries.reduce((sum, m) => sum + m.amount, 0);
          const catAvg = catTotal / last12Months.length;
          
          // Trend: avg of last 3 months - overall avg
          const last3 = catSeries.slice(-3);
          const last3Avg = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
          const trend = last3Avg - catAvg;

          return {
            name: cat,
            slug: cat.toLowerCase().replace(/\s+/g, "-"),
            total: catTotal,
            share: total > 0 ? catTotal / total : 0,
            trend,
            monthlySeries: catSeries,
          };
        })
        .sort((a, b) => b.total - a.total);

      return NextResponse.json({
        level: "all",
        breadcrumb: [{ label: "All spending" }],
        total,
        avgPerMonth,
        monthlySeries,
        rankedItems,
        currency: profile.homeCurrency,
      });
    } else if (level === "category") {
      // Level 2: Category -> Merchants
      const categoryTxns = txns.filter(t => t.category === categoryParam);
      
      if (categoryTxns.length === 0) {
        return NextResponse.json({ error: "Category not found" }, { status: 404 });
      }

      // Build category monthly series
      const catMonthTotals = new Map<string, number>();
      for (const txn of categoryTxns) {
        const current = catMonthTotals.get(txn.txMonth) || 0;
        catMonthTotals.set(txn.txMonth, current + txn.amount);
      }

      const monthlySeries: MonthlySeries[] = last12Months.map(ym => ({
        yearMonth: ym,
        amount: catMonthTotals.get(ym) || 0,
      }));

      const total = monthlySeries.reduce((sum, m) => sum + m.amount, 0);
      const avgPerMonth = total / last12Months.length;

      // Build comparison series (all spending)
      const allMonthTotals = new Map<string, number>();
      for (const txn of txns) {
        const current = allMonthTotals.get(txn.txMonth) || 0;
        allMonthTotals.set(txn.txMonth, current + txn.amount);
      }
      const comparisonSeries: MonthlySeries[] = last12Months.map(ym => ({
        yearMonth: ym,
        amount: allMonthTotals.get(ym) || 0,
      }));

      // Group by merchant
      const merchantMap = new Map<string, typeof categoryTxns>();
      for (const txn of categoryTxns) {
        const slug = merchantSlug(txn.merchant);
        const existing = merchantMap.get(slug) || [];
        existing.push(txn);
        merchantMap.set(slug, existing);
      }

      // Rank merchants
      const rankedItems: RankedItem[] = Array.from(merchantMap.entries())
        .map(([slug, merchTxns]) => {
          const merchMonthTotals = new Map<string, number>();
          for (const txn of merchTxns) {
            const current = merchMonthTotals.get(txn.txMonth) || 0;
            merchMonthTotals.set(txn.txMonth, current + txn.amount);
          }

          const merchSeries: MonthlySeries[] = last12Months.map(ym => ({
            yearMonth: ym,
            amount: merchMonthTotals.get(ym) || 0,
          }));

          const merchTotal = merchSeries.reduce((sum, m) => sum + m.amount, 0);
          const merchAvg = merchTotal / last12Months.length;
          
          const last3 = merchSeries.slice(-3);
          const last3Avg = last3.reduce((sum, m) => sum + m.amount, 0) / 3;
          const trend = last3Avg - merchAvg;

          return {
            name: merchTxns[0].merchant,
            slug,
            total: merchTotal,
            share: total > 0 ? merchTotal / total : 0,
            trend,
            monthlySeries: merchSeries,
          };
        })
        .sort((a, b) => b.total - a.total);

      // Cadence stats for category
      const dayOfWeekCounts = new Map<string, number>();
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      
      for (const txn of categoryTxns) {
        const date = new Date(txn.date);
        const dow = days[date.getDay()];
        dayOfWeekCounts.set(dow, (dayOfWeekCounts.get(dow) || 0) + 1);
      }

      const dayOfWeek = days.map(day => ({
        day,
        count: dayOfWeekCounts.get(day) || 0,
      }));

      // Find most common day(s)
      const maxCount = Math.max(...dayOfWeek.map(d => d.count));
      const topDays = dayOfWeek.filter(d => d.count >= maxCount * 0.6).map(d => d.day);
      
      let sentence: string | undefined;
      if (topDays.length === 1 && maxCount / categoryTxns.length >= 0.3) {
        sentence = `Most of your ${categoryParam} happens on ${topDays[0]}`;
      } else if (topDays.length === 2) {
        const topCount = dayOfWeek.filter(d => topDays.includes(d.day)).reduce((sum, d) => sum + d.count, 0);
        if (topCount / categoryTxns.length >= 0.5) {
          sentence = `Most of your ${categoryParam} happens on ${topDays[0]} and ${topDays[1]}`;
        }
      }

      return NextResponse.json({
        level: "category",
        breadcrumb: [
          { label: "All spending", href: "/account/spending" },
          { label: categoryParam },
        ],
        total,
        avgPerMonth,
        monthlySeries,
        comparisonSeries,
        rankedItems,
        cadence: { dayOfWeek, sentence },
        currency: profile.homeCurrency,
      });
    } else {
      // Level 3: Merchant -> Transactions
      const categoryTxns = txns.filter(t => t.category === categoryParam);
      const merchantTxns = categoryTxns.filter(t => merchantSlug(t.merchant) === merchantParam);
      
      if (merchantTxns.length === 0) {
        return NextResponse.json({ error: "Merchant not found" }, { status: 404 });
      }

      // Build merchant monthly series
      const merchMonthTotals = new Map<string, number>();
      for (const txn of merchantTxns) {
        const current = merchMonthTotals.get(txn.txMonth) || 0;
        merchMonthTotals.set(txn.txMonth, current + txn.amount);
      }

      const monthlySeries: MonthlySeries[] = last12Months.map(ym => ({
        yearMonth: ym,
        amount: merchMonthTotals.get(ym) || 0,
      }));

      const total = monthlySeries.reduce((sum, m) => sum + m.amount, 0);
      const avgPerMonth = total / last12Months.length;

      // Build comparison series (category)
      const catMonthTotals = new Map<string, number>();
      for (const txn of categoryTxns) {
        const current = catMonthTotals.get(txn.txMonth) || 0;
        catMonthTotals.set(txn.txMonth, current + txn.amount);
      }
      const comparisonSeries: MonthlySeries[] = last12Months.map(ym => ({
        yearMonth: ym,
        amount: catMonthTotals.get(ym) || 0,
      }));

      // Rank transactions (newest first)
      const rankedItems: RankedItem[] = merchantTxns
        .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .map(txn => ({
          name: new Date(txn.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }),
          slug: txn.date,
          total: txn.amount,
          share: total > 0 ? txn.amount / total : 0,
          trend: 0,
          monthlySeries: [],
        }));

      // Cadence stats for merchant
      const dayOfWeekCounts = new Map<string, number>();
      const dayOfMonthCounts = new Map<number, number>();
      const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
      
      for (const txn of merchantTxns) {
        const date = new Date(txn.date);
        const dow = days[date.getDay()];
        const dom = date.getDate();
        dayOfWeekCounts.set(dow, (dayOfWeekCounts.get(dow) || 0) + 1);
        dayOfMonthCounts.set(dom, (dayOfMonthCounts.get(dom) || 0) + 1);
      }

      const dayOfWeek = days.map(day => ({
        day,
        count: dayOfWeekCounts.get(day) || 0,
      }));

      // Check for weekday pattern
      const maxDowCount = Math.max(...dayOfWeek.map(d => d.count));
      const topDow = dayOfWeek.find(d => d.count === maxDowCount);
      
      // Check for day-of-month pattern
      const maxDomCount = Math.max(...Array.from(dayOfMonthCounts.values()));
      const topDom = Array.from(dayOfMonthCounts.entries()).find(([, count]) => count === maxDomCount)?.[0];

      let sentence: string | undefined;
      const avgAmount = total / merchantTxns.length;

      if (topDom && maxDomCount >= merchantTxns.length * 0.6) {
        const suffix = topDom === 1 || topDom === 21 || topDom === 31 ? "st" : topDom === 2 || topDom === 22 ? "nd" : topDom === 3 || topDom === 23 ? "rd" : "th";
        sentence = `Charges on the ${topDom}${suffix} of each month, $${Math.round(avgAmount)}`;
      } else if (topDow && maxDowCount >= merchantTxns.length * 0.4) {
        sentence = `Usually ${topDow.day}, about $${Math.round(avgAmount)}`;
      }

      return NextResponse.json({
        level: "merchant",
        breadcrumb: [
          { label: "All spending", href: "/account/spending" },
          { label: categoryParam, href: `/account/spending?category=${encodeURIComponent(categoryParam)}` },
          { label: merchantTxns[0].merchant },
        ],
        total,
        avgPerMonth,
        monthlySeries,
        comparisonSeries,
        rankedItems,
        cadence: { dayOfWeek, sentence },
        currency: profile.homeCurrency,
      });
    }
  } catch (err) {
    console.error("[drilldown GET]", err);
    return NextResponse.json({ error: "Failed to load drilldown data" }, { status: 500 });
  }
}
