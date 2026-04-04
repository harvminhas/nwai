import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { consolidateStatements, getYearMonth } from "@/lib/consolidate";
import type { ParsedStatementData } from "@/lib/types";
import { buildAccountSlug } from "@/lib/accountSlug";
import { merchantSlug } from "@/lib/applyRules";
import { getFinancialProfile } from "@/lib/financialProfile";
import { getNetWorth, getSavingsRate, getMonthlyIncome, getMonthlyExpenses, getLatestCompleteMonth, getMonthlyDebtPayments } from "@/lib/profileMetrics";
import { CORE_EXCLUDE_RE } from "@/lib/spendingMetrics";
import { detectFrequency } from "@/lib/incomeEngine";
import { projectNextDates, nextUpcoming, toDateStr } from "@/lib/projectionEngine";
import { computeRadarItems } from "@/lib/today/computeRadarItems";
import type { RadarItem, CalendarEvent, FreshnessData, FreshnessState, NetWorthSnapshot } from "@/lib/today/types";
import { resolveCanonical } from "@/lib/sourceMappings";
import type { SourceMapping } from "@/lib/sourceMappings";
import { INCOME_TRANSFER_RE } from "@/lib/spendingMetrics";

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
  const [cashSnap, recurringSnap, ratesSnap, sourceMappingsSnap, cashIncomeSnap] = await Promise.all([
    db.collection(`users/${uid}/cashCommitments`).get(),
    db.collection(`users/${uid}/recurringRules`).get(),
    db.collection(`users/${uid}/accountRates`).get(),
    db.collection(`users/${uid}/sourceMappings`).get(),
    db.collection(`users/${uid}/cashIncome`).get(),
  ]);
  const cashItems = cashSnap.docs.map((d) => d.data() as {
    id: string; name: string; amount: number; frequency: string;
    category: string; notes?: string; nextDate?: string;
  });
  const cashIncomeItems = cashIncomeSnap.docs.map((d) => d.data() as import("@/lib/cashIncome").CashIncomeEntry);

  // ── 3. User-marked recurring rules ─────────────────────────────────────────
  const recurringRules = recurringSnap.docs.map((d) => d.data() as {
    merchant: string; amount: number; frequency: string; category?: string; slug: string;
  });

  // ── 4. Account rates (CC APR alert + minimum payment estimate) ─────────────
  const ratesByAccount: Record<string, number> = {};
  for (const d of ratesSnap.docs) {
    const r = d.data();
    ratesByAccount[d.id] = (r.manualRate ?? r.aiRate ?? 0) as number;
  }

  // ── 4b. Source mappings (income deduplication) ─────────────────────────────
  const sourceMappings = sourceMappingsSnap.docs.map((d) => d.data() as SourceMapping);

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

  // ── Financial profile (single source of truth — same data as spending page) ──
  // Category rules are pre-applied. typicalMonthly computed over full history.
  const profile = await getFinancialProfile(uid, db);
  const { expenseTxns, incomeTxns, accountSnapshots: txSnapshots, allTxMonths } = profile;

  // Override liquid assets from profile snapshots
  if (txSnapshots.length > 0) {
    liquidAssets = txSnapshots
      .filter((a) => /checking|savings|cash/i.test(a.accountType))
      .reduce((s, a) => s + Math.max(0, a.balance), 0);
  }

  const dayOfMonth    = now.getDate();
  const daysInMonth   = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const monthFraction = dayOfMonth / daysInMonth;

  const income   = incomeTxns.filter((t) => t.txMonth === thisMonth).reduce((s, t) => s + t.amount, 0);
  const expenses = expenseTxns
    .filter((t) => t.txMonth === thisMonth && !CORE_EXCLUDE_RE.test((t.category ?? "").trim()))
    .reduce((s, t) => s + t.amount, 0);
  const debts = txSnapshots.reduce((s, a) => s + Math.max(0, -a.balance), 0);

  const dataIsCurrentMonth     = allTxMonths.includes(thisMonth);
  const typicalMonthlyExpenses = profile.typicalMonthly.median;

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

  // ── E. Expected income — frequency-aware projection ─────────────────────────
  // Group incomeTxns by source, detect frequency, project next dates using
  // medianGap instead of day-of-month (which breaks for biweekly pay).

  // Transfers that landed in income should never be treated as recurring income.
  // Uses the canonical INCOME_TRANSFER_RE (same regex used by the cache pipeline).
  const incomeBySource = new Map<string, typeof incomeTxns>();
  for (const txn of incomeTxns) {
    const src = txn.source || txn.description || "income";
    if (INCOME_TRANSFER_RE.test(src)) continue;        // skip transfer-like sources
    const canonical = resolveCanonical(src, sourceMappings);  // merge confirmed aliases
    const key = normKey(canonical);
    const arr = incomeBySource.get(key) ?? [];
    arr.push(txn);
    incomeBySource.set(key, arr);
  }

  for (const [srcKey, txns] of incomeBySource) {
    // Require at least 2 occurrences before predicting — a single deposit is
    // not a confirmed pattern and should not show as overdue/upcoming.
    if (txns.length < 2) continue;

    const sortedByDate = [...txns].sort((a, b) => b.date.localeCompare(a.date));
    const lastDate     = sortedByDate[0].date;
    const allDates     = txns.map((t) => t.date).filter(Boolean).sort();
    const freq         = detectFrequency(allDates);

    // Use the most recent transaction amount — salary and regular deposits can
    // change over time (e.g. tax rate changes mid-year), so the latest is the
    // best predictor rather than a median of older values.
    const latestAmt = sortedByDate.find((t) => t.amount > 0)?.amount ?? 0;
    if (latestAmt <= 0) continue;

    const sourceName = resolveCanonical(
      txns[0].source || txns[0].description || srcKey.replace(/\b\w/g, (c) => c.toUpperCase()),
      sourceMappings
    );

    if (freq.frequency !== "irregular" && freq.medianGap && freq.medianGap >= 5) {
      // Frequency-aware: project from last date using gap
      const projections = projectNextDates(lastDate, freq.medianGap, 4, true);
      const seenDates   = new Set<string>();

      for (const p of projections) {
        if (p.daysFromToday > LOOK_AHEAD) break;
        if (p.daysFromToday < -3) continue;
        if (seenDates.has(p.dateStr)) continue;
        seenDates.add(p.dateStr);

        const patternLabel = `Predicted from ${freq.medianGap}-day pattern`;
        upcoming.push({
          id: `income-proj-${srcKey}-${p.dateStr}`,
          date: p.dateStr,
          daysFromNow: p.daysFromToday,
          title: sourceName,
          subtitle: p.daysFromToday < 0
            ? `May have already arrived · ${patternLabel}`
            : patternLabel,
          amount: Math.round(latestAmt),
          type: "cash-in",
          href: "/account/income",
          isOverdue: p.daysFromToday < 0,
          isThisMonth: false,
          predictedDate: p.dateStr,
        });
      }
    } else {
      // Fallback: day-of-month median for monthly/irregular
      const days      = allDates.map((d) => parseInt(d.slice(8, 10)));
      const medianDay = [...days].sort((a, b) => a - b)[Math.floor(days.length / 2)];
      const daysInMo  = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const targetDay = Math.min(medianDay, daysInMo);
      const expectedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
      const diff      = daysBetween(today, expectedDate);
      if (diff <= LOOK_AHEAD && diff >= -3) {
        upcoming.push({
          id: `income-${srcKey}`,
          date: expectedDate,
          daysFromNow: diff,
          title: sourceName,
          subtitle: diff < 0 ? "May have already arrived" : `Based on ${txns.length} deposit${txns.length !== 1 ? "s" : ""}`,
          amount: Math.round(latestAmt),
          type: "cash-in",
          href: "/account/income",
          isOverdue: diff < 0,
          isThisMonth: diff < -3,
        });
      }
    }
  }

  // ── E2. Cash income entries — recurring ones feed Next Up ────────────────────
  for (const entry of cashIncomeItems) {
    if (entry.frequency === "once") {
      // One-off: only show if nextDate is within look-ahead window
      if (!entry.nextDate) continue;
      const diff = daysBetween(today, entry.nextDate);
      if (diff > LOOK_AHEAD || diff < -3) continue;
      const key = `cash-income-once-${entry.id}`;
      if (seenMerchants.has(key)) continue;
      seenMerchants.add(key);
      upcoming.push({
        id: key,
        date: entry.nextDate,
        daysFromNow: diff,
        title: entry.name,
        subtitle: `One-off · ${entry.category}`,
        amount: entry.amount,
        type: "cash-in",
        href: "/account/income?tab=cash",
        isOverdue: diff < 0,
        isThisMonth: false,
      });
    } else {
      // Recurring: nextDate is the NEXT expected date (not a past anchor).
      // Advance forward by frequency gap until we reach a date ≥ today−3 days,
      // then emit up to 2 upcoming occurrences within the look-ahead window.
      if (!entry.nextDate) continue;
      const freqDays: Record<string, number> = {
        weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, annual: 365,
      };
      const gap = freqDays[entry.frequency] ?? 30;
      // Use a wider look-ahead for income so monthly entries are always visible
      const incomeLookAhead = Math.max(LOOK_AHEAD, gap + 7);

      // Step forward from nextDate until we find the first occurrence that isn't
      // more than 3 days in the past.
      let cursor = new Date(entry.nextDate + "T12:00:00Z");
      const todayMs = new Date(today + "T00:00:00Z").getTime();
      const gapMs   = gap * 86_400_000;
      while (cursor.getTime() < todayMs - 3 * 86_400_000) {
        cursor = new Date(cursor.getTime() + gapMs);
      }

      // Emit up to 2 occurrences within the look-ahead window
      for (let i = 0; i < 2; i++) {
        const daysFromNow = Math.round((cursor.getTime() - todayMs) / 86_400_000);
        if (daysFromNow > incomeLookAhead) break;
        const dateStr = toDateStr(cursor);
        const key = `cash-income-${entry.id}-${dateStr}`;
        if (!seenMerchants.has(key)) {
          seenMerchants.add(key);
          upcoming.push({
            id: key,
            date: dateStr,
            daysFromNow,
            title: entry.name,
            subtitle: daysFromNow < 0
              ? `May have already arrived · ${entry.frequency} · ${entry.category}`
              : `${entry.frequency} · ${entry.category}`,
            amount: entry.amount,
            type: "cash-in",
            href: "/account/income?tab=cash",
            isOverdue: daysFromNow < 0,
            isThisMonth: dateStr.slice(0, 7) === today.slice(0, 7),
            predictedDate: dateStr,
          });
        }
        cursor = new Date(cursor.getTime() + gapMs);
      }
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
      if (!aIsPast && bIsPast) return -1;
      if (aIsPast && !bIsPast) return 1;
      if (!aIsPast && !bIsPast) return aDate.localeCompare(bDate);
      return bDate.localeCompare(aDate);
    }
    return a.date.localeCompare(b.date);
  });

  // ── F. Radar (calendar collision detection) ───────────────────────────────
  // Build merchantPatternDates map for annual bill detection
  const merchantPatternDates = new Map<string, { dates: string[]; amounts: number[] }>();
  for (const doc of stmtSnap.docs) {
    const p = doc.data().parsedData as ParsedStatementData | undefined;
    if (!p) continue;
    for (const txn of (p.expenses?.transactions ?? [])) {
      if (!txn.date || !txn.merchant) continue;
      const key = normKey(txn.merchant);
      if (!merchantPatternDates.has(key)) merchantPatternDates.set(key, { dates: [], amounts: [] });
      const entry = merchantPatternDates.get(key)!;
      entry.dates.push(txn.date);
      if (txn.amount) entry.amounts.push(Math.abs(txn.amount));
    }
  }

  const radar: RadarItem[] = computeRadarItems({
    incomeTxns,
    expenseTxns,
    cashCommitments: cashItems,
    aiSubs: consolidated?.subscriptions ?? [],
    merchantPatternDates,
  });

  // ── G. Calendar events (overdue + this month) ─────────────────────────────
  // Convert upcoming items into the richer CalendarEvent format
  function upcomingToCalendarEvent(item: UpcomingItem): CalendarEvent {
    const tags: CalendarEvent["tags"] = [];
    if (item.isOverdue) tags.push({ type: "overdue", text: `${Math.abs(item.daysFromNow)}d overdue` });
    const patternTag = item.predictedDate
      ? (() => {
          // Extract the gap hint from the subtitle if present
          const m = item.subtitle?.match(/(\d+)-day pattern/);
          return m ? `Predicted from ${m[1]}-day pattern` : "Predicted";
        })()
      : undefined;

    const timing = item.isOverdue
      ? `Expected ${new Date(item.date + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
      : item.daysFromNow === 0 ? "Today"
      : item.daysFromNow === 1 ? "due tomorrow"
      : item.predictedDate
        ? `Predicted · ${new Date(item.predictedDate + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`
        : item.isThisMonth ? "this month"
        : `due ${new Date(item.date + "T00:00:00").toLocaleDateString("en-CA", { month: "short", day: "numeric" })}`;

    const iconBg = item.type === "cash-in"      ? "#dcfce7"
                 : item.type === "debt"          ? "#fee2e2"
                 : item.type === "subscription"  ? "#f3e8ff"
                 : "#fef3c7";
    const icon   = item.type === "cash-in"      ? "💵"
                 : item.type === "debt"          ? "📋"
                 : item.type === "subscription"  ? "🔄"
                 : "💸";

    const amtFmt = new Intl.NumberFormat("en-CA", {
      style: "currency", currency: "CAD",
      minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(item.amount);

    return {
      id: item.id,
      icon,
      iconBg,
      title: item.title,
      tags,
      sub: item.subtitle ?? "",
      patternTag,
      amount: item.type === "cash-in" ? `+${amtFmt}` : `−${amtFmt}`,
      amountClass: item.type === "cash-in" ? "income" : "expense",
      timing,
      status: item.isOverdue ? "overdue" : item.predictedDate ? "predicted" : "confirmed",
      dueDate: item.date,
      daysFromToday: item.daysFromNow,
      href: item.href,
    };
  }

  const overdueEvents: CalendarEvent[]    = upcoming.filter((i) => i.isOverdue).map(upcomingToCalendarEvent);
  const thisMonthEvents: CalendarEvent[]  = upcoming.filter((i) => !i.isOverdue).map(upcomingToCalendarEvent);
  const thisMonthCollapsedCount           = thisMonthEvents.filter(
    (e) => e.dueDate < today && e.status !== "confirmed",
  ).length;

  // ── H. Freshness ──────────────────────────────────────────────────────────
  // Build per-account upload dates from statement metadata
  // ── Build per-account statement-date history ──────────────────────────────
  // Key: slug → sorted array of statement dates (from parsedData.statementDate)
  const acctStmtDatesMap = new Map<string, string[]>();
  const acctLabelMap     = new Map<string, string>();

  for (const doc of stmtSnap.docs) {
    const p = doc.data().parsedData as ParsedStatementData | undefined;
    if (!p?.statementDate) continue;
    const slug  = buildAccountSlug(p.bankName, p.accountId);
    const dates = acctStmtDatesMap.get(slug) ?? [];
    dates.push(p.statementDate);
    acctStmtDatesMap.set(slug, dates);

    if (!acctLabelMap.has(slug)) {
      // Prefer specific account name, fall back to "Bank AccountType"
      const label = p.accountName
        ?? (p.bankName && p.accountType
            ? `${p.bankName} ${p.accountType.charAt(0).toUpperCase()}${p.accountType.slice(1).toLowerCase()}`
            : p.bankName ?? p.accountType ?? "Account");
      acctLabelMap.set(slug, label);
    }
  }

  // ── Determine freshness per account ───────────────────────────────────────
  // For each account:
  //   1. Find the typical issue day-of-month (median across all statement dates).
  //   2. Compute the expected statement date for the current cycle:
  //      the most recent past occurrence of that day-of-month.
  //   3. Flag as overdue if we have no statement dated ≥ expected date.
  //   Give a 5-day grace period so a fresh statement isn't immediately flagged.
  const GRACE_DAYS = 8; // 5 days for user to upload + 3 days for bank publishing delay
  const todayMs    = new Date(today + "T00:00:00").getTime();

  const freshnessAccounts: FreshnessData["accounts"] = [];

  for (const [slug, rawDates] of acctStmtDatesMap) {
    const sorted    = [...rawDates].filter(Boolean).sort();
    const latestStmt = sorted[sorted.length - 1];

    // Typical issue day-of-month (median)
    const issueDays = sorted.map((d) => parseInt(d.slice(8, 10), 10)).filter((n) => n > 0 && n <= 31);
    const sortedDays = [...issueDays].sort((a, b) => a - b);
    const typicalDay = sortedDays[Math.floor(sortedDays.length / 2)] ?? 1;

    // Expected date = most recent occurrence of typicalDay on or before today
    const todayDate = new Date(today + "T00:00:00");
    const exp       = new Date(todayDate);
    exp.setDate(typicalDay);
    // If this month's issue day hasn't passed yet, use last month
    if (exp.getTime() > todayMs) {
      exp.setMonth(exp.getMonth() - 1);
    }
    const expectedDate = exp.toISOString().slice(0, 10);

    // Grace period: only flag overdue after GRACE_DAYS past expected date
    const daysOverdue = Math.max(0, Math.round((todayMs - exp.getTime()) / 86_400_000) - GRACE_DAYS);
    const isOverdue   = latestStmt < expectedDate && daysOverdue > 0;

    freshnessAccounts.push({
      name:         acctLabelMap.get(slug) ?? slug,
      statementDate: latestStmt,
      expectedDate,
      isOverdue,
      daysOverdue:  isOverdue ? daysOverdue : 0,
    });
  }

  const maxDaysOverdue = freshnessAccounts.reduce((m, a) => Math.max(m, a.daysOverdue), 0);
  const freshnessState: FreshnessState = maxDaysOverdue === 0 ? "fresh"
                                       : maxDaysOverdue <= 14 ? "aging"
                                       : "stale";
  const freshness: FreshnessData = {
    state:      freshnessState,
    daysOverdue: maxDaysOverdue,
    accounts:   freshnessAccounts.sort((a, b) => b.statementDate.localeCompare(a.statementDate)),
  };

  // ── I. Net worth snapshot ─────────────────────────────────────────────────
  const nw = getNetWorth(profile, thisMonth);
  const netWorth: NetWorthSnapshot = {
    total:           nw.total,
    calculatedLabel: nw.calculatedLabel,
    isStale:         nw.isStale,
    accounts:        nw.accounts,
    debtAccounts:    nw.debtAccounts,
  };

  // ── Status banner ─────────────────────────────────────────────────────────
  // Derive a single top-level status message from the most important condition.
  // This replaces the old alerts[] for the banner position (alerts are still returned
  // for backwards compat).
  let statusText   = "";
  let statusDetail = "";
  let statusType: "ok" | "warn" | "alert" = "ok";

  if (freshnessState === "stale") {
    statusType   = "alert";
    const overdueAccounts = freshness.accounts.filter((a) => a.isOverdue).map((a) => a.name);
    statusText   = overdueAccounts.length > 0
      ? `${overdueAccounts.join(", ")} statement${overdueAccounts.length > 1 ? "s" : ""} overdue — upload to refresh predictions`
      : `Statements overdue — predictions may be unreliable`;
    statusDetail = "Upload your latest bank statement to get accurate predictions. Most predictions use data from your last upload.";
  } else if (alerts.some((a) => a.type === "spending_pace")) {
    statusType   = "warn";
    statusText   = "Spending ahead of income";
    statusDetail = alerts.find((a) => a.type === "spending_pace")?.body ?? "";
  } else if (alerts.some((a) => a.type === "low_liquid")) {
    statusType   = "warn";
    statusText   = alerts.find((a) => a.type === "low_liquid")!.title;
    statusDetail = alerts.find((a) => a.type === "low_liquid")!.body;
  } else if (radar.some((r) => r.type === "warn" && r.targetMonthKey >= thisMonth)) {
    const highWarn = radar.find((r) => r.type === "warn" && r.targetMonthKey >= thisMonth);
    statusType   = "warn";
    statusText   = highWarn?.title ?? "Upcoming cash flow pressure — plan ahead";
    statusDetail = highWarn?.sub ?? "";
  } else if (radar.some((r) => r.type === "windfall" && r.targetMonthKey >= thisMonth)) {
    const windfall = radar.find((r) => r.type === "windfall" && r.targetMonthKey >= thisMonth);
    statusType = "ok";
    statusText   = windfall?.title ?? `${windfall?.when ?? "Next month"} is a strong month`;
    statusDetail = windfall?.sub ?? "";
  } else if (spentThisMonth > 0 && typicalMonthlyExpenses > 0) {
    const pace = (spentThisMonth / dayOfMonth) * daysInMonth;
    if (pace <= typicalMonthlyExpenses * 0.95) {
      statusType   = "ok";
      statusText   = `On track — ${fmt(spentThisMonth)} spent so far`;
      statusDetail = `On pace for ${fmt(Math.round(pace))}, below your typical ${fmt(Math.round(typicalMonthlyExpenses))}/mo`;
    }
  }

  return NextResponse.json({
    // Legacy fields (kept for backwards compat with existing UI consumers)
    alerts: cappedAlerts,
    upcoming,
    today,
    insights: todayInsights,
    // New fields for redesigned Today page
    radar,
    overdueEvents,
    thisMonthEvents,
    thisMonthCollapsedCount,
    freshness,
    netWorth,
    savingsRate: (() => {
      // Use the latest month that has both income AND expenses (a complete month).
      // This skips the current partial month (e.g. April with only cash income
      // but no expenses yet) and correctly surfaces March if March statements exist.
      const savingsMonth = getLatestCompleteMonth(profile);
      return {
        rate:         getSavingsRate(profile, savingsMonth),
        income:       getMonthlyIncome(profile, savingsMonth),
        expenses:     getMonthlyExpenses(profile, savingsMonth, { core: true }),
        debtPayments: getMonthlyDebtPayments(profile, savingsMonth),
        month:        savingsMonth,
      };
    })(),
    statusBanner: statusText
      ? { type: statusType, text: statusText, detail: statusDetail }
      : null,
    needsRefresh: profile.cacheStale ?? false,
  });
}
