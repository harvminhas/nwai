"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Suspense } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { ManualLiability, LiabilityCategory, SubAccount } from "@/lib/types";
import type { AccountSnapshot } from "@/lib/extractTransactions";
import type { AccountBalanceHistory } from "@/lib/financialProfile";
import type { AccountRateEntry } from "@/app/api/user/account-rates/route";
import { usePlan } from "@/contexts/PlanContext";
import UpgradePrompt from "@/components/UpgradePrompt";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";
import { fmt, getCurrencySymbol, formatCurrency } from "@/lib/currencyUtils";

// ── constants ─────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<LiabilityCategory, { label: string; color: string; barColor: string }> = {
  mortgage:       { label: "Mortgage",        color: "bg-red-50 text-red-700",       barColor: "bg-red-400" },
  auto_loan:      { label: "Auto Loan",        color: "bg-blue-50 text-blue-700",     barColor: "bg-blue-400" },
  student_loan:   { label: "Student Loan",     color: "bg-indigo-50 text-indigo-700", barColor: "bg-indigo-400" },
  personal_loan:  { label: "Personal Loan",    color: "bg-yellow-50 text-yellow-700", barColor: "bg-yellow-400" },
  credit_card:    { label: "Credit Card",      color: "bg-orange-50 text-orange-700", barColor: "bg-orange-400" },
  line_of_credit: { label: "Line of Credit",   color: "bg-purple-50 text-purple-700", barColor: "bg-purple-400" },
  other:          { label: "Other",            color: "bg-gray-100 text-gray-600",    barColor: "bg-gray-400" },
};

const CATEGORY_ORDER: LiabilityCategory[] = [
  "mortgage", "auto_loan", "student_loan", "personal_loan", "credit_card", "line_of_credit", "other",
];

const ACCT_TYPE_TO_CAT: Record<string, LiabilityCategory> = {
  mortgage: "mortgage",
  loan: "personal_loan",
  credit: "credit_card",
  line_of_credit: "line_of_credit",
};

/**
 * Names that indicate a home equity line of credit / revolving LOC regardless
 * of what accountType the AI stored (retroactively fixes "loan"-typed HELOCs).
 */
const HELOC_NAME_RE = /flexline|flex[- ]line|heloc|home[\s-]?equity[\s-]?(line|loc)|equity[\s-]?line[\s-]?of[\s-]?credit|line[\s-]?of[\s-]?credit/i;

function deriveCategoryFromSnapshot(accountType: string, accountName?: string): LiabilityCategory {
  if (accountName && HELOC_NAME_RE.test(accountName)) return "line_of_credit";
  return ACCT_TYPE_TO_CAT[accountType] ?? "other";
}

// ── tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",  label: "Overview" },
  { id: "accounts",  label: "Accounts" },
  { id: "payoff",    label: "Payoff planner" },
] as const;
type TabId = typeof TABS[number]["id"];

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtShort(v: number, currency?: string) {
  const sym = getCurrencySymbol(currency);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sym}${Math.round(abs / 1_000)}k`;
  return fmt(v, currency);
}
function normalizeName(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function addMonths(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

// ── APR resolution — single source of truth ───────────────────────────────────
// Priority: (1) rate extracted from the statement itself, (2) stored rate from
// the account-rates API matched by exact accountKey, (3) category default.
// This mirrors exactly what the account detail page does — no fuzzy name guessing.

const APR_CATEGORY_DEFAULTS: Partial<Record<LiabilityCategory, number>> = {
  credit_card: 19.99, line_of_credit: 9.99, mortgage: 4.5,
  auto_loan: 6.5, student_loan: 5.5, personal_loan: 8.99,
};

function resolveApr(
  lib: DisplayLiability,
  accountRates: AccountRateEntry[],
): { apr: number | null; estimated: boolean } {
  // 1. Rate on the statement itself (most authoritative)
  if (lib.interestRate != null) return { apr: lib.interestRate, estimated: false };

  // 2. Stored rate from account-rates API — exact accountKey match
  const stored = accountRates.find((r) => r.accountKey === lib.accountSlug);
  if (stored?.effectiveRate != null) return { apr: stored.effectiveRate, estimated: false };

  // 3. Category default (flag as estimated so UI can warn the user)
  const def = APR_CATEGORY_DEFAULTS[lib.category] ?? null;
  return { apr: def, estimated: def != null };
}

// ── payoff math ───────────────────────────────────────────────────────────────

function calcAmortisedPayment(balance: number, apr: number, months: number): number {
  const r = apr / 100 / 12;
  if (r === 0 || months === 0) return balance / Math.max(months, 1);
  const pow = Math.pow(1 + r, months);
  return (balance * r * pow) / (pow - 1);
}

const DEFAULT_TERMS: Record<LiabilityCategory, number> = {
  mortgage: 25 * 12, auto_loan: 5 * 12, student_loan: 10 * 12,
  personal_loan: 3 * 12, credit_card: 0, line_of_credit: 0, other: 5 * 12,
};

function estimateMinPayment(balance: number, apr: number | null, cat: LiabilityCategory): number {
  if (cat === "credit_card") return Math.max(Math.ceil(balance * 0.02), 25);
  // HELOCs and revolving LOCs: minimum = interest-only (balance × monthly rate).
  // Using a 7% default if APR unknown — real rate from statement is preferred.
  if (cat === "line_of_credit") {
    const monthlyRate = (apr ?? 7) / 100 / 12;
    return Math.max(25, Math.round(balance * monthlyRate));
  }
  const rate = apr ?? 5;
  return Math.round(calcAmortisedPayment(balance, rate, DEFAULT_TERMS[cat] ?? 60));
}

interface PayoffDebt {
  id: string; label: string; bankName?: string; category: LiabilityCategory;
  balance: number; currency?: string; apr: number | null; aprEstimated: boolean; minPayment: number;
}

function simulate(
  debts: PayoffDebt[],
  extraMonthly: number,
  order: string[],
): { debtResults: Map<string, { payoffMonths: number; interestPaid: number }>; totalMonths: number; totalInterestPaid: number } {
  if (debts.length === 0) return { debtResults: new Map(), totalMonths: 0, totalInterestPaid: 0 };

  const state = new Map(debts.map((d) => [d.id, { ...d, remaining: d.balance, interestPaid: 0 }]));
  const finished = new Map<string, { payoffMonths: number; interestPaid: number }>();

  for (let m = 1; m <= 600; m++) {
    const alive = order.filter((id) => (state.get(id)?.remaining ?? 0) > 0.01);
    if (alive.length === 0) break;

    // Determine which debt gets the extra this month (first unfinished in priority order)
    let priorityId: string | null = null;
    for (const id of order) {
      if ((state.get(id)?.remaining ?? 0) > 0.01) { priorityId = id; break; }
    }

    for (const id of alive) {
      const d = state.get(id)!;
      const monthlyRate = (d.apr ?? 0) / 100 / 12;
      const interest = d.remaining * monthlyRate;

      // For credit cards the real minimum scales with the current balance (2 % of balance).
      // This prevents artificially small fixed minimums from letting the balance grow
      // explosively when APR > 2 %/month.
      const dynamicMin = d.category === "credit_card"
        ? Math.max(Math.ceil(d.remaining * 0.02), 25)
        : d.minPayment;

      const extra   = id === priorityId ? extraMonthly : 0;
      const payment = Math.min(d.remaining + interest, dynamicMin + extra);

      // Only count interest actually covered by the payment (avoids inflating totals
      // when payment < interest, i.e. negative amortisation).
      const interestCovered = Math.min(interest, payment);
      d.interestPaid += interestCovered;
      d.remaining = Math.max(0, d.remaining + interest - payment);
    }

    for (const id of alive) {
      const d = state.get(id)!;
      if (d.remaining <= 0.01 && !finished.has(id)) {
        finished.set(id, { payoffMonths: m, interestPaid: Math.round(d.interestPaid) });
      }
    }
  }

  for (const [id, d] of state) {
    if (!finished.has(id)) finished.set(id, { payoffMonths: 600, interestPaid: Math.round(d.interestPaid) });
  }

  const totalMonths       = Math.max(0, ...Array.from(finished.values()).map((r) => r.payoffMonths));
  const totalInterestPaid = Array.from(finished.values()).reduce((s, r) => s + r.interestPaid, 0);
  return { debtResults: finished, totalMonths, totalInterestPaid };
}

// ── icons ─────────────────────────────────────────────────────────────────────

function CategoryIcon({ cat }: { cat: LiabilityCategory }) {
  const base = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full";
  if (cat === "credit_card" || cat === "line_of_credit")
    return <span className={`${base} bg-orange-100`}><svg className="h-4 w-4 text-orange-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg></span>;
  if (cat === "mortgage")
    return <span className={`${base} bg-red-100`}><svg className="h-4 w-4 text-red-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" /></svg></span>;
  if (cat === "auto_loan")
    return <span className={`${base} bg-blue-100`}><svg className="h-4 w-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M8 7h8m-8 5h8m-4 5v-5M5 17H3a1 1 0 01-1-1v-5l2-5h14l2 5v5a1 1 0 01-1 1h-2m-10 0a2 2 0 104 0m6 0a2 2 0 104 0" /></svg></span>;
  return <span className={`${base} bg-gray-100`}><svg className="h-4 w-4 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg></span>;
}

// ── display type ──────────────────────────────────────────────────────────────

interface DisplayLiability {
  id: string; label: string; subLabel?: string; category: LiabilityCategory;
  balance: number; currency?: string; interestRate?: number; statementDate?: string;
  source: "manual" | "statement"; accountSlug?: string;
  subAccounts?: SubAccount[];
  /** Actual payments received from the latest statement — used as min payment when available. */
  paymentsMade?: number;
}

// ── modal ─────────────────────────────────────────────────────────────────────

function LiabilityModal({ initial, onSave, onClose, saving }: {
  initial?: ManualLiability | null;
  onSave: (data: Omit<ManualLiability, "id" | "updatedAt">) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}) {
  const [label, setLabel]       = useState(initial?.label ?? "");
  const [category, setCategory] = useState<LiabilityCategory>(initial?.category ?? "auto_loan");
  const [balance, setBalance]   = useState(initial?.balance?.toString() ?? "");
  const [rate, setRate]         = useState(initial?.interestRate?.toString() ?? "");
  const [err, setErr]           = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const bal = parseFloat(balance);
    if (!label.trim()) { setErr("Name is required."); return; }
    if (isNaN(bal) || bal < 0) { setErr("Enter a valid balance."); return; }
    setErr(null);
    const rateNum = rate !== "" ? parseFloat(rate) : undefined;
    await onSave({ label: label.trim(), category, balance: bal, interestRate: isNaN(rateNum!) ? undefined : rateNum });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-gray-900">{initial ? "Edit liability" : "Add liability"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Type</label>
            <select value={category} onChange={(e) => setCategory(e.target.value as LiabilityCategory)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-purple-400 focus:outline-none">
              {CATEGORY_ORDER.map((cat) => <option key={cat} value={cat}>{CATEGORY_META[cat].label}</option>)}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Name / lender</label>
            <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
              placeholder={category === "auto_loan" ? "e.g. Honda Civic – TD Auto" : "e.g. RBC Mortgage"}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Outstanding balance ($)</label>
              <input type="number" min="0" step="0.01" value={balance} onChange={(e) => setBalance(e.target.value)}
                placeholder="0" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none" />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Interest rate (%, optional)</label>
              <input type="number" min="0" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)}
                placeholder="e.g. 6.5" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none" />
            </div>
          </div>
          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
            <button type="submit" disabled={saving} className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── chart colors by category ──────────────────────────────────────────────────

const CATEGORY_CHART_COLOR: Record<LiabilityCategory, string> = {
  mortgage:       "#ef4444",
  auto_loan:      "#3b82f6",
  student_loan:   "#6366f1",
  personal_loan:  "#eab308",
  credit_card:    "#f97316",
  line_of_credit: "#8b5cf6",
  other:          "#94a3b8",
};

// ── per-account monthly history ───────────────────────────────────────────────

export interface AccountMonthlyData {
  slug: string;
  label: string;
  accountId?: string; // masked account number e.g. "****1234"
  category: LiabilityCategory;
  color: string;
  // sorted oldest → newest
  months: { ym: string; balance: number }[];
  currentBalance: number;
  prevBalance: number | null;
  delta: number | null; // positive = debt increased (bad), negative = paid down (good)
}

// Inline SVG sparkline (no recharts overhead for small charts)
function Sparkline({ values, color, good }: { values: number[]; color: string; good: "up" | "down" }) {
  if (values.length < 2) return null;
  const W = 64, H = 24, PAD = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const xs = values.map((_, i) => PAD + (i / (values.length - 1)) * (W - PAD * 2));
  const ys = values.map((v) => H - PAD - ((v - min) / range) * (H - PAD * 2));
  const pts = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  // trend: for debts going down = good; for assets going up = good
  const first = values[0], last = values[values.length - 1];
  const trending = good === "down" ? last < first : last > first;
  const strokeColor = trending ? "#16a34a" : "#dc2626";
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={strokeColor} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={2.5} fill={strokeColor} />
    </svg>
  );
}

// ── tab: overview ─────────────────────────────────────────────────────────────

interface DebtHistoryPoint { ym: string; label: string; total: number; isEstimate: boolean; totalSolid: number | null; totalDashed: number | null; }

function OverviewTab({ libs, debtHistory, accountMonthly, paymentsMade, accountRates, homeCurrency, fxRates }: {
  libs: DisplayLiability[];
  debtHistory: DebtHistoryPoint[];
  accountMonthly: AccountMonthlyData[];
  paymentsMade: number;
  accountRates: AccountRateEntry[];
  homeCurrency: string;
  fxRates: Record<string, number>;
}) {
  // Convert a liability's native-currency balance to the home currency for aggregation.
  function toHome(amount: number, currency?: string): number {
    const cur = (currency ?? homeCurrency).toUpperCase();
    if (cur === homeCurrency.toUpperCase()) return amount;
    const rate = fxRates[cur];
    return rate ? amount * rate : amount;
  }

  const total = libs.reduce((s, l) => s + toHome(l.balance, l.currency), 0);
  const [selectedYm, setSelectedYm] = useState<string | null>(null);
  if (libs.length === 0) return <EmptyState />;

  const selectedPt = selectedYm ? debtHistory.find((p) => p.ym === selectedYm) ?? null : null;
  const selectedIdx = selectedYm ? debtHistory.findIndex((p) => p.ym === selectedYm) : -1;
  const prevPtYm = selectedIdx > 0 ? debtHistory[selectedIdx - 1].ym : null;
  // Find the latest known balance at-or-before a given ym for an account
  const latestBalanceAtOrBefore = (a: AccountMonthlyData, ym: string) => {
    const pts = a.months.filter((m) => m.ym <= ym);
    if (pts.length === 0) return null;
    return pts[pts.length - 1].balance;
  };
  const selectedRows = accountMonthly
    .map((a) => {
      const bal = selectedYm ? latestBalanceAtOrBefore(a, selectedYm) : null;
      const prevBal = prevPtYm ? latestBalanceAtOrBefore(a, prevPtYm) : null;
      const delta = bal !== null && prevBal !== null ? bal - prevBal : null;
      return { ...a, balanceThisMonth: bal, balancePrevMonth: prevBal, delta };
    })
    .filter((r) => r.balanceThisMonth !== null)
    .sort((a, b) => (b.balanceThisMonth ?? 0) - (a.balanceThisMonth ?? 0));

  // By-type summary — convert each liability to home currency before aggregating
  const byCategory = new Map<LiabilityCategory, number>();
  for (const l of libs) byCategory.set(l.category, (byCategory.get(l.category) ?? 0) + toHome(l.balance, l.currency));
  const categoryGroups = CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((c) => ({
    cat: c, label: CATEGORY_META[c].label, total: byCategory.get(c)!, color: CATEGORY_CHART_COLOR[c],
    meta: CATEGORY_META[c],
  }));

  // Fixed 4-card groupings
  const mortgageTotal = (["mortgage", "line_of_credit"] as LiabilityCategory[])
    .reduce((s, c) => s + (byCategory.get(c) ?? 0), 0);
  const ccTotal = byCategory.get("credit_card") ?? 0;
  const loansTotal = (["auto_loan", "student_loan", "personal_loan", "other"] as LiabilityCategory[])
    .reduce((s, c) => s + (byCategory.get(c) ?? 0), 0);
  const mortgageAccts = libs.filter((l) => l.category === "mortgage" || l.category === "line_of_credit").length;
  const ccAccts       = libs.filter((l) => l.category === "credit_card").length;
  const loanAccts     = libs.filter((l) => ["auto_loan", "student_loan", "personal_loan", "other"].includes(l.category)).length;

  // Donut data
  const donutData = categoryGroups.map((g) => ({ label: g.label, value: g.total, color: g.color }));

  // Growth metrics
  const firstPt  = debtHistory[0];
  const latestPt = debtHistory.length >= 1 ? debtHistory[debtHistory.length - 1] : null;
  const growthTotal = firstPt && latestPt ? firstPt.total - latestPt.total : null; // positive = net reduction
  const growthPct   = firstPt && latestPt && firstPt.total > 0
    ? ((firstPt.total - latestPt.total) / firstPt.total) * 100 : null;

  // ── Debt insight numbers ────────────────────────────────────────────────────
  const insightDebts: PayoffDebt[] = libs.filter((l) => l.balance > 0).map((l) => {
    const { apr, estimated } = resolveApr(l, accountRates);
    return { id: l.id, label: l.label, category: l.category, balance: l.balance, apr, aprEstimated: estimated, minPayment: estimateMinPayment(l.balance, apr, l.category) };
  });
  const insightOrder = [...insightDebts]
    .sort((a, b) => (b.apr ?? 0) - (a.apr ?? 0))
    .map((d) => d.id);

  const monthlyInterest = insightDebts.reduce((s, d) => {
    if (d.apr == null) return s;
    return s + (d.balance * d.apr) / 100 / 12;
  }, 0);
  // Only count truly unknown APRs (not resolved from rates or defaults)
  const unratedCount = insightDebts.filter((d) => d.apr == null).length;
  const estimatedCount = insightDebts.filter((d) => d.aprEstimated).length;

  const simMin = insightDebts.length > 0 ? simulate(insightDebts, 0, insightOrder) : null;
  const payoffMonths = simMin?.totalMonths ?? null;
  const payoffYears  = payoffMonths != null ? Math.floor(payoffMonths / 12) : null;
  const payoffRemMo  = payoffMonths != null ? payoffMonths % 12 : null;
  const totalInterestIfMin = simMin?.totalInterestPaid ?? null;

  return (
    <div className="space-y-5">
      {/* Total debt header */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Total Debt</p>
        <div className="mt-1 flex items-center gap-3 flex-wrap">
          <p className="font-bold text-3xl text-gray-900 break-all leading-tight">{formatCurrency(total, homeCurrency, undefined, true)}</p>
        </div>
        {Object.keys(fxRates).length > 0 && (
          <p className="mt-1 text-[10px] text-gray-400">
            {Object.entries(fxRates)
              .map(([ccy, rate]) => `1 ${ccy} = ${rate.toFixed(4)} ${homeCurrency}`)
              .join(" · ")}
          </p>
        )}
      </div>

      {/* KPI cards — Mortgage / CC / Loans / Payments Made */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Mortgage */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-red-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Mortgage</p>
          </div>
          <p className="font-bold text-xl text-gray-900 break-all leading-tight">{mortgageTotal > 0 ? formatCurrency(mortgageTotal, homeCurrency, undefined, true) : "—"}</p>
          <p className="mt-1 text-xs text-gray-400">
            {mortgageTotal > 0
              ? `${mortgageAccts} account${mortgageAccts !== 1 ? "s" : ""} · ${total > 0 ? ((mortgageTotal / total) * 100).toFixed(0) : 0}% of debt`
              : "none"}
          </p>
          <div className="mt-3 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-red-400" style={{ width: `${total > 0 ? (mortgageTotal / total) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Credit Cards */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-orange-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Credit Cards</p>
          </div>
          <p className="font-bold text-xl text-gray-900 break-all leading-tight">{ccTotal > 0 ? formatCurrency(ccTotal, homeCurrency, undefined, true) : "—"}</p>
          <p className="mt-1 text-xs text-gray-400">
            {ccTotal > 0
              ? `${ccAccts} card${ccAccts !== 1 ? "s" : ""} · ${total > 0 ? ((ccTotal / total) * 100).toFixed(0) : 0}% of debt`
              : "none"}
          </p>
          <div className="mt-3 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-orange-400" style={{ width: `${total > 0 ? (ccTotal / total) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Loans */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-blue-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Loans</p>
          </div>
          <p className="font-bold text-xl text-gray-900 break-all leading-tight">{loansTotal > 0 ? formatCurrency(loansTotal, homeCurrency, undefined, true) : "—"}</p>
          <p className="mt-1 text-xs text-gray-400">
            {loansTotal > 0
              ? `${loanAccts} account${loanAccts !== 1 ? "s" : ""} · ${total > 0 ? ((loansTotal / total) * 100).toFixed(0) : 0}% of debt`
              : "none"}
          </p>
          <div className="mt-3 h-1 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className="h-full rounded-full bg-blue-400" style={{ width: `${total > 0 ? (loansTotal / total) * 100 : 0}%` }} />
          </div>
        </div>

        {/* Payments Made */}
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-5 shadow-sm flex flex-col">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-emerald-500" />
            <p className="text-xs font-semibold uppercase tracking-wider text-emerald-600">Payments Made</p>
          </div>
          <p className="font-bold text-xl text-gray-900 break-all leading-tight">{paymentsMade > 0 ? formatCurrency(paymentsMade, homeCurrency, undefined, true) : "—"}</p>
          <p className="mt-1 text-xs text-gray-400">{paymentsMade > 0 ? "this month" : "re-upload for data"}</p>
          <div className="mt-3 h-1 w-full rounded-full bg-emerald-100 overflow-hidden">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: paymentsMade > 0 ? "100%" : "0%" }} />
          </div>
        </div>
      </div>

      {/* Debt Growth chart */}
      {debtHistory.length >= 2 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Debt Over Time</p>
              {growthTotal !== null && growthPct !== null && (
                <p className={`mt-1 text-sm font-semibold ${growthTotal >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {growthTotal >= 0 ? "↓ " : "↑ "}{formatCurrency(Math.abs(growthTotal), homeCurrency, undefined, true)}
                  <span className="ml-1.5 font-normal text-gray-400 text-xs">
                    ({Math.abs(growthPct).toFixed(1)}% {growthTotal >= 0 ? "reduction" : "increase"}) over {debtHistory.length} months
                  </span>
                </p>
              )}
            </div>
          </div>
          <p className="mb-2 text-xs text-gray-400">
            Click a point to see per-account breakdown
            {debtHistory.some((p) => p.isEstimate) && (
              <span className="ml-2 text-gray-300">· <span className="text-purple-300">- - -</span> estimated (no statement)</span>
            )}
          </p>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={debtHistory} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="debtGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%"  stopColor="#ef4444" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => formatCurrency(v, homeCurrency, undefined, true)} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  formatter={(v, name) => name === "__dashed__" ? null : [typeof v === "number" ? formatCurrency(v, homeCurrency, undefined, true) : v, "Total debt"]}
                  labelStyle={{ fontSize: 12, color: "#6b7280" }}
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: 12 }}
                />
                {/* Solid series */}
                <Area
                  type="monotone"
                  dataKey="totalSolid"
                  name="Total debt"
                  stroke="#ef4444"
                  strokeWidth={2}
                  fill="url(#debtGrad)"
                  connectNulls={false}
                  dot={(props) => {
                    const { cx, cy, payload } = props as { cx: number; cy: number; payload: DebtHistoryPoint };
                    if (payload.totalSolid === null) return <g key={payload.ym} />;
                    const selected = payload.ym === selectedYm;
                    return (
                      <circle
                        key={payload.ym}
                        cx={cx} cy={cy}
                        r={selected ? 7 : 5}
                        fill={selected ? "#ef4444" : "#fff"}
                        stroke="#ef4444"
                        strokeWidth={selected ? 2 : 1.5}
                        style={{ cursor: "pointer", outline: "none" }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedYm((prev) => prev === payload.ym ? null : payload.ym);
                        }}
                      />
                    );
                  }}
                  activeDot={false}
                />
                {/* Dashed series for estimated months */}
                <Area
                  type="monotone"
                  dataKey="totalDashed"
                  name="__dashed__"
                  stroke="#fca5a5"
                  strokeWidth={1.5}
                  strokeDasharray="5 4"
                  fill="none"
                  connectNulls={false}
                  dot={(props) => {
                    const { cx, cy, payload } = props as { cx: number; cy: number; payload: DebtHistoryPoint };
                    if (!payload.isEstimate || payload.totalDashed === null) return <g key={payload.ym + "-d"} />;
                    const selected = payload.ym === selectedYm;
                    return (
                      <circle
                        key={payload.ym + "-d"}
                        cx={cx} cy={cy}
                        r={selected ? 6 : 3}
                        fill={selected ? "#fca5a5" : "#fff"}
                        stroke="#fca5a5"
                        strokeWidth={1.5}
                        strokeDasharray="none"
                        style={{ cursor: "pointer", outline: "none" }}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelectedYm((prev) => prev === payload.ym ? null : payload.ym);
                        }}
                      />
                    );
                  }}
                  activeDot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          {/* Month breakdown panel */}
          {selectedPt && (
            <div className="mt-4 rounded-lg border border-red-100 bg-red-50/40 p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-gray-800">{selectedPt.label}</p>
                  <p className="text-xs text-gray-400">
                    Total debt: <span className="font-medium text-gray-700">{formatCurrency(selectedPt.total, homeCurrency, undefined, true)}</span>
                    {prevPtYm && (() => {
                      const prevTotal = debtHistory.find((p) => p.ym === prevPtYm)?.total ?? null;
                      if (prevTotal === null) return null;
                      const diff = selectedPt.total - prevTotal;
                      return (
                        <span className={`ml-2 font-semibold ${diff <= 0 ? "text-green-600" : "text-red-500"}`}>
                          {diff <= 0 ? "↓ " : "↑ "}{formatCurrency(Math.abs(diff), homeCurrency, undefined, true)} vs prior chart month
                        </span>
                      );
                    })()}
                  </p>
                </div>
                <button
                  onClick={() => setSelectedYm(null)}
                  className="rounded-full p-1 text-gray-400 hover:bg-red-100 hover:text-gray-600"
                  aria-label="Close"
                >
                  <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M4 4l8 8M12 4l-8 8" />
                  </svg>
                </button>
              </div>
              <div className="space-y-2">
                {selectedRows.map((r) => {
                  const paidDown = r.delta !== null && r.delta < 0;
                  const increased = r.delta !== null && r.delta > 0;
                  return (
                    <div key={r.slug} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm">
                      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                      <div className="flex-1 min-w-0">
                        <p className="truncate text-sm font-medium text-gray-800">{r.label}</p>
                        {r.accountId && (
                          <p className="text-xs font-mono text-gray-400">{r.accountId}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold tabular-nums text-gray-800">{formatCurrency(r.balanceThisMonth!, homeCurrency, undefined, true)}</p>
                        {r.delta !== null ? (
                          <p className={`text-xs font-medium tabular-nums ${paidDown ? "text-green-600" : increased ? "text-red-500" : "text-gray-400"}`}>
                            {paidDown ? "↓ " : increased ? "↑ " : ""}{r.delta === 0 ? "no change" : formatCurrency(Math.abs(r.delta), homeCurrency, undefined, true)}
                          </p>
                        ) : r.balanceThisMonth != null && prevPtYm ? (
                          <p className="text-xs font-medium tabular-nums text-red-500">
                            ↑ {formatCurrency(r.balanceThisMonth, homeCurrency, undefined, true)}{" "}
                            <span className="font-normal text-gray-400">(new this month)</span>
                          </p>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* What changed — walk back through history to find most recent real-change window */}
      {(() => {
        if (debtHistory.length < 2) return null;
        let lastIdx = debtHistory.length - 1;
        let prevIdx = lastIdx - 1;
        while (prevIdx >= 0) {
          const ymLast = debtHistory[lastIdx].ym;
          const ymPrev = debtHistory[prevIdx].ym;
          const hasChange = accountMonthly.some((a) => {
            const bLast = latestBalanceAtOrBefore(a, ymLast);
            const bPrev = latestBalanceAtOrBefore(a, ymPrev);
            return bLast !== null && bPrev !== null && Math.abs(bLast - bPrev) > 0.5;
          });
          if (hasChange) break;
          lastIdx = prevIdx;
          prevIdx--;
        }
        if (prevIdx < 0) return null;
        const ymLast = debtHistory[lastIdx].ym;
        const ymPrev = debtHistory[prevIdx].ym;
        const formatLabel = (ym: string) => {
          const [y, m] = ym.split("-").map(Number);
          return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
        };
        const changed = accountMonthly.flatMap((a) => {
          const bLast = latestBalanceAtOrBefore(a, ymLast);
          const bPrev = latestBalanceAtOrBefore(a, ymPrev);
          if (bLast === null) return [];
          const delta = bPrev !== null ? bLast - bPrev : null;
          if (delta === null || Math.abs(delta) < 0.5) return [];
          return [{ ...a, delta, currentBalance: bLast }];
        }).sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
        if (changed.length === 0) return null;
        const netChange = changed.reduce((s, a) => s + (a.delta ?? 0), 0);
        return (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                What changed <span className="font-normal normal-case text-gray-400">({formatLabel(ymPrev)} → {formatLabel(ymLast)})</span>
              </p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${netChange <= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {netChange <= 0 ? "↓ " : "↑ "}{formatCurrency(Math.abs(netChange), homeCurrency, undefined, true)} net
              </span>
            </div>
            <div className="space-y-2">
              {changed.map((a) => {
                const paidDown = (a.delta ?? 0) < 0;
                return (
                  <div key={a.slug} className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                    <span className="flex-1 truncate text-sm text-gray-700">{a.label}</span>
                    <span className={`text-sm font-semibold tabular-nums ${paidDown ? "text-green-600" : "text-red-500"}`}>
                      {paidDown ? "↓ " : "↑ "}{formatCurrency(Math.abs(a.delta!), homeCurrency, undefined, true)}
                    </span>
                    <span className="w-20 text-right text-xs text-gray-400 tabular-nums">{formatCurrency(a.currentBalance, homeCurrency, undefined, true)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* ── Debt cost insight cards ───────────────────────────────────────── */}
      {insightDebts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Monthly interest cost */}
          <div className="rounded-xl border border-red-100 bg-gradient-to-br from-red-50 to-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-red-400">Interest costing you</p>
                <p className="mt-1.5 font-bold text-2xl text-red-600 break-all leading-tight">
                  {monthlyInterest > 0 ? fmt(Math.round(monthlyInterest), homeCurrency) : "—"}
                  {monthlyInterest > 0 && <span className="ml-1 text-base font-normal text-red-400">/mo</span>}
                </p>
                {monthlyInterest > 0 && (
                  <p className="mt-1 text-xs text-red-400">
                    {fmt(Math.round(monthlyInterest * 12), homeCurrency)} per year lost to interest
                  </p>
                )}
                {estimatedCount > 0 && (
                  <p className="mt-1.5 text-[10px] text-gray-400">
                    {estimatedCount} account{estimatedCount !== 1 ? "s" : ""} using typical category rate — set APR on the account page for exact figures
                  </p>
                )}
                {unratedCount > 0 && (
                  <p className="mt-1.5 text-[10px] text-gray-400">
                    {unratedCount} account{unratedCount !== 1 ? "s" : ""} missing APR entirely
                  </p>
                )}
              </div>
              <div className="shrink-0 rounded-full bg-red-100 p-2.5">
                <svg className="h-5 w-5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
            </div>
          </div>

          {/* Debt-free estimate */}
          <div className="rounded-xl border border-green-100 bg-gradient-to-br from-green-50 to-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-green-600">Debt-free estimate</p>
                {payoffYears != null && payoffMonths! < 600 ? (
                  <>
                    <p className="mt-1.5 font-bold text-3xl text-gray-900">
                      {payoffYears > 0 ? `${payoffYears}y` : ""}{payoffRemMo! > 0 ? ` ${payoffRemMo}m` : ""}
                    </p>
                    <p className="mt-1 text-xs text-gray-400">at minimum payments</p>
                    {totalInterestIfMin != null && totalInterestIfMin > 0 && (
                      <p className="mt-1 text-xs text-red-400">
                        {fmt(totalInterestIfMin, homeCurrency)} in interest if you take that long
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p className="mt-1.5 font-bold text-2xl text-gray-900">—</p>
                  <p className="mt-1 text-xs text-gray-400">Set APR on accounts for an exact estimate</p>
                  </>
                )}
                <Link href="/account/liabilities?tab=payoff" className="mt-2.5 inline-flex items-center gap-1 text-xs font-semibold text-green-600 hover:underline">
                  See payoff plan →
                </Link>
              </div>
              <div className="shrink-0 rounded-full bg-green-100 p-2.5">
                <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}


// ── tab: accounts ─────────────────────────────────────────────────────────────

function AccountsTab({
  libs, manualLibs, accountMonthly, deletingId, deletingSlug, homeCurrency, fxRates,
  onAdd, onEdit, onDelete, onDeleteAccount,
}: {
  libs: DisplayLiability[];
  manualLibs: ManualLiability[];
  accountMonthly: AccountMonthlyData[];
  deletingId: string | null;
  deletingSlug: string | null;
  homeCurrency: string;
  fxRates: Record<string, number>;
  onAdd: () => void;
  onEdit: (m: ManualLiability) => void;
  onDelete: (id: string) => void;
  onDeleteAccount: (slug: string, label: string) => void;
}) {
  const [acctFilter, setAcctFilter] = useState<"all" | "needs_update" | "mortgage" | "credit_card" | "loans">("all");
  const [acctSort, setAcctSort] = useState<"balance" | "name" | "freshness">("balance");

  if (libs.length === 0) return <EmptyState onAdd={onAdd} />;

  function toHome(amount: number, currency?: string): number {
    const cur = (currency ?? homeCurrency).toUpperCase();
    if (cur === homeCurrency.toUpperCase()) return amount;
    const rate = fxRates[cur];
    return rate ? amount * rate : amount;
  }

  function freshnessAge(statementDate?: string): number {
    if (!statementDate) return 999;
    const [y, m] = statementDate.split("-").map(Number);
    // Periods behind: monthly cadence, available ~5 days after month end
    const today = new Date();
    const cy = today.getFullYear(), cm = today.getMonth() + 1, cd = today.getDate();
    let em = cd >= 5 ? cm - 1 : cm - 2;
    let ey = cy;
    while (em <= 0) { em += 12; ey--; }
    const months = (ey - y) * 12 + (em - m);
    return Math.max(0, months);
  }

  function accountFreshness(statementDate?: string, source?: "manual" | "statement"): "fresh" | "aging" | "stale" {
    if (source === "manual") return "fresh";
    const periods = freshnessAge(statementDate);
    if (periods <= 0) return "fresh";
    if (periods === 1) return "aging";
    return "stale";
  }

  function freshnessText(statementDate?: string, source?: "manual" | "statement"): string {
    if (source === "manual") return "";
    const periods = freshnessAge(statementDate);
    if (periods <= 0) return "Up to date";
    if (periods === 1) return "1 month behind";
    return `${periods} months behind`;
  }

  function formatYearMonth(ym?: string): string {
    if (!ym) return "—";
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
  }

  function sparkValues(lib: DisplayLiability): number[] {
    if (!lib.accountSlug) return [];
    const monthly = accountMonthly.find((a) => a.slug === lib.accountSlug);
    if (!monthly) return [];
    return monthly.months.slice(-8).map((m) => m.balance);
  }

  function libDelta(lib: DisplayLiability): number | null {
    if (!lib.accountSlug) return null;
    const monthly = accountMonthly.find((a) => a.slug === lib.accountSlug);
    return monthly?.delta ?? null;
  }

  const stmtLibs = libs.filter((l) => l.source === "statement");
  const currentCnt   = stmtLibs.filter((l) => accountFreshness(l.statementDate, l.source) === "fresh").length;
  const behindCnt    = stmtLibs.filter((l) => accountFreshness(l.statementDate, l.source) === "aging").length;
  const farBehindCnt = stmtLibs.filter((l) => accountFreshness(l.statementDate, l.source) === "stale").length;
  const needsUpdateCnt = behindCnt + farBehindCnt;

  const filteredLibs = libs.filter((l) => {
    if (acctFilter === "needs_update") return l.source === "statement" && accountFreshness(l.statementDate, l.source) !== "fresh";
    if (acctFilter === "mortgage") return l.category === "mortgage" || l.category === "line_of_credit";
    if (acctFilter === "credit_card") return l.category === "credit_card";
    if (acctFilter === "loans") return (["auto_loan", "student_loan", "personal_loan", "other"] as LiabilityCategory[]).includes(l.category);
    return true;
  });

  const sortedLibs = [...filteredLibs].sort((a, b) => {
    if (acctSort === "name") return a.label.localeCompare(b.label);
    if (acctSort === "freshness") {
      const order = { stale: 0, aging: 1, fresh: 2 };
      return order[accountFreshness(a.statementDate, a.source)] - order[accountFreshness(b.statementDate, b.source)];
    }
    return toHome(b.balance, b.currency) - toHome(a.balance, a.currency);
  });

  const GROUP_DEFS: { key: string; label: string; cats: LiabilityCategory[]; dotColor: string }[] = [
    { key: "MORTGAGE", label: "MORTGAGE & CREDIT LINES", cats: ["mortgage", "line_of_credit"], dotColor: "#ef4444" },
    { key: "CARDS",    label: "CREDIT CARDS",            cats: ["credit_card"],                  dotColor: "#f97316" },
    { key: "LOANS",    label: "LOANS",                   cats: ["auto_loan", "student_loan", "personal_loan", "other"], dotColor: "#3b82f6" },
  ];

  return (
    <div className="space-y-5">
      {/* Freshness banner */}
      {stmtLibs.length > 0 && needsUpdateCnt > 0 && (
        <div className="rounded-xl border border-amber-100 bg-amber-50/60 px-5 py-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm font-semibold text-amber-700">
              {needsUpdateCnt} of {stmtLibs.length} account{stmtLibs.length !== 1 ? "s" : ""} behind
            </p>
            <div className="flex items-center gap-3 text-xs text-gray-500">
              {currentCnt > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-green-400" />{currentCnt} Up to date</span>}
              {behindCnt > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-400" />{behindCnt} 1 behind</span>}
              {farBehindCnt > 0 && <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-red-400" />{farBehindCnt} 2+ behind</span>}
            </div>
          </div>
          <div className="h-1.5 w-full rounded-full overflow-hidden flex">
            {currentCnt > 0 && <div className="h-full bg-green-400" style={{ width: `${(currentCnt / stmtLibs.length) * 100}%` }} />}
            {behindCnt > 0 && <div className="h-full bg-amber-400" style={{ width: `${(behindCnt / stmtLibs.length) * 100}%` }} />}
            {farBehindCnt > 0 && <div className="h-full bg-red-400" style={{ width: `${(farBehindCnt / stmtLibs.length) * 100}%` }} />}
          </div>
        </div>
      )}

      {/* Filter pills + Sort */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          {(["all", "needs_update", "mortgage", "credit_card", "loans"] as const).map((f) => {
            const labels: Record<typeof f, string> = { all: "All", needs_update: `Behind ${needsUpdateCnt}`, mortgage: "Mortgage", credit_card: "Credit Cards", loans: "Loans" };
            return (
              <button key={f} onClick={() => setAcctFilter(f)}
                className={`rounded-full px-3 py-1 text-xs font-semibold transition ${acctFilter === f ? "bg-gray-900 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                {labels[f]}
              </button>
            );
          })}
        </div>
        <select value={acctSort} onChange={(e) => setAcctSort(e.target.value as typeof acctSort)}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-600 focus:outline-none focus:border-purple-400">
          <option value="balance">Balance high → low</option>
          <option value="name">Name</option>
          <option value="freshness">Needs update first</option>
        </select>
      </div>

      {/* Grouped account list */}
      {GROUP_DEFS.map((grp) => {
        const grpLibs = sortedLibs.filter((l) => grp.cats.includes(l.category));
        if (grpLibs.length === 0) return null;
        const grpTotal = grpLibs.reduce((s, l) => s + toHome(l.balance, l.currency), 0);
        return (
          <div key={grp.key}>
            <div className="mb-2 flex items-center justify-between">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{grp.label}</p>
              <p className="text-xs font-semibold text-gray-500">{fmt(grpTotal, homeCurrency)}</p>
            </div>
            <div className="divide-y divide-gray-50 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {grpLibs.map((l) => {
                const freshness = accountFreshness(l.statementDate, l.source);
                const dotColor = freshness === "fresh" ? "#4ade80" : freshness === "aging" ? "#fbbf24" : "#f87171";
                const spark = sparkValues(l);
                const delta = libDelta(l);
                const paidDown = delta !== null && delta < 0;

                return (
                  <div key={l.id} className="flex items-center gap-3 px-5 py-3.5">
                    {/* Freshness dot */}
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} title={freshness} />

                    {/* Account info */}
                    <div className="flex-1 min-w-0">
                      {l.source === "statement" && l.accountSlug ? (
                        <Link href={`/account/accounts/${l.accountSlug}`} className="text-sm font-medium text-gray-800 hover:text-purple-600 truncate block">
                          {l.label}{l.subLabel && l.subLabel !== l.label && <span className="ml-1 font-normal text-gray-400">— {l.subLabel}</span>}
                        </Link>
                      ) : (
                        <p className="text-sm font-medium text-gray-800 truncate">
                          {l.label}{l.subLabel && l.subLabel !== l.label && <span className="ml-1 font-normal text-gray-400">— {l.subLabel}</span>}
                        </p>
                      )}
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <p className="text-xs text-gray-400">{CATEGORY_META[l.category].label}</p>
                        {l.source === "statement" && l.statementDate && (
                          <>
                            <span className="text-gray-200">·</span>
                            <p className={`text-xs ${freshness === "stale" ? "text-red-500" : freshness === "aging" ? "text-amber-500" : "text-gray-400"}`}>
                              {freshnessText(l.statementDate, l.source)} · {formatYearMonth(l.statementDate)}
                            </p>
                          </>
                        )}
                        {l.source === "manual" && (
                          <>
                            <span className="text-gray-200">·</span>
                            <p className="text-xs text-gray-400">manually added</p>
                          </>
                        )}
                      </div>
                    </div>

                    {/* Upload button for aging/stale */}
                    {l.source === "statement" && freshness !== "fresh" && (
                      <Link href="/upload" className="shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-700 hover:bg-amber-100 transition">
                        ↑ Upload
                      </Link>
                    )}

                    {/* Sparkline */}
                    {spark.length >= 2 && (
                      <div className="shrink-0">
                        <Sparkline values={spark} color={grp.dotColor} good="down" />
                      </div>
                    )}

                    {/* Balance + delta */}
                    <div className="shrink-0 text-right w-28">
                      <p className="text-sm font-semibold text-gray-800 tabular-nums">{fmt(l.balance, l.currency)}</p>
                      {delta !== null && Math.abs(delta) > 0 ? (
                        <p className={`text-xs font-medium tabular-nums ${paidDown ? "text-green-600" : "text-red-500"}`}>
                          {paidDown ? "↓ " : "↑ "}{formatCurrency(Math.abs(delta), homeCurrency, undefined, true)} MoM
                        </p>
                      ) : (
                        <p className="text-xs text-gray-400">unchanged</p>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="shrink-0 flex items-center gap-1">
                      {l.source === "statement" && l.accountSlug && (
                        <button onClick={() => onDeleteAccount(l.accountSlug!, l.label)}
                          disabled={deletingSlug === l.accountSlug}
                          className="rounded p-1 text-gray-300 hover:bg-red-50 hover:text-red-400 disabled:opacity-40 transition"
                          title="Delete account">
                          {deletingSlug === l.accountSlug
                            ? <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/></svg>
                            : <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>}
                        </button>
                      )}
                      {l.source === "manual" && (
                        <div className="flex items-center gap-1">
                          <button onClick={() => { const m = manualLibs.find((x) => x.id === l.id); if (m) onEdit(m); }}
                            className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600" title="Edit">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" /></svg>
                          </button>
                          <button onClick={() => onDelete(l.id)} disabled={deletingId === l.id}
                            className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40" title="Delete">
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Add actions */}
      <div className="flex gap-3 pt-1">
        <button onClick={onAdd} className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
          + Add manually
        </button>
        <Link href="/upload" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
          Upload statement
        </Link>
      </div>
    </div>
  );
}


// ── tab: payoff planner ───────────────────────────────────────────────────────

type Strategy = "avalanche" | "snowball" | "custom";

// ── Gantt chart ───────────────────────────────────────────────────────────────

function GanttChart({
  debts,
  simResults,
  maxMonths,
}: {
  debts: PayoffDebt[];
  simResults: Map<string, { payoffMonths: number; interestPaid: number }>;
  maxMonths: number;
}) {
  const clampedMax = Math.min(Math.max(maxMonths, 12), 600);
  const currentYear = new Date().getFullYear();
  const totalYears  = Math.ceil(clampedMax / 12);

  // Year tick positions (every 2 years, or every year if <=5 yrs)
  const step = totalYears <= 5 ? 1 : totalYears <= 10 ? 2 : Math.ceil(totalYears / 6);
  const yearTicks: number[] = [];
  for (let y = 0; y <= totalYears; y += step) yearTicks.push(y);
  if (yearTicks[yearTicks.length - 1] !== totalYears) yearTicks.push(totalYears);

  return (
    <div>
      <div className="space-y-1.5">
        {debts.map((d) => {
          const result    = simResults.get(d.id);
          const months    = result ? Math.min(result.payoffMonths, 600) : 600;
          const widthPct  = Math.min((months / clampedMax) * 100, 100);
          const isRevolving = d.category === "credit_card" || d.category === "line_of_credit";
          const payoffLabel = result
            ? result.payoffMonths >= 600
              ? "50+ yrs"
              : addMonths(result.payoffMonths)
            : "—";
          return (
            <div key={d.id} className="flex items-center gap-2">
              <p className="w-36 shrink-0 text-[11px] text-gray-500 truncate pr-1">{d.label}</p>
              <div className="relative flex-1 h-5">
                <div className="absolute inset-0 rounded bg-gray-100" />
                <div
                  className={`absolute inset-y-0 left-0 rounded transition-all ${isRevolving ? "bg-orange-400" : "bg-gray-700"}`}
                  style={{ width: `${widthPct}%` }}
                />
              </div>
              <p className="w-24 shrink-0 text-[10px] text-gray-400 tabular-nums">{payoffLabel}</p>
            </div>
          );
        })}
      </div>

      {/* X-axis year labels */}
      <div className="flex mt-2 pl-[152px] pr-24">
        <div className="relative flex-1 h-4">
          {yearTicks.map((y) => (
            <span
              key={y}
              className="absolute text-[10px] text-gray-300 -translate-x-1/2"
              style={{ left: `${(y / totalYears) * 100}%` }}
            >
              {y === 0 ? "Today" : currentYear + y}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── PayoffTab ─────────────────────────────────────────────────────────────────

function PayoffTab({ libs, accountRates, homeCurrency }: { libs: DisplayLiability[]; accountRates: AccountRateEntry[]; homeCurrency: string }) {
  const [strategy, setStrategy]        = useState<Strategy>("avalanche");
  const [extraPayment, setExtraPayment] = useState(200);
  const [customOrder, setCustomOrder]   = useState<string[]>([]);

  const payoffDebts: PayoffDebt[] = libs.filter((d) => d.balance > 0).map((d) => {
    const { apr, estimated } = resolveApr(d, accountRates);
    const formulaMin = estimateMinPayment(d.balance, apr, d.category);
    const useActualPayment =
      d.paymentsMade != null &&
      d.paymentsMade > 0 &&
      (d.category === "line_of_credit" || d.category === "mortgage");
    const minPayment = useActualPayment ? d.paymentsMade! : formulaMin;
    return { id: d.id, label: d.label, bankName: d.subLabel, category: d.category, balance: d.balance, currency: d.currency, apr, aprEstimated: estimated, minPayment };
  });

  function strategyOrder(s: Strategy, custom: string[]): string[] {
    if (s === "avalanche") return [...payoffDebts].sort((a, b) => (b.apr ?? 0) - (a.apr ?? 0)).map((d) => d.id);
    if (s === "snowball")  return [...payoffDebts].sort((a, b) => a.balance - b.balance).map((d) => d.id);
    const ids = payoffDebts.map((d) => d.id);
    return custom.length === ids.length ? custom : ids;
  }

  function handleStrategyClick(s: Strategy) {
    if (s === "custom" && strategy !== "custom") setCustomOrder(strategyOrder("avalanche", []));
    setStrategy(s);
  }

  function moveDebt(id: string, dir: -1 | 1) {
    setCustomOrder((prev) => {
      const arr = [...prev];
      const idx = arr.indexOf(id);
      if (idx < 0) return arr;
      const swap = idx + dir;
      if (swap < 0 || swap >= arr.length) return arr;
      [arr[idx], arr[swap]] = [arr[swap], arr[idx]];
      return arr;
    });
  }

  const [dragId, setDragId]       = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

  function handleDragStart(id: string) { setDragId(id); }
  function handleDragOver(e: React.DragEvent, id: string) {
    e.preventDefault();
    if (id !== dragId) setDragOverId(id);
  }
  function handleDrop(targetId: string) {
    if (!dragId || dragId === targetId) { setDragId(null); setDragOverId(null); return; }
    setCustomOrder((prev) => {
      const arr  = [...prev];
      const from = arr.indexOf(dragId);
      const to   = arr.indexOf(targetId);
      if (from < 0 || to < 0) return prev;
      arr.splice(from, 1);
      arr.splice(to, 0, dragId);
      return arr;
    });
    setDragId(null);
    setDragOverId(null);
  }
  function handleDragEnd() { setDragId(null); setDragOverId(null); }

  const order         = strategyOrder(strategy, customOrder);
  const orderedDebts  = order.map((id) => payoffDebts.find((d) => d.id === id)!).filter(Boolean);

  const simWith       = simulate(payoffDebts, extraPayment, order);
  const simWithout    = simulate(payoffDebts, 0,            order);
  const simAvalanche  = simulate(payoffDebts, extraPayment, strategyOrder("avalanche", []));
  const simSnowball   = simulate(payoffDebts, extraPayment, strategyOrder("snowball", []));

  const totalMinPayments = payoffDebts.reduce((s, d) => s + d.minPayment, 0);
  const totalMonthly     = totalMinPayments + extraPayment;
  const interestSaved    = Math.max(0, simWithout.totalInterestPaid - simWith.totalInterestPaid);
  const monthsSooner     = Math.max(0, simWithout.totalMonths - simWith.totalMonths);
  const maxExtra         = Math.max(1000, Math.ceil(totalMinPayments * 0.5 / 50) * 50);

  const savesMostStrategy: Strategy =
    simAvalanche.totalInterestPaid <= simSnowball.totalInterestPaid ? "avalanche" : "snowball";

  const interestByStrategy: Record<Strategy, number | null> = {
    avalanche: simAvalanche.totalInterestPaid,
    snowball:  simSnowball.totalInterestPaid,
    custom:    strategy === "custom" ? simWith.totalInterestPaid : null,
  };

  const maxPayoffMonths = Math.max(1, ...payoffDebts.map(
    (d) => simWith.debtResults.get(d.id)?.payoffMonths ?? 1
  ));

  const STRATEGY_DESC: Record<Strategy, string> = {
    avalanche: "Highest APR first. Mathematically cheapest.",
    snowball:  "Smallest balance first. Faster wins, more motivation.",
    custom:    "Drag rows below into your own payoff order.",
  };

  if (payoffDebts.length === 0) return <EmptyState />;

  const debtFreeYrs = Math.floor(simWith.totalMonths / 12);
  const debtFreeMos = simWith.totalMonths % 12;
  const isViable    = simWith.totalMonths < 600;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">

      {/* ── HERO ──────────────────────────────────────────────────────── */}
      <div className="px-6 pt-6 pb-6 border-b border-gray-100">
        <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Your payoff plan</p>
        {isViable ? (
          <>
            <h2 className="text-3xl font-extrabold text-gray-900 leading-tight">
              Debt-free by {addMonths(simWith.totalMonths)}
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              If you keep paying {fmt(totalMonthly, homeCurrency)}/mo across all debts
            </p>
          </>
        ) : (
          <>
            <h2 className="text-2xl font-extrabold text-orange-600 leading-tight">
              Payments too low to pay off all debts
            </h2>
            <p className="mt-1 text-sm text-gray-400">
              One or more debts are growing faster than you're paying them down — increase your extra payment.
            </p>
          </>
        )}
        <div className="mt-5 grid grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Total interest</p>
            {isViable ? (
              <>
                <p className="mt-1 text-2xl font-extrabold text-gray-900 tabular-nums">{fmt(simWith.totalInterestPaid, homeCurrency)}</p>
                {interestSaved > 0 && (
                  <p className="mt-0.5 text-xs font-medium text-green-600">↓ {fmt(interestSaved, homeCurrency)} saved</p>
                )}
              </>
            ) : (
              <p className="mt-1 text-2xl font-extrabold text-gray-400">—</p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Time to payoff</p>
            {isViable ? (
              <>
                <p className="mt-1 text-2xl font-extrabold text-gray-900">
                  {debtFreeYrs} yr{debtFreeYrs !== 1 ? "s" : ""} {debtFreeMos > 0 ? `${debtFreeMos} mo` : ""}
                </p>
                {monthsSooner > 0 && (
                  <p className="mt-0.5 text-xs font-medium text-green-600">↓ {monthsSooner} months sooner</p>
                )}
              </>
            ) : (
              <p className="mt-1 text-2xl font-extrabold text-orange-500">50+ years</p>
            )}
          </div>
        </div>
      </div>

      {/* ── STRATEGY CARDS ────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-gray-100">
        <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Strategy</p>
        <div className="grid grid-cols-3 gap-3">
          {(["avalanche", "snowball", "custom"] as Strategy[]).map((s) => {
            const isActive = strategy === s;
            const isBest   = s === savesMostStrategy;
            const interest = interestByStrategy[s];
            return (
              <button
                key={s}
                onClick={() => handleStrategyClick(s)}
                className={`relative text-left rounded-xl border px-3 py-3 transition ${
                  isActive
                    ? "bg-gray-900 border-gray-900"
                    : "border-gray-200 hover:border-gray-400 bg-white"
                }`}
              >
                {isBest && (
                  <span className={`absolute top-2 right-2 rounded-full px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide ${
                    isActive ? "bg-white/20 text-white" : "bg-gray-100 text-gray-600"
                  }`}>
                    Saves most
                  </span>
                )}
                <p className={`text-sm font-bold capitalize mb-1 ${isActive ? "text-white" : "text-gray-800"}`}>
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </p>
                <p className={`text-[11px] leading-relaxed ${isActive ? "text-white/60" : "text-gray-400"}`}>
                  {STRATEGY_DESC[s]}
                </p>
                <div className="mt-2.5">
                  <p className={`text-[9px] font-bold uppercase tracking-wider ${isActive ? "text-white/40" : "text-gray-300"}`}>
                    Interest
                  </p>
                  <p className={`text-sm font-bold tabular-nums ${isActive ? "text-white" : "text-gray-700"}`}>
                    {interest != null ? fmt(interest, homeCurrency) : "—"}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── SLIDER ────────────────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <p className="text-sm font-medium text-gray-600">Extra payment per month</p>
          <p className="text-[11px] text-gray-400">Applied to your priority debt</p>
        </div>
        <div className="mt-1 flex items-baseline gap-2.5">
          <span className="text-2xl font-extrabold text-gray-900 tabular-nums">{fmt(extraPayment, homeCurrency)}</span>
          {extraPayment > 0 && interestSaved > 0 && (
            <span className="text-xs font-medium text-green-600">
              Saves {fmt(interestSaved, homeCurrency)} · {monthsSooner} months sooner
            </span>
          )}
        </div>
        <div className="mt-3">
          <input
            type="range" min={0} max={maxExtra} step={25} value={extraPayment}
            onChange={(e) => setExtraPayment(Number(e.target.value))}
            className="w-full h-1.5 cursor-pointer appearance-none rounded-full"
            style={{
              background: `linear-gradient(to right, #16a34a ${(extraPayment / maxExtra) * 100}%, #e5e7eb ${(extraPayment / maxExtra) * 100}%)`,
            }}
          />
        </div>
        <div className="mt-1.5 flex justify-between text-[10px] text-gray-300">
          {[0, 0.25, 0.5, 0.75, 1].map((f) => (
            <span key={f}>{fmt(Math.round(maxExtra * f / 25) * 25, homeCurrency)}</span>
          ))}
        </div>
      </div>

      {/* ── PAYOFF TIMELINE ───────────────────────────────────────────── */}
      <div className="px-6 py-5 border-b border-gray-100">
        <div className="flex items-center justify-between mb-4">
          <p className="text-sm font-semibold text-gray-700">Payoff timeline</p>
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="inline-block h-2 w-3 rounded-sm bg-orange-400" />Revolving
            </span>
            <span className="flex items-center gap-1 text-[10px] text-gray-400">
              <span className="inline-block h-2 w-3 rounded-sm bg-gray-700" />Installment
            </span>
          </div>
        </div>
        <GanttChart
          debts={orderedDebts}
          simResults={simWith.debtResults}
          maxMonths={maxPayoffMonths}
        />
      </div>

      {/* ── PAYMENT SEQUENCE ──────────────────────────────────────────── */}
      <div className="px-6 pt-5 pb-6">
        <div className="flex items-center justify-between mb-5">
          <p className="text-sm font-semibold text-gray-700">Payment sequence</p>
          <p className="text-[11px] text-gray-400">How your money flows each month</p>
        </div>

        <div className="space-y-5">
          {orderedDebts.map((d, i) => {
            const result          = simWith.debtResults.get(d.id);
            const monthlyInterest = d.balance * (d.apr ?? 0) / 100 / 12;
            const isPriority      = i === 0;
            const allocated       = isPriority ? d.minPayment + extraPayment : d.minPayment;
            // "Min below interest" warning: min payment alone doesn't cover interest,
            // but only show if the *allocated* amount (which includes extra for the priority
            // debt) also doesn't cover interest — prevents a false alarm when extra payment
            // rescues the debt. Truly unpayable = simulation never finishes (≥600 months).
            const minBelowInterest = d.apr != null && d.apr > 0 && d.minPayment < monthlyInterest;
            const isUnpayable      = result ? result.payoffMonths >= 600 : minBelowInterest;
            const allocPct        = totalMonthly > 0 ? Math.min(100, (allocated / totalMonthly) * 100) : 0;
            const isRevolving     = d.category === "credit_card" || d.category === "line_of_credit";
            const payoffLabel     = result
              ? result.payoffMonths >= 600
                ? "50+ yrs"
                : isPriority
                  ? `Paid off in ~${Math.max(1, Math.round(result.payoffMonths / 12))} yr${Math.round(result.payoffMonths / 12) !== 1 ? "s" : ""}`
                  : `Paid off ${addMonths(result.payoffMonths)}`
              : "—";

            const isDragging  = strategy === "custom" && dragId === d.id;
            const isDragTarget = strategy === "custom" && dragOverId === d.id;

            return (
              <div
                key={d.id}
                draggable={strategy === "custom"}
                onDragStart={() => handleDragStart(d.id)}
                onDragOver={(e) => handleDragOver(e, d.id)}
                onDrop={() => handleDrop(d.id)}
                onDragEnd={handleDragEnd}
                className={`flex gap-4 transition-opacity rounded-lg ${
                  isDragging ? "opacity-30" : "opacity-100"
                } ${isDragTarget ? "ring-2 ring-purple-400 ring-offset-2 bg-purple-50/40" : ""} ${
                  strategy === "custom" ? "cursor-grab active:cursor-grabbing" : ""
                }`}
              >
                {/* Drag handle + step circle — side by side, top-aligned */}
                <div className="flex shrink-0 items-center gap-1 mt-0.5">
                  {strategy === "custom" && (
                    <div className="flex flex-col gap-[4px] cursor-grab active:cursor-grabbing">
                      {[0, 1, 2].map((r) => (
                        <div key={r} className="flex gap-[4px]">
                          <span className="h-[4px] w-[4px] rounded-full bg-gray-400" />
                          <span className="h-[4px] w-[4px] rounded-full bg-gray-400" />
                        </div>
                      ))}
                    </div>
                  )}
                  <div className={`h-7 w-7 rounded-full border-2 flex items-center justify-center text-[10px] font-extrabold tabular-nums ${
                    isPriority ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 bg-white text-gray-400"
                  }`}>
                    {String(i + 1).padStart(2, "0")}
                  </div>
                </div>

                <div className="flex-1 min-w-0">
                  {/* Top row: icon + name + balance */}
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <CategoryIcon cat={d.category} />
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <p className="text-sm font-semibold text-gray-900 truncate">{d.label}</p>
                          {isUnpayable && (
                            <span className="shrink-0 rounded-full bg-orange-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-orange-700">
                              Min won&apos;t pay off
                            </span>
                          )}
                          {!isUnpayable && minBelowInterest && (
                            <span className="shrink-0 rounded-full bg-gray-100 px-1.5 py-0.5 text-[9px] font-medium text-gray-400">
                              Min &lt; interest
                            </span>
                          )}
                        </div>
                        {d.bankName && d.bankName !== d.label && (
                          <p className="text-[11px] text-gray-400">{d.bankName}</p>
                        )}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(d.balance, homeCurrency, d.currency, false)}</p>
                      <p className="text-xs text-green-600">{payoffLabel}</p>
                    </div>
                  </div>

                  {/* APR + min */}
                  <p className="mt-1 text-[11px] text-gray-400">
                    {d.apr != null && <>{d.apr.toFixed(1)}% APR{d.aprEstimated && <span className="text-amber-500"> est.</span>} · </>}
                    Min {fmt(d.minPayment, d.currency)}/mo
                  </p>

                  {/* Allocation bar */}
                  <div className="mt-2 flex items-center gap-2">
                    <span className="shrink-0 text-[9px] font-bold uppercase tracking-wide text-gray-300">Allocation</span>
                    <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${isRevolving ? "bg-orange-400" : "bg-gray-700"}`}
                        style={{ width: `${allocPct}%` }}
                      />
                    </div>
                    <span className={`shrink-0 text-xs tabular-nums font-semibold ${isPriority ? "text-gray-900" : "text-gray-400"}`}>
                      {fmt(allocated, d.currency)}/mo
                    </span>
                  </div>

                  {/* Touch-friendly arrow fallback for custom */}
                  {strategy === "custom" && (
                    <div className="mt-1.5 flex items-center gap-1">
                      <span className="text-[10px] text-gray-300">or</span>
                      <button onClick={() => moveDebt(d.id, -1)} disabled={i === 0}
                        className="rounded p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 15l7-7 7 7" /></svg>
                      </button>
                      <button onClick={() => moveDebt(d.id, 1)} disabled={i === orderedDebts.length - 1}
                        className="rounded p-0.5 text-gray-300 hover:text-gray-600 disabled:opacity-20">
                        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── empty state ───────────────────────────────────────────────────────────────

function EmptyState({ onAdd }: { onAdd?: () => void }) {
  return (
    <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
      <p className="text-sm text-gray-500">No liabilities yet.</p>
      <p className="mt-1 text-xs text-gray-400">Add manually or upload a statement.</p>
      {onAdd && (
        <div className="mt-4 flex justify-center gap-3">
          <button onClick={onAdd} className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">Add manually</button>
          <Link href="/upload" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Upload statement</Link>
        </div>
      )}
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

function LiabilitiesPageInner() {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();
  const { can }     = usePlan();

  const [paymentsMade, setPaymentsMade] = useState<number>(0);
  const [activeTab, setActiveTab]       = useState<TabId>(() => {
    const t = searchParams.get("tab");
    return TABS.some((tb) => tb.id === t) ? (t as TabId) : "overview";
  });

  // Keep activeTab in sync when the URL changes (e.g. <Link> navigation or browser back/forward)
  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && TABS.some((tb) => tb.id === t)) setActiveTab(t as TabId);
  }, [searchParams]);

  const [idToken, setIdToken]           = useState<string | null>(null);
  const [manualLibs, setManualLibs]     = useState<ManualLiability[]>([]);
  const [displayLibs, setDisplayLibs]   = useState<DisplayLiability[]>([]);
  const [accountRates, setAccountRates] = useState<AccountRateEntry[]>([]);
  const [yearMonth, setYearMonth]       = useState<string | null>(null);
  const [debtHistory, setDebtHistory]   = useState<DebtHistoryPoint[]>([]);
  const [accountMonthly, setAccountMonthly] = useState<AccountMonthlyData[]>([]);
  const [homeCurrency, setHomeCurrency] = useState<string>("USD");
  const [fxRates, setFxRates]           = useState<Record<string, number>>({});
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  const [modalOpen, setModalOpen]       = useState(false);
  const [editing, setEditing]           = useState<ManualLiability | null>(null);
  const [saving, setSaving]             = useState(false);
  const [deletingId, setDeletingId]     = useState<string | null>(null);

  // Delete account (statement-sourced)
  const [deletingSlug, setDeletingSlug] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<{ slug: string; label: string } | null>(null);
  const [deleteSuccess, setDeleteSuccess] = useState(false);

  function switchTab(id: TabId) {
    setActiveTab(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const loadData = useCallback(async (token: string) => {
    setLoading(true); setError(null);
    try {
      // Single pipeline: all account data flows through the financial profile cache.
      const [cRes, mRes, rRes] = await Promise.all([
        fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/user/liabilities",             { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/user/account-rates",           { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const cJson = cRes.ok ? await cRes.json().catch(() => ({})) : {};
      const mJson = await mRes.json().catch(() => ({}));
      const rJson = rRes.ok ? await rRes.json().catch(() => ({})) : {};

      setYearMonth(cJson.yearMonth ?? null);
      setPaymentsMade(cJson.paymentsMade ?? 0);
      setHomeCurrency(cJson.homeCurrency ?? "USD");
      setFxRates(cJson.fxRates ?? {});

      // Build debt history from accountBalanceHistory with carry-forward.
      // Using this source (instead of cJson.history[].debtTotal) means backfill months
      // are included — accounts with synthetic history contribute their estimated balance
      // to historical months, preventing false "new debt" spikes.
      const DEBT_TYPES_SET = new Set(["credit", "mortgage", "loan", "line_of_credit"]);
      const debtBalHist = (cJson.accountBalanceHistory as AccountBalanceHistory[] ?? [])
        .filter((h) => DEBT_TYPES_SET.has(h.accountType) || h.entries.some((e) => e.balance < 0));
      const allDebtMonths = Array.from(
        new Set(debtBalHist.flatMap((h) => h.entries.map((e) => e.yearMonth)))
      ).sort();
      const histFxRates: Record<string, number> = cJson.fxRates ?? {};
      const histHomeCurrency: string = cJson.homeCurrency ?? "USD";
      function toHistHome(amount: number, ccy?: string): number {
        if (!ccy || ccy.toUpperCase() === histHomeCurrency.toUpperCase()) return amount;
        const rate = histFxRates[ccy.toUpperCase()];
        return rate != null ? amount * rate : amount;
      }

      // Set of months that have real (non-carry-forward) balance entries
      const realDebtMonths = new Set<string>(
        debtBalHist.flatMap((h) => h.entries.map((e) => e.yearMonth))
      );

      const histRaw = allDebtMonths
        .map((ym) => {
          let total = 0;
          for (const acct of debtBalHist) {
            const pts = acct.entries.filter((e) => e.yearMonth <= ym);
            if (pts.length > 0) total += toHistHome(Math.abs(pts[pts.length - 1].balance), acct.currency);
          }
          const [y, m] = ym.split("-");
          const label = new Date(parseInt(y), parseInt(m) - 1, 1)
            .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          return { ym, label, total, isEstimate: !realDebtMonths.has(ym), totalSolid: null as number | null, totalDashed: null as number | null };
        })
        .filter((h) => h.total > 0);

      const hist: DebtHistoryPoint[] = histRaw.map((pt, i) => {
        const prev = histRaw[i - 1] ?? null;
        const next = histRaw[i + 1] ?? null;
        const totalSolid: number | null = pt.isEstimate ? null : pt.total;
        let totalDashed: number | null = pt.isEstimate ? pt.total : null;
        // Bridge: last real point before an estimated run → also in dashed series
        if (!pt.isEstimate && next?.isEstimate) totalDashed = pt.total;
        // Bridge: first real point after an estimated run → also in dashed series
        if (!pt.isEstimate && prev?.isEstimate) totalDashed = pt.total;
        return { ...pt, totalSolid, totalDashed };
      });
      setDebtHistory(hist);

      // Per-account monthly balance history — from the financial profile cache
      const acctMonthly: AccountMonthlyData[] = (cJson.accountBalanceHistory as AccountBalanceHistory[] ?? [])
        .filter((h) => DEBT_TYPES_SET.has(h.accountType) || h.entries.some((e) => e.balance < 0))
        .map((h) => {
          const sorted = h.entries; // already sorted ascending
          const cur = sorted.at(-1)?.balance ?? 0;
          const prev = sorted.length >= 2 ? sorted[sorted.length - 2].balance : null;
          const cat: LiabilityCategory = deriveCategoryFromSnapshot(h.accountType, h.label);
          return {
            slug: h.slug, label: h.label, accountId: undefined, category: cat,
            color: CATEGORY_CHART_COLOR[cat],
            months: sorted.map((e) => ({ ym: e.yearMonth, balance: Math.abs(e.balance) })),
            currentBalance: Math.abs(cur), prevBalance: prev !== null ? Math.abs(prev) : null,
            delta: prev !== null ? Math.abs(cur) - Math.abs(prev) : null,
          };
        });
      setAccountMonthly(acctMonthly);

      const manual: ManualLiability[] = mJson.liabilities ?? [];
      setManualLibs(manual);
      setAccountRates(rJson.rates ?? []);

      // Build display liabilities from the profile cache's accountSnapshots
      const DEBT_TYPES = new Set(["credit", "mortgage", "loan", "line_of_credit"]);
      const snapshots: AccountSnapshot[] = cJson.accountSnapshots ?? [];
      const fromStatements: DisplayLiability[] = snapshots
        .filter((s) => DEBT_TYPES.has(s.accountType ?? "") || s.balance < 0)
        .map((s) => ({
          id: `stmt-${s.slug}`, label: s.accountName ?? s.bankName ?? "Account",
          subLabel: s.bankName, category: deriveCategoryFromSnapshot(s.accountType ?? "", s.accountName),
          balance: Math.abs(s.balance), currency: s.currency ?? undefined,
          statementDate: s.statementMonth,
          interestRate: typeof s.interestRate === "number" ? s.interestRate : undefined,
          source: "statement" as const, accountSlug: s.slug,
          paymentsMade: s.paymentsMade,
        }));

      const fromManual: DisplayLiability[] = manual.map((m) => ({
        id: m.id, label: m.label, category: m.category, balance: m.balance,
        interestRate: m.interestRate, source: "manual" as const,
      }));

      setDisplayLibs([...fromStatements, ...fromManual].sort((a, b) => b.balance - a.balance));
    } catch { setError("Failed to load liabilities"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const token = await user.getIdToken();
      setIdToken(token);
      loadData(token);
    });
  }, [router, loadData]);

  async function handleSave(data: Omit<ManualLiability, "id" | "updatedAt">) {
    if (!idToken) return;
    setSaving(true);
    try {
      if (editing) {
        await fetch(`/api/user/liabilities/${editing.id}`, { method: "PUT", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify(data) });
      } else {
        await fetch("/api/user/liabilities", { method: "POST", headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" }, body: JSON.stringify(data) });
      }
      setModalOpen(false); setEditing(null);
      await loadData(idToken);
    } finally { setSaving(false); }
  }

  async function handleDelete(id: string) {
    if (!idToken || !confirm("Delete this liability?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/user/liabilities/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${idToken}` } });
      await loadData(idToken);
    } finally { setDeletingId(null); }
  }

  async function handleDeleteAccount(slug: string) {
    if (!idToken) return;
    setDeletingSlug(slug);
    setDeleteConfirm(null);
    try {
      const res = await fetch(`/api/user/accounts/${encodeURIComponent(slug)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (res.ok) {
        setDeleteSuccess(true);
        await loadData(idToken);
      }
    } finally {
      setDeletingSlug(null);
    }
  }

  const total = displayLibs.reduce((s, l) => {
    const rate = l.currency && l.currency.toUpperCase() !== homeCurrency.toUpperCase()
      ? (fxRates[l.currency.toUpperCase()] ?? 1)
      : 1;
    return s + l.balance * rate;
  }, 0);
  const monthStr = yearMonth
    ? new Date(parseInt(yearMonth.slice(0, 4)), parseInt(yearMonth.slice(5, 7)) - 1, 1)
        .toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Header */}
      <div className="mb-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-3xl text-gray-900">Liabilities</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {total > 0 && <>{formatCurrency(total, homeCurrency, undefined, true)} total</>}
            {monthStr && <> · {monthStr}</>}
          </p>
        </div>
        {activeTab === "accounts" && (
          <button onClick={() => { setEditing(null); setModalOpen(true); }}
            className="flex shrink-0 items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" /></svg>
            Add
          </button>
        )}
      </div>

      {error && <p className="mb-4 mt-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {/* Tab bar */}
      <div className="mt-5 mb-6 flex border-b border-gray-200">
        {TABS.map((tab) => {
          const isLocked = tab.id === "payoff" && !can("payoffPlanner");
          return (
            <button
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              className={`relative mr-6 pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? "text-gray-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-gray-900 after:content-['']"
                  : "text-gray-400 hover:text-gray-600"
              }`}
            >
              <span className="flex items-center gap-1.5">
                {tab.label}
                {isLocked && (
                  <span className="rounded-full bg-amber-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-amber-600">
                    Pro
                  </span>
                )}
              </span>
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && (
        <OverviewTab
          libs={displayLibs}
          debtHistory={debtHistory}
          accountMonthly={accountMonthly}
          paymentsMade={paymentsMade}
          accountRates={accountRates}
          homeCurrency={homeCurrency}
          fxRates={fxRates}
        />
      )}
      {activeTab === "accounts" && (
        <AccountsTab
          libs={displayLibs} manualLibs={manualLibs} accountMonthly={accountMonthly} deletingId={deletingId}
          deletingSlug={deletingSlug}
          homeCurrency={homeCurrency}
          fxRates={fxRates}
          onAdd={() => { setEditing(null); setModalOpen(true); }}
          onEdit={(m) => { setEditing(m); setModalOpen(true); }}
          onDelete={handleDelete}
          onDeleteAccount={(slug, label) => setDeleteConfirm({ slug, label })}
        />
      )}

      {/* Delete account confirmation modal */}
      {deleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteConfirm(null); }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-br from-red-500 to-rose-600 px-6 py-5">
              <h2 className="text-lg font-bold text-white">Delete account?</h2>
              <p className="mt-1 text-sm text-red-100">This will permanently delete all statements for this account.</p>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-700">
                All statement history for <span className="font-semibold">{deleteConfirm.label}</span> will be deleted.
              </p>
              <div className="mt-4 rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                <p className="text-xs text-amber-800 font-medium">After deleting, re-upload the correct statement to add this account back.</p>
              </div>
            </div>
            <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between gap-3">
              <button
                onClick={() => setDeleteConfirm(null)}
                className="text-sm text-gray-400 hover:text-gray-600 transition"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDeleteAccount(deleteConfirm.slug)}
                className="rounded-lg bg-red-500 px-5 py-2 text-sm font-semibold text-white hover:bg-red-600 transition"
              >
                Delete account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post-delete re-upload prompt */}
      {deleteSuccess && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ background: "rgba(0,0,0,0.45)" }}
          onClick={(e) => { if (e.target === e.currentTarget) setDeleteSuccess(false); }}
        >
          <div className="w-full max-w-sm rounded-2xl bg-white shadow-2xl overflow-hidden">
            <div className="bg-gradient-to-br from-green-500 to-emerald-600 px-6 py-5">
              <h2 className="text-lg font-bold text-white">Account deleted</h2>
              <p className="mt-1 text-sm text-green-100">The account and all its statements have been removed.</p>
            </div>
            <div className="px-6 py-5">
              <p className="text-sm text-gray-700">Re-upload the correct statement to add this account back with the right account number.</p>
            </div>
            <div className="border-t border-gray-100 px-6 py-4 flex items-center justify-between gap-3">
              <button
                onClick={() => setDeleteSuccess(false)}
                className="text-sm text-gray-400 hover:text-gray-600 transition"
              >
                Close
              </button>
              <Link
                href="/upload"
                onClick={() => setDeleteSuccess(false)}
                className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
              >
                Upload statement →
              </Link>
            </div>
          </div>
        </div>
      )}

      {activeTab === "payoff" && (
        can("payoffPlanner")
          ? <PayoffTab libs={displayLibs} accountRates={accountRates} homeCurrency={homeCurrency} />
          : <UpgradePrompt feature="payoffPlanner" description="Simulate avalanche, snowball, and custom debt payoff strategies with extra payment modelling." />
      )}

      {modalOpen && (
        <LiabilityModal
          initial={editing}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          saving={saving}
        />
      )}
    </div>
  );
}

export default function LiabilitiesPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    }>
      <LiabilitiesPageInner />
    </Suspense>
  );
}
