"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { AccountRateEntry } from "@/app/api/user/account-rates/route";
import { usePlan } from "@/contexts/PlanContext";
import { fmt, getCurrencySymbol, HOME_CURRENCY } from "@/lib/currencyUtils";
import type { AccountSnapshot } from "@/lib/extractTransactions";
import type { EmergencyFundMetrics } from "@/lib/profileMetrics";
import type { AccountBalanceHistory } from "@/lib/financialProfile";
import { monthlyDebtTotalsFromBalanceHistory } from "@/lib/monthlyDebtFromBalanceHistory";

type GoalType = "savings" | "debt_payoff" | "emergency_fund" | "net_worth";

/** Normalise legacy Firestore values (purchase, investment, income, custom) → savings */
function toGoalType(raw?: string): GoalType {
  if (raw === "debt_payoff")    return "debt_payoff";
  if (raw === "emergency_fund") return "emergency_fund";
  if (raw === "net_worth")      return "net_worth";
  return "savings";
}

type SavedGoalRecord = {
  id: string;
  goalType?: GoalType;
  title?: string;
  emoji?: string;
  targetAmount?: number | null;
  targetDate?: string | null;
  currentAmount?: number | null;
  description?: string;
  /** Asset account slugs (savings / checking / investment) — savings goals only. */
  linkedAccountSlugs?: string[];
  /** Liability account slugs — debt payoff goals only. */
  linkedLiabilitySlugs?: string[];
};

type GoalTemplate = {
  goalType: GoalType;
  emoji: string;
  label: string;
  description: string;
  suggested?: boolean;
  prefill?: Partial<Omit<SavedGoalRecord, "id">>;
};

type DisplayGoal = {
  id: string;
  source: "auto_debt" | "auto_ef" | "auto_nw" | "user";
  isComplete: boolean;
  goalType: GoalType;
  emoji: string;
  title: string;
  subtitle: string;
  currentAmount: number;
  targetAmount: number | null;
  progressPct: number;
  projectedMonths: number | null;
  apr?: number | null;
  monthlyPayment?: number | null;
  accountSnap?: AccountSnapshot;
  savedGoal?: SavedGoalRecord;
};

function goalAccent(type: GoalType) {
  const m: Record<GoalType, { track: string; bar: string; active: string; badge: string }> = {
    savings:        { track: "bg-teal-100",   bar: "bg-teal-500",   active: "border-teal-300 bg-teal-50 ring-1 ring-teal-200",       badge: "bg-teal-100 border-teal-200 text-teal-800"       },
    debt_payoff:    { track: "bg-purple-100", bar: "bg-purple-500", active: "border-purple-300 bg-purple-50 ring-1 ring-purple-200", badge: "bg-purple-100 border-purple-200 text-purple-800" },
    emergency_fund: { track: "bg-amber-100",  bar: "bg-amber-500",  active: "border-amber-300 bg-amber-50 ring-1 ring-amber-200",   badge: "bg-amber-100 border-amber-200 text-amber-800"   },
    net_worth:      { track: "bg-indigo-100", bar: "bg-indigo-500", active: "border-indigo-300 bg-indigo-50 ring-1 ring-indigo-200", badge: "bg-indigo-100 border-indigo-200 text-indigo-800" },
  };
  return m[type] ?? m.savings;
}

/** Returns the account slugs that should count toward a user goal.
 *  If the user has never customised the list, defaults to all savings+checking
 *  accounts with a positive balance for savings-type goals. */
function effectiveLinkedSlugs(goal: SavedGoalRecord, snaps: AccountSnapshot[]): string[] {
  // Firestore returns null for explicitly-unset array fields; treat null the same as undefined (use smart default)
  if (Array.isArray(goal.linkedAccountSlugs)) return goal.linkedAccountSlugs;
  const type = toGoalType(goal.goalType);
  if (type === "savings") {
    // Auto-link savings + checking accounts by default
    return snaps
      .filter((s) => (s.accountType === "savings" || s.accountType === "checking") && s.balance > 0)
      .map((s) => s.slug);
  }
  return [];
}

const ASSET_TYPES = new Set(["checking", "savings", "investment"]);
/** Included in consolidated `history.debtTotal` and liabilities list. */
const DEBT_TYPES  = new Set(["credit", "mortgage", "loan", "line_of_credit"]);

function isConsolidatedLiabilitySnapshot(s: AccountSnapshot): boolean {
  return DEBT_TYPES.has(s.accountType ?? "") || s.balance < 0;
}

/** Home-currency debt for a snapshot (matches consolidated net-worth debt math when FX applies). */
function snapshotDebtInHome(s: AccountSnapshot, home: string, fxRates: Record<string, number>): number {
  const raw = s.parsedDebts != null ? s.parsedDebts : Math.max(0, -s.balance);
  if (raw <= 0) return 0;
  const cur = (s.currency ?? home).toUpperCase();
  const h = home.toUpperCase();
  if (cur === h) return raw;
  const rate = fxRates[cur];
  return rate != null ? raw * rate : raw;
}

/** Debt accounts included in a user debt-payoff goal. Default = all liabilities. */
function effectiveDebtLinkedSlugs(goal: SavedGoalRecord, liabilitySnaps: AccountSnapshot[]): string[] {
  if (toGoalType(goal.goalType) !== "debt_payoff") return [];
  if (Array.isArray(goal.linkedLiabilitySlugs)) return goal.linkedLiabilitySlugs;
  return liabilitySnaps.map((s) => s.slug);
}

/** Weighted APR (percent, e.g. 19.99) for a subset of debt snapshots. */
function balanceWeightedDebtAprSubset(
  debtSnaps: AccountSnapshot[],
  rateEntries: AccountRateEntry[],
  homeCurrency: string,
  fxRates: Record<string, number>,
): number | null {
  const entries = rateEntries.filter((r) => DEBT_TYPES.has(r.accountType) && r.effectiveRate != null);
  if (entries.length === 0) return null;
  let matchedOwed = 0;
  let weighted = 0;
  for (const s of debtSnaps) {
    const owed = snapshotDebtInHome(s, homeCurrency, fxRates);
    if (owed <= 0) continue;
    const entry = entries.find((r) => r.accountName === s.accountName || r.bankName === s.bankName);
    if (entry?.effectiveRate == null) continue;
    matchedOwed += owed;
    weighted += owed * entry.effectiveRate;
  }
  if (matchedOwed > 0) return weighted / matchedOwed;
  const simple = entries.map((r) => r.effectiveRate as number);
  return simple.reduce((a, b) => a + b, 0) / simple.length;
}

const GOAL_TYPE_LABEL: Record<GoalType, string> = {
  savings:        "Savings goal",
  debt_payoff:    "Debt payoff",
  emergency_fund: "Emergency fund",
  net_worth:      "Net worth",
};

// ── constants ─────────────────────────────────────────────────────────────────

const FI_MULTIPLIER    = 25;
const DEFAULT_INVEST_RETURN = 0.07;
const DEFAULT_SAVINGS_RETURN = 0.04;

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtShort(v: number, hc: string) {
  const sym = getCurrencySymbol(hc);
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sym}${Math.round(abs / 1_000)}k`;
  return fmt(v, hc);
}
function addMonths(months: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + months);
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

/** `YYYY-MM` for `<input type="month">`, five calendar years from now. */
function defaultMonthFiveYearsFromNow(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() + 5);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

function projectMonths(
  current: number, target: number, monthlySavings: number, annualReturnRate: number,
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

function amortisedPayoffMonths(
  balance: number, annualRate: number, monthlyPayment: number,
): number | null {
  if (balance <= 0) return 0;
  const r = annualRate / 100 / 12;
  if (r === 0) return monthlyPayment > 0 ? Math.ceil(balance / monthlyPayment) : null;
  if (monthlyPayment <= balance * r) return null;
  let bal = balance;
  for (let m = 1; m <= 600; m++) {
    bal = bal * (1 + r) - monthlyPayment;
    if (bal <= 0) return m;
  }
  return null;
}

function medianOfSorted(sorted: number[]): number | null {
  if (sorted.length === 0) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Median month-over-month debt balance drops. Uses IQR outlier filtering when
 * enough samples exist so one-off lump paydowns / statement quirks don't dominate.
 */
function medianDebtReductionFromHistory(history: { debtTotal: number }[]): number | null {
  const withDebt = history.filter((h) => h.debtTotal > 0);
  if (withDebt.length < 2) return null;
  const reductions: number[] = [];
  for (let i = 1; i < withDebt.length; i++) {
    const prev = withDebt[i - 1].debtTotal;
    const cur = withDebt[i].debtTotal;
    const r = prev - cur;
    if (r > 0) reductions.push(r);
  }
  if (reductions.length === 0) return null;
  if (reductions.length >= 4) {
    const sorted = [...reductions].sort((a, b) => a - b);
    const lo = Math.floor((sorted.length - 1) * 0.25);
    const hi = Math.floor((sorted.length - 1) * 0.75);
    const q1 = sorted[lo];
    const q3 = sorted[hi];
    const iqr = q3 - q1;
    const low = q1 - 1.5 * iqr;
    const high = q3 + 1.5 * iqr;
    const filt = reductions.filter((x) => x >= low && x <= high);
    if (filt.length > 0) {
      filt.sort((a, b) => a - b);
      return medianOfSorted(filt);
    }
  }
  reductions.sort((a, b) => a - b);
  return medianOfSorted(reductions);
}

/** Typical monthly dollars going to debt: reconcile balance-delta median vs txn-based median. */
function typicalMonthlyDebtPaymentEstimate(
  history: { debtTotal: number }[],
  txnTypicalMedian: number,
): number | null {
  const fromBalances = medianDebtReductionFromHistory(history);
  const parts = [
    fromBalances != null && fromBalances > 0 ? fromBalances : null,
    txnTypicalMedian > 0 ? txnTypicalMedian : null,
  ].filter((x): x is number => x != null);
  if (parts.length === 0) return null;
  parts.sort((a, b) => a - b);
  return medianOfSorted(parts);
}

function debtPayoffEstimate(
  currentDebt: number,
  history: { debtTotal: number }[],
  annualRate: number | null,
  txnTypicalMedian: number,
): number | null {
  if (currentDebt <= 0) return 0;
  const monthlyPayment = typicalMonthlyDebtPaymentEstimate(history, txnTypicalMedian);
  if (monthlyPayment == null || monthlyPayment <= 0) return null;
  if (annualRate != null && annualRate > 0) return amortisedPayoffMonths(currentDebt, annualRate, monthlyPayment);
  return Math.ceil(currentDebt / monthlyPayment);
}

// ── account type labels ───────────────────────────────────────────────────────

const TYPE_LABEL: Record<string, string> = {
  checking: "Checking", savings: "Savings", credit: "Credit card",
  mortgage: "Mortgage", loan: "Loan", investment: "Investment", other: "Other",
};

const TYPE_RATE_LABEL: Record<string, string> = {
  checking: "APY", savings: "APY", credit: "APR",
  mortgage: "Interest rate", loan: "Interest rate", investment: "Annual return", other: "Annual rate",
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

  const rateLabel = TYPE_RATE_LABEL[entry.accountType] ?? "Rate";
  const display   = entry.effectiveRate != null ? `${entry.effectiveRate}%` : null;
  const isManual  = entry.manualRate != null;
  const isAI      = entry.extractedRate != null && entry.manualRate == null;

  return (
    <div className="flex items-center justify-between gap-3 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-medium text-gray-800">{entry.accountName}</p>
        <p className="text-xs text-gray-400">
          {TYPE_LABEL[entry.accountType] ?? entry.accountType} · {entry.bankName}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {!editing ? (
          <>
            <span className="text-sm font-semibold text-gray-700 tabular-nums">
              {display ?? <span className="text-gray-300 font-normal text-xs">no {rateLabel}</span>}
            </span>
            {isManual && (
              <span className="rounded-full bg-purple-50 border border-purple-200 px-1.5 py-0.5 text-[10px] font-medium text-purple-600" title="Manually set">
                edited
              </span>
            )}
            {isAI && !isManual && (
              <span className="rounded-full bg-gray-50 border border-gray-200 px-1.5 py-0.5 text-[10px] font-medium text-gray-400" title="Extracted from statement">
                auto
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
  const { loading: planLoading } = usePlan();

  const [netWorth, setNetWorth]                       = useState(0);
  const [liquidAssets, setLiquidAssets]               = useState(0);
  const [debts, setDebts]                             = useState(0);
  const [monthlyIncome, setMonthlyIncome]             = useState(0);
  const [monthlyExpenses, setMonthlyExpenses]         = useState(0);
  const [typicalDebtPayments, setTypicalDebtPayments] = useState(0);
  const [monthsTracked, setMonthsTracked]             = useState(0);
  const [history, setHistory]                         = useState<{ debtTotal: number }[]>([]);
  const [emergencyFund, setEmergencyFund]           = useState<EmergencyFundMetrics | null>(null);
  const [rates, setRates]                     = useState<AccountRateEntry[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const [authToken, setAuthToken]             = useState<string | null>(null);
  const [showRates, setShowRates]             = useState(false);
  const [homeCurrency, setHomeCurrency]       = useState(HOME_CURRENCY);
  const [fxRatesState, setFxRatesState]       = useState<Record<string, number>>({});
  const [extraPayPerMonth, setExtraPayPerMonth] = useState(0);
  const [scenarioApr, setScenarioApr]         = useState<number | null>(null);

  const [accountBalanceHistory, setAccountBalanceHistory] = useState<AccountBalanceHistory[]>([]);
  const [snapshots, setSnapshots]               = useState<AccountSnapshot[]>([]);
  const [savedGoals, setSavedGoals]             = useState<SavedGoalRecord[]>([]);
  const [showAddGoal, setShowAddGoal]           = useState(false);
  const [goalPickerStep, setGoalPickerStep]     = useState<"pick" | "form">("pick");
  const [selectedTemplate, setSelectedTemplate] = useState<GoalTemplate | null>(null);
  const [newGoalTitle, setNewGoalTitle]         = useState("");
  const [newGoalAmount, setNewGoalAmount]       = useState("");
  const [newGoalDate, setNewGoalDate]           = useState("");
  const [newGoalSaving, setNewGoalSaving]       = useState(false);
  const [selectedGoalId, setSelectedGoalId]     = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId]   = useState<string | null>(null);
  const [deleting, setDeleting]                 = useState(false);
  /** null = all debt accounts selected (default). Set to a subset when user deselects some. */
  const [selectedDebtSlugs, setSelectedDebtSlugs] = useState<string[] | null>(null);
  /** Debt account slugs chosen in the new-goal modal. null = all (default). */
  const [newGoalDebtSlugs, setNewGoalDebtSlugs] = useState<string[] | null>(null);
  /** Asset account slugs chosen in the new-goal modal for savings goals. null = smart default (all positive savings+checking). */
  const [newGoalAssetSlugs, setNewGoalAssetSlugs] = useState<string[] | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        setAuthToken(token);
        const headers = { Authorization: `Bearer ${token}` };
        const [consolidatedRes, ratesRes, goalsRes] = await Promise.all([
          fetch("/api/user/statements/consolidated", { headers }),
          fetch("/api/user/account-rates", { headers }),
          fetch("/api/user/goals", { headers }),
        ]);
        const consolidated = await consolidatedRes.json().catch(() => ({}));
        const ratesJson    = await ratesRes.json().catch(() => ({}));

        if (consolidatedRes.ok) {
          setNetWorth(consolidated.data?.netWorth ?? 0);
          setLiquidAssets(consolidated.liquidAssets ?? 0);
          setDebts(consolidated.data?.debts ?? 0);
          setMonthlyIncome(consolidated.typicalMonthlyIncome ?? consolidated.txMonthlyIncome ?? consolidated.data?.income?.total ?? 0);
          setMonthlyExpenses(consolidated.typicalMonthlyExpenses ?? consolidated.txMonthlyExpenses ?? consolidated.data?.expenses?.total ?? 0);
          setTypicalDebtPayments(consolidated.typicalMonthlyDebtPayments ?? 0);
          setMonthsTracked(consolidated.totalMonthsTracked ?? 0);
          setHistory(Array.isArray(consolidated.history) ? consolidated.history : []);
          setEmergencyFund(consolidated.emergencyFund ?? null);
          setHomeCurrency(
            typeof consolidated.homeCurrency === "string" && consolidated.homeCurrency
              ? consolidated.homeCurrency : HOME_CURRENCY,
          );
          setFxRatesState(
            consolidated.fxRates && typeof consolidated.fxRates === "object"
              ? (consolidated.fxRates as Record<string, number>)
              : {},
          );
          setSnapshots(Array.isArray(consolidated.accountSnapshots) ? consolidated.accountSnapshots : []);
          setAccountBalanceHistory(
            Array.isArray(consolidated.accountBalanceHistory)
              ? consolidated.accountBalanceHistory
              : [],
          );
        }
        if (ratesRes.ok) setRates(ratesJson.rates ?? []);
        if (goalsRes.ok) {
          const gj = await goalsRes.json().catch(() => ({}) as { goals?: SavedGoalRecord[] });
          setSavedGoals(Array.isArray(gj.goals) ? gj.goals : []);
        }
      } catch {
        setError("Failed to load goals");
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  // ── derive rates ─────────────────────────────────────────────────────────

  const investReturnRate = (() => {
    const investRates = rates
      .filter((r) => ASSET_TYPES.has(r.accountType) && r.effectiveRate != null)
      .map((r) => r.effectiveRate as number);
    if (investRates.length === 0) return DEFAULT_INVEST_RETURN;
    return (investRates.reduce((a, b) => a + b, 0) / investRates.length) / 100;
  })();

  const savingsReturnRate = (() => {
    const r = rates.find((r) => r.accountType === "savings" && r.effectiveRate != null);
    return r ? (r.effectiveRate as number) / 100 : DEFAULT_SAVINGS_RETURN;
  })();

  const debtInterestRate = (() => {
    const debtRateEntries = rates.filter((r) => DEBT_TYPES.has(r.accountType) && r.effectiveRate != null);
    if (debtRateEntries.length === 0) return null;
    // Balance-weighted average APR across liability accounts
    const debtSnaps = snapshots.filter(isConsolidatedLiabilitySnapshot);
    const { totalOwed, totalInterest } = debtSnaps.reduce(
      (acc, s) => {
        const owed = snapshotDebtInHome(s, homeCurrency, fxRatesState);
        const entry = debtRateEntries.find(
          (r) => r.accountName === s.accountName || r.bankName === s.bankName,
        );
        if (entry == null) return acc;
        return { totalOwed: acc.totalOwed + owed, totalInterest: acc.totalInterest + owed * (entry.effectiveRate as number) };
      },
      { totalOwed: 0, totalInterest: 0 },
    );
    if (totalOwed > 0) return totalInterest / totalOwed;
    // Fallback: simple average if we can't match snapshots to rates
    const simple = debtRateEntries.map((r) => r.effectiveRate as number);
    return simple.reduce((a, b) => a + b, 0) / simple.length;
  })();

  // ── derived values ────────────────────────────────────────────────────────

  const hc               = homeCurrency;
  const monthlySavings   = monthlyIncome - monthlyExpenses;
  const efMonthsTarget   = emergencyFund?.targetMonths ?? 6;
  const efTarget         = emergencyFund?.targetAmount ?? monthlyExpenses * efMonthsTarget;
  /** Same baseline as Overview emergency fund card — never use tx-single-month fallback here. */
  const efRunwayBaseline =
    emergencyFund != null && emergencyFund.baselineMonthlyCoreExpenses > 0
      ? emergencyFund.baselineMonthlyCoreExpenses
      : monthlyExpenses;
  const efProgress       = efTarget > 0 ? Math.min(1, liquidAssets / efTarget) : 0;
  const efMonths         = efTarget > 0 && liquidAssets < efTarget
    ? projectMonths(liquidAssets, efTarget, Math.max(0, monthlySavings), savingsReturnRate)
    : liquidAssets >= efTarget ? 0 : null;

  const baseDebtPay = typicalMonthlyDebtPaymentEstimate(history, typicalDebtPayments);
  /** Same monthly totals as Debts › Debt Growth; first row = baseline balance for paid-down math. */
  const debtRollupAll = monthlyDebtTotalsFromBalanceHistory(
    accountBalanceHistory,
    fxRatesState,
    homeCurrency,
    null,
  );
  const allDebtTimelineStart =
    debtRollupAll.length > 0 ? debtRollupAll[0].debtTotal : debts;
  /** Balance reduction = starting balance (first month on timeline) − today’s consolidated debt. */
  const paidTowardDebt = Math.max(0, allDebtTimelineStart - debts);
  const debtProgressPct =
    allDebtTimelineStart > 0
      ? Math.min(100, Math.round((paidTowardDebt / allDebtTimelineStart) * 100))
      : 0;

  const redirectToEfMonthly = (baseDebtPay ?? 0) + Math.max(0, monthlySavings);
  const efMonthsIfRedirect  = efTarget > 0 && liquidAssets < efTarget && redirectToEfMonthly > 0
    ? projectMonths(liquidAssets, efTarget, redirectToEfMonthly, savingsReturnRate) : null;

  // FI / net worth derived values
  const annualExpenses  = monthlyExpenses * 12;
  const fiTarget        = annualExpenses > 0 ? FI_MULTIPLIER * annualExpenses : 0;
  const fiProgress      = fiTarget > 0 ? Math.min(1, netWorth / fiTarget) : 0;
  const fiMonths        = fiTarget > 0
    ? projectMonths(netWorth, fiTarget, monthlySavings, investReturnRate) : null;

  // Aggregate debt payoff projection (baseline, no extra payment)
  const baselineDebtPayoffMonths =
    debts > 0 && baseDebtPay != null && baseDebtPay > 0
      ? amortisedPayoffMonths(debts, debtInterestRate ?? 8.5, baseDebtPay)
      : debts > 0 ? debtPayoffEstimate(debts, history, debtInterestRate, typicalDebtPayments) : 0;

  const liabilitySnaps = snapshots.filter(isConsolidatedLiabilitySnapshot);

  // Debt accounts selected for tracking (null = all)
  const trackedDebtSnaps = selectedDebtSlugs === null
    ? liabilitySnaps
    : liabilitySnaps.filter((s) => selectedDebtSlugs.includes(s.slug));
  const trackedDebt = trackedDebtSnaps.reduce(
    (sum, s) => sum + snapshotDebtInHome(s, hc, fxRatesState),
    0,
  );
  // Allocate monthly payment proportionally to tracked share
  const trackedDebtShare = debts > 0 ? trackedDebt / debts : 1;
  const trackedDebtPay   = baseDebtPay != null ? baseDebtPay * trackedDebtShare : null;
  /** Per-account rollup for selected liabilities when history exists; avoids global-share distortion. */
  const trackedDebtRollup = monthlyDebtTotalsFromBalanceHistory(
    accountBalanceHistory,
    fxRatesState,
    homeCurrency,
    trackedDebtSnaps.length > 0 && trackedDebtSnaps.length < liabilitySnaps.length
      ? new Set(trackedDebtSnaps.map((s) => s.slug))
      : null,
  );
  const trackedTimelineStart =
    trackedDebtRollup.length > 0 ? trackedDebtRollup[0].debtTotal : trackedDebt;
  const trackedPaidTowardDebt = Math.max(0, trackedTimelineStart - trackedDebt);
  const trackedProgressPct =
    trackedTimelineStart > 0
      ? Math.min(100, Math.round((trackedPaidTowardDebt / trackedTimelineStart) * 100))
      : 0;

  function toggleDebtSlug(slug: string) {
    setSelectedDebtSlugs((prev) => {
      const current = prev ?? liabilitySnaps.map((s) => s.slug);
      const next = current.includes(slug) ? current.filter((s) => s !== slug) : [...current, slug];
      // If all selected, revert to null (all = default)
      return next.length === liabilitySnaps.length ? null : next.length === 0 ? current : next;
    });
  }

  async function deleteGoal(goalId: string) {
    if (!authToken) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/user/goals/${goalId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${authToken}` },
      });
      if (res.ok) {
        setSavedGoals((prev) => prev.filter((g) => g.id !== goalId));
        setConfirmDeleteId(null);
        // Select next available goal
        setSelectedGoalId(null);
      }
    } finally {
      setDeleting(false);
    }
  }

  async function toggleAccountLink(goalId: string, slug: string, add: boolean) {
    if (!authToken) return;
    const goal = savedGoals.find((g) => g.id === goalId);
    if (!goal) return;
    const previous = effectiveLinkedSlugs(goal, snapshots);
    const newSlugs = add
      ? [...new Set([...previous, slug])]
      : previous.filter((s) => s !== slug);
    // Optimistic update
    setSavedGoals((prev) =>
      prev.map((g) => g.id === goalId ? { ...g, linkedAccountSlugs: newSlugs } : g),
    );
    try {
      const res = await fetch(`/api/user/goals/${goalId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ linkedAccountSlugs: newSlugs }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (err) {
      console.error("Failed to save account link:", err);
      // Revert optimistic update
      setSavedGoals((prev) =>
        prev.map((g) => g.id === goalId ? { ...g, linkedAccountSlugs: previous } : g),
      );
    }
  }

  async function toggleLiabilityLink(goalId: string, slug: string, add: boolean) {
    if (!authToken) return;
    const goal = savedGoals.find((g) => g.id === goalId);
    if (!goal) return;
    const previous = effectiveDebtLinkedSlugs(goal, liabilitySnaps);
    const newSlugs = add
      ? [...new Set([...previous, slug])]
      : previous.filter((s) => s !== slug);
    const finalSlugs = newSlugs.length === 0 ? previous : newSlugs;
    if (finalSlugs.join() === previous.join()) return;

    setSavedGoals((prev) =>
      prev.map((g) => g.id === goalId ? { ...g, linkedLiabilitySlugs: finalSlugs } : g),
    );
    try {
      const res = await fetch(`/api/user/goals/${goalId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ linkedLiabilitySlugs: finalSlugs }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (err) {
      console.error("Failed to save liability link:", err);
      setSavedGoals((prev) =>
        prev.map((g) => g.id === goalId ? { ...g, linkedLiabilitySlugs: previous } : g),
      );
    }
  }

  async function selectAllLiabilityLinks(goalId: string) {
    if (!authToken || liabilitySnaps.length === 0) return;
    const goal = savedGoals.find((g) => g.id === goalId);
    if (!goal) return;
    const allSlugs = liabilitySnaps.map((s) => s.slug);
    const previous = effectiveDebtLinkedSlugs(goal, liabilitySnaps);
    if (allSlugs.length === previous.length && allSlugs.every((s) => previous.includes(s))) return;

    setSavedGoals((prev) =>
      prev.map((g) => g.id === goalId ? { ...g, linkedLiabilitySlugs: allSlugs } : g),
    );
    try {
      const res = await fetch(`/api/user/goals/${goalId}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ linkedLiabilitySlugs: allSlugs }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
    } catch (err) {
      console.error("Failed to save liability selection:", err);
      setSavedGoals((prev) =>
        prev.map((g) => g.id === goalId ? { ...g, linkedLiabilitySlugs: previous } : g),
      );
    }
  }

  function closeGoalModal() {
    setShowAddGoal(false);
    setGoalPickerStep("pick");
    setSelectedTemplate(null);
    setNewGoalTitle(""); setNewGoalAmount(""); setNewGoalDate("");
    setNewGoalDebtSlugs(null);
    setNewGoalAssetSlugs(null);
  }

  async function createSavedGoal() {
    if (!authToken || !newGoalTitle.trim()) return;
    setNewGoalSaving(true);
    try {
      const isDebtPayoff = selectedTemplate?.goalType === "debt_payoff";
      const amount = !isDebtPayoff && newGoalAmount.trim()
        ? parseFloat(newGoalAmount.replace(/[^0-9.]/g, ""))
        : null;
      const payload: Omit<SavedGoalRecord, "id"> = {
        title: newGoalTitle.trim(),
        goalType: selectedTemplate?.goalType ?? "savings",
        emoji: selectedTemplate?.emoji ?? "🎯",
        targetAmount: isDebtPayoff || isNaN(amount ?? NaN) ? null : amount,
        targetDate: newGoalDate.trim() || null,
        description: selectedTemplate?.description ?? "",
        ...(isDebtPayoff  && { linkedLiabilitySlugs: newGoalDebtSlugs ?? undefined }),
        ...(!isDebtPayoff && newGoalAssetSlugs !== null && { linkedAccountSlugs: newGoalAssetSlugs }),
      };
      const res = await fetch("/api/user/goals", {
        method: "POST",
        headers: { Authorization: `Bearer ${authToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const j = (await res.json()) as SavedGoalRecord & { id?: string };
      if (res.ok && j.id) {
        const newGoal: SavedGoalRecord = { id: j.id, ...payload };
        setSavedGoals((prev) => [...prev, newGoal]);
        setSelectedGoalId(j.id);
        closeGoalModal();
      }
    } finally {
      setNewGoalSaving(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (planLoading || loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error) return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8">
      <p className="text-red-600">{error}</p>
    </div>
  );

  const usingDefaultReturn = investReturnRate === DEFAULT_INVEST_RETURN;
  const assetRates = rates.filter((r) => ASSET_TYPES.has(r.accountType));
  const debtRates  = rates.filter((r) => DEBT_TYPES.has(r.accountType));

  // ── Build unified goal list ──────────────────────────────────────────────
  // Default goals: Debt · Emergency Fund · Net Worth (always shown when data exists)
  // followed by user-added goals.
  const hasFinancialData = monthlyExpenses > 0 || netWorth !== 0 || debts > 0;

  const allGoals: DisplayGoal[] = [
    // 1. Pay off all debt (combined)
    ...(debts > 0 || debtProgressPct > 0 ? [{
      id: "auto-debt",
      source: "auto_debt" as const,
      isComplete: trackedDebt <= 0,
      goalType: "debt_payoff" as GoalType,
      emoji: "💳",
      title: trackedDebtSnaps.length === liabilitySnaps.length || liabilitySnaps.length === 0
        ? "Pay off debt"
        : `Pay off debt (${trackedDebtSnaps.length} of ${liabilitySnaps.length} accounts)`,
      subtitle: trackedDebtSnaps.length > 0
        ? trackedDebtSnaps.map((s) => s.accountName ?? s.bankName).filter(Boolean).join(", ")
        : "No accounts selected",
      currentAmount: trackedPaidTowardDebt,
      targetAmount: trackedTimelineStart > 0 ? trackedTimelineStart : trackedDebt,
      progressPct: trackedProgressPct,
      projectedMonths: trackedDebt > 0 && trackedDebtPay != null && trackedDebtPay > 0
        ? (amortisedPayoffMonths(trackedDebt, debtInterestRate ?? 8.5, trackedDebtPay) ?? null)
        : trackedDebt <= 0 ? 0 : null,
      apr: debtInterestRate ?? null,
      monthlyPayment: trackedDebtPay ?? null,
    }] : []),

    // 2. Emergency fund
    ...(hasFinancialData && monthlyExpenses > 0 ? [{
      id: "auto-ef",
      source: "auto_ef" as const,
      isComplete: efProgress >= 1,
      goalType: "emergency_fund" as GoalType,
      emoji: "🛡️",
      title: "Emergency fund",
      subtitle: `${efMonthsTarget}-month expense runway`,
      currentAmount: liquidAssets,
      targetAmount: efTarget,
      progressPct: Math.round(efProgress * 100),
      projectedMonths: efMonths ?? null,
      apr: null, monthlyPayment: null,
    }] : []),

    // 3. Net worth milestone (FI target)
    ...(hasFinancialData ? [{
      id: "auto-nw",
      source: "auto_nw" as const,
      isComplete: fiMonths === 0,
      goalType: "net_worth" as GoalType,
      emoji: "📈",
      title: "Net worth",
      subtitle: fiTarget > 0 ? `FI target · ${fmtShort(fiTarget, hc)}` : "Building wealth",
      currentAmount: Math.max(0, netWorth),
      targetAmount: fiTarget > 0 ? fiTarget : null,
      progressPct: fiTarget > 0 ? Math.round(fiProgress * 100) : 0,
      projectedMonths: fiMonths ?? null,
      apr: null, monthlyPayment: null,
    }] : []),

    // User-saved goals
    ...savedGoals.map((g) => {
      const gt = toGoalType(g.goalType);
      if (gt === "debt_payoff") {
        const debtSlugs = effectiveDebtLinkedSlugs(g, liabilitySnaps);
        const debtSnapsSubset = liabilitySnaps.filter((s) => debtSlugs.includes(s.slug));
        const remaining = debtSnapsSubset.reduce(
          (sum, s) => sum + snapshotDebtInHome(s, hc, fxRatesState),
          0,
        );
        const share = debts > 0 ? remaining / debts : remaining > 0 ? 1 : 0;
        const subsetRollup = monthlyDebtTotalsFromBalanceHistory(
          accountBalanceHistory,
          fxRatesState,
          homeCurrency,
          new Set(debtSlugs),
        );
        const subsetTimelineStart =
          subsetRollup.length > 0 ? subsetRollup[0].debtTotal : remaining;
        const paidDown = Math.max(0, subsetTimelineStart - remaining);
        const pct =
          subsetTimelineStart > 0
            ? Math.min(100, Math.round((paidDown / subsetTimelineStart) * 100))
            : remaining <= 0 ? 100 : 0;
        const subsetApr = balanceWeightedDebtAprSubset(debtSnapsSubset, rates, hc, fxRatesState) ?? debtInterestRate ?? 8.5;
        const subsetPay = baseDebtPay != null && debts > 0 ? baseDebtPay * share : baseDebtPay;
        const projMs = remaining > 0 && subsetPay != null && subsetPay > 0
          ? (amortisedPayoffMonths(remaining, subsetApr, subsetPay) ?? null)
          : remaining <= 0 ? 0 : null;
        const names = debtSnapsSubset.map((s) => s.accountName ?? s.bankName).filter(Boolean);
        const explicitlyNoDebts = Array.isArray(g.linkedLiabilitySlugs) && g.linkedLiabilitySlugs.length === 0;
        return {
          id: g.id,
          source: "user" as const,
          isComplete: !explicitlyNoDebts && remaining <= 0,
          goalType: "debt_payoff" as GoalType,
          emoji: g.emoji ?? "💳",
          title: g.title ?? "Goal",
          subtitle: names.length > 0 ? names.join(", ") : g.description ?? "",
          currentAmount: remaining,
          targetAmount: subsetTimelineStart > 0 ? subsetTimelineStart : null,
          progressPct: pct,
          projectedMonths: projMs,
          apr: subsetApr,
          monthlyPayment: subsetPay ?? null,
          savedGoal: g,
        };
      }

      const linkedSlugs = effectiveLinkedSlugs(g, snapshots);
      const linkedBalance = snapshots
        .filter((s) => linkedSlugs.includes(s.slug))
        .reduce((sum, s) => sum + Math.max(0, s.balance), 0);
      const tgt = g.targetAmount ?? null;
      const cur = linkedBalance;
      const pct = tgt != null && tgt > 0 ? Math.min(100, Math.round(cur / tgt * 100)) : 0;
      const remaining = tgt != null ? Math.max(0, tgt - cur) : null;
      const projMs = remaining != null && remaining > 0 && monthlySavings > 0
        ? Math.ceil(remaining / monthlySavings) : tgt != null && cur >= tgt ? 0 : null;
      return {
        id: g.id,
        source: "user" as const,
        isComplete: tgt != null && tgt > 0 && cur >= tgt,
        goalType: toGoalType(g.goalType),
        emoji: g.emoji ?? "🎯",
        title: g.title ?? "Goal",
        subtitle: g.description ?? "",
        currentAmount: cur,
        targetAmount: tgt,
        progressPct: pct,
        projectedMonths: projMs,
        apr: null, monthlyPayment: null,
        savedGoal: g,
      };
    }),
  ];

  // Sort: active goals first, completed last
  const sortedGoals = [
    ...allGoals.filter((g) => !g.isComplete),
    ...allGoals.filter((g) => g.isComplete),
  ];
  const activeId   = selectedGoalId ?? sortedGoals[0]?.id ?? null;
  const activeGoal = sortedGoals.find((g) => g.id === activeId) ?? null;
  const accent     = goalAccent(activeGoal?.goalType ?? "savings");

  // Per-goal computed values — debt (uses tracked subset)
  const activeDebtApr       = debtInterestRate ?? 8.5;
  const activeDebtBase      = trackedDebtPay ?? 0;
  const activeDebtWithExtra = activeDebtBase + extraPayPerMonth;
  const activeDebtPayoffMs  = trackedDebt > 0 && activeDebtWithExtra > 0
    ? amortisedPayoffMonths(trackedDebt, activeDebtApr, activeDebtWithExtra) : null;
  const activeDebtBaseMs    = trackedDebt > 0 && activeDebtBase > 0
    ? amortisedPayoffMonths(trackedDebt, activeDebtApr, activeDebtBase) : null;

  // Per-goal computed values — net worth
  const yearsToFi = fiMonths != null && fiMonths > 0 ? (fiMonths / 12).toFixed(1) : null;

  const userGoalTargetDateLabel = activeGoal?.savedGoal?.targetDate
    ? (() => { try { return new Date(activeGoal!.savedGoal!.targetDate! + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }); } catch { return null; } })()
    : null;

  // Goal type picker modal templates (data-driven suggestions)

  const catalogueTemplates: GoalTemplate[] = [
    {
      goalType: "savings",
      emoji: "🎯",
      label: "Savings goal",
      description: "Save toward anything — name it whatever you like.",
      prefill: { emoji: "🎯" },
    },
    {
      goalType: "debt_payoff",
      emoji: "💳",
      label: "Pay off by a date",
      description: "Track paying off a specific debt by a target date.",
      prefill: { emoji: "💳" },
    },
  ];

  // ── Wireframe list helpers ─────────────────────────────────────────────────

  type RowStatus = "attention" | "on_pace" | "not_started" | "complete";

  function rowStatus(g: DisplayGoal): RowStatus {
    if (g.isComplete) return "complete";
    if (g.progressPct === 0 && g.projectedMonths === null) return "not_started";
    if (g.goalType === "debt_payoff" && g.savedGoal?.targetDate && g.projectedMonths != null) {
      try {
        const tgt = new Date(g.savedGoal.targetDate + "-01");
        const now = new Date();
        const moToTarget = (tgt.getFullYear() - now.getFullYear()) * 12 + (tgt.getMonth() - now.getMonth());
        if (g.projectedMonths > moToTarget + 1) return "attention";
      } catch { /* ignore */ }
    }
    if (g.goalType !== "debt_payoff" && monthlySavings <= 0) return "attention";
    return g.projectedMonths != null ? "on_pace" : "not_started";
  }

  function rowBadge(g: DisplayGoal): { text: string; classes: string; dotColor: string } | null {
    const s = rowStatus(g);
    if (s === "complete") return { text: "Complete", classes: "border-emerald-200 bg-emerald-50 text-emerald-800", dotColor: "bg-emerald-500" };
    if (g.goalType === "debt_payoff" && g.savedGoal?.targetDate && g.projectedMonths != null) {
      try {
        const tgt = new Date(g.savedGoal.targetDate + "-01");
        const now = new Date();
        const moToTarget = (tgt.getFullYear() - now.getFullYear()) * 12 + (tgt.getMonth() - now.getMonth());
        const diff = g.projectedMonths - moToTarget;
        if (diff > 1) return { text: `${diff}mo behind`, classes: "border-amber-200 bg-amber-50 text-amber-800", dotColor: "bg-amber-500" };
        if (diff < -1) return { text: `${Math.abs(diff)}mo early`, classes: "border-emerald-200 bg-emerald-50 text-emerald-800", dotColor: "bg-emerald-500" };
        return { text: "On target", classes: "border-emerald-200 bg-emerald-50 text-emerald-800", dotColor: "bg-emerald-500" };
      } catch { /* ignore */ }
    }
    if (s === "attention") return { text: "Saving paused", classes: "border-amber-200 bg-amber-50 text-amber-800", dotColor: "bg-amber-500" };
    if (s === "on_pace")   return { text: "On pace",       classes: "border-emerald-200 bg-emerald-50 text-emerald-800", dotColor: "bg-emerald-500" };
    return { text: "Awaiting pace", classes: "border-gray-200 bg-gray-50 text-gray-500", dotColor: "bg-gray-400" };
  }

  function rowSubtitle(g: DisplayGoal): string {
    const dateStr = (() => {
      if (g.savedGoal?.targetDate) {
        try { return `Target ${new Date(g.savedGoal.targetDate + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" })}`; }
        catch { return "No date set"; }
      }
      if (g.projectedMonths != null && g.projectedMonths > 0) return `Target ${addMonths(g.projectedMonths)}`;
      return "No date set";
    })();
    if (g.goalType === "debt_payoff") {
      const remaining = (g.targetAmount ?? 0) > 0 ? Math.max(0, g.targetAmount! - g.currentAmount) : g.currentAmount;
      return `${fmtShort(remaining, hc)} owed · ${dateStr}`;
    }
    if (g.targetAmount != null && g.targetAmount > 0) {
      return `${fmtShort(g.currentAmount, hc)} of ${fmtShort(g.targetAmount, hc)} · ${dateStr}`;
    }
    return g.subtitle || dateStr;
  }

  const allSections: Array<{ key: RowStatus; label: string; dotColor: string; goals: DisplayGoal[] }> = [
    { key: "attention",   label: "Needs attention", dotColor: "bg-amber-500",   goals: sortedGoals.filter((g) => !g.isComplete && rowStatus(g) === "attention") },
    { key: "on_pace",     label: "On pace",         dotColor: "bg-emerald-500", goals: sortedGoals.filter((g) => !g.isComplete && rowStatus(g) === "on_pace") },
    { key: "not_started", label: "Not started yet", dotColor: "bg-gray-400",    goals: sortedGoals.filter((g) => !g.isComplete && rowStatus(g) === "not_started") },
    { key: "complete",    label: "Completed",        dotColor: "bg-emerald-300", goals: sortedGoals.filter((g) => g.isComplete) },
  ];
  const sections = allSections.filter((s) => s.goals.length > 0);

  const behindCount  = sections.find((s) => s.key === "attention")?.goals.length ?? 0;
  const onPaceCount  = sections.find((s) => s.key === "on_pace")?.goals.length   ?? 0;

  /** Compute projected payoff month as `YYYY-MM` for a set of liability slugs (null = all). */
  function computeDebtPayoffYM(slugs: string[] | null): string {
    const snaps = slugs === null ? liabilitySnaps : liabilitySnaps.filter((s) => slugs.includes(s.slug));
    if (snaps.length === 0 || (baseDebtPay ?? 0) <= 0 || debts <= 0) return "";
    const totalDebt = snaps.reduce((sum, s) => sum + snapshotDebtInHome(s, hc, fxRatesState), 0);
    if (totalDebt <= 0) return "";
    const share      = totalDebt / debts;
    const monthlyPay = (baseDebtPay as number) * share;
    if (monthlyPay <= 0) return "";
    const apr    = balanceWeightedDebtAprSubset(snaps, rates, hc, fxRatesState) ?? 8.5;
    const months = amortisedPayoffMonths(totalDebt, apr, monthlyPay);
    if (months == null || months <= 0) return "";
    const d = new Date();
    d.setMonth(d.getMonth() + months);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  /** Friendly label for a `YYYY-MM` string, e.g. "Jun 2035". */
  function ymLabel(ym: string): string {
    if (!ym) return "";
    try { return new Date(ym + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }); }
    catch { return ym; }
  }

  return (
    <div className="mx-auto max-w-2xl lg:max-w-3xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Header */}
      <div className="mb-4 flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold text-gray-900">Goals</h1>
        <button
          type="button"
          onClick={() => { setShowAddGoal(true); setGoalPickerStep("pick"); }}
          className="inline-flex items-center gap-1.5 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition shrink-0"
        >
          + New goal
        </button>
      </div>

      {/* Status pills */}
      {allGoals.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center gap-2">
          {behindCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {behindCount} behind
            </span>
          )}
          {onPaceCount > 0 && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {onPaceCount} on pace
            </span>
          )}
          <span className="text-sm text-gray-500">{allGoals.length} goals total</span>
        </div>
      )}

      {/* Empty state */}
      {allGoals.length === 0 && (
        <div className="rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50/50 p-14 text-center">
          <p className="text-3xl mb-3">🎯</p>
          <p className="text-sm font-semibold text-gray-700">No goals yet</p>
          <p className="mt-1 text-sm text-gray-500 max-w-xs mx-auto">
            Upload statements so we can auto-suggest goals, or add one now.
          </p>
          <button
            type="button"
            onClick={() => { setShowAddGoal(true); setGoalPickerStep("pick"); }}
            className="mt-5 inline-flex items-center gap-2 rounded-xl bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-700 transition"
          >
            + Add a goal
          </button>
        </div>
      )}

      {/* ── Sectioned goal list ── */}
      {allGoals.length > 0 && (
        <div className="space-y-6">
          {sections.map((section) => (
            <div key={section.key}>
              {/* Section header */}
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full ${section.dotColor}`} />
                  <p className="text-[11px] font-bold uppercase tracking-[0.15em] text-gray-400">{section.label}</p>
                </div>
                <span className="text-xs text-gray-400">{section.goals.length}</span>
              </div>

              {/* Rows */}
              <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
                {section.goals.map((g) => {
                  const isDebt   = g.goalType === "debt_payoff";
                  const isActive = g.id === activeId && !isDebt;
                  const s        = rowStatus(g);
                  const badge    = rowBadge(g);
                  const leftBorderColor =
                    s === "attention" ? "border-amber-400" :
                    s === "on_pace"   ? "border-emerald-500" :
                    g.isComplete      ? "border-emerald-300" : "border-gray-200";
                  const barColor =
                    s === "attention" ? "bg-amber-400" :
                    s === "on_pace"   ? "bg-emerald-500" :
                    g.isComplete      ? "bg-emerald-400" : "bg-gray-300";
                  const iconBg =
                    g.goalType === "debt_payoff"    ? "bg-orange-50"  :
                    g.goalType === "emergency_fund" ? "bg-amber-50"   :
                    g.goalType === "net_worth"      ? "bg-indigo-50"  : "bg-teal-50";

                  const rowContent = (
                    <div className={`flex items-center gap-4 px-4 py-4 border-l-4 ${leftBorderColor}`}>
                      {/* Icon */}
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-xl ${iconBg}`}>
                        {g.emoji}
                      </div>
                      {/* Title + subtitle */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-900 truncate">{g.title}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{rowSubtitle(g)}</p>
                      </div>
                      {/* Progress + badge */}
                      <div className="shrink-0 flex flex-col items-end gap-1.5 min-w-[140px] sm:min-w-[160px]">
                        <div className="flex items-center gap-2 w-full justify-end">
                          <span className="text-[11px] text-gray-400">Progress</span>
                          <span className="text-xs font-semibold text-gray-700 tabular-nums">{g.progressPct}%</span>
                        </div>
                        <div className="w-full h-1.5 rounded-full bg-gray-100 overflow-hidden">
                          <div className={`h-full rounded-full ${barColor} transition-all`} style={{ width: `${g.progressPct}%` }} />
                        </div>
                        {badge && (
                          <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${badge.classes}`}>
                            <span className={`h-1 w-1 rounded-full ${badge.dotColor}`} />
                            {badge.text}
                          </span>
                        )}
                      </div>
                    </div>
                  );

                  const isUserGoal   = g.source === "user";
                  const isConfirming = confirmDeleteId === g.id;

                  return (
                    <div key={g.id}>
                      {/* Row — ALL goal types navigate to their detail page */}
                      <Link
                        href={`/account/goals/${g.id}`}
                        className="block hover:bg-gray-50/40 transition"
                      >
                        {rowContent}
                      </Link>

                      {/* Bottom bar: navigate chevron + optional delete */}
                      <div className="flex items-center justify-between px-4 pb-3">
                        <Link
                          href={`/account/goals/${g.id}`}
                          className="text-xs text-gray-400 hover:text-gray-600 transition"
                        >
                          ›
                        </Link>

                        {/* Delete (user goals only) */}
                        {isUserGoal && (
                          isConfirming ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">Delete this goal?</span>
                              <button
                                type="button"
                                disabled={deleting}
                                onClick={() => deleteGoal(g.id)}
                                className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition"
                              >
                                {deleting ? "…" : "Yes, delete"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteId(null)}
                                className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 transition"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(g.id)}
                              className="rounded-lg p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 transition"
                              title="Delete goal"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Goal detail card (non-debt-payoff goals only — debt payoff has its own page) ── */}
      {activeGoal && activeGoal.goalType !== "debt_payoff" && (
        <div className={`mt-6 rounded-2xl border bg-white shadow-sm overflow-hidden ${activeGoal.isComplete ? "border-emerald-200" : "border-gray-200"}`}>

              {/* Completion banner */}
              {activeGoal.isComplete && (
                <div className="flex items-center gap-2 px-5 py-3 bg-emerald-50 border-b border-emerald-100">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full bg-emerald-500 text-white text-[11px] font-bold shrink-0">✓</span>
                  <p className="text-sm font-semibold text-emerald-800">Goal completed!</p>
                </div>
              )}

              {/* ══ DEBT PAYOFF detail ══ */}
              {activeGoal.source === "auto_debt" && (
                <>
                  <div className="px-6 pt-6 pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${accent.badge}`}>
                          {GOAL_TYPE_LABEL.debt_payoff}
                        </span>
                        <h2 className="mt-2 text-2xl font-bold text-gray-900">{activeGoal.title}</h2>
                      </div>
                      <div className="flex flex-col items-end gap-2 shrink-0">
                        {activeDebtPayoffMs != null && (
                          <div className="text-right">
                            <p className="text-base font-bold text-gray-900 tabular-nums">{addMonths(activeDebtPayoffMs)}</p>
                            <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Projected</p>
                          </div>
                        )}
                        <Link
                          href={`/account/goals/${activeGoal.id}`}
                          className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:text-purple-900 transition"
                        >
                          Full details
                          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        </Link>
                      </div>
                    </div>
                    <div className="mt-5">
                      <p className="text-4xl font-bold tabular-nums text-gray-900">{fmt(trackedDebt, hc)}</p>
                      <p className="text-sm text-gray-500 mt-1">
                        remaining{trackedDebtSnaps.length < liabilitySnaps.length ? ` across ${trackedDebtSnaps.length} selected account${trackedDebtSnaps.length !== 1 ? "s" : ""}` : " across all accounts"}
                      </p>
                    </div>
                    <div className="mt-5 pb-6">
                      <div className="flex justify-between text-xs text-gray-500 mb-2">
                        <span>
                          {trackedPaidTowardDebt > 0
                            ? `Down ${fmt(trackedPaidTowardDebt, hc)} since first month on the chart`
                            : "No change yet vs. first month on the chart"}
                        </span>
                        <span className="font-medium tabular-nums">{trackedProgressPct}%</span>
                      </div>
                      <div className={`h-3 w-full rounded-full ${accent.track} overflow-hidden`}>
                        <div className={`h-full rounded-full ${accent.bar} transition-all`} style={{ width: `${trackedProgressPct}%` }} />
                      </div>
                      {activeDebtBaseMs != null && extraPayPerMonth === 0 && (
                        <p className="text-xs text-gray-400 mt-1.5 tabular-nums">{activeDebtBaseMs} months to go at current pace</p>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-gray-100 grid grid-cols-3 divide-x divide-gray-100">
                    <div className="px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Wtd. APR</p>
                      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                        {debtInterestRate != null ? `${debtInterestRate.toFixed(2)}%` : "—"}
                      </p>
                    </div>
                    <div className="px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Monthly payment</p>
                      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                        {baseDebtPay != null ? fmt(baseDebtPay, hc) : "—"}
                      </p>
                    </div>
                    <div className="px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Months left</p>
                      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                        {activeDebtBaseMs != null ? activeDebtBaseMs : "—"}
                      </p>
                    </div>
                  </div>

                  {/* Toggleable account selector */}
                  {liabilitySnaps.length > 0 && (
                    <div className="border-t border-gray-100 px-6 py-5">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Accounts to track</p>
                          <p className="text-xs text-gray-400 mt-0.5">Toggle accounts on or off</p>
                        </div>
                        {selectedDebtSlugs !== null && (
                          <button type="button" onClick={() => setSelectedDebtSlugs(null)} className="text-xs font-semibold text-purple-700 hover:text-purple-900">
                            Select all
                          </button>
                        )}
                      </div>
                      <div className="space-y-1">
                        {liabilitySnaps.map((s) => {
                          const owed = Math.abs(s.balance);
                          const rate = debtRates.find((r) => r.accountName === s.accountName || r.bankName === s.bankName);
                          const apr = rate?.effectiveRate;
                          const isTracked = selectedDebtSlugs === null || selectedDebtSlugs.includes(s.slug);
                          return (
                            <button
                              key={s.slug}
                              type="button"
                              onClick={() => toggleDebtSlug(s.slug)}
                              className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                                isTracked
                                  ? "border-purple-200 bg-purple-50/60"
                                  : "border-gray-100 bg-white opacity-60 hover:opacity-100 hover:bg-gray-50"
                              }`}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-gray-800 truncate">{s.accountName ?? s.bankName}</p>
                                <p className="text-xs text-gray-400">{TYPE_LABEL[s.accountType] ?? s.accountType}{apr != null ? ` · ${apr.toFixed(2)}% APR` : ""}</p>
                              </div>
                              <div className="flex items-center gap-3 shrink-0 ml-3">
                                <p className="text-sm font-semibold tabular-nums text-gray-700">{fmt(owed, hc)}</p>
                                <div className={`relative w-9 h-5 rounded-full transition-colors ${isTracked ? "bg-purple-500" : "bg-gray-200"}`}>
                                  <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isTracked ? "translate-x-4" : "translate-x-0.5"}`} />
                                </div>
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {activeDebtBase > 0 && (
                    <div className="border-t border-gray-100 px-6 py-5">
                      <div className="flex items-center justify-between mb-4">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">What if I pay more?</p>
                        {extraPayPerMonth > 0 && (
                          <button type="button" onClick={() => setExtraPayPerMonth(0)} className="text-xs font-semibold text-purple-700 hover:text-purple-900">Reset</button>
                        )}
                      </div>
                      <label className="block">
                        <div className="flex justify-between text-xs text-gray-600 mb-2">
                          <span>Extra payment per month</span>
                          <span className="font-bold text-gray-900 tabular-nums">+{fmt(extraPayPerMonth, hc)}</span>
                        </div>
                        <input
                          type="range" min={0} max={2000} step={25} value={extraPayPerMonth}
                          onChange={(e) => setExtraPayPerMonth(Number(e.target.value))}
                          className="w-full accent-purple-600"
                        />
                      </label>
                      <div className="mt-4 flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 text-sm">
                        <span className="text-gray-500">Paid off by</span>
                        <span className="font-semibold text-gray-900 tabular-nums">
                          {activeDebtPayoffMs != null
                            ? `${addMonths(activeDebtPayoffMs)} · ${activeDebtPayoffMs} months`
                            : <span className="font-normal text-gray-400">Too low to reach $0 in the model</span>}
                        </span>
                      </div>
                      {extraPayPerMonth > 0 && activeDebtBaseMs != null && activeDebtPayoffMs != null && activeDebtPayoffMs < activeDebtBaseMs && (
                        <p className="mt-2 text-xs font-medium text-emerald-700">
                          ↑ {activeDebtBaseMs - activeDebtPayoffMs} months sooner
                        </p>
                      )}
                    </div>
                  )}
                </>
              )}

              {/* ══ EMERGENCY FUND detail ══ */}
              {activeGoal.source === "auto_ef" && (
                <>
                  <div className="px-6 pt-6 pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${accent.badge}`}>
                          {GOAL_TYPE_LABEL.emergency_fund}
                        </span>
                        <h2 className="mt-2 text-2xl font-bold text-gray-900">Emergency fund</h2>
                        <p className="text-sm text-gray-500 mt-0.5">{efMonthsTarget}-month expense runway</p>
                      </div>
                      {efProgress >= 1 ? (
                        <span className="inline-flex rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 shrink-0">
                          Fully funded ✓
                        </span>
                      ) : activeGoal.projectedMonths != null && activeGoal.projectedMonths > 0 ? (
                        <div className="text-right shrink-0">
                          <p className="text-base font-bold text-gray-900">{addMonths(activeGoal.projectedMonths)}</p>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">Projected</p>
                        </div>
                      ) : null}
                    </div>
                    <div className="mt-5">
                      <p className="text-4xl font-bold tabular-nums text-gray-900">{fmtShort(liquidAssets, hc)}</p>
                      <p className="text-sm text-gray-500 mt-1">of {fmtShort(efTarget, hc)} target</p>
                    </div>
                    <div className="mt-5 pb-6">
                      <div className="flex justify-between text-xs text-gray-500 mb-2">
                        <span>{fmtShort(liquidAssets, hc)} saved</span>
                        <span className="font-medium tabular-nums">{Math.round(efProgress * 100)}%</span>
                      </div>
                      <div className={`h-3 w-full rounded-full ${accent.track} overflow-hidden`}>
                        <div className={`h-full rounded-full ${accent.bar} transition-all`} style={{ width: `${Math.round(efProgress * 100)}%` }} />
                      </div>
                      {efTarget > liquidAssets && (
                        <p className="text-xs text-gray-400 mt-1.5 tabular-nums">{fmtShort(efTarget - liquidAssets, hc)} remaining</p>
                      )}
                    </div>
                  </div>

                  <div className="border-t border-gray-100 grid grid-cols-3 divide-x divide-gray-100">
                    <div className="px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Months covered</p>
                      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                        {efRunwayBaseline > 0 ? (liquidAssets / efRunwayBaseline).toFixed(1) : "—"}
                      </p>
                    </div>
                    <div className="px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Median core / mo</p>
                      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmt(efRunwayBaseline, hc)}</p>
                    </div>
                    <div className="px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Monthly savings</p>
                      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                        {monthlySavings > 0 ? fmt(monthlySavings, hc) : "—"}
                      </p>
                    </div>
                  </div>

                  {efProgress < 1 && efMonths != null && efMonths > 0 && (
                    <div className="border-t border-gray-100 px-6 py-4">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        At your current savings rate of{" "}
                        <strong className="text-gray-700">{fmt(Math.max(0, monthlySavings), hc)}/mo</strong> you&apos;ll
                        hit the target in <strong className="text-gray-700">~{efMonths} months</strong> ({addMonths(efMonths)}).
                        {debts > 0 && efMonthsIfRedirect != null && efMonthsIfRedirect < efMonths && (
                          <> Once debt-free, redirecting payments could cut that to{" "}
                          <strong className="text-gray-700">~{efMonthsIfRedirect} months</strong>.</>
                        )}
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* ══ NET WORTH detail ══ */}
              {activeGoal.source === "auto_nw" && (
                <>
                  <div className="px-6 pt-6 pb-0">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${accent.badge}`}>
                          {GOAL_TYPE_LABEL.net_worth}
                        </span>
                        <h2 className="mt-2 text-2xl font-bold text-gray-900">Net worth</h2>
                        {fiTarget > 0 && (
                          <p className="text-sm text-gray-500 mt-0.5">FI target · {FI_MULTIPLIER}× annual expenses</p>
                        )}
                      </div>
                      {fiMonths != null && fiMonths > 0 ? (
                        <div className="text-right shrink-0">
                          <p className="text-base font-bold text-gray-900">{addMonths(fiMonths)}</p>
                          <p className="text-[10px] font-bold uppercase tracking-wide text-gray-400">FI projected</p>
                        </div>
                      ) : fiMonths === 0 ? (
                        <span className="inline-flex rounded-full bg-emerald-100 border border-emerald-200 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-800 shrink-0">
                          FI reached ✓
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-5">
                      <p className="text-4xl font-bold tabular-nums text-gray-900">{fmtShort(netWorth, hc)}</p>
                      <p className="text-sm text-gray-500 mt-1">current net worth</p>
                    </div>
                    {fiTarget > 0 && (
                      <div className="mt-5 pb-6">
                        <div className="flex justify-between text-xs text-gray-500 mb-2">
                          <span>{fmtShort(Math.max(0, netWorth), hc)} of {fmtShort(fiTarget, hc)}</span>
                          <span className="font-medium tabular-nums">{Math.round(fiProgress * 100)}%</span>
                        </div>
                        <div className={`h-3 w-full rounded-full ${accent.track} overflow-hidden`}>
                          <div className={`h-full rounded-full ${accent.bar} transition-all`} style={{ width: `${Math.round(fiProgress * 100)}%` }} />
                        </div>
                        {yearsToFi != null && (
                          <p className="text-xs text-gray-400 mt-1.5">{yearsToFi} years to go · {fmtShort(fiTarget - netWorth > 0 ? fiTarget - netWorth : 0, hc)} remaining</p>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-gray-100 grid grid-cols-3 divide-x divide-gray-100">
                    <div className="px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">FI target</p>
                      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                        {fiTarget > 0 ? fmtShort(fiTarget, hc) : "—"}
                      </p>
                    </div>
                    <div className="px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Monthly savings</p>
                      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                        {monthlySavings > 0 ? fmt(monthlySavings, hc) : "—"}
                      </p>
                    </div>
                    <div className="px-5 py-4">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Years to FI</p>
                      <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                        {yearsToFi ?? "—"}
                      </p>
                    </div>
                  </div>

                  {fiTarget > 0 && annualExpenses > 0 && (
                    <div className="border-t border-gray-100 px-6 py-4">
                      <p className="text-xs text-gray-500 leading-relaxed">
                        Based on <strong className="text-gray-700">{fmtShort(annualExpenses, hc)}/yr</strong> in annual expenses at{" "}
                        <strong className="text-gray-700">{FI_MULTIPLIER}×</strong> (4% rule), with a{" "}
                        <strong className="text-gray-700">{(investReturnRate * 100).toFixed(1)}%</strong> annual portfolio return{usingDefaultReturn ? " (default estimate)" : ""}.
                      </p>
                    </div>
                  )}
                </>
              )}

              {/* ══ USER GOAL detail ══ */}
              {activeGoal.source === "user" && activeGoal.savedGoal && (() => {
                const sg = activeGoal.savedGoal;
                const isDebtPayoffUser = toGoalType(sg.goalType) === "debt_payoff";
                const linkedSlugs = !isDebtPayoffUser ? effectiveLinkedSlugs(sg, snapshots) : [];
                const debtLinkedSlugs = isDebtPayoffUser ? effectiveDebtLinkedSlugs(sg, liabilitySnaps) : [];

                const linkableSnaps = snapshots.filter((s) => ASSET_TYPES.has(s.accountType));
                const savingsChecking = linkableSnaps.filter((s) => s.accountType === "savings" || s.accountType === "checking");
                const investmentAccs  = linkableSnaps.filter((s) => s.accountType === "investment");
                const hasLinkable = !isDebtPayoffUser && linkableSnaps.length > 0;

                const debtPeak = activeGoal.targetAmount ?? 0;
                const debtPaidDown = debtPeak > 0 ? Math.max(0, debtPeak - activeGoal.currentAmount) : 0;

                return (
                  <>
                    <div className="px-6 pt-6 pb-0">
                      <div className="flex items-start gap-3 mb-5">
                        <span className="text-3xl leading-none">{activeGoal.emoji}</span>
                        <div className="min-w-0 flex-1">
                          <span className={`inline-flex rounded-full border px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${accent.badge}`}>
                            {GOAL_TYPE_LABEL[activeGoal.goalType]}
                          </span>
                          <h2 className="mt-1.5 text-2xl font-bold text-gray-900">{activeGoal.title}</h2>
                          {activeGoal.subtitle && <p className="text-sm text-gray-500 mt-0.5">{activeGoal.subtitle}</p>}
                          {isDebtPayoffUser && (
                            <Link
                              href={`/account/goals/${sg.id}`}
                              className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-purple-700 hover:text-purple-900 transition"
                            >
                              Full details
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                            </Link>
                          )}
                        </div>
                        {/* Delete button */}
                        {confirmDeleteId === sg.id ? (
                          <div className="flex items-center gap-2 shrink-0">
                            <p className="text-xs text-gray-500">Delete this goal?</p>
                            <button
                              type="button"
                              disabled={deleting}
                              onClick={() => deleteGoal(sg.id)}
                              className="rounded-lg bg-red-600 px-2.5 py-1 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 transition"
                            >
                              {deleting ? "…" : "Yes, delete"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteId(null)}
                              className="rounded-lg border border-gray-200 px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 transition"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <button
                            type="button"
                            onClick={() => setConfirmDeleteId(sg.id)}
                            className="shrink-0 rounded-lg p-1.5 text-gray-300 hover:bg-red-50 hover:text-red-500 transition"
                            title="Delete goal"
                          >
                            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>

                      {isDebtPayoffUser ? (
                        <>
                          <div>
                            <p className="text-4xl font-bold tabular-nums text-gray-900">{fmt(activeGoal.currentAmount, hc)}</p>
                            <p className="text-sm text-gray-500 mt-1">
                              {debtLinkedSlugs.length > 0
                                ? `remaining across ${debtLinkedSlugs.length} selected debt account${debtLinkedSlugs.length !== 1 ? "s" : ""}`
                                : "No debts selected"}
                            </p>
                          </div>
                          <div className="mt-4 pb-5">
                            <div className="flex justify-between text-xs text-gray-500 mb-2">
                              <span>
                                {debtPaidDown > 0
                                  ? `Down ${fmt(debtPaidDown, hc)} since first month on the chart`
                                  : "No change yet vs. first month on the chart"}
                              </span>
                              <span className="font-medium tabular-nums">{activeGoal.progressPct}%</span>
                            </div>
                            <div className={`h-3 w-full rounded-full ${accent.track} overflow-hidden`}>
                              <div className={`h-full rounded-full ${accent.bar} transition-all duration-500`} style={{ width: `${activeGoal.progressPct}%` }} />
                            </div>
                            {activeGoal.apr != null && (
                              <p className="text-xs text-gray-400 mt-1.5 tabular-nums">Wtd. APR · {activeGoal.apr.toFixed(2)}%</p>
                            )}
                            {activeGoal.projectedMonths != null && activeGoal.projectedMonths > 0 && activeGoal.monthlyPayment != null && activeGoal.monthlyPayment > 0 && (
                              <p className="text-xs text-gray-400 mt-1.5">
                                At ~{fmt(activeGoal.monthlyPayment, hc)}/mo toward these debts · ~{activeGoal.projectedMonths} mo ({addMonths(activeGoal.projectedMonths)})
                              </p>
                            )}
                            {userGoalTargetDateLabel && (
                              <p className="text-xs text-gray-400 mt-1">Goal payoff date: {userGoalTargetDateLabel}</p>
                            )}
                          </div>
                        </>
                      ) : activeGoal.targetAmount != null && activeGoal.targetAmount > 0 ? (
                        <>
                          <div>
                            <p className="text-4xl font-bold tabular-nums text-gray-900">{fmt(activeGoal.currentAmount, hc)}</p>
                            <p className="text-sm text-gray-500 mt-1">saved of {fmt(activeGoal.targetAmount, hc)} target</p>
                          </div>
                          <div className="mt-4 pb-5">
                            <div className="flex justify-between text-xs text-gray-500 mb-2">
                              <span>{activeGoal.progressPct}% there</span>
                              {activeGoal.targetAmount > activeGoal.currentAmount && (
                                <span className="tabular-nums">{fmt(activeGoal.targetAmount - activeGoal.currentAmount, hc)} to go</span>
                              )}
                              {activeGoal.progressPct >= 100 && <span className="text-emerald-600 font-semibold">Goal reached 🎉</span>}
                            </div>
                            <div className={`h-3 w-full rounded-full ${accent.track} overflow-hidden`}>
                              <div className={`h-full rounded-full ${accent.bar} transition-all duration-500`} style={{ width: `${activeGoal.progressPct}%` }} />
                            </div>
                            {activeGoal.projectedMonths != null && activeGoal.projectedMonths > 0 && monthlySavings > 0 && (
                              <p className="text-xs text-gray-400 mt-1.5">
                                {fmt(Math.max(0, activeGoal.targetAmount - activeGoal.currentAmount), hc)} remaining · at {fmt(monthlySavings, hc)}/mo → ~{activeGoal.projectedMonths} months ({addMonths(activeGoal.projectedMonths)})
                              </p>
                            )}
                            {userGoalTargetDateLabel && (
                              <p className="text-xs text-gray-400 mt-1">Target date: {userGoalTargetDateLabel}</p>
                            )}
                          </div>
                        </>
                      ) : (
                        <div className="pb-5">
                          <p className="text-sm text-gray-400">No target amount set.</p>
                          {userGoalTargetDateLabel && <p className="text-xs text-gray-400 mt-1">Target date: {userGoalTargetDateLabel}</p>}
                        </div>
                      )}
                    </div>

                    {/* Stats row */}
                    {isDebtPayoffUser ? (
                      <div className="border-t border-gray-100 grid grid-cols-3 divide-x divide-gray-100">
                        <div className="px-5 py-4 min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Remaining</p>
                          <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmt(activeGoal.currentAmount, hc)}</p>
                        </div>
                        <div className="px-5 py-4 min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Target payoff</p>
                          <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                            {userGoalTargetDateLabel ?? "—"}
                          </p>
                        </div>
                        <div className="px-5 py-4 min-w-0">
                          <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Expected</p>
                          <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                            {activeGoal.projectedMonths != null && activeGoal.projectedMonths > 0
                              ? addMonths(activeGoal.projectedMonths)
                              : "—"}
                          </p>
                          {activeGoal.monthlyPayment != null && activeGoal.monthlyPayment > 0 && (
                            <p className="text-[10px] text-gray-400 mt-1 tabular-nums truncate" title={`~${fmt(activeGoal.monthlyPayment, hc)}/mo toward these debts`}>
                              ~{fmt(activeGoal.monthlyPayment, hc)}/mo
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      activeGoal.targetAmount != null && activeGoal.targetAmount > 0 && (
                        <div className="border-t border-gray-100 grid grid-cols-2 divide-x divide-gray-100">
                          <div className="px-5 py-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">Target</p>
                            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">{fmt(activeGoal.targetAmount, hc)}</p>
                          </div>
                          <div className="px-5 py-4">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                              {userGoalTargetDateLabel ? "Target date" : activeGoal.projectedMonths != null && activeGoal.projectedMonths > 0 ? "Projected" : "Savings rate"}
                            </p>
                            <p className="text-xl font-bold text-gray-900 mt-1 tabular-nums">
                              {userGoalTargetDateLabel
                                ? userGoalTargetDateLabel
                                : activeGoal.projectedMonths != null && activeGoal.projectedMonths > 0
                                ? addMonths(activeGoal.projectedMonths)
                                : monthlySavings > 0 ? `${fmt(monthlySavings, hc)}/mo` : "—"}
                            </p>
                          </div>
                        </div>
                      )
                    )}

                    {/* Debts tracked (payoff goals) */}
                    {isDebtPayoffUser && liabilitySnaps.length > 0 && (
                      <div className="border-t border-gray-100 px-6 py-5">
                        <div className="flex items-center justify-between mb-3 gap-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Debts included in this goal</p>
                            <p className="text-xs text-gray-400 mt-0.5">Toggle which balances count toward payoff</p>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            {debtLinkedSlugs.length < liabilitySnaps.length && (
                              <button
                                type="button"
                                onClick={() => selectAllLiabilityLinks(sg.id)}
                                className="text-xs font-semibold text-purple-700 hover:text-purple-900 whitespace-nowrap"
                              >
                                Select all
                              </button>
                            )}
                            {debtLinkedSlugs.length > 0 && (
                              <p className="text-xs font-semibold text-gray-700 tabular-nums">{fmt(activeGoal.currentAmount, hc)} owed</p>
                            )}
                          </div>
                        </div>
                        <div className="space-y-1">
                          {liabilitySnaps.map((s) => {
                            const owed = Math.abs(Math.min(0, s.balance));
                            const rate = debtRates.find((r) => r.accountName === s.accountName || r.bankName === s.bankName);
                            const apr = rate?.effectiveRate;
                            const isLinked = debtLinkedSlugs.includes(s.slug);
                            return (
                              <button
                                key={s.slug}
                                type="button"
                                onClick={() => toggleLiabilityLink(sg.id, s.slug, !isLinked)}
                                className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                                  isLinked
                                    ? "border-purple-200 bg-purple-50/60"
                                    : "border-gray-100 bg-white opacity-60 hover:opacity-100 hover:bg-gray-50"
                                }`}
                              >
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-gray-800 truncate">{s.accountName ?? s.bankName}</p>
                                  <p className="text-xs text-gray-400">
                                    {TYPE_LABEL[s.accountType] ?? s.accountType}
                                    {apr != null ? ` · ${apr.toFixed(2)}% APR` : ""}
                                  </p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0 ml-3">
                                  <p className="text-sm font-semibold tabular-nums text-gray-700">{fmt(owed, hc)}</p>
                                  <div className={`relative w-9 h-5 rounded-full transition-colors ${isLinked ? "bg-purple-500" : "bg-gray-200"}`}>
                                    <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isLinked ? "translate-x-4" : "translate-x-0.5"}`} />
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                        {debtLinkedSlugs.length === 0 && (
                          <p className="mt-2 text-xs text-gray-400">Turn on at least one debt above to track this goal.</p>
                        )}
                      </div>
                    )}

                    {isDebtPayoffUser && liabilitySnaps.length === 0 && (
                      <div className="border-t border-gray-100 px-6 py-4">
                        <p className="text-xs text-gray-500">Upload statements with credit cards, loans, or mortgages to choose which debts this goal tracks.</p>
                      </div>
                    )}

                    {/* Asset linking (savings goals) */}
                    {hasLinkable && (
                      <div className="border-t border-gray-100 px-6 py-5">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Accounts counting toward this goal</p>
                            <p className="text-xs text-gray-400 mt-0.5">Toggle savings, checking, and investments</p>
                          </div>
                          {linkedSlugs.length > 0 && (
                            <p className="text-xs font-semibold text-gray-700 tabular-nums">{fmt(activeGoal.currentAmount, hc)} total</p>
                          )}
                        </div>

                        {[
                          { label: "Savings & Checking", accounts: savingsChecking },
                          { label: "Investments", accounts: investmentAccs },
                        ].map(({ label, accounts }) =>
                          accounts.length > 0 ? (
                            <div key={label} className="mb-3 last:mb-0">
                              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-300 mb-1.5">{label}</p>
                              <div className="space-y-1">
                                {accounts.map((s) => {
                                  const isLinked = linkedSlugs.includes(s.slug);
                                  return (
                                    <button
                                      key={s.slug}
                                      type="button"
                                      onClick={() => toggleAccountLink(sg.id, s.slug, !isLinked)}
                                      className={`w-full flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                                        isLinked
                                          ? `${accent.active} border-opacity-60`
                                          : "border-gray-100 bg-white hover:bg-gray-50"
                                      }`}
                                    >
                                      <div className="min-w-0">
                                        <p className="text-sm font-medium text-gray-800 truncate">{s.accountName ?? s.bankName}</p>
                                        <p className="text-xs text-gray-400">{s.bankName} · {TYPE_LABEL[s.accountType] ?? s.accountType}</p>
                                      </div>
                                      <div className="flex items-center gap-3 shrink-0 ml-3">
                                        <p className="text-sm font-semibold tabular-nums text-gray-700">{fmt(Math.max(0, s.balance), hc)}</p>
                                        <div className={`relative w-9 h-5 rounded-full transition-colors ${isLinked ? "bg-purple-500" : "bg-gray-200"}`}>
                                          <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform ${isLinked ? "translate-x-4" : "translate-x-0.5"}`} />
                                        </div>
                                      </div>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          ) : null,
                        )}

                        {linkedSlugs.length === 0 && (
                          <p className="mt-2 text-xs text-gray-400">No accounts selected — enable one above to start tracking progress automatically.</p>
                        )}
                      </div>
                    )}
                  </>
                );
              })()}
        </div>
      )}

      {/* ── Projection assumptions (scoped to active goal) ── */}
          {(() => {
            if (!activeGoal) return null;

            // Which rates are relevant for the current goal
            const isDebtGoal = activeGoal.source === "auto_debt" || activeGoal.goalType === "debt_payoff";
            const isNwGoal   = activeGoal.source === "auto_nw"   || activeGoal.goalType === "net_worth";
            const isEfGoal   = activeGoal.source === "auto_ef"   || activeGoal.goalType === "emergency_fund";

            const visibleDebtRates  = isDebtGoal ? debtRates : [];
            const visibleAssetRates = (isNwGoal || isEfGoal)
              ? (isEfGoal
                  ? assetRates.filter((r) => r.accountType === "savings")
                  : assetRates.filter((r) => r.accountType === "investment"))
              : [];

            const noRates = visibleDebtRates.length === 0 && visibleAssetRates.length === 0;
            if (noRates) return null;

            const showDefaultWarning = isNwGoal && usingDefaultReturn;

            const subtitle = isDebtGoal
              ? "APRs used to calculate your payoff date"
              : isEfGoal
              ? "Savings rate used to project your target date"
              : "Portfolio return used to project your FI date";

            return (
              <div className="mt-4 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <button
                  onClick={() => setShowRates((v) => !v)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left"
                >
                  <div>
                    <p className="text-sm font-semibold text-gray-800">Projection assumptions</p>
                    <p className="mt-0.5 text-xs text-gray-400">{subtitle}</p>
                  </div>
                  <svg className={`h-4 w-4 text-gray-400 transition-transform ${showRates ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {showRates && (
                  <div className="border-t border-gray-100 px-5">
                    {visibleDebtRates.length > 0 && (
                      <div className="divide-y divide-gray-100">
                        {visibleDebtRates.map((r) => (
                          <RateEditor key={r.accountKey} entry={r} token={authToken!}
                            onSaved={(key, rate) => setRates((prev) => prev.map((e) => e.accountKey === key ? { ...e, manualRate: rate, effectiveRate: rate ?? e.extractedRate } : e))}
                          />
                        ))}
                      </div>
                    )}
                    {visibleAssetRates.length > 0 && (
                      <div className="divide-y divide-gray-100 pb-1">
                        {visibleAssetRates.map((r) => (
                          <RateEditor key={r.accountKey} entry={r} token={authToken!}
                            onSaved={(key, rate) => setRates((prev) => prev.map((e) => e.accountKey === key ? { ...e, manualRate: rate, effectiveRate: rate ?? e.extractedRate } : e))}
                          />
                        ))}
                      </div>
                    )}
                    {showDefaultWarning && (
                      <p className="py-3 border-t border-gray-100 text-xs text-amber-600">
                        No investment return found — using {(DEFAULT_INVEST_RETURN * 100).toFixed(0)}% default. Add your portfolio rate above for a more accurate FI date.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })()}

      {/* ── Add goal modal (two-step picker) ── */}
      {showAddGoal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl overflow-hidden" role="dialog" aria-labelledby="goal-modal-title">
            {goalPickerStep === "pick" ? (
              <>
                <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center justify-between">
                  <div>
                    <h2 id="goal-modal-title" className="text-base font-semibold text-gray-900">What are you working toward?</h2>
                    <p className="text-xs text-gray-400 mt-0.5">Pick a type to get started</p>
                  </div>
                  <button type="button" onClick={closeGoalModal} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition" aria-label="Close">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="px-5 py-4 max-h-[70vh] overflow-y-auto">
                  <div className="grid grid-cols-1 gap-2">
                      {catalogueTemplates.map((t) => (
                        <button key={t.label} type="button"
                          onClick={() => {
                            setSelectedTemplate(t);
                            setNewGoalTitle(t.prefill?.title ?? "");
                            setNewGoalAmount("");
                            setNewGoalDebtSlugs(null);
                            setNewGoalAssetSlugs(null);
                            setNewGoalDate(t.goalType === "debt_payoff" ? computeDebtPayoffYM(null) : "");
                            setGoalPickerStep("form");
                          }}
                          className="flex items-center gap-3 rounded-xl border border-gray-100 bg-white px-4 py-3 text-left hover:border-gray-200 hover:bg-gray-50 transition"
                        >
                          <span className="text-xl shrink-0">{t.emoji}</span>
                          <div className="min-w-0">
                            <p className="text-sm font-semibold text-gray-800">{t.label}</p>
                            <p className="text-xs text-gray-400 truncate">{t.description}</p>
                          </div>
                          <svg className="h-4 w-4 text-gray-300 shrink-0 ml-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
                        </button>
                      ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="px-5 pt-5 pb-3 border-b border-gray-100 flex items-center gap-3">
                  <button type="button" onClick={() => setGoalPickerStep("pick")} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition" aria-label="Back">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" /></svg>
                  </button>
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xl shrink-0">{selectedTemplate?.emoji ?? "🎯"}</span>
                    <h2 id="goal-modal-title" className="text-base font-semibold text-gray-900 leading-tight">{selectedTemplate?.label ?? "New goal"}</h2>
                  </div>
                  <button type="button" onClick={closeGoalModal} className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 transition ml-auto shrink-0" aria-label="Close">
                    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                </div>
                <div className="px-5 py-5 space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 mb-1.5">Goal name <span className="text-red-400">*</span></label>
                    <input
                      value={newGoalTitle}
                      onChange={(e) => setNewGoalTitle(e.target.value)}
                      placeholder={
                        selectedTemplate?.goalType === "debt_payoff"
                          ? "e.g. Clear my Amex balance"
                          : "e.g. Kitchen renovation fund"
                      }
                      autoFocus
                      className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  {selectedTemplate?.goalType !== "debt_payoff" && (
                    <div>
                      <label className="block text-xs font-semibold text-gray-700 mb-1.5">Target amount <span className="text-gray-400">(optional)</span></label>
                      <div className="flex rounded-lg border border-gray-200 bg-white shadow-sm focus-within:border-purple-500 focus-within:ring-2 focus-within:ring-purple-500">
                        <span className="flex shrink-0 items-center border-r border-gray-200 bg-gray-50 px-3 py-2 text-sm font-medium tabular-nums text-gray-500 select-none">
                          {getCurrencySymbol(hc)}
                        </span>
                        <input
                          type="text"
                          inputMode="decimal"
                          autoComplete="off"
                          value={newGoalAmount}
                          onChange={(e) => setNewGoalAmount(e.target.value)}
                          placeholder="0"
                          className="min-w-0 flex-1 border-0 bg-transparent px-3 py-2 text-sm tabular-nums focus:outline-none focus:ring-0"
                        />
                      </div>
                      {newGoalAmount && monthlySavings > 0 && (() => {
                        const target = parseFloat(newGoalAmount.replace(/[^0-9.]/g, ""));
                        if (!isNaN(target) && target > 0) {
                          return <p className="mt-1.5 text-xs text-gray-500">At your savings rate · estimated <span className="font-medium text-gray-700">{addMonths(Math.ceil(target / monthlySavings))}</span></p>;
                        }
                        return null;
                      })()}
                    </div>
                  )}
                  {selectedTemplate?.goalType === "debt_payoff" ? (
                    /* ── Debt payoff: account selection + auto-projected date ── */
                    <>
                      {liabilitySnaps.length > 0 && (() => {
                        const activeSlugs = newGoalDebtSlugs ?? liabilitySnaps.map((s) => s.slug);
                        const projYM = computeDebtPayoffYM(newGoalDebtSlugs);
                        return (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs font-semibold text-gray-700">Accounts to include</label>
                              {newGoalDebtSlugs !== null && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    setNewGoalDebtSlugs(null);
                                    const ym = computeDebtPayoffYM(null);
                                    if (ym) setNewGoalDate(ym);
                                  }}
                                  className="text-xs font-semibold text-purple-700 hover:text-purple-900"
                                >
                                  Select all
                                </button>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              {liabilitySnaps.map((s) => {
                                const owed = snapshotDebtInHome(s, hc, fxRatesState);
                                const rate = debtRates.find((r) => r.accountName === s.accountName || r.bankName === s.bankName);
                                const apr  = rate?.effectiveRate;
                                const isOn = activeSlugs.includes(s.slug);
                                return (
                                  <button
                                    key={s.slug}
                                    type="button"
                                    onClick={() => {
                                      const next = isOn
                                        ? activeSlugs.filter((x) => x !== s.slug)
                                        : [...activeSlugs, s.slug];
                                      const finalSlugs = next.length === liabilitySnaps.length ? null : next.length === 0 ? activeSlugs : next;
                                      setNewGoalDebtSlugs(finalSlugs);
                                      const ym = computeDebtPayoffYM(finalSlugs);
                                      if (ym) setNewGoalDate(ym);
                                    }}
                                    className={`w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                                      isOn ? "border-purple-200 bg-purple-50/60" : "border-gray-100 bg-white opacity-60 hover:opacity-100 hover:bg-gray-50"
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-gray-800 truncate">{s.accountName ?? s.bankName}</p>
                                      {apr != null && <p className="text-xs text-gray-400">{apr.toFixed(2)}% APR</p>}
                                    </div>
                                    <div className="flex items-center gap-2.5 shrink-0 ml-3">
                                      <p className="text-sm font-semibold tabular-nums text-gray-700">{fmtShort(owed, hc)}</p>
                                      <div className={`relative w-8 h-4 rounded-full transition-colors ${isOn ? "bg-purple-500" : "bg-gray-200"}`}>
                                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${isOn ? "translate-x-4" : "translate-x-0.5"}`} />
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                            {projYM && (
                              <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                                <p className="text-xs text-gray-500">
                                  Projected debt-free: <span className="font-semibold text-gray-800">{ymLabel(projYM)}</span>
                                </p>
                                {projYM !== newGoalDate && (
                                  <button
                                    type="button"
                                    onClick={() => setNewGoalDate(projYM)}
                                    className="ml-3 text-xs font-semibold text-purple-700 hover:text-purple-900 shrink-0"
                                  >
                                    Use this →
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })()}
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                          Goal date <span className="text-gray-400">(optional)</span>
                        </label>
                        <input
                          type="month"
                          value={newGoalDate}
                          onChange={(e) => setNewGoalDate(e.target.value)}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                        />
                        <p className="mt-1.5 text-xs text-gray-400">
                          Auto-filled from your projected payoff. Edit any time.
                        </p>
                      </div>
                    </>
                  ) : (
                    /* ── Savings / savings-type: account selection + target date ── */
                    <>
                      {(() => {
                        const savingsAccounts = snapshots.filter(
                          (s) => (s.accountType === "savings" || s.accountType === "checking") && s.balance >= 0,
                        );
                        if (savingsAccounts.length === 0) return null;
                        const activeSlugs = newGoalAssetSlugs ?? savingsAccounts.map((s) => s.slug);
                        const selectedBalance = savingsAccounts
                          .filter((s) => activeSlugs.includes(s.slug))
                          .reduce((sum, s) => sum + Math.max(0, s.balance), 0);
                        const targetAmt = newGoalAmount.trim()
                          ? parseFloat(newGoalAmount.replace(/[^0-9.]/g, ""))
                          : NaN;
                        return (
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <label className="text-xs font-semibold text-gray-700">Accounts counting toward this goal</label>
                              {newGoalAssetSlugs !== null && (
                                <button
                                  type="button"
                                  onClick={() => setNewGoalAssetSlugs(null)}
                                  className="text-xs font-semibold text-purple-700 hover:text-purple-900"
                                >
                                  Select all
                                </button>
                              )}
                            </div>
                            <div className="space-y-1.5">
                              {savingsAccounts.map((s) => {
                                const isOn = activeSlugs.includes(s.slug);
                                return (
                                  <button
                                    key={s.slug}
                                    type="button"
                                    onClick={() => {
                                      const next = isOn
                                        ? activeSlugs.filter((x) => x !== s.slug)
                                        : [...activeSlugs, s.slug];
                                      const finalSlugs = next.length === savingsAccounts.length
                                        ? null : next.length === 0 ? activeSlugs : next;
                                      setNewGoalAssetSlugs(finalSlugs);
                                    }}
                                    className={`w-full flex items-center justify-between rounded-xl border px-3 py-2.5 text-left transition ${
                                      isOn ? "border-purple-200 bg-purple-50/60" : "border-gray-100 bg-white opacity-60 hover:opacity-100 hover:bg-gray-50"
                                    }`}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium text-gray-800 truncate">{s.accountName ?? s.bankName}</p>
                                      <p className="text-xs text-gray-400">{TYPE_LABEL[s.accountType] ?? s.accountType} · {s.bankName}</p>
                                    </div>
                                    <div className="flex items-center gap-2.5 shrink-0 ml-3">
                                      <p className="text-sm font-semibold tabular-nums text-gray-700">{fmtShort(Math.max(0, s.balance), hc)}</p>
                                      <div className={`relative w-8 h-4 rounded-full transition-colors ${isOn ? "bg-purple-500" : "bg-gray-200"}`}>
                                        <div className={`absolute top-0.5 w-3 h-3 rounded-full bg-white shadow-sm transition-transform ${isOn ? "translate-x-4" : "translate-x-0.5"}`} />
                                      </div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                            <div className="mt-3 flex items-center justify-between rounded-lg bg-gray-50 border border-gray-100 px-3 py-2">
                              <p className="text-xs text-gray-500">
                                Selected balance: <span className="font-semibold text-gray-800">{fmtShort(selectedBalance, hc)}</span>
                              </p>
                              {!isNaN(targetAmt) && targetAmt > 0 && (
                                <p className="text-xs text-gray-500 tabular-nums">
                                  {Math.round(Math.min(100, (selectedBalance / targetAmt) * 100))}% of target
                                </p>
                              )}
                            </div>
                          </div>
                        );
                      })()}
                      <div>
                        <label className="block text-xs font-semibold text-gray-700 mb-1.5">
                          Target date <span className="text-gray-400">(optional)</span>
                        </label>
                        <input type="month" value={newGoalDate} onChange={(e) => setNewGoalDate(e.target.value)}
                          className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500" />
                        {!isNaN(parseFloat(newGoalAmount.replace(/[^0-9.]/g, ""))) &&
                         parseFloat(newGoalAmount.replace(/[^0-9.]/g, "")) > 0 &&
                         monthlySavings > 0 && (() => {
                          const selected = (newGoalAssetSlugs ?? snapshots.filter(s => s.accountType === "savings" || s.accountType === "checking"))
                            .reduce((sum: number, sv: AccountSnapshot | string) => {
                              const snap = typeof sv === "string" ? snapshots.find(s => s.slug === sv) : sv;
                              return sum + (snap ? Math.max(0, snap.balance) : 0);
                            }, 0);
                          const remaining = parseFloat(newGoalAmount.replace(/[^0-9.]/g, "")) - selected;
                          if (remaining > 0) {
                            return <p className="mt-1.5 text-xs text-gray-500">{fmtShort(remaining, hc)} remaining · at {fmtShort(monthlySavings, hc)}/mo → ~{Math.ceil(remaining / monthlySavings)} months</p>;
                          }
                          return <p className="mt-1.5 text-xs text-emerald-600 font-medium">You&apos;ve already hit this target 🎉</p>;
                        })()}
                      </div>
                    </>
                  )}
                  <div className="flex gap-2 pt-1">
                    <button type="button" onClick={closeGoalModal} className="flex-1 rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-600 hover:bg-gray-50 transition">Cancel</button>
                    <button type="button" disabled={newGoalSaving || !newGoalTitle.trim()} onClick={createSavedGoal}
                      className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition">
                      {newGoalSaving ? "Saving…" : "Save goal"}
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
