"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { UserStatementSummary, ManualLiability, LiabilityCategory } from "@/lib/types";
import type { AccountRateEntry } from "@/app/api/user/account-rates/route";

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
  const bank = (s.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = (s.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
}
function normalizeName(s: string) { return s.toLowerCase().replace(/[^a-z0-9]/g, ""); }
function addMonths(n: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + n);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
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

// ── tab: overview ─────────────────────────────────────────────────────────────

function OverviewTab({ libs }: { libs: DisplayLiability[] }) {
  const total = libs.reduce((s, l) => s + l.balance, 0);
  if (libs.length === 0) return <EmptyState />;
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total owed</p>
      <p className="mt-1 font-bold text-4xl text-gray-900">{fmt(total)}</p>
      <div className="mt-5 space-y-3">
        {libs.map((l) => {
          const meta = CATEGORY_META[l.category];
          const pct  = total > 0 ? Math.min((l.balance / total) * 100, 100) : 0;
          return (
            <div key={l.id}>
              <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
                <span className="flex items-center gap-1.5">
                  <span className={`inline-block h-2 w-2 rounded-full ${meta.barColor}`} />
                  {l.label}
                  {l.source === "manual" && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] text-gray-400">manual</span>}
                </span>
                <span className="tabular-nums font-medium text-gray-700">
                  {fmt(l.balance)} <span className="text-gray-400">· {Math.round(pct)}%</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                <div className={`h-full rounded-full ${meta.barColor} transition-all`} style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>
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
                <div key={l.id} className="flex items-center justify-between px-4 py-3.5">
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
    let apr: number | null = d.interestRate ?? null;
    let aprEstimated = false;
    if (apr == null) {
      const match = accountRates.find((r) =>
        normalizeName(r.bankName).includes(normalizeName(d.subLabel ?? d.label)) ||
        normalizeName(d.label).includes(normalizeName(r.bankName))
      );
      if (match?.effectiveRate != null) {
        apr = match.effectiveRate;
      } else {
        const defaults: Partial<Record<LiabilityCategory, number>> = {
          credit_card: 19.99, line_of_credit: 9.99, mortgage: 4.5,
          auto_loan: 6.5, student_loan: 5.5, personal_loan: 8.99,
        };
        apr = defaults[d.category] ?? null;
        aprEstimated = apr != null;
      }
    }
    return { id: d.id, label: d.label, bankName: d.subLabel, category: d.category, balance: d.balance, apr, aprEstimated, minPayment: estimateMinPayment(d.balance, apr, d.category) };
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

export default function LiabilitiesPage() {
  const router      = useRouter();
  const pathname    = usePathname();
  const searchParams = useSearchParams();

  const [activeTab, setActiveTab]       = useState<TabId>(() => {
    const t = searchParams.get("tab");
    return TABS.some((tb) => tb.id === t) ? (t as TabId) : "overview";
  });

  const [idToken, setIdToken]           = useState<string | null>(null);
  const [manualLibs, setManualLibs]     = useState<ManualLiability[]>([]);
  const [displayLibs, setDisplayLibs]   = useState<DisplayLiability[]>([]);
  const [accountRates, setAccountRates] = useState<AccountRateEntry[]>([]);
  const [yearMonth, setYearMonth]       = useState<string | null>(null);
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
      const manual: ManualLiability[] = mJson.liabilities ?? [];
      setManualLibs(manual);
      setAccountRates(rJson.rates ?? []);

      const stmts: UserStatementSummary[] = (sJson.statements ?? []).filter(
        (s: UserStatementSummary) => s.status === "completed" && !s.superseded
      );
      const latestBySlug = new Map<string, UserStatementSummary>();
      for (const s of stmts) {
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
          source: "statement" as const, accountSlug: accountSlug(s),
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
      if (!user) { router.push("/account/login"); return; }
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
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

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
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => switchTab(tab.id)}
            className={`relative mr-6 pb-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "text-gray-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-gray-900 after:content-['']"
                : "text-gray-400 hover:text-gray-600"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {activeTab === "overview" && <OverviewTab libs={displayLibs} />}
      {activeTab === "accounts" && (
        <AccountsTab
          libs={displayLibs} manualLibs={manualLibs} deletingId={deletingId}
          onAdd={() => { setEditing(null); setModalOpen(true); }}
          onEdit={(m) => { setEditing(m); setModalOpen(true); }}
          onDelete={handleDelete}
        />
      )}
      {activeTab === "payoff" && <PayoffTab libs={displayLibs} accountRates={accountRates} />}

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
