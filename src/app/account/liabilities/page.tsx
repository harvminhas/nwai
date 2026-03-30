"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { Suspense } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { UserStatementSummary, ManualLiability, LiabilityCategory, SubAccount } from "@/lib/types";
import { buildAccountSlug } from "@/lib/accountSlug";
import type { AccountRateEntry } from "@/app/api/user/account-rates/route";
import { usePlan } from "@/contexts/PlanContext";
import UpgradePrompt from "@/components/UpgradePrompt";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
} from "recharts";

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
};

// ── tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",  label: "Overview" },
  { id: "accounts",  label: "Accounts" },
  { id: "payoff",    label: "Payoff planner" },
] as const;
type TabId = typeof TABS[number]["id"];

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}
function fmtShort(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${Math.round(abs / 1_000)}k`;
  return fmt(v);
}
function accountSlug(s: UserStatementSummary) {
  return buildAccountSlug(s.bankName, s.accountId);
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
  if (cat === "credit_card")    return Math.max(Math.ceil(balance * 0.02), 25);
  if (cat === "line_of_credit") return Math.max(Math.ceil(balance * 0.01), 50);
  const rate = apr ?? 5;
  return Math.round(calcAmortisedPayment(balance, rate, DEFAULT_TERMS[cat] ?? 60));
}

interface PayoffDebt {
  id: string; label: string; bankName?: string; category: LiabilityCategory;
  balance: number; apr: number | null; aprEstimated: boolean; minPayment: number;
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

    for (const id of alive) {
      const d = state.get(id)!;
      const interest = d.remaining * (d.apr ?? 0) / 100 / 12;
      d.interestPaid += interest;
      d.remaining = Math.max(0, d.remaining + interest - d.minPayment);
    }

    let extraLeft = extraMonthly;
    for (const id of order) {
      const d = state.get(id);
      if (!d || d.remaining <= 0.01) continue;
      d.remaining = Math.max(0, d.remaining - Math.min(d.remaining, extraLeft));
      extraLeft = 0;
      break;
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
  balance: number; interestRate?: number; statementDate?: string;
  source: "manual" | "statement"; accountSlug?: string;
  subAccounts?: SubAccount[];
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

interface DebtHistoryPoint { ym: string; label: string; total: number }

function OverviewTab({ libs, debtHistory, accountMonthly, paymentsMade, accountRates }: {
  libs: DisplayLiability[];
  debtHistory: DebtHistoryPoint[];
  accountMonthly: AccountMonthlyData[];
  paymentsMade: number;
  accountRates: AccountRateEntry[];
}) {
  const total = libs.reduce((s, l) => s + l.balance, 0);
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

  // By-type summary
  const byCategory = new Map<LiabilityCategory, number>();
  for (const l of libs) byCategory.set(l.category, (byCategory.get(l.category) ?? 0) + l.balance);
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
  const prevPt   = debtHistory.length >= 2 ? debtHistory[debtHistory.length - 2] : null;
  const latestPt = debtHistory.length >= 1 ? debtHistory[debtHistory.length - 1] : null;
  // Debt going down = positive (good), going up = negative
  const growthMoM   = prevPt  && latestPt ? prevPt.total  - latestPt.total : null; // positive = paid down
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
          <p className="font-bold text-4xl text-gray-900">{fmtShort(total)}</p>
          {growthMoM !== null && (
            <span className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-sm font-semibold ${
              growthMoM >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"
            }`}>
              {growthMoM >= 0 ? "↓" : "↑"} {fmtShort(Math.abs(growthMoM))} this month
            </span>
          )}
        </div>
      </div>

      {/* KPI cards — Mortgage / CC / Loans / Payments Made */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {/* Mortgage */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-red-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Mortgage</p>
          </div>
          <p className="font-bold text-2xl text-gray-900">{mortgageTotal > 0 ? fmtShort(mortgageTotal) : "—"}</p>
          <p className="mt-1 text-xs text-gray-400">
            {mortgageTotal > 0
              ? `${mortgageAccts} account${mortgageAccts !== 1 ? "s" : ""} · ${total > 0 ? ((mortgageTotal / total) * 100).toFixed(0) : 0}% of debt`
              : "none"}
          </p>
        </div>

        {/* Credit Cards */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-orange-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Credit Cards</p>
          </div>
          <p className="font-bold text-2xl text-gray-900">{ccTotal > 0 ? fmtShort(ccTotal) : "—"}</p>
          <p className="mt-1 text-xs text-gray-400">
            {ccTotal > 0
              ? `${ccAccts} card${ccAccts !== 1 ? "s" : ""} · ${total > 0 ? ((ccTotal / total) * 100).toFixed(0) : 0}% of debt`
              : "none"}
          </p>
        </div>

        {/* Loans */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-blue-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Loans</p>
          </div>
          <p className="font-bold text-2xl text-gray-900">{loansTotal > 0 ? fmtShort(loansTotal) : "—"}</p>
          <p className="mt-1 text-xs text-gray-400">
            {loansTotal > 0
              ? `${loanAccts} account${loanAccts !== 1 ? "s" : ""} · ${total > 0 ? ((loansTotal / total) * 100).toFixed(0) : 0}% of debt`
              : "none"}
          </p>
        </div>

        {/* Payments Made */}
        <div className="rounded-xl border border-blue-100 bg-blue-50/40 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-2">
            <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-blue-400" />
            <p className="text-xs font-semibold uppercase tracking-wider text-blue-400">Payments Made</p>
          </div>
          <p className="font-bold text-2xl text-gray-900">{paymentsMade > 0 ? fmtShort(paymentsMade) : "—"}</p>
          <p className="mt-1 text-xs text-gray-400">{paymentsMade > 0 ? "this month" : "re-upload for data"}</p>
        </div>
      </div>

      {/* ── Debt cost insight cards ───────────────────────────────────────── */}
      {insightDebts.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {/* Monthly interest cost */}
          <div className="rounded-xl border border-red-100 bg-gradient-to-br from-red-50 to-white p-5 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-red-400">Interest costing you</p>
                <p className="mt-1.5 font-bold text-3xl text-red-600">
                  {monthlyInterest > 0 ? fmt(Math.round(monthlyInterest)) : "—"}
                  {monthlyInterest > 0 && <span className="ml-1 text-base font-normal text-red-400">/mo</span>}
                </p>
                {monthlyInterest > 0 && (
                  <p className="mt-1 text-xs text-red-400">
                    {fmt(Math.round(monthlyInterest * 12))} per year lost to interest
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
                        {fmt(totalInterestIfMin)} in interest if you take that long
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

      {/* What changed this month */}
      {accountMonthly.some((a) => a.delta !== null) && (() => {
        const changed = accountMonthly
          .filter((a) => a.delta !== null && Math.abs(a.delta!) > 0)
          .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
        const netChange = changed.reduce((s, a) => s + a.delta!, 0);
        if (changed.length === 0) return null;
        return (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">What changed this month</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${netChange <= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {netChange <= 0 ? "↓ " : "↑ "}{fmtShort(Math.abs(netChange))} net
              </span>
            </div>
            <div className="space-y-2">
              {changed.map((a) => {
                const paidDown = (a.delta ?? 0) < 0; // negative delta = paid down = good
                return (
                  <div key={a.slug} className="flex items-center gap-3">
                    <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                    <span className="flex-1 truncate text-sm text-gray-700">{a.label}</span>
                    <span className={`text-sm font-semibold tabular-nums ${paidDown ? "text-green-600" : "text-red-500"}`}>
                      {paidDown ? "↓ " : "↑ "}{fmtShort(Math.abs(a.delta!))}
                    </span>
                    <span className="w-20 text-right text-xs text-gray-400 tabular-nums">{fmt(a.currentBalance)}</span>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })()}

      {/* Debt Growth chart */}
      {debtHistory.length >= 2 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Debt Over Time</p>
              {growthTotal !== null && growthPct !== null && (
                <p className={`mt-1 text-sm font-semibold ${growthTotal >= 0 ? "text-green-600" : "text-red-500"}`}>
                  {growthTotal >= 0 ? "↓ " : "↑ "}{fmtShort(Math.abs(growthTotal))}
                  <span className="ml-1.5 font-normal text-gray-400 text-xs">
                    ({Math.abs(growthPct).toFixed(1)}% {growthTotal >= 0 ? "reduction" : "increase"}) over {debtHistory.length} months
                  </span>
                </p>
              )}
            </div>
            {growthMoM !== null && (
              <div className={`rounded-lg px-2.5 py-1 text-xs font-semibold ${growthMoM >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                {growthMoM >= 0 ? "↓" : "↑"} {fmtShort(Math.abs(growthMoM))} MoM
              </div>
            )}
          </div>
          <p className="mb-2 text-xs text-gray-400">Click a point to see per-account breakdown</p>
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
                <YAxis tickFormatter={(v) => fmtShort(v)} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  formatter={(v) => [typeof v === "number" ? fmt(v) : v, "Total debt"]}
                  labelStyle={{ fontSize: 12, color: "#6b7280" }}
                  contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: 12 }}
                />
                <Area
                  type="monotone"
                  dataKey="total"
                  stroke="#ef4444"
                  strokeWidth={2}
                  fill="url(#debtGrad)"
                  dot={(props) => {
                    const { cx, cy, payload } = props as { cx: number; cy: number; payload: DebtHistoryPoint };
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
                    Total debt: <span className="font-medium text-gray-700">{fmt(selectedPt.total)}</span>
                    {prevPtYm && (() => {
                      const prevTotal = debtHistory.find((p) => p.ym === prevPtYm)?.total ?? null;
                      if (prevTotal === null) return null;
                      const diff = selectedPt.total - prevTotal;
                      return (
                        <span className={`ml-2 font-semibold ${diff <= 0 ? "text-green-600" : "text-red-500"}`}>
                          {diff <= 0 ? "↓ " : "↑ "}{fmtShort(Math.abs(diff))} vs prev month
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
                        <p className="text-sm font-semibold tabular-nums text-gray-800">{fmt(r.balanceThisMonth!)}</p>
                        {r.delta !== null ? (
                          <p className={`text-xs font-medium tabular-nums ${paidDown ? "text-green-600" : increased ? "text-red-500" : "text-gray-400"}`}>
                            {paidDown ? "↓ " : increased ? "↑ " : ""}{r.delta === 0 ? "no change" : fmtShort(Math.abs(r.delta))}
                          </p>
                        ) : (
                          <p className="text-xs text-gray-300">new</p>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* By account with sparklines */}
      {accountMonthly.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">By account</p>
          </div>
          <div className="divide-y divide-gray-50">
                    {accountMonthly.sort((a, b) => b.currentBalance - a.currentBalance).map((a) => {
                      const paidDown = (a.delta ?? 0) < 0;
                      const sparkVals = a.months.map((m) => m.balance);
                      return (
                        <div key={a.slug} className="flex items-center gap-3 px-5 py-3">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{a.label}</p>
                            <p className="text-xs text-gray-400">
                              {CATEGORY_META[a.category].label}
                              {a.accountId && <span className="ml-1.5 font-mono text-gray-300">{a.accountId}</span>}
                            </p>
                          </div>
                  <div className="shrink-0">
                    <Sparkline values={sparkVals} color={a.color} good="down" />
                  </div>
                  <div className="shrink-0 text-right w-28">
                    <p className="text-sm font-semibold text-gray-800 tabular-nums">{fmt(a.currentBalance)}</p>
                    {a.delta !== null && Math.abs(a.delta) > 0 && (
                      <p className={`text-xs font-medium tabular-nums ${paidDown ? "text-green-600" : "text-red-500"}`}>
                        {paidDown ? "↓ " : "↑ "}{fmtShort(Math.abs(a.delta))} MoM
                      </p>
                    )}
                    {(a.delta === null || Math.abs(a.delta) === 0) && (
                      <p className="text-xs text-gray-400">unchanged</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Debt Breakdown donut */}
      {donutData.length > 0 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Debt Breakdown</p>
          <div className="flex items-center gap-6">
            <div className="relative h-40 w-40 shrink-0">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={donutData} cx="50%" cy="50%" innerRadius={44} outerRadius={68}
                    paddingAngle={2} dataKey="value" strokeWidth={0}>
                    {donutData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip
                    formatter={(v) => [typeof v === "number" ? fmtShort(v) : String(v)]}
                    contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: 12 }}
                  />
                </PieChart>
              </ResponsiveContainer>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-base font-bold text-gray-900">{fmtShort(total)}</span>
                <span className="text-xs text-gray-400">owed</span>
              </div>
            </div>
            <div className="flex-1 space-y-2">
              {donutData.map((d) => {
                const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
                return (
                  <div key={d.label} className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                      <span className="truncate text-sm text-gray-700">{d.label}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 text-sm">
                      <span className="font-medium text-gray-800">{fmtShort(d.value)}</span>
                      <span className="w-8 text-right text-xs text-gray-400">{pct}%</span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── tab: accounts ─────────────────────────────────────────────────────────────

function AccountsTab({
  libs, manualLibs, deletingId,
  onAdd, onEdit, onDelete,
}: {
  libs: DisplayLiability[];
  manualLibs: ManualLiability[];
  deletingId: string | null;
  onAdd: () => void;
  onEdit: (m: ManualLiability) => void;
  onDelete: (id: string) => void;
}) {
  if (libs.length === 0) return <EmptyState onAdd={onAdd} />;

  const byCategory = new Map<LiabilityCategory, DisplayLiability[]>();
  for (const l of libs) {
    if (!byCategory.has(l.category)) byCategory.set(l.category, []);
    byCategory.get(l.category)!.push(l);
  }

  return (
    <div className="space-y-5">
      {CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((cat) => {
        const group     = byCategory.get(cat)!;
        const groupTotal = group.reduce((s, l) => s + l.balance, 0);
        const meta      = CATEGORY_META[cat];
        return (
          <div key={cat}>
            <div className="mb-2 flex items-center gap-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{meta.label}</p>
              <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${meta.color}`}>{fmt(groupTotal)}</span>
            </div>
            <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
              {group.map((l) => (
                <div key={l.id}>
                  <div className="flex items-center justify-between px-4 py-3.5">
                    <div className="flex items-center gap-3 min-w-0">
                      <CategoryIcon cat={l.category} />
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-800 truncate">
                          {l.label}
                          {l.subLabel && l.subLabel !== l.label && <span className="ml-1 font-normal text-gray-400">— {l.subLabel}</span>}
                        </p>
                        <p className="text-xs text-gray-400">
                          {l.statementDate
                            ? `as of ${new Date(l.statementDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                            : l.interestRate != null ? `${l.interestRate}% APR` : "manually added"}
                        </p>
                      </div>
                    </div>
                    <div className="ml-4 flex shrink-0 items-center gap-3">
                      <p className="font-semibold text-sm text-gray-900 tabular-nums">{fmt(l.balance)}</p>
                      {l.source === "statement" && l.accountSlug && (
                        <Link href={`/account/accounts/${l.accountSlug}`} className="text-gray-300 hover:text-purple-500 transition" title="View account">
                          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        </Link>
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
                  {/* Sub-account breakdown (e.g. HELOC revolving + mortgage term portions) */}
                  {l.subAccounts && l.subAccounts.length > 0 && (
                    <div className="mx-4 mb-3 rounded-lg border border-gray-100 bg-gray-50 divide-y divide-gray-100">
                      {l.subAccounts.map((sub) => (
                        <div key={sub.id} className="flex items-center justify-between px-3 py-2">
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-700">{sub.label}</p>
                            <p className="text-[11px] text-gray-400 mt-0.5">
                              {sub.apr != null ? `${sub.apr}% APR` : "rate unknown"}
                              {sub.maturityDate ? ` · matures ${new Date(sub.maturityDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : ""}
                              {" · "}<span className="capitalize">{sub.type}</span>
                            </p>
                          </div>
                          <p className="ml-3 shrink-0 text-xs font-semibold text-gray-700 tabular-nums">{fmt(sub.balance)}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
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

function PayoffTab({ libs, accountRates }: { libs: DisplayLiability[]; accountRates: AccountRateEntry[] }) {
  const [strategy, setStrategy]       = useState<Strategy>("avalanche");
  const [extraPayment, setExtraPayment] = useState(200);
  const [customOrder, setCustomOrder] = useState<string[]>([]);

  const payoffDebts: PayoffDebt[] = libs.filter((d) => d.balance > 0).map((d) => {
    const { apr, estimated } = resolveApr(d, accountRates);
    return { id: d.id, label: d.label, bankName: d.subLabel, category: d.category, balance: d.balance, apr, aprEstimated: estimated, minPayment: estimateMinPayment(d.balance, apr, d.category) };
  });

  function strategyOrder(s: Strategy, custom: string[]): string[] {
    if (s === "avalanche") return [...payoffDebts].sort((a, b) => (b.apr ?? 0) - (a.apr ?? 0)).map((d) => d.id);
    if (s === "snowball")  return [...payoffDebts].sort((a, b) => a.balance - b.balance).map((d) => d.id);
    const ids = payoffDebts.map((d) => d.id);
    return custom.length === ids.length ? custom : ids;
  }

  const order = strategyOrder(strategy, customOrder);

  function handleStrategyClick(s: Strategy) {
    if (s === "custom" && strategy !== "custom") setCustomOrder(strategyOrder("avalanche", []));
    setStrategy(s);
  }

  function moveDebt(id: string, dir: -1 | 1) {
    setCustomOrder((prev) => {
      const arr = [...prev];
      const idx = arr.indexOf(id);
      if (idx < 0) return arr;
      const swapIdx = idx + dir;
      if (swapIdx < 0 || swapIdx >= arr.length) return arr;
      [arr[idx], arr[swapIdx]] = [arr[swapIdx], arr[idx]];
      return arr;
    });
  }

  const simWith    = simulate(payoffDebts, extraPayment, order);
  const simWithout = simulate(payoffDebts, 0, order);
  const interestSaved = Math.max(0, simWithout.totalInterestPaid - simWith.totalInterestPaid);
  const monthsSooner  = Math.max(0, simWithout.totalMonths - simWith.totalMonths);
  const orderedDebts  = order.map((id) => payoffDebts.find((d) => d.id === id)!).filter(Boolean);
  const maxExtra      = Math.max(1000, Math.ceil(payoffDebts.reduce((s, d) => s + d.minPayment, 0) * 0.5 / 50) * 50);

  if (payoffDebts.length === 0) return <EmptyState />;

  return (
    <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Strategy tabs */}
      <div className="flex items-center gap-2 border-b border-gray-100 px-4 pt-4 pb-3">
        {(["avalanche", "snowball", "custom"] as Strategy[]).map((s) => (
          <button key={s} onClick={() => handleStrategyClick(s)}
            className={`rounded-lg border px-3 py-1.5 text-sm font-medium transition ${
              strategy === s ? "border-gray-900 bg-gray-900 text-white" : "border-gray-200 text-gray-600 hover:border-gray-400"
            }`}>
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>

      {/* Strategy hint */}
      <p className="px-4 pt-2.5 pb-1 text-xs text-gray-400">
        {strategy === "avalanche" && "Highest APR first — minimises total interest paid"}
        {strategy === "snowball"  && "Smallest balance first — fastest early wins"}
        {strategy === "custom"   && "Use ↑↓ to set your own payoff priority"}
      </p>

      {/* Debt rows */}
      <div className="divide-y divide-gray-100">
        {orderedDebts.map((d, i) => {
          const result = simWith.debtResults.get(d.id);
          return (
            <div key={d.id} className="flex items-center gap-3 px-4 py-3.5">
              <CategoryIcon cat={d.category} />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800 truncate">
                  {d.label}
                  {d.bankName && d.bankName !== d.label && <span className="font-normal text-gray-400"> — {d.bankName}</span>}
                </p>
                <p className="mt-0.5 text-xs text-gray-400">
                  {d.apr != null ? <>{d.apr.toFixed(1)}% APR{d.aprEstimated && <span className="text-amber-500"> est.</span>} · </> : null}
                  {fmt(d.minPayment)}/mo min
                </p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold text-gray-900 tabular-nums">{fmtShort(d.balance)}</p>
                <p className="mt-0.5 text-xs text-green-600">
                  {result ? (result.payoffMonths >= 600 ? "50+ yrs" : `Paid off ${addMonths(result.payoffMonths)}`) : "—"}
                </p>
              </div>
              {strategy === "custom" && (
                <div className="shrink-0 flex flex-col gap-0.5">
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
          );
        })}
      </div>

      {/* Extra payment slider */}
      <div className="border-t border-gray-100 px-4 pt-4 pb-3">
        <div className="flex items-center justify-between mb-2">
          <p className="text-sm text-gray-600">Extra payment per month</p>
          <span className="text-sm font-bold text-gray-900 tabular-nums">{fmt(extraPayment)}</span>
        </div>
        <input type="range" min={0} max={maxExtra} step={25} value={extraPayment}
          onChange={(e) => setExtraPayment(Number(e.target.value))}
          className="w-full accent-gray-900 cursor-pointer" />
        <div className="flex justify-between text-xs text-gray-300 mt-0.5"><span>$0</span><span>{fmt(maxExtra)}</span></div>
      </div>

      {/* Savings banner */}
      {extraPayment > 0 && (interestSaved > 0 || monthsSooner > 0) ? (
        <div className="mx-4 mb-4 rounded-lg bg-green-50 border border-green-200 px-4 py-2.5">
          <p className="text-sm font-medium text-green-800">
            {interestSaved > 0 && <>Save <span className="font-bold">{fmt(interestSaved)}</span> in interest</>}
            {interestSaved > 0 && monthsSooner > 0 && <span className="text-green-500"> · </span>}
            {monthsSooner > 0 && <>debt-free <span className="font-bold">{monthsSooner < 12 ? `${monthsSooner} month${monthsSooner !== 1 ? "s" : ""}` : `${(monthsSooner / 12).toFixed(1)} yrs`}</span> sooner</>}
          </p>
        </div>
      ) : extraPayment === 0 ? (
        <p className="mx-4 mb-4 text-xs text-gray-400">Move the slider to see how extra payments accelerate payoff.</p>
      ) : null}

      {/* CTA */}
      <div className="border-t border-gray-100 px-4 py-3">
        <Link href="/account/goals" className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition">
          Build full payoff plan
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
        </Link>
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
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState<string | null>(null);

  const [modalOpen, setModalOpen]       = useState(false);
  const [editing, setEditing]           = useState<ManualLiability | null>(null);
  const [saving, setSaving]             = useState(false);
  const [deletingId, setDeletingId]     = useState<string | null>(null);

  function switchTab(id: TabId) {
    setActiveTab(id);
    const params = new URLSearchParams(searchParams.toString());
    params.set("tab", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }

  const loadData = useCallback(async (token: string) => {
    setLoading(true); setError(null);
    try {
      const [sRes, cRes, mRes, rRes] = await Promise.all([
        fetch("/api/user/statements",              { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/user/liabilities",             { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/user/account-rates",           { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const sJson = await sRes.json().catch(() => ({}));
      const cJson = cRes.ok ? await cRes.json().catch(() => ({})) : {};
      const mJson = await mRes.json().catch(() => ({}));
      const rJson = rRes.ok ? await rRes.json().catch(() => ({})) : {};

      setYearMonth(cJson.yearMonth ?? null);
      setPaymentsMade(cJson.paymentsMade ?? 0);

      // Build debt history from consolidated monthly history
      const rawHistory: { yearMonth: string; netWorth: number; debtTotal: number }[] = cJson.history ?? [];
      const hist: DebtHistoryPoint[] = rawHistory
        .filter((h) => h.debtTotal > 0)
        .map((h) => {
          const [y, m] = h.yearMonth.split("-");
          const label = new Date(parseInt(y), parseInt(m) - 1, 1)
            .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          return { ym: h.yearMonth, label, total: h.debtTotal };
        });
      setDebtHistory(hist);

      // Per-account monthly balance history (from all completed statements)
      const allStmts: UserStatementSummary[] = (sJson.statements ?? []).filter(
        (s: UserStatementSummary) => s.status === "completed" && !s.superseded
      );
      const DEBT_TYPES_SET = new Set(["credit", "mortgage", "loan"]);
      const debtStmts = allStmts.filter(
        (s) => DEBT_TYPES_SET.has(s.accountType ?? "") || (s.netWorth ?? 0) < 0
      );
      // Group by slug → sorted months
      const acctMap = new Map<string, { label: string; accountId?: string; category: LiabilityCategory; color: string; months: { ym: string; balance: number }[] }>();
      for (const s of debtStmts) {
        const slug = accountSlug(s);
        const ym = (s.statementDate ?? s.uploadedAt).slice(0, 7);
        const bal = Math.abs(s.netWorth ?? 0);
        const cat: LiabilityCategory = ACCT_TYPE_TO_CAT[s.accountType ?? ""] ?? "other";
        if (!acctMap.has(slug)) {
          acctMap.set(slug, {
            label: s.accountName ?? s.bankName ?? "Account",
            accountId: s.accountId,
            category: cat,
            color: CATEGORY_CHART_COLOR[cat],
            months: [],
          });
        }
        const entry = acctMap.get(slug)!;
        if (!entry.months.find((m) => m.ym === ym)) entry.months.push({ ym, balance: bal });
      }
      const acctMonthly: AccountMonthlyData[] = Array.from(acctMap.entries()).map(([slug, e]) => {
        const sorted = [...e.months].sort((a, b) => a.ym.localeCompare(b.ym));
        const cur = sorted.at(-1)?.balance ?? 0;
        const prev = sorted.length >= 2 ? sorted[sorted.length - 2].balance : null;
        return {
          slug, label: e.label, accountId: e.accountId, category: e.category, color: e.color,
          months: sorted, currentBalance: cur, prevBalance: prev,
          delta: prev !== null ? cur - prev : null,
        };
      });
      setAccountMonthly(acctMonthly);

      const manual: ManualLiability[] = mJson.liabilities ?? [];
      setManualLibs(manual);
      setAccountRates(rJson.rates ?? []);

      const stmts: UserStatementSummary[] = (sJson.statements ?? []).filter(
        (s: UserStatementSummary) => s.status === "completed" && !s.superseded
      );
      const latestBySlug = new Map<string, UserStatementSummary>();
      for (const s of stmts) {
        // Only consider statements that carry a real account balance
        if (s.netWorth == null) continue;
        const slug = accountSlug(s);
        const existing = latestBySlug.get(slug);
        if (!existing || (s.statementDate ?? s.uploadedAt) > (existing.statementDate ?? existing.uploadedAt)) {
          latestBySlug.set(slug, s);
        }
      }
      const DEBT_TYPES = new Set(["credit", "mortgage", "loan"]);
      const fromStatements: DisplayLiability[] = Array.from(latestBySlug.values())
        .filter((s) => DEBT_TYPES.has(s.accountType ?? "") || (s.netWorth ?? 0) < 0)
        .map((s) => ({
          id: `stmt-${accountSlug(s)}`, label: s.accountName ?? s.bankName ?? "Account",
          subLabel: s.bankName, category: ACCT_TYPE_TO_CAT[s.accountType ?? ""] ?? "other",
          balance: Math.abs(s.netWorth ?? 0), statementDate: s.statementDate,
          interestRate: typeof s.interestRate === "number" ? s.interestRate : undefined,
          source: "statement" as const, accountSlug: accountSlug(s),
          subAccounts: s.subAccounts,
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

  const total = displayLibs.reduce((s, l) => s + l.balance, 0);
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
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Header */}
      <div className="mb-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-3xl text-gray-900">Liabilities</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {total > 0 && <>{fmt(total)} total</>}
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
      {activeTab === "overview" && <OverviewTab libs={displayLibs} debtHistory={debtHistory} accountMonthly={accountMonthly} paymentsMade={paymentsMade} accountRates={accountRates} />}
      {activeTab === "accounts" && (
        <AccountsTab
          libs={displayLibs} manualLibs={manualLibs} deletingId={deletingId}
          onAdd={() => { setEditing(null); setModalOpen(true); }}
          onEdit={(m) => { setEditing(m); setModalOpen(true); }}
          onDelete={handleDelete}
        />
      )}
      {activeTab === "payoff" && (
        can("payoffPlanner")
          ? <PayoffTab libs={displayLibs} accountRates={accountRates} />
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
