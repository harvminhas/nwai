/**
 * GET /api/user/spending/account-cashflow?account=<slug>
 *
 * Returns day-of-month cash-flow aggregates for a single account across all
 * statement months. Used by the CashflowHeatmap component on the account detail page.
 *
 * Each day entry represents a "typical day" — amounts are averaged across the
 * number of months that had any activity on that calendar day.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";

export interface DayStat {
  day: number;           // 1–31
  income: number;        // total income on this day in the selected month
  expense: number;       // total expenses on this day in the selected month
  topMerchants: { name: string; amount: number }[];
}

export interface AccountCashflowResponse {
  days: DayStat[];
  month: string;         // YYYY-MM of the data shown
  currency: string;
  homeCurrency: string;
}

export async function GET(request: NextRequest) {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

    const url = new URL(request.url);
    const accountSlug = url.searchParams.get("account")?.trim();
    if (!accountSlug) return NextResponse.json({ error: "account required" }, { status: 400 });

    const profile = await getFinancialProfile(uid, db);
    const { expenseTxns, incomeTxns, homeCurrency } = profile;

    // Find the account's currency from snapshots
    const snap = profile.accountSnapshots.find(s => s.slug === accountSlug);
    const currency = snap?.currency ?? homeCurrency;

    // Use the requested month, or fall back to the most recent month with data
    const requestedMonth = url.searchParams.get("month")?.slice(0, 7) ?? null;
    const allMonths = new Set<string>();
    for (const t of [...(expenseTxns ?? []), ...(incomeTxns ?? [])]) {
      if (t.accountSlug === accountSlug) {
        const m = t.date?.slice(0, 7);
        if (m) allMonths.add(m);
      }
    }
    const sortedMonths = [...allMonths].sort();
    const month = (requestedMonth && allMonths.has(requestedMonth))
      ? requestedMonth
      : (sortedMonths[sortedMonths.length - 1] ?? null);

    if (!month) {
      const empty: DayStat[] = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, income: 0, expense: 0, topMerchants: [] }));
      return NextResponse.json({ days: empty, month: "", currency, homeCurrency } satisfies AccountCashflowResponse);
    }

    // Filter to this account + selected month
    const expTxns = (expenseTxns ?? []).filter(t => t.accountSlug === accountSlug && t.date?.startsWith(month));
    const incTxns = (incomeTxns  ?? []).filter(t => t.accountSlug === accountSlug && t.date?.startsWith(month));

    // Accumulate per-day totals
    const incomeByDay  = new Map<number, number>();
    const expByDay     = new Map<number, number>();
    const merchantsByDay = new Map<number, Map<string, number>>();

    for (const t of incTxns) {
      const day = parseInt(t.date.slice(8, 10), 10);
      if (day < 1 || day > 31) continue;
      incomeByDay.set(day, (incomeByDay.get(day) ?? 0) + Math.abs(t.amount));
    }

    for (const t of expTxns) {
      const day = parseInt(t.date.slice(8, 10), 10);
      if (day < 1 || day > 31) continue;
      expByDay.set(day, (expByDay.get(day) ?? 0) + Math.abs(t.amount));
      const name = t.merchant ?? "Other";
      if (!merchantsByDay.has(day)) merchantsByDay.set(day, new Map());
      const mm = merchantsByDay.get(day)!;
      mm.set(name, (mm.get(name) ?? 0) + Math.abs(t.amount));
    }

    // Build response — all 31 days
    const result: DayStat[] = [];
    for (let d = 1; d <= 31; d++) {
      const topMerchants = [...(merchantsByDay.get(d) ?? new Map()).entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, amount]) => ({ name, amount }));
      result.push({
        day: d,
        income:  incomeByDay.get(d)  ?? 0,
        expense: expByDay.get(d)     ?? 0,
        topMerchants,
      });
    }

    return NextResponse.json({ days: result, month, currency, homeCurrency } satisfies AccountCashflowResponse);
  } catch (err) {
    console.error("[account-cashflow] error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
