"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { AccountRateEntry } from "@/app/api/user/account-rates/route";
import { usePlan } from "@/contexts/PlanContext";
import UpgradePrompt from "@/components/UpgradePrompt";

// ── constants ─────────────────────────────────────────────────────────────────

const FI_MULTIPLIER    = 25;   // 4% withdrawal rule
const DEFAULT_INVEST_RETURN = 0.07;  // fallback if no investment rate on file
const DEFAULT_SAVINGS_RETURN = 0.04; // fallback if no savings APY on file
const EF_MONTHS_TARGET = 6;

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}
function fmtShort(v: number) {
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `$${Math.round(abs / 1_000)}k`;
  return fmt(v);
}
function addMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}
function monthsToLabel(months: number): string {
  if (months <= 0)  return "Achieved";
  if (months < 12)  return `~${months} month${months !== 1 ? "s" : ""} away`;
  const years = (months / 12).toFixed(1);
  return `~${years} years`;
}

function projectMonths(
  current: number,
  target: number,
  monthlySavings: number,
  annualReturnRate: number,
): number | null {
  if (current >= target) return 0;
  if (monthlySavings <= 0 && current <= 0) return null;
  const monthlyRate = annualReturnRate / 12;
  let nw = current;
  for (let m = 1; m <= 600; m++) {
    nw = nw * (1 + monthlyRate) + monthlySavings;
    if (nw >= target) return m;
  }
  return null;
}

/** Proper amortisation-aware payoff: months to reach $0 given balance, APR, and monthly payment. */
function amortisedPayoffMonths(
  balance: number,
  annualRate: number,   // e.g. 19.99 for 19.99%
  monthlyPayment: number,
): number | null {
  if (balance <= 0) return 0;
  const r = annualRate / 100 / 12;
  if (r === 0) {
    // zero-interest: simple division
    return monthlyPayment > 0 ? Math.ceil(balance / monthlyPayment) : null;
  }
  if (monthlyPayment <= balance * r) return null; // payment doesn't cover interest
  let bal = balance;
  for (let m = 1; m <= 600; m++) {
    bal = bal * (1 + r) - monthlyPayment;
    if (bal <= 0) return m;
  }
  return null;
}

function debtPayoffEstimate(
  currentDebt: number,
  history: { debtTotal: number }[],
  annualRate: number | null,
): number | null {
  if (currentDebt <= 0) return 0;
  const withDebt = history.filter((h) => h.debtTotal > 0);
  if (withDebt.length < 2) return null;
  const recent = withDebt.slice(-3);
  let totalReduction = 0, count = 0;
  for (let i = 1; i < recent.length; i++) {
    const r = recent[i - 1].debtTotal - recent[i].debtTotal;
    if (r > 0) { totalReduction += r; count++; }
  }
  if (count === 0) return null;
  const monthlyPayment = totalReduction / count;

  if (annualRate != null && annualRate > 0) {
    return amortisedPayoffMonths(currentDebt, annualRate, monthlyPayment);
  }
  return Math.ceil(currentDebt / monthlyPayment);
}

// ── account type labels ───────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit card",
  mortgage: "Mortgage",
  loan: "Loan",
  investment: "Investment",
  other: "Other",
};

const TYPE_RATE_LABEL: Record<string, string> = {
  checking: "APY",
  savings: "APY",
  credit: "APR",
  mortgage: "Interest rate",
  loan: "Interest rate",
  investment: "Annual return",
  other: "Annual rate",
};

const ASSET_TYPES = new Set(["checking", "savings", "investment"]);
const DEBT_TYPES  = new Set(["credit", "mortgage", "loan"]);

// ── milestone types ───────────────────────────────────────────────────────────

type MilestoneStatus = "achieved" | "in-progress" | "future";
interface Milestone {
  id: string;
  title: string;
  subtitle: string;
  status: MilestoneStatus;
  progress?: number;
}
const DOT_CLASS: Record<MilestoneStatus, string> = {
  "achieved":    "bg-green-500",
  "in-progress": "bg-blue-500",
  "future":      "bg-gray-300",
};

// ── inline rate editor ────────────────────────────────────────────────────────

function RateEditor({
  entry, token, onSaved,
}: {
  entry: AccountRateEntry;
  token: string;
  onSaved: (key: string, rate: number | null) => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [value, setValue]       = useState(String(entry.effectiveRate ?? ""));
  const [saving, setSaving]     = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (editing) inputRef.current?.focus(); }, [editing]);

  async function save() {
    setSaving(true);
    const parsed = value.trim() === "" ? null : parseFloat(value);
    const rate   = parsed != null && !isNaN(parsed) ? parsed : null;
    await fetch("/api/user/account-rates", {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ accountKey: entry.accountKey, rate }),
    });
    onSaved(entry.accountKey, rate);
    setSaving(false);
    setEditing(false);
  }

  const rateLabel  = TYPE_RATE_LABEL[entry.accountType] ?? "Rate";
  const display    = entry.effectiveRate != null ? `${entry.effectiveRate}%` : null;
  const isManual   = entry.manualRate != null;
  const isAI       = entry.extractedRate != null && entry.manualRate == null;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-800">{entry.accountName}</p>
        <p className="text-xs text-gray-400">
          {TYPE_LABEL[entry.accountType] ?? entry.accountType} · {entry.bankName}
        </p>
      </div>

      <div className="shrink-0 flex items-center gap-2">
        {!editing ? (
          <>
            {display ? (
              <span className={`text-sm font-semibold tabular-nums ${DEBT_TYPES.has(entry.accountType) ? "text-red-600" : "text-green-700"}`}>
                {display}
              </span>
            ) : (
              <span className="text-xs text-gray-300 italic">not set</span>
            )}
            {isAI && (
              <span className="rounded-full bg-blue-50 border border-blue-200 px-1.5 py-0.5 text-[10px] font-medium text-blue-600" title="Extracted from statement">
                auto
              </span>
            )}
            {isManual && (
              <span className="rounded-full bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[10px] font-medium text-purple-600" title="Manually set">
                edited
              </span>
            )}
            <button
              onClick={() => { setValue(String(entry.effectiveRate ?? "")); setEditing(true); }}
              className="rounded-md p-1 text-gray-300 hover:bg-gray-100 hover:text-gray-600 transition"
              title={`Edit ${rateLabel}`}
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
            </button>
          </>
        ) : (
          <>
            <div className="flex items-center gap-1">
              <input
                ref={inputRef}
                value={value} onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
                placeholder="e.g. 4.25"
                type="number" step="0.01" min="0" max="100"
                className="w-20 rounded-lg border border-purple-300 px-2 py-1 text-right text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <span className="text-sm text-gray-500">%</span>
            </div>
            <button
              onClick={save} disabled={saving}
              className="rounded-lg bg-purple-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
            >
              {saving ? "…" : "Save"}
            </button>
            <button onClick={() => setEditing(false)} className="rounded-lg border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:bg-gray-50 transition">
              Cancel
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function GoalsPage() {
  const router = useRouter();
  const { can, loading: planLoading } = usePlan();

  const [netWorth, setNetWorth]               = useState(0);
  const [liquidAssets, setLiquidAssets]       = useState(0);
  const [debts, setDebts]                     = useState(0);
  const [monthlyIncome, setMonthlyIncome]     = useState(0);
  const [monthlyExpenses, setMonthlyExpenses] = useState(0);
  const [history, setHistory]                 = useState<{ debtTotal: number }[]>([]);
  const [rates, setRates]                     = useState<AccountRateEntry[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const [authToken, setAuthToken]             = useState<string | null>(null);
  const [showRates, setShowRates]             = useState(false);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        setAuthToken(token);
        const headers = { Authorization: `Bearer ${token}` };
        const [consolidatedRes, ratesRes] = await Promise.all([
          fetch("/api/user/statements/consolidated", { headers }),
          fetch("/api/user/account-rates", { headers }),
        ]);
        const consolidated = await consolidatedRes.json().catch(() => ({}));
        const ratesJson    = await ratesRes.json().catch(() => ({}));

        if (consolidatedRes.ok) {
          setNetWorth(consolidated.data?.netWorth ?? 0);
          setLiquidAssets(consolidated.liquidAssets ?? 0);
          setDebts(consolidated.data?.debts ?? 0);
          setMonthlyIncome(consolidated.txMonthlyIncome ?? consolidated.data?.income?.total ?? 0);
          setMonthlyExpenses(consolidated.txMonthlyExpenses ?? consolidated.data?.expenses?.total ?? 0);
          setHistory(Array.isArray(consolidated.history) ? consolidated.history : []);
        }
        if (ratesRes.ok) setRates(ratesJson.rates ?? []);
      } catch { setError("Failed to load goals"); }
      finally { setLoading(false); }
    });
  }, [router]);

  // ── derive effective rates ────────────────────────────────────────────────

  /** Best annual return to use for investment/FI projection. */
  const investReturnRate = (() => {
    const investRates = rates
      .filter((r) => ASSET_TYPES.has(r.accountType) && r.effectiveRate != null)
      .map((r) => r.effectiveRate as number);
    if (investRates.length === 0) return DEFAULT_INVEST_RETURN;
    return (investRates.reduce((a, b) => a + b, 0) / investRates.length) / 100;
  })();

  /** Best annual return for emergency fund (savings account). */
  const savingsReturnRate = (() => {
    const r = rates.find((r) => r.accountType === "savings" && r.effectiveRate != null);
    return r ? (r.effectiveRate as number) / 100 : DEFAULT_SAVINGS_RETURN;
  })();

  /** Total consumer debt interest rate (average of credit/loan accounts). */
  const debtInterestRate = (() => {
    const debtRates = rates
      .filter((r) => DEBT_TYPES.has(r.accountType) && r.effectiveRate != null)
      .map((r) => r.effectiveRate as number);
    if (debtRates.length === 0) return null;
    return debtRates.reduce((a, b) => a + b, 0) / debtRates.length;
  })();

  // ── derived milestones ────────────────────────────────────────────────────

  const monthlySavings = monthlyIncome - monthlyExpenses;
  const annualExpenses = monthlyExpenses * 12;
  const fiTarget       = annualExpenses > 0 ? FI_MULTIPLIER * annualExpenses : 0;
  const fiProgress     = fiTarget > 0 ? Math.min(1, netWorth / fiTarget) : 0;
  const fiMonths       = fiTarget > 0
    ? projectMonths(netWorth, fiTarget, monthlySavings, investReturnRate)
    : null;

  const efTarget   = monthlyExpenses * EF_MONTHS_TARGET;
  const efProgress = efTarget > 0 ? Math.min(1, liquidAssets / efTarget) : 0;
  const efMonths   = efTarget > 0 && liquidAssets < efTarget
    ? projectMonths(liquidAssets, efTarget, Math.max(0, monthlySavings), savingsReturnRate)
    : liquidAssets >= efTarget ? 0 : null;

  const debtMonths = debtPayoffEstimate(debts, history, debtInterestRate);
  const hasData    = monthlyExpenses > 0 || netWorth !== 0;

  const milestones: Milestone[] = [];

  if (debts > 0 || history.some((h) => h.debtTotal > 0)) {
    const achieved = debts <= 0;
    milestones.push({
      id: "debt_free",
      title: "Debt-free (all consumer debt paid)",
      subtitle: achieved
        ? "Achieved 🎉"
        : debtMonths != null
          ? `Estimated ${addMonths(debtMonths)} at current paydown rate${debtInterestRate != null ? ` (${debtInterestRate.toFixed(2)}% avg APR)` : ""}`
          : "Upload more statements to estimate payoff date",
      status: achieved ? "achieved" : "in-progress",
    });
  }

  if (monthlyExpenses > 0) {
    const achieved = liquidAssets >= efTarget;
    milestones.push({
      id: "emergency_fund",
      title: `${EF_MONTHS_TARGET}-month emergency fund fully funded`,
      subtitle: achieved
        ? "Fully funded 🎉"
        : `${fmtShort(efTarget)} target · ${fmtShort(liquidAssets)} current · ${
            efMonths != null ? monthsToLabel(efMonths) : "keep saving"
          }`,
      status: achieved ? "achieved" : liquidAssets > 0 ? "in-progress" : "future",
      progress: efProgress,
    });
  }

  if (fiTarget > 0) {
    milestones.push({
      id: "fi_milestone",
      title: `FI milestone — ${fmtShort(fiTarget)} net worth`,
      subtitle: fiMonths === 0
        ? "Achieved 🎉"
        : fiMonths != null
          ? `Projected ${addMonths(fiMonths)}`
          : monthlySavings <= 0
            ? "Increase savings rate to project FI date"
            : "Projecting…",
      status: fiMonths === 0 ? "achieved" : "future",
      progress: fiProgress,
    });
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (planLoading || loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (!can("goals")) return (
    <UpgradePrompt feature="goals" description="Track your Financial Independence target, debt-free milestone, and emergency fund — automatically." />
  );
  if (error) return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <p className="text-red-600">{error}</p>
    </div>
  );

  const usingDefaultReturn = investReturnRate === DEFAULT_INVEST_RETURN;
  const assetRates = rates.filter((r) => ASSET_TYPES.has(r.accountType));
  const debtRates  = rates.filter((r) => DEBT_TYPES.has(r.accountType));

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Goals</h1>
        <p className="mt-0.5 text-sm text-gray-400">Your financial milestones, auto-tracked</p>
      </div>

      {!hasData ? (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
          <p className="text-sm text-gray-500">No financial data yet.</p>
          <p className="mt-1 text-xs text-gray-400">Upload statements to auto-generate your FI target and milestones.</p>
        </div>
      ) : (
        <div className="space-y-4">

          {/* ── FI target card ─────────────────────────────────────────── */}
          {fiTarget > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-bold text-gray-900">Financial independence target</h2>
                <span className="rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-semibold text-blue-700">
                  {fmtShort(fiTarget)} goal
                </span>
              </div>

              <div className="flex items-center gap-3 mb-2">
                <div className="flex-1 h-3 overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-all"
                    style={{ width: `${Math.round(fiProgress * 100)}%` }}
                  />
                </div>
                <span className="shrink-0 text-sm font-bold text-gray-700 tabular-nums w-10 text-right">
                  {Math.round(fiProgress * 100)}%
                </span>
              </div>

              <p className="text-sm text-gray-500">
                {fiMonths === 0 ? (
                  <span className="font-medium text-green-600">FI achieved 🎉</span>
                ) : fiMonths != null ? (
                  <>At current pace: <span className="font-medium text-gray-700">{monthsToLabel(fiMonths)} · {addMonths(fiMonths)}</span></>
                ) : monthlySavings <= 0 ? (
                  <span className="text-red-500">Increase savings rate to project FI date</span>
                ) : "Projecting…"}
              </p>

              <div className="mt-3 flex flex-wrap gap-4 text-xs text-gray-400 border-t border-gray-100 pt-3">
                <span>Current <span className="font-semibold text-gray-700">{fmtShort(netWorth)}</span></span>
                <span>Saving <span className="font-semibold text-gray-700">{fmt(Math.max(0, monthlySavings))}/mo</span></span>
                <span>Based on <span className="font-semibold text-gray-700">{fmt(annualExpenses)}/yr</span> spend</span>
                <span className={usingDefaultReturn ? "text-amber-500" : ""}>
                  Return rate <span className="font-semibold">{(investReturnRate * 100).toFixed(1)}%{usingDefaultReturn ? " (default)" : ""}</span>
                </span>
              </div>
            </div>
          )}

          {/* ── Milestone list ─────────────────────────────────────────── */}
          {milestones.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {milestones.map((m, i) => (
                <div key={m.id} className={`px-5 py-4 flex items-start gap-4 ${i > 0 ? "border-t border-gray-100" : ""}`}>
                  <div className="flex flex-col items-center pt-1">
                    <span className={`h-3 w-3 shrink-0 rounded-full ${DOT_CLASS[m.status]}`} />
                    {i < milestones.length - 1 && (
                      <div className="mt-1 w-px flex-1 bg-gray-200" style={{ minHeight: "24px" }} />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={`text-sm font-semibold ${m.status === "future" ? "text-gray-400" : "text-gray-800"}`}>
                      {m.title}
                    </p>
                    <p className="mt-0.5 text-xs text-gray-400">{m.subtitle}</p>
                    {m.status === "in-progress" && m.progress != null && m.progress > 0 && (
                      <div className="mt-2 flex items-center gap-2">
                        <div className="flex-1 h-1.5 overflow-hidden rounded-full bg-gray-100">
                          <div className="h-full rounded-full bg-blue-400" style={{ width: `${Math.round(m.progress * 100)}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-400 tabular-nums">{Math.round(m.progress * 100)}%</span>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* ── Interest / return rates ─────────────────────────────────── */}
          {rates.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <button
                onClick={() => setShowRates((v) => !v)}
                className="w-full flex items-center justify-between px-5 py-4 text-left"
              >
                <div>
                  <p className="text-sm font-semibold text-gray-800">Interest &amp; return rates</p>
                  <p className="mt-0.5 text-xs text-gray-400">
                    Extracted from your statements · edit to override
                  </p>
                </div>
                <svg
                  className={`h-4 w-4 text-gray-400 transition-transform ${showRates ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showRates && (
                <div className="border-t border-gray-100 px-5">
                  {debtRates.length > 0 && (
                    <>
                      <p className="pt-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-300">Liabilities</p>
                      <div className="divide-y divide-gray-100">
                        {debtRates.map((r) => (
                          <RateEditor key={r.accountKey} entry={r} token={authToken!}
                            onSaved={(key, rate) => setRates((prev) =>
                              prev.map((e) => e.accountKey === key
                                ? { ...e, manualRate: rate, effectiveRate: rate ?? e.extractedRate }
                                : e
                              )
                            )}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  {assetRates.length > 0 && (
                    <>
                      <p className={`${debtRates.length > 0 ? "pt-4" : "pt-3"} pb-1 text-[10px] font-semibold uppercase tracking-widest text-gray-300`}>Assets</p>
                      <div className="divide-y divide-gray-100 pb-1">
                        {assetRates.map((r) => (
                          <RateEditor key={r.accountKey} entry={r} token={authToken!}
                            onSaved={(key, rate) => setRates((prev) =>
                              prev.map((e) => e.accountKey === key
                                ? { ...e, manualRate: rate, effectiveRate: rate ?? e.extractedRate }
                                : e
                              )
                            )}
                          />
                        ))}
                      </div>
                    </>
                  )}
                  {usingDefaultReturn && (
                    <p className="py-3 border-t border-gray-100 text-xs text-amber-600">
                      No investment return rate found — using {(DEFAULT_INVEST_RETURN * 100).toFixed(0)}% default for FI projection. Add your accounts&apos; rates above for a more accurate estimate.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}
