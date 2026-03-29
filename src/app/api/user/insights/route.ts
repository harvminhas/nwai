import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { consolidateStatements, getYearMonth } from "@/lib/consolidate";
import type { ParsedStatementData } from "@/lib/types";
import { buildAccountSlug } from "@/lib/accountSlug";
import { merchantSlug } from "@/lib/applyRules";
import type * as FirebaseFirestore from "firebase-admin/firestore";
import { extractAllTransactions, expenseTotalForMonth } from "@/lib/extractTransactions";

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    return (await auth.verifyIdToken(token)).uid;
  } catch { return null; }
}

// ── types ─────────────────────────────────────────────────────────────────────

export type AlertSeverity = "high" | "medium" | "low";
export type AlertType =
  | "low_liquid"
  | "overdue_cash"
  | "spending_pace"
  | "no_income"
  | "cc_interest"
  | "savings_low";

export interface DashboardAlert {
  id: string;
  type: AlertType;
  severity: AlertSeverity;
  title: string;
  body: string;
  href?: string;
}

export interface TodayInsight {
  id: string;
  emoji: string;
  title: string;
  subtitle: string;
  /** positive = green, caution = amber, neutral = gray */
  tone: "positive" | "caution" | "neutral";
  href?: string;
}

export type UpcomingItemType = "cash-out" | "cash-in" | "subscription" | "debt";

export interface UpcomingItem {
  id: string;
  /** ISO date "YYYY-MM-DD" for known dates; "this-month" for no-exact-date items */
  date: string;
  /** negative = overdue; 9999 = "this month" (no exact date) */
  daysFromNow: number;
  title: string;
  subtitle?: string;
  amount: number;
  type: UpcomingItemType;
  href?: string;
  isOverdue: boolean;
  /** true when the exact date is unknown — show as "This month" */
  isThisMonth: boolean;
  /** predicted day-of-month date even when isThisMonth is true (already passed or far out) */
  predictedDate?: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime();
  return Math.round(ms / 86400000);
}

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

// ── GET ───────────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const today = todayISO();
  const now   = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // ── 1. Latest consolidated snapshot ────────────────────────────────────────
  const stmtSnap = await db.collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .orderBy("uploadedAt", "desc")
    .get();

  let consolidated: ParsedStatementData | null = null;
  let liquidAssets = 0;

  if (!stmtSnap.empty) {
    const allDocs = stmtSnap.docs;
    const yearMonths = new Set<string>();
    for (const d of allDocs) {
      const p = d.data().parsedData as ParsedStatementData | undefined;
      let ym = p?.statementDate ? getYearMonth(p.statementDate) : "";
      if (!ym) {
        const raw = d.data().uploadedAt?.toDate?.() ?? d.data().uploadedAt;
        if (raw) ym = (typeof raw === "object" && "toISOString" in raw
          ? (raw as Date).toISOString() : String(raw)).slice(0, 7);
      }
      if (ym) yearMonths.add(ym);
    }
    const currentYm = Array.from(yearMonths).sort().reverse()[0];
    if (currentYm) {
      const latestPerAccount = new Map<string, ParsedStatementData>();
      for (const d of allDocs) {
        const p = d.data().parsedData as ParsedStatementData | undefined;
        if (!p) continue;
        let ym = p.statementDate ? getYearMonth(p.statementDate) : "";
        if (!ym) {
          const raw = d.data().uploadedAt?.toDate?.() ?? d.data().uploadedAt;
          if (raw) ym = (typeof raw === "object" && "toISOString" in raw
            ? (raw as Date).toISOString() : String(raw)).slice(0, 7);
        }
        if (!ym || ym > currentYm) continue;
        const slug = buildAccountSlug(p.bankName, p.accountId);
        if (!latestPerAccount.has(slug)) latestPerAccount.set(slug, p);
      }
      consolidated = consolidateStatements(Array.from(latestPerAccount.values()), currentYm);
      for (const p of latestPerAccount.values()) {
        const t = p.accountType?.toLowerCase() ?? "";
        if (t === "checking" || t === "savings" || t === "cash") {
          const bal = typeof p.netWorth === "number" ? p.netWorth : 0;
          if (bal > 0) liquidAssets += bal;
        }
      }
    }
  }

  // ── 2. Cash commitments ────────────────────────────────────────────────────
  const cashSnap = await db.collection(`users/${uid}/cashCommitments`).get();
  const cashItems = cashSnap.docs.map((d) => d.data() as {
    id: string; name: string; amount: number; frequency: string;
    category: string; notes?: string; nextDate?: string;
  });

  // ── 3. User-marked recurring rules ─────────────────────────────────────────
  const recurringSnap = await db.collection(`users/${uid}/recurringRules`).get();
  const recurringRules = recurringSnap.docs.map((d) => d.data() as {
    merchant: string; amount: number; frequency: string; category?: string; slug: string;
  });

  // ── 4. Account rates (CC APR alert + minimum payment estimate) ─────────────
  const ratesSnap = await db.collection(`users/${uid}/accountRates`).get();
  const ratesByAccount: Record<string, number> = {};
  for (const d of ratesSnap.docs) {
    const r = d.data();
    ratesByAccount[d.id] = (r.manualRate ?? r.aiRate ?? 0) as number;
  }

  // ── 5. Build merchant → day-of-month pattern from ALL transaction history ──
  // Gives us predicted dates and account attribution for recurring items.
  interface MerchantPattern {
    days: number[];     // observed day-of-month for each transaction
    accounts: string[]; // accounts where this merchant appears
  }
  const merchantPatterns = new Map<string, MerchantPattern>();

  function normKey(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
  }

  for (const doc of stmtSnap.docs) {
    const p = doc.data().parsedData as ParsedStatementData | undefined;
    if (!p) continue;
    const acctLabel = [p.bankName ?? "", p.accountId ? `*${p.accountId.slice(-4)}` : ""]
      .filter(Boolean).join(" ");
    for (const txn of (p.expenses?.transactions ?? [])) {
      if (!txn.date || !txn.merchant) continue;
      const day = parseInt(txn.date.slice(8, 10));
      if (isNaN(day) || day < 1 || day > 31) continue;
      const key = normKey(txn.merchant);
      if (!merchantPatterns.has(key)) merchantPatterns.set(key, { days: [], accounts: [] });
      const pat = merchantPatterns.get(key)!;
      pat.days.push(day);
      if (acctLabel && !pat.accounts.includes(acctLabel)) pat.accounts.push(acctLabel);
    }
    // Also scan income transactions for deposit-day patterns
    for (const txn of (p.income?.transactions ?? [])) {
      if (!txn.date || !txn.source) continue;
      const day = parseInt(txn.date.slice(8, 10));
      if (isNaN(day) || day < 1 || day > 31) continue;
      const key = normKey(txn.source);
      if (!merchantPatterns.has(key)) merchantPatterns.set(key, { days: [], accounts: [] });
      const pat = merchantPatterns.get(key)!;
      pat.days.push(day);
      if (acctLabel && !pat.accounts.includes(acctLabel)) pat.accounts.push(acctLabel);
    }
  }

  /** Returns median day-of-month and account label for a merchant name, or null. */
  function predictPattern(merchantName: string): { medianDay: number; account: string } | null {
    const searchKey = normKey(merchantName);
    if (!searchKey) return null;
    let bestPat: MerchantPattern | null = null;
    let bestScore = 0;
    for (const [k, v] of merchantPatterns) {
      // Overlap scoring: characters in common / length of shorter key
      const shorter = Math.min(k.length, searchKey.length);
      if (shorter < 3) continue;
      let overlap = 0;
      for (let i = 0; i < shorter; i++) if (k[i] === searchKey[i]) overlap++;
      const score = overlap / shorter;
      // Require at least 50% character-prefix overlap
      const prefixLen = Math.min(6, shorter);
      const prefixMatch = k.slice(0, prefixLen) === searchKey.slice(0, prefixLen);
      if (prefixMatch && score > bestScore && v.days.length >= 1) {
        bestScore = score;
        bestPat = v;
      }
    }
    if (!bestPat || bestPat.days.length === 0) return null;
    const sorted = [...bestPat.days].sort((a, b) => a - b);
    const medianDay = sorted[Math.floor(sorted.length / 2)];
    return { medianDay, account: bestPat.accounts[0] ?? "" };
  }

  /** Given a merchant and optional known frequency, returns the next predicted date in this or next month. */
  function nextOccurrence(merchantName: string): { date: string; daysFromNow: number; account: string } | null {
    const pat = predictPattern(merchantName);
    if (!pat) return null;
    const { medianDay, account } = pat;
    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const targetDay  = Math.min(medianDay, daysInMonth);
    const mm  = String(now.getMonth() + 1).padStart(2, "0");
    const dd  = String(targetDay).padStart(2, "0");
    const dateStr = `${now.getFullYear()}-${mm}-${dd}`;
    const diff = daysBetween(today, dateStr);
    return { date: dateStr, daysFromNow: diff, account };
  }

  // ── Transaction-date-based financial data (single source of truth) ─────────
  // Statements are ingestion only — all financial totals use actual tx dates.
  const txData = await extractAllTransactions(uid, db);
  const { expenseTxns, incomeTxns, accountSnapshots: txSnapshots, allTxMonths } = txData;

  // Override liquid assets from latest account snapshots (balance data is point-in-time,
  // but we use extractAllTransactions so we have a single fetch for all account data).
  if (txSnapshots.length > 0) {
    liquidAssets = txSnapshots
      .filter((a) => /checking|savings|cash/i.test(a.accountType))
      .reduce((s, a) => s + Math.max(0, a.balance), 0);
  }

  const dayOfMonth   = now.getDate();
  const daysInMonth  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthFraction = dayOfMonth / daysInMonth;

  // Current-month income & expenses from transaction dates only.
  // No category filter — must match the spending page exactly so users never see discrepancies.
  const income   = incomeTxns.filter((t) => t.txMonth === thisMonth).reduce((s, t) => s + t.amount, 0);
  const expenses = expenseTxns.filter((t) => t.txMonth === thisMonth).reduce((s, t) => s + t.amount, 0);
  const debts    = txSnapshots.reduce((s, a) => s + Math.max(0, -a.balance), 0);

  // "Data is current month" if we have at least one transaction dated in thisMonth.
  const dataIsCurrentMonth = allTxMonths.includes(thisMonth);

  // Typical monthly expenses: median of per-month tx totals across all historical months.
  const typicalMonthlyExpenses = (() => {
    const historicalMonths = allTxMonths.filter((m) => m < thisMonth);
    if (historicalMonths.length === 0) return expenses;
    const monthTotals = historicalMonths
      .map((m) =>
        expenseTxns
          .filter((t) => t.txMonth === m)
          .reduce((s, t) => s + t.amount, 0)
      )
      .filter((v) => v > 0);
    if (monthTotals.length === 0) return expenses;
    const sorted = [...monthTotals].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;
  })();

  // ── build alerts ──────────────────────────────────────────────────────────
  const alerts: DashboardAlert[] = [];

  // Overdue cash commitments
  const overdueCash = cashItems.filter((c) => c.nextDate && c.nextDate < today);
  if (overdueCash.length > 0) {
    const names = overdueCash.map((c) => c.name).slice(0, 2).join(", ");
    const more  = overdueCash.length > 2 ? ` +${overdueCash.length - 2} more` : "";
    alerts.push({
      id: "overdue_cash", type: "overdue_cash", severity: "high",
      title: `Cash payment${overdueCash.length > 1 ? "s" : ""} overdue`,
      body: `${names}${more} ${overdueCash.length === 1 ? "is" : "are"} past due — mark as paid or update the date.`,
      href: "/account/spending?tab=cash",
    });
  }

  // Low liquid buffer — use typicalMonthlyExpenses (median across months) so one
  // outlier month doesn't inflate the daily burn rate and trigger a false alarm.
  if (liquidAssets > 0 && typicalMonthlyExpenses > 0) {
    const daysOfBuffer = liquidAssets / (typicalMonthlyExpenses / 30);
    if (daysOfBuffer < 7) {
      alerts.push({
        id: "low_liquid", type: "low_liquid", severity: "high",
        title: "Very low cash buffer",
        body: `${fmt(liquidAssets)} in cash — less than a week of typical expenses. Consider moving funds.`,
        href: "/account/assets",
      });
    } else if (daysOfBuffer < 14) {
      alerts.push({
        id: "low_liquid", type: "low_liquid", severity: "medium",
        title: "Low cash buffer",
        body: `${fmt(liquidAssets)} in checking/savings — about ${Math.round(daysOfBuffer)} days of typical expenses.`,
        href: "/account/assets",
      });
    }
  }

  // Spending pace — fires when this calendar month has transaction data and we're
  // ≥40% through the month. `expenses` is already transfer-free (tx-date-based).
  if (dataIsCurrentMonth && income > 0 && expenses > 0 && monthFraction >= 0.40) {
    // Require income to be reasonably captured (≥ 20% of real spending) to
    // avoid false alerts when only a credit card statement was uploaded.
    if (income >= expenses * 0.20) {
      const projected = expenses / monthFraction;
      const overshoot = projected - income;
      if (overshoot > income * 0.10) {
        alerts.push({
          id: "spending_pace", type: "spending_pace", severity: "medium",
          title: "Spending ahead of income",
          body: `At current pace you'll spend ${fmt(projected)} this month — ${fmt(overshoot)} more than your income.`,
          href: "/account/spending",
        });
      }
    }
  }

  // No income this month — only relevant when data is from the current month
  if (dataIsCurrentMonth && income === 0 && expenses > 0) {
    alerts.push({
      id: "no_income", type: "no_income", severity: "low",
      title: "No income recorded this month",
      body: "Upload a bank statement to track your income.",
      href: "/account/income",
    });
  }

  // High-interest CC
  const highApr = Object.entries(ratesByAccount).find(([, apr]) => apr >= 19.99);
  if (highApr && debts > 0) {
    const annualInterest = debts * (highApr[1] / 100);
    if (annualInterest > 1000) {
      alerts.push({
        id: "cc_interest", type: "cc_interest", severity: "medium",
        title: "High-interest debt costing you",
        body: `At ${highApr[1].toFixed(1)}% APR, your debt is costing ~${fmt(annualInterest / 12)}/mo in interest.`,
        href: "/account/liabilities?tab=payoff",
      });
    }
  }

  const severityOrder = { high: 0, medium: 1, low: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);
  const cappedAlerts = alerts.slice(0, 4);

  // ── build upcoming items ──────────────────────────────────────────────────
  const upcoming: UpcomingItem[] = [];
  const LOOK_AHEAD = 14;
  // Track de-duplication by merchant name (case-insensitive) so AI subs + manual rules don't double-up
  const seenMerchants = new Set<string>();

  // ── A. Cash commitments with nextDate ─────────────────────────────────────
  for (const c of cashItems) {
    if (!c.nextDate) continue;
    const diff = daysBetween(today, c.nextDate);
    if (diff > LOOK_AHEAD) continue;
    upcoming.push({
      id: `cash-${c.id}`,
      date: c.nextDate,
      daysFromNow: diff,
      title: c.name,
      subtitle: c.frequency === "once" ? "One-off cash payment" : `${c.frequency} · ${c.category}`,
      amount: c.amount,
      type: "cash-out",
      href: "/account/spending?tab=cash",
      isOverdue: diff < 0,
      isThisMonth: false,
    });
    seenMerchants.add(c.name.toLowerCase());
  }

  // ── B. AI-detected subscriptions (from consolidated statement) ─────────────
  const aiSubs: { name: string; amount: number; frequency?: string }[] =
    consolidated?.subscriptions ?? [];
  for (const sub of aiSubs) {
    const key = sub.name.toLowerCase();
    if (seenMerchants.has(key)) continue;
    seenMerchants.add(key);
    const occ = nextOccurrence(sub.name);
    // If we found a predicted date in the future, use it; otherwise keep "this month"
    const hasExactDate = occ && occ.daysFromNow >= 0 && occ.daysFromNow <= LOOK_AHEAD + 14;
    const subtitleParts: string[] = [`Recurring · ${sub.frequency ?? "monthly"}`];
    if (occ?.account) subtitleParts.push(occ.account);
    upcoming.push({
      id: `aisub-${key}`,
      date: hasExactDate ? occ!.date : thisMonth,
      daysFromNow: hasExactDate ? occ!.daysFromNow : 9999,
      title: sub.name,
      subtitle: subtitleParts.join(" · "),
      amount: sub.amount,
      type: "subscription",
      href: `/account/spending/merchant/${merchantSlug(sub.name)}`,
      isOverdue: false,
      isThisMonth: !hasExactDate,
      predictedDate: !hasExactDate && occ ? occ.date : undefined,
    });
  }

  // ── C. User-marked recurring rules (manual) ────────────────────────────────
  for (const rule of recurringRules) {
    const key = rule.merchant.toLowerCase();
    if (seenMerchants.has(key)) continue;
    seenMerchants.add(key);
    const occ = nextOccurrence(rule.merchant);
    const hasExactDate = occ && occ.daysFromNow >= 0 && occ.daysFromNow <= LOOK_AHEAD + 14;
    const subtitleParts: string[] = [`Recurring · ${rule.category ?? rule.frequency ?? "monthly"}`];
    if (occ?.account) subtitleParts.push(occ.account);
    upcoming.push({
      id: `rule-${rule.slug}`,
      date: hasExactDate ? occ!.date : thisMonth,
      daysFromNow: hasExactDate ? occ!.daysFromNow : 9999,
      title: rule.merchant,
      subtitle: subtitleParts.join(" · "),
      amount: rule.amount,
      type: "subscription",
      href: `/account/spending/merchant/${rule.slug}`,
      isOverdue: false,
      isThisMonth: !hasExactDate,
      predictedDate: !hasExactDate && occ ? occ.date : undefined,
    });
  }

  // ── D. CC minimum payment estimate ────────────────────────────────────────
  if (consolidated) {
    // Look for credit card accounts with a balance
    const stmtDocs = stmtSnap.docs;
    for (const d of stmtDocs) {
      const p = d.data().parsedData as ParsedStatementData | undefined;
      if (!p) continue;
      const acctType = (p.accountType ?? "").toLowerCase();
      if (acctType !== "credit" && acctType !== "credit card") continue;
      const balance = Math.abs(p.netWorth ?? 0);
      if (balance < 50) continue;
      // Estimate minimum: 2% of balance or $25, whichever is higher
      const minPayment = Math.max(25, balance * 0.02);
      const label = p.bankName ? `${p.bankName}${p.accountId ? ` ···${p.accountId.slice(-4)}` : ""}` : "Credit card";
      const key   = `cc-min-${label.toLowerCase().replace(/\s+/g, "-")}`;
      if (seenMerchants.has(key)) continue;
      seenMerchants.add(key);
      upcoming.push({
        id: key,
        date: thisMonth,
        daysFromNow: 9999,
        title: `${label} minimum`,
        subtitle: `Est. minimum payment · ${fmt(balance)} balance`,
        amount: Math.round(minPayment),
        type: "debt",
        href: "/account/liabilities",
        isOverdue: false,
        isThisMonth: true,
      });
    }
  }

  // ── E. Expected income (from historical deposit-day patterns) ─────────────
  // Build per-source deposit day patterns using income.sources across all statements
  interface IncomeSourcePattern {
    days: number[];
    totalPerOccurrence: number[];
    account: string;
  }
  const incomeSourcePatterns = new Map<string, IncomeSourcePattern>();

  for (const doc of stmtSnap.docs.slice(0, 8)) {
    const p = doc.data().parsedData as ParsedStatementData | undefined;
    if (!p) continue;
    const acctLabel = [p.bankName ?? "", p.accountId ? `*${p.accountId.slice(-4)}` : ""]
      .filter(Boolean).join(" ");
    for (const txn of (p.income?.transactions ?? [])) {
      if (!txn.date) continue;
      const day = parseInt(txn.date.slice(8, 10));
      if (isNaN(day) || day < 1 || day > 31) continue;
      const srcKey = normKey(txn.source || txn.category || "income");
      if (!incomeSourcePatterns.has(srcKey)) {
        incomeSourcePatterns.set(srcKey, { days: [], totalPerOccurrence: [], account: acctLabel });
      }
      const pat = incomeSourcePatterns.get(srcKey)!;
      pat.days.push(day);
      if (txn.amount) pat.totalPerOccurrence.push(txn.amount);
    }
  }

  // For each income source, predict next deposit date
  const addedIncomeDays = new Set<number>(); // avoid duplicates for same-day multi-source
  for (const [srcKey, pat] of incomeSourcePatterns) {
    if (pat.days.length < 1) continue;
    const sorted = [...pat.days].sort((a, b) => a - b);
    const medianDay = sorted[Math.floor(sorted.length / 2)];
    if (addedIncomeDays.has(medianDay)) continue;

    const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const targetDay   = Math.min(medianDay, daysInMonth);
    const mm  = String(now.getMonth() + 1).padStart(2, "0");
    const dd  = String(targetDay).padStart(2, "0");
    const expectedDate = `${now.getFullYear()}-${mm}-${dd}`;
    const diff = daysBetween(today, expectedDate);

    // Show if within look-ahead or up to 3 days past
    if (diff > LOOK_AHEAD || diff < -3) continue;

    const avgAmount = pat.totalPerOccurrence.length > 0
      ? pat.totalPerOccurrence.reduce((s, v) => s + v, 0) / pat.totalPerOccurrence.length
      : income / Math.max(incomeSourcePatterns.size, 1);
    if (avgAmount <= 0) continue;

    // Try to get a readable source name from consolidated income sources
    const sourceName = consolidated?.income?.sources?.find((s) =>
      normKey(s.description ?? "").slice(0, 6) === srcKey.slice(0, 6)
    )?.description ?? srcKey.replace(/\b\w/g, (c) => c.toUpperCase());

    addedIncomeDays.add(medianDay);
    upcoming.push({
      id: `income-${srcKey}`,
      date: expectedDate,
      daysFromNow: diff,
      title: sourceName,
      subtitle: diff < 0 ? `${pat.account ? pat.account + " · " : ""}May have already arrived` : `${pat.account ? pat.account + " · " : ""}Based on ${pat.days.length} deposit${pat.days.length !== 1 ? "s" : ""}`,
      amount: Math.round(avgAmount),
      type: "cash-in",
      href: "/account/income",
      isOverdue: false,
      isThisMonth: diff < -3,
    });
  }

  // Fallback: if no income transaction-level data, use aggregate deposit day from all txns
  if (incomeSourcePatterns.size === 0) {
    const incomeDepositDays: number[] = [];
    for (const d of stmtSnap.docs.slice(0, 6)) {
      const txns = (d.data().parsedData as ParsedStatementData | undefined)?.income?.transactions ?? [];
      for (const t of txns) {
        if (t.date) {
          const day = parseInt(t.date.slice(8, 10));
          if (!isNaN(day)) incomeDepositDays.push(day);
        }
      }
    }
    const dayCounts: Record<number, number> = {};
    for (const d of incomeDepositDays) dayCounts[d] = (dayCounts[d] ?? 0) + 1;
    const topDays = Object.entries(dayCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .map(([day]) => parseInt(day));

    for (const day of topDays) {
      const paddedDay = String(day).padStart(2, "0");
      const expectedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${paddedDay}`;
      const diff = daysBetween(today, expectedDate);
      if (diff > LOOK_AHEAD || diff < -3) continue;
      const avgIncome = income > 0 ? income / Math.max(topDays.length, 1) : 0;
      if (avgIncome <= 0) continue;
      upcoming.push({
        id: `income-${day}`,
        date: expectedDate,
        daysFromNow: diff,
        title: "Income expected",
        subtitle: diff < 0 ? "May have already arrived" : "Based on historical pattern",
        amount: Math.round(avgIncome),
        type: "cash-in",
        href: "/account/income",
        isOverdue: false,
        isThisMonth: diff < -3,
      });
    }
  }

  // ── build today insights (deterministic, from transaction dates) ─────────────
  const todayInsights: TodayInsight[] = [];

  // txData / expenseTxns / incomeTxns / allTxMonths already computed above.
  // Re-use `expenses` (current-month tx total) as `spentThisMonth` for insights.
  const spentThisMonth = expenses;
  const dayOfMonthNow  = dayOfMonth;
  const daysInMonthNow = daysInMonth;

  // 1. Spending pace insight
  if (spentThisMonth > 0 && typicalMonthlyExpenses > 0) {
    const paceProjected = (spentThisMonth / dayOfMonthNow) * daysInMonthNow;
    const pctOfTypical  = paceProjected / typicalMonthlyExpenses;
    if (pctOfTypical <= 0.90) {
      todayInsights.push({
        id: "pace_good",
        emoji: "✅",
        title: `On track — ${fmt(spentThisMonth)} spent so far`,
        subtitle: `On pace for ${fmt(Math.round(paceProjected))}, below your typical ${fmt(Math.round(typicalMonthlyExpenses))}/mo`,
        tone: "positive",
        href: "/account/spending",
      });
    } else if (pctOfTypical >= 1.20) {
      todayInsights.push({
        id: "pace_high",
        emoji: "📈",
        title: `Spending running high — ${fmt(spentThisMonth)} this month`,
        subtitle: `On pace for ${fmt(Math.round(paceProjected))} vs typical ${fmt(Math.round(typicalMonthlyExpenses))}/mo`,
        tone: "caution",
        href: "/account/spending",
      });
    } else {
      todayInsights.push({
        id: "pace_normal",
        emoji: "💳",
        title: `${fmt(spentThisMonth)} spent in ${new Date().toLocaleDateString("en-US", { month: "long" })}`,
        subtitle: `On pace for ${fmt(Math.round(paceProjected))} — typical month is ${fmt(Math.round(typicalMonthlyExpenses))}`,
        tone: "neutral",
        href: "/account/spending",
      });
    }
  }

  // 2. Cash runway insight
  if (liquidAssets > 0 && typicalMonthlyExpenses > 0) {
    const runwayDays = Math.round(liquidAssets / (typicalMonthlyExpenses / 30));
    if (runwayDays >= 90) {
      todayInsights.push({
        id: "runway_strong",
        emoji: "🏦",
        title: `${Math.round(runwayDays / 30)} months of cash on hand`,
        subtitle: `${fmt(liquidAssets)} in checking/savings — solid buffer`,
        tone: "positive",
        href: "/account/assets",
      });
    } else if (runwayDays < 30 && runwayDays >= 7) {
      todayInsights.push({
        id: "runway_low",
        emoji: "⚠️",
        title: `${runwayDays} days of cash runway`,
        subtitle: `${fmt(liquidAssets)} in checking/savings vs typical ${fmt(Math.round(typicalMonthlyExpenses))}/mo spend`,
        tone: "caution",
        href: "/account/assets",
      });
    }
  }

  // 3. Upcoming 7-day net cash flow
  const next7Out = upcoming
    .filter((i) => !i.isThisMonth && i.daysFromNow >= 0 && i.daysFromNow <= 7 && i.type !== "cash-in")
    .reduce((s, i) => s + i.amount, 0);
  const next7In  = upcoming
    .filter((i) => !i.isThisMonth && i.daysFromNow >= 0 && i.daysFromNow <= 7 && i.type === "cash-in")
    .reduce((s, i) => s + i.amount, 0);
  if (next7Out > 0 || next7In > 0) {
    const net = next7In - next7Out;
    if (next7Out > 0 && liquidAssets > 0 && next7Out > liquidAssets * 0.30) {
      todayInsights.push({
        id: "cashflow_week",
        emoji: "📅",
        title: `${fmt(next7Out)} due in the next 7 days`,
        subtitle: next7In > 0
          ? `${fmt(next7In)} expected in — net ${net >= 0 ? "+" : ""}${fmt(net)}`
          : `Check your ${fmt(liquidAssets)} balance is enough`,
        tone: "caution",
        href: "/account/spending",
      });
    } else if (next7Out > 0) {
      todayInsights.push({
        id: "cashflow_week",
        emoji: "📅",
        title: `${fmt(next7Out)} in bills this week`,
        subtitle: next7In > 0 ? `${fmt(next7In)} income expected — net ${net >= 0 ? "+" : ""}${fmt(net)}` : "Upcoming charges this week",
        tone: "neutral",
        href: "/account/spending",
      });
    }
  }

  // ── sort: overdue → dated (asc) → this-month (cash-out first, income last) ─
  upcoming.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    if (!a.isThisMonth && b.isThisMonth) return -1;
    if (a.isThisMonth && !b.isThisMonth) return 1;
    if (a.isThisMonth && b.isThisMonth) {
      const todayStr = new Date().toISOString().slice(0, 10);
      const aDate = a.predictedDate ?? "";
      const bDate = b.predictedDate ?? "";
      const aIsPast = aDate && aDate < todayStr;
      const bIsPast = bDate && bDate < todayStr;
      // upcoming before past
      if (!aIsPast && bIsPast) return -1;
      if (aIsPast && !bIsPast) return 1;
      // both upcoming → soonest first; both past → most recent first
      if (!aIsPast && !bIsPast) return aDate.localeCompare(bDate);
      return bDate.localeCompare(aDate);
    }
    return a.date.localeCompare(b.date);
  });

  return NextResponse.json({ alerts: cappedAlerts, upcoming, today, insights: todayInsights });
}
