"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import NetWorthChart from "@/components/NetWorthChart";
import IncomeCard from "@/components/IncomeCard";
import ExpensesCard from "@/components/ExpensesCard";
import SavingsRateCard from "@/components/SavingsRateCard";
import SubscriptionsCard from "@/components/SubscriptionsCard";
import InsightsSection from "@/components/InsightsSection";
import type { ParsedStatementData, ManualAsset, InvestmentHolding } from "@/lib/types";
import { buildAccountSlug } from "@/lib/accountSlug";
import CsvImportPanel from "@/components/CsvImportPanel";
import type { PaymentFrequency } from "@/app/api/user/account-rates/route";

// ── constants ─────────────────────────────────────────────────────────────────

const PAYMENT_FREQ_OPTIONS: { value: PaymentFrequency; label: string; perYear: number }[] = [
  { value: "weekly",       label: "Weekly",       perYear: 52 },
  { value: "biweekly",     label: "Bi-weekly",    perYear: 26 },
  { value: "semi-monthly", label: "Semi-monthly", perYear: 24 },
  { value: "monthly",      label: "Monthly",      perYear: 12 },
];

const TYPE_LABEL: Record<string, string> = {
  checking: "Checking", savings: "Savings", credit: "Credit Card",
  mortgage: "Mortgage", investment: "Investment", loan: "Loan", other: "Other",
};
const TYPE_COLOR: Record<string, string> = {
  checking: "bg-blue-100 text-blue-700", savings: "bg-green-100 text-green-700",
  credit: "bg-orange-100 text-orange-700", mortgage: "bg-red-100 text-red-700",
  investment: "bg-purple-100 text-purple-700", loan: "bg-yellow-100 text-yellow-700",
  other: "bg-gray-100 text-gray-600",
};
const DEBT_TYPES = new Set(["mortgage", "loan", "credit"]);

// ── helpers ───────────────────────────────────────────────────────────────────

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function shortMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
import { fmt, getCurrencySymbol, CURRENCY_SYMBOL } from "@/lib/currencyUtils";
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
/** Derive the accountKey (used by account-rates API) from parsedData fields. */
function toAccountKey(bankName: string, accountId?: string): string {
  return buildAccountSlug(bankName, accountId);
}

// ── types ─────────────────────────────────────────────────────────────────────

interface StatementHistoryEntry {
  yearMonth: string;
  netWorth: number;
  uploadedAt: string;
  statementId: string;
  isCarryForward: boolean;
  interestRate: number | null;
  source?: "pdf" | "csv";
  isManualSnapshot?: boolean;
  snapshotId?: string;
  note?: string;
}

interface RateHistoryEntry {
  rate: number;
  source: "user" | "ai";
  changedAt: string;
  note: string | null;
}

// ── Holdings card (investment accounts) ──────────────────────────────────────

const HOLDING_TYPE_LABEL: Record<string, string> = {
  stock:       "Stock",
  etf:         "ETF",
  mutual_fund: "Mutual Fund",
  bond:        "Bond",
  gic:         "GIC",
  cash:        "Cash",
  other:       "Other",
};
const HOLDING_TYPE_COLOR: Record<string, string> = {
  stock:       "bg-blue-100 text-blue-700",
  etf:         "bg-indigo-100 text-indigo-700",
  mutual_fund: "bg-purple-100 text-purple-700",
  bond:        "bg-green-100 text-green-700",
  gic:         "bg-teal-100 text-teal-700",
  cash:        "bg-gray-100 text-gray-500",
  other:       "bg-gray-100 text-gray-500",
};

function HoldingsCard({ holdings, totalValue }: { holdings: InvestmentHolding[]; totalValue: number }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 6;
  const sorted  = [...holdings].sort((a, b) => b.value - a.value);
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW);
  const hasMore = sorted.length > PREVIEW;

  const fmt$ = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
      minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

  // Aggregate by type for the mini summary bar
  const byType = holdings.reduce<Record<string, number>>((acc, h) => {
    acc[h.type] = (acc[h.type] ?? 0) + h.value;
    return acc;
  }, {});
  const typeOrder: string[] = ["stock", "etf", "mutual_fund", "bond", "gic", "cash", "other"];
  const barSegments = typeOrder
    .filter((t) => byType[t])
    .map((t) => ({ type: t, value: byType[t], pct: totalValue > 0 ? (byType[t] / totalValue) * 100 : 0 }));

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Holdings</p>

        {/* Stacked composition bar */}
        {barSegments.length > 0 && (
          <div className="mb-3">
            <div className="flex h-2.5 w-full rounded-full overflow-hidden gap-px">
              {barSegments.map((seg) => (
                <div
                  key={seg.type}
                  style={{ width: `${seg.pct}%` }}
                  className={`h-full ${HOLDING_TYPE_COLOR[seg.type]?.split(" ")[0] ?? "bg-gray-200"}`}
                  title={`${HOLDING_TYPE_LABEL[seg.type]}: ${fmt$(seg.value)} (${seg.pct.toFixed(1)}%)`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {barSegments.map((seg) => (
                <span key={seg.type} className="flex items-center gap-1 text-[11px] text-gray-500">
                  <span className={`h-2 w-2 rounded-sm inline-block ${HOLDING_TYPE_COLOR[seg.type]?.split(" ")[0] ?? "bg-gray-200"}`} />
                  {HOLDING_TYPE_LABEL[seg.type]} {seg.pct.toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Holdings list */}
      <div className="divide-y divide-gray-50">
        {visible.map((h, i) => {
          const pct = h.percentOfPortfolio ?? (totalValue > 0 ? (h.value / totalValue) * 100 : 0);
          return (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-gray-900 truncate">{h.name}</p>
                  {h.symbol && (
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-gray-600">
                      {h.symbol}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${HOLDING_TYPE_COLOR[h.type] ?? HOLDING_TYPE_COLOR.other}`}>
                    {HOLDING_TYPE_LABEL[h.type] ?? h.type}
                  </span>
                  {h.units !== undefined && (
                    <span className="text-xs text-gray-400">{h.units.toLocaleString()} units</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-gray-900">{fmt$(h.value)}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{pct.toFixed(1)}%</p>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-gray-100 px-5 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition text-center"
        >
          {expanded ? "Show less ↑" : `Show all ${sorted.length} holdings ↓`}
        </button>
      )}
    </div>
  );
}

// ── APR inline editor ────────────────────────────────────────────────────────

interface AprEditorProps {
  accountKey: string;
  currentRate: number | null;
  extractedRate: number | null;
  token: string;
  onSaved: (rate: number | null) => void;
}
function AprEditor({ accountKey, currentRate, extractedRate, token, onSaved }: AprEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(currentRate !== null ? String(currentRate) : "");
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local value in sync if parent rate changes (e.g. after reload)
  useEffect(() => {
    if (!editing) setValue(currentRate !== null ? String(currentRate) : "");
  }, [currentRate, editing]);

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.focus(), 50);
  }, [editing]);

  async function save() {
    const parsed = parseFloat(value.replace(/[^0-9.]/g, ""));
    if (value.trim() !== "" && (isNaN(parsed) || parsed <= 0 || parsed > 100)) {
      setErr("Enter a rate between 0.01 and 100"); return;
    }
    setSaving(true); setErr(null);
    const rate = value.trim() === "" ? null : parsed;
    try {
      const res = await fetch("/api/user/account-rates", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountKey, rate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Save failed");
      }
      onSaved(rate);
      setEditing(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally { setSaving(false); }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <input
            ref={inputRef}
            type="text" inputMode="decimal"
            value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            placeholder={extractedRate !== null ? String(extractedRate) : "e.g. 3.9"}
            className="w-24 rounded-lg border border-purple-300 px-2.5 py-1.5 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
        </div>
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={() => { setEditing(false); setErr(null); }}
          className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
        {err && <p className="w-full text-xs text-red-500">{err}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-2xl font-bold text-gray-900">
        {currentRate !== null ? `${currentRate}%` : "—"}
      </span>
      <button onClick={() => setEditing(true)}
        className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:border-purple-300 hover:text-purple-600 transition">
        Edit
      </button>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function AccountDetailPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [data, setData]                   = useState<ParsedStatementData | null>(null);
  const [previousMonth, setPreviousMonth] = useState<{ netWorth: number; assets: number; debts: number } | null>(null);
  const [yearMonth, setYearMonth]         = useState<string | null>(null);
  const [history, setHistory]             = useState<{ yearMonth: string; netWorth: number; expensesTotal?: number; isEstimate?: boolean }[]>([]);
  const [manualAssets, setManualAssets]   = useState<ManualAsset[]>([]);
  const [stmtHistory, setStmtHistory]     = useState<StatementHistoryEntry[]>([]);
  const [baselineMonth, setBaselineMonth] = useState<string | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [statementCount, setStatementCount] = useState(0);
  const [idToken, setIdToken]             = useState<string | null>(null);
  const [deletingId, setDeletingId]       = useState<string | null>(null);
  const [reparsingId, setReparsingId]     = useState<string | null>(null);
  const [showCsvImport, setShowCsvImport] = useState(false);
  const [activeTab, setActiveTab] = useState<"overview" | "transactions" | "history">("overview");

  // Transactions section state
  const [txMonth, setTxMonth]         = useState<string | null>(null);
  const [txData, setTxData]           = useState<ParsedStatementData["expenses"] | null>(null);
  const [txPayments, setTxPayments]   = useState<number>(0);
  const [txLoading, setTxLoading]     = useState(false);

  // APR / frequency state
  const [effectiveRate, setEffectiveRate]       = useState<number | null>(null);
  const [extractedRate, setExtractedRate]       = useState<number | null>(null);
  const [accountKey, setAccountKey]             = useState<string>("");
  const [rateHistory, setRateHistory]           = useState<RateHistoryEntry[]>([]);
  const [showRateHistory, setShowRateHistory]     = useState(false);
  const [showAllStatements, setShowAllStatements] = useState(false);
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>("monthly");
  const [savingFreq, setSavingFreq]             = useState(false);

  // FX rates from the financial profile cache (currency → CAD rate)
  const [fxRates, setFxRates] = useState<Record<string, number>>({});

  // Currency override modal state
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [selectedCurrency, setSelectedCurrency]   = useState<string>("CAD");
  const [savingCurrency, setSavingCurrency]       = useState(false);

  // Balance snapshot state
  const [showSnapshotForm,  setShowSnapshotForm]  = useState(false);
  const [snapBalance,       setSnapBalance]       = useState("");
  const [snapMonth,         setSnapMonth]         = useState("");
  const [snapNote,          setSnapNote]          = useState("");
  const [snapSaving,        setSnapSaving]        = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [snapError,         setSnapError]         = useState<string | null>(null);
  const [deletingSnap,      setDeletingSnap]      = useState<string | null>(null);

  const loadAccountData = useCallback(async (token: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `/api/user/statements/consolidated?account=${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "Failed to load account"); return; }
      setData(json.data ?? null);
      setStatementCount(json.count ?? 0);
      setPreviousMonth(json.previousMonth ?? null);
      setYearMonth(json.yearMonth ?? null);
      setManualAssets(Array.isArray(json.manualAssets) ? json.manualAssets : []);
      setTxMonth(json.yearMonth ?? null);
      setTxData((json.data as ParsedStatementData | null)?.expenses ?? null);
      setTxPayments(json.paymentsMade ?? 0);

      const acctHistory: StatementHistoryEntry[] = json.accountStatementHistory?.[slug] ?? [];
      setStmtHistory(acctHistory);

      const monthMap = new Map<string, { yearMonth: string; netWorth: number; isEstimate: boolean; priority: number }>();
      for (const e of acctHistory) {
        const isBackfill = e.note === "Estimated (backfilled)";
        // Priority: carry-forward=0 (worst), backfill/snapshot=1, real upload=2 (best)
        const priority = e.isCarryForward ? 0 : (isBackfill || e.isManualSnapshot) ? 1 : 2;
        const existing = monthMap.get(e.yearMonth);
        if (!existing || priority > existing.priority) {
          monthMap.set(e.yearMonth, {
            yearMonth: e.yearMonth,
            netWorth: e.netWorth,
            isEstimate: e.isCarryForward || isBackfill,
            priority,
          });
        }
      }
      const chartHistory = Array.from(monthMap.values())
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
        .map(({ yearMonth, netWorth, isEstimate }) => ({ yearMonth, netWorth, isEstimate }));
      setHistory(chartHistory);

      setFxRates(typeof json.fxRates === "object" && json.fxRates !== null ? json.fxRates : {});

      const saved = localStorage.getItem(`baseline-${slug}`);
      if (saved) setBaselineMonth(saved);

      // Load APR for this account.
      // The URL slug IS the accountKey (both built with buildAccountSlug), so we
      // can always use it — even when parsedData.bankName is missing.
      const parsed = json.data as ParsedStatementData | null;
      const key = parsed?.bankName
        ? toAccountKey(parsed.bankName, parsed.accountId)
        : slug; // fall back to URL slug which equals the accountKey
      setAccountKey(key);

      const ratesRes = await fetch("/api/user/account-rates", { headers: { Authorization: `Bearer ${token}` } });
      const ratesJson = await ratesRes.json().catch(() => ({}));
      const entry = (ratesJson.rates ?? []).find(
        (r: { accountKey: string }) => r.accountKey === key
      );
      if (entry) {
        setEffectiveRate(entry.effectiveRate ?? null);
        setExtractedRate(entry.extractedRate ?? null);
        if (entry.paymentFrequency) setPaymentFrequency(entry.paymentFrequency as PaymentFrequency);
      } else {
        const fromStmt = typeof parsed?.interestRate === "number" ? parsed.interestRate : null;
        setExtractedRate(fromStmt);
        setEffectiveRate(fromStmt);
      }

      const histRes = await fetch(
        `/api/user/account-rates/history?accountKey=${encodeURIComponent(key)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const histJson = await histRes.json().catch(() => ({}));
      setRateHistory(histJson.history ?? []);
    } catch { setError("Failed to load account"); }
    finally { setLoading(false); }
  }, [slug]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const token = await user.getIdToken();
      setIdToken(token);
      await loadAccountData(token);
    });
  }, [router, slug, loadAccountData]);

  async function handleViewFile(statementId: string) {
    if (!idToken) return;
    try {
      const res = await fetch(`/api/user/statements/${statementId}/file`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) { alert("Could not load the original document."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      // revoke after a short delay to allow the new tab to load
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      alert("Could not load the original document.");
    }
  }

  async function handleDelete(statementId: string) {
    if (!idToken || !confirm("Delete this statement?")) return;
    setDeletingId(statementId);
    try {
      await fetch(`/api/user/statements/${statementId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${idToken}` },
      });
      const res = await fetch(
        `/api/user/statements/consolidated?account=${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      const json = await res.json().catch(() => ({}));
      setData(json.data ?? null);
      setStatementCount(json.count ?? 0);
      const acctHistory: StatementHistoryEntry[] = json.accountStatementHistory?.[slug] ?? [];
      setStmtHistory(acctHistory);
      setHistory((Array.isArray(json.history) ? json.history : []).map(
        (h: { yearMonth: string; netWorth: number; expensesTotal?: number; isEstimate?: boolean }) => ({
          ...h,
          isEstimate: h.isEstimate ??
            (acctHistory.find((e) => e.yearMonth === h.yearMonth)?.isCarryForward ?? false),
        })
      ));
    } finally { setDeletingId(null); }
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  async function handleReparse(statementId: string) {
    if (!idToken) return;
    setReparsingId(statementId);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ statementId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(j.error || "Re-parse failed", false);
        return;
      }
      const newSlug: string | undefined = j.accountSlug;
      if (newSlug && newSlug !== slug) {
        router.push(`/account/accounts/${encodeURIComponent(newSlug)}`);
      } else {
        showToast("Re-parsed successfully — categories updated", true);
        if (idToken) loadAccountData(idToken);
      }
    } finally {
      setReparsingId(null);
    }
  }

  async function handleTxMonthSelect(ym: string) {
    if (!idToken || ym === txMonth) return;
    setTxMonth(ym);
    setTxLoading(true);
    try {
      const res = await fetch(
        `/api/user/statements/consolidated?account=${encodeURIComponent(slug)}&month=${ym}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      const json = await res.json().catch(() => ({}));
      // Update all account state so KPI cards, equity, sub-accounts etc. reflect the selected month
      if (json.data) setData(json.data as ParsedStatementData);
      if (json.previousMonth !== undefined) setPreviousMonth(json.previousMonth);
      if (json.yearMonth) setYearMonth(json.yearMonth);
      setTxData((json.data as ParsedStatementData | null)?.expenses ?? null);
      setTxPayments(json.paymentsMade ?? 0);
    } finally {
      setTxLoading(false);
    }
  }

  async function handleFrequencyChange(freq: PaymentFrequency) {
    if (!idToken || !accountKey) return;
    setPaymentFrequency(freq);
    setSavingFreq(true);
    try {
      await fetch("/api/user/account-rates", {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountKey, paymentFrequency: freq }),
      });
    } finally { setSavingFreq(false); }
  }

  function handleSetBaseline(ym: string) {
    const newBaseline = baselineMonth === ym ? null : ym;
    setBaselineMonth(newBaseline);
    if (newBaseline) localStorage.setItem(`baseline-${slug}`, newBaseline);
    else localStorage.removeItem(`baseline-${slug}`);
  }

  // ── Balance snapshot handlers ──────────────────────────────────────────────
  function openSnapshotForm() {
    const now = new Date();
    const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    const latestBal = stmtHistory.find((e) => !e.isManualSnapshot && !e.isCarryForward)?.netWorth ?? 0;
    setSnapBalance(String(Math.abs(latestBal)));
    setSnapMonth(ym);
    setSnapNote("");
    setSnapError(null);
    setShowSnapshotForm(true);
  }
  async function handleSaveSnapshot() {
    if (!idToken || !data) return;
    const val = parseFloat(snapBalance.replace(/,/g, ""));
    if (isNaN(val)) { setSnapError("Enter a valid balance"); return; }
    if (!snapMonth)  { setSnapError("Select a month"); return; }
    setSnapSaving(true); setSnapError(null);
    try {
      const isDebt = ["credit", "mortgage", "loan"].includes(data.accountType ?? "");
      const balance = isDebt ? -Math.abs(val) : Math.abs(val);
      const res = await fetch("/api/user/balance-snapshots", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          accountSlug: slug,
          accountName: data.accountName ?? data.bankName ?? slug,
          accountType: data.accountType ?? "other",
          balance,
          yearMonth: snapMonth,
          note: snapNote || undefined,
        }),
      });
      if (!res.ok) { setSnapError("Failed to save. Please try again."); return; }
      setShowSnapshotForm(false);
      // Refresh the page data
      const refreshed = await fetch(
        `/api/user/statements/consolidated?account=${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      const rJson = await refreshed.json().catch(() => ({}));
      const acctHistory: StatementHistoryEntry[] = rJson.accountStatementHistory?.[slug] ?? [];
      setStmtHistory(acctHistory);
      setHistory((rJson.history ?? []).map((h: { yearMonth: string; netWorth: number; expensesTotal?: number; isEstimate?: boolean }) => ({
        ...h,
        isEstimate: h.isEstimate ??
          (acctHistory.find((e) => e.yearMonth === h.yearMonth)?.isCarryForward ?? false),
      })));
    } finally { setSnapSaving(false); }
  }
  async function handleDeleteSnapshot(snapshotId: string) {
    if (!idToken) return;
    setDeletingSnap(snapshotId);
    try {
      await fetch(`/api/user/balance-snapshots?id=${snapshotId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      setStmtHistory((prev) => prev.filter((e) => e.snapshotId !== snapshotId));
    } finally { setDeletingSnap(null); }
  }

  async function saveCurrency(newCurrency: string) {
    if (!idToken) return;
    setSavingCurrency(true);
    try {
      const res = await fetch("/api/user/account-currencies", {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountSlug: slug, currency: newCurrency }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setShowCurrencyModal(false);
      showToast(`Currency set to ${newCurrency}. Rebuilding profile…`, true);
      await loadAccountData(idToken);
    } catch {
      showToast("Failed to save currency", false);
    } finally {
      setSavingCurrency(false);
    }
  }

  // Merge AI rate history from stmtHistory with user rate history
  const combinedRateHistory: (RateHistoryEntry & { label: string })[] = [
    // User manual changes
    ...rateHistory.map((r) => ({
      ...r,
      label: r.note ?? "User override",
    })),
    // AI extracted from each real statement
    ...stmtHistory
      .filter((e) => !e.isCarryForward && e.interestRate !== null)
      .map((e) => ({
        rate: e.interestRate!,
        source: "ai" as const,
        changedAt: e.uploadedAt || `${e.yearMonth}-01T00:00:00.000Z`,
        note: `Extracted from ${shortMonth(e.yearMonth)} statement`,
        label: shortMonth(e.yearMonth),
      })),
  ].sort((a, b) => b.changedAt.localeCompare(a.changedAt));

  const filteredHistory = baselineMonth
    ? history.filter((h) => h.yearMonth >= baselineMonth)
    : history;

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error || !data || !yearMonth) return (
    <div className="mx-auto max-w-4xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-800">{error || "No data for this account."}</p>
        <Link href="/account/accounts" className="mt-4 inline-block text-purple-600 hover:underline">Back to accounts</Link>
      </div>
    </div>
  );

  const accountType      = data.accountType ?? "other";
  const isDebtAccount    = DEBT_TYPES.has(accountType);
  const isInvestment     = accountType === "investment";
  const currency         = (data as ParsedStatementData & { currency?: string }).currency ?? "CAD";
  const isForeignCurrency = currency !== "CAD";
  // Live FX rate for this account's currency (undefined if CAD or rate not yet fetched)
  const fxRate           = isForeignCurrency ? fxRates[currency.toUpperCase()] : undefined;
  const rawBalance       = data.netWorth ?? 0;
  const cadEquivalent    = fxRate ? rawBalance * fxRate : null;
  const hasIncome        = !isInvestment && (accountType === "checking" || accountType === "savings" || (data.income?.total ?? 0) > 0);
  // Investment accounts contain fund transactions (buys, sells, dividends) that the
  // parser may surface as "expenses" — these are portfolio activity, not spending.
  // Exclude them entirely so the Expenses card / Spent KPI don't show for investments.
  const hasSpending      = !isInvestment && (
    ["checking", "savings", "credit", "loan"].includes(accountType) ||
    (data.expenses?.total ?? 0) > 0 || (data.subscriptions?.length ?? 0) > 0
  );

  // "Spent this month" = all expense transactions on this account, matching ExpensesCard below.
  const spentThisMonth = data.expenses?.total ?? 0;
  const spentThisMonthCount = data.expenses?.transactions?.length ?? 0;
  const linkedAssets      = manualAssets.filter((a) => a.linkedAccountSlug === slug);
  const linkedAssetsTotal = linkedAssets.reduce((s, a) => s + a.value, 0);
  // Use data.debts (raw debt balance, never inflated by linked assets) rather than
  // Math.abs(data.netWorth) which becomes the equity value once an asset is linked.
  const outstandingDebt   = data.debts ?? Math.abs(data.netWorth ?? 0);
  const equity            = linkedAssetsTotal - outstandingDebt;
  // previousMonth.debts is already a positive number — no Math.abs needed.
  const prevDebt          = previousMonth ? (previousMonth.debts ?? Math.abs(previousMonth.netWorth)) : null;
  const paidDown          = prevDebt !== null ? prevDebt - outstandingDebt : null;
  const carryForwardCount = stmtHistory.filter((e) => e.isCarryForward).length;
  const backfillCount     = stmtHistory.filter((e) => e.note === "Estimated (backfilled)").length;

  const freqConfig = PAYMENT_FREQ_OPTIONS.find((f) => f.value === paymentFrequency) ?? PAYMENT_FREQ_OPTIONS[3];
  const perPaymentInterest = effectiveRate !== null && outstandingDebt > 0
    ? (outstandingDebt * effectiveRate) / 100 / freqConfig.perYear
    : null;

  // Months with real uploaded statements — used for pills + transaction tab
  const realMonths = stmtHistory
    .filter((e) => !e.isCarryForward && !e.isManualSnapshot)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  const txns = txData?.transactions ?? [];

  return (
    <div className="mx-auto max-w-2xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg text-sm font-medium transition-all ${
          toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"
        }`}>
          <span>{toast.ok ? "✓" : "✕"}</span>
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="mb-3 flex items-center gap-2 text-sm text-gray-500">
        <Link href={isDebtAccount ? "/account/liabilities?tab=accounts" : "/account/assets?tab=accounts"} className="hover:text-purple-600">Accounts</Link>
        <span>/</span>
        <span className="font-medium text-gray-700">{data.accountName ?? data.bankName ?? slug}</span>
      </div>

      {/* Account header */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLOR[accountType] ?? TYPE_COLOR.other}`}>
          {TYPE_LABEL[accountType] ?? accountType}
        </span>
        {data.bankName && <span className="text-sm text-gray-500">{data.bankName}</span>}
        {data.accountId && data.accountId !== "unknown" && <span className="text-sm text-gray-400">{data.accountId}</span>}
        {/* Currency badge — always shown, clickable to change */}
        <button
          onClick={() => { setSelectedCurrency(currency); setShowCurrencyModal(true); }}
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition hover:ring-2 hover:ring-offset-1 ${
            isForeignCurrency
              ? "bg-amber-100 text-amber-700 hover:ring-amber-300"
              : "bg-gray-100 text-gray-500 hover:ring-gray-300"
          }`}
          title="Change account currency"
        >
          {currency}
        </button>
      </div>

      {/* Foreign currency banner */}
      {isForeignCurrency && (
        <div className="mt-3 mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="text-xs text-amber-800 space-y-0.5">
            {fxRate && cadEquivalent !== null ? (
              <>
                <p>
                  Balance {fmt(rawBalance, currency)} = <strong>{fmt(cadEquivalent, "CAD")} CAD</strong>{" "}
                  <span className="text-amber-600">(1 {currency} = {fxRate.toFixed(4)} CAD, refreshed daily)</span>
                </p>
                <p className="text-amber-700">Your net worth already includes this account converted to CAD.</p>
              </>
            ) : (
              <p>
                Balances are in <strong>{currency}</strong>. Net worth will be converted to CAD.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Currency change modal */}
      {showCurrencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Set account currency</h2>
            <p className="text-sm text-gray-500 mb-4">
              Choose the currency this account is denominated in. Balances will be converted to CAD for net worth calculations using a daily exchange rate.
            </p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {["CAD", "USD", "EUR", "GBP", "AUD", "CHF"].map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCurrency(c)}
                  className={`rounded-lg border py-2 text-sm font-semibold transition ${
                    selectedCurrency === c
                      ? "border-purple-500 bg-purple-50 text-purple-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            {selectedCurrency !== currency && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Changing currency will rebuild your financial profile. Net worth and history will update within a few seconds.
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCurrencyModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => saveCurrency(selectedCurrency)}
                disabled={savingCurrency || selectedCurrency === currency}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition flex items-center gap-2"
              >
                {savingCurrency && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                {savingCurrency ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
      <p className="text-sm text-gray-500">
        As of {monthLabel(yearMonth)}
        {statementCount > 0 && ` · ${statementCount} statement${statementCount !== 1 ? "s" : ""}`}
      </p>

      {/* Month pills */}
      {realMonths.length > 1 && (
        <div className="mt-4 -mx-1 flex gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          {realMonths.map((e) => (
            <button key={e.yearMonth} onClick={() => handleTxMonthSelect(e.yearMonth)}
              className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-medium transition ${
                txMonth === e.yearMonth ? "bg-purple-600 text-white" : "bg-gray-100 text-gray-500 hover:bg-gray-200"
              }`}>
              {shortMonth(e.yearMonth)} {e.yearMonth.slice(2, 4)}
            </button>
          ))}
        </div>
      )}

      {/* Tab bar */}
      <div className="mt-5 mb-6 flex border-b border-gray-200">
        {([
          { id: "overview",     label: "Overview" },
          { id: "transactions", label: "Transactions", count: txns.length },
          { id: "history",      label: "History", count: stmtHistory.length },
        ] as { id: string; label: string; count?: number }[]).map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as "overview" | "transactions" | "history")}
            className={`relative mr-5 pb-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "text-gray-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-gray-900 after:content-['']"
                : "text-gray-400 hover:text-gray-600"
            }`}>
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <>

      {/* Backfill estimated history banner */}
      {backfillCount > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1 min-w-0 text-sm">
            <p className="font-medium text-blue-900">
              {backfillCount} month{backfillCount !== 1 ? "s" : ""} of estimated history
            </p>
            <p className="mt-0.5 text-blue-700">
              Shown as a dashed line on the chart. Based on the balance from your first uploaded statement.{" "}
              <Link href="/upload" className="font-medium underline hover:text-blue-900">
                Upload older statements
              </Link>{" "}
              to make it accurate.
            </p>
          </div>
        </div>
      )}

      {/* Incomplete months banner */}
      {carryForwardCount > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="text-sm">
            <p className="font-medium text-amber-800">{carryForwardCount} month{carryForwardCount !== 1 ? "s" : ""} estimated</p>
            <p className="mt-0.5 text-amber-700">
              Months marked <span className="font-medium">~estimated</span> use the most recent uploaded balance.
            </p>
          </div>
        </div>
      )}

      {/* ── Equity card for mortgage/loan ───────────────────────────────────── */}
      {isDebtAccount && linkedAssets.length > 0 && (
        <div className="mb-6 rounded-xl border border-purple-200 bg-purple-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 mb-3">Equity breakdown</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {linkedAssets.map((a) => (
              <div key={a.id} className="rounded-lg bg-white p-3 shadow-sm">
                <p className="text-xs text-gray-500 truncate">{a.label}</p>
                <p className="font-bold text-gray-900">{fmt(a.value)}</p>
                <Link href="/account/assets" className="text-xs text-purple-500 hover:underline">Edit →</Link>
              </div>
            ))}
            <div className="rounded-lg bg-white p-3 shadow-sm">
              <p className="text-xs text-gray-500">Outstanding balance</p>
              <p className="font-bold text-red-600">−{fmt(outstandingDebt)}</p>
            </div>
            <div className={`rounded-lg p-3 shadow-sm ${equity >= 0 ? "bg-green-50" : "bg-red-50"}`}>
              <p className="text-xs text-gray-500">Your equity</p>
              <p className={`font-bold text-lg ${equity >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt(equity)}</p>
            </div>
          </div>
        </div>
      )}

      {isDebtAccount && linkedAssets.length === 0 && (
        <div className="mb-6 rounded-xl border-2 border-dashed border-purple-200 bg-purple-50/50 p-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-gray-900">
              {accountType === "mortgage" ? "🏠 What's your property worth?" : "🚗 Add the asset behind this loan"}
            </p>
            <p className="mt-0.5 text-sm text-gray-600">Link an asset to calculate your true equity.</p>
          </div>
          <Link
            href={`/account/assets?link=${slug}&category=${accountType === "mortgage" ? "property" : "vehicle"}`}
            className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
          >
            Add asset
          </Link>
        </div>
      )}

      {/* ── KPI cards ────────────────────────────────────────────────────────── */}
      {isDebtAccount ? (
        /* Debt-specific KPIs: Outstanding Balance | Paid Down | Interest Rate */
        <div className="grid grid-cols-3 gap-4 mb-6">
          {/* Outstanding Balance */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Outstanding Balance</p>
            <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(outstandingDebt, currency)}</p>
            {paidDown !== null && paidDown !== 0 && (
              <p className={`mt-1.5 text-xs font-medium ${paidDown > 0 ? "text-green-600" : "text-red-500"}`}>
                {paidDown > 0 ? "↓" : "↑"} {fmt(Math.abs(paidDown), currency)} {paidDown > 0 ? "paid down" : "more debt"} vs prev month
              </p>
            )}
            {paidDown === null && (
              <p className="mt-1.5 text-xs text-gray-400">First month tracked</p>
            )}
          </div>

          {/* Payments Made / Paid Down */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {txPayments > 0 ? "Payments Made" : paidDown !== null && paidDown > 0 ? "Principal Paid" : "Balance Change"}
            </p>
            <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">
              {txPayments > 0
                ? fmt(txPayments)
                : paidDown !== null
                  ? fmt(Math.abs(paidDown))
                  : (data.expenses?.total ? fmt(data.expenses.total) : "—")}
            </p>
            <p className="mt-1.5 text-xs text-gray-400">
              {txPayments > 0
                ? "total paid this period"
                : paidDown !== null && paidDown > 0
                  ? "principal reduction"
                  : "vs previous statement"}
            </p>
          </div>

          {/* Interest Rate — compact card with history popover */}
          {(isDebtAccount || accountType === "savings" || accountType === "investment") && idToken && accountKey && (
            <div className="relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {isDebtAccount ? "Interest Rate (APR)" : "Return Rate (APY)"}
                </p>
                {combinedRateHistory.length > 0 && (
                  <button
                    onClick={() => setShowRateHistory((v) => !v)}
                    className="shrink-0 rounded-md border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 hover:border-purple-300 hover:text-purple-600 transition"
                  >
                    History
                  </button>
                )}
              </div>
              <AprEditor
                accountKey={accountKey}
                currentRate={effectiveRate}
                extractedRate={extractedRate}
                token={idToken}
                onSaved={(rate) => {
                  setEffectiveRate(rate ?? extractedRate);
                  fetch(`/api/user/account-rates/history?accountKey=${encodeURIComponent(accountKey)}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                  })
                    .then((r) => r.json())
                    .then((j) => setRateHistory(j.history ?? []))
                    .catch(() => {});
                }}
              />
              {perPaymentInterest !== null ? (
                <p className="mt-1.5 text-xs text-gray-400">≈ {fmt(perPaymentInterest)} interest/{freqConfig.label.toLowerCase()}</p>
              ) : (
                <p className="mt-1.5 text-xs text-gray-400">
                  {effectiveRate !== null ? "User-set" : extractedRate !== null ? "From statement" : "Not set"}
                </p>
              )}

              {/* History popover */}
              {showRateHistory && combinedRateHistory.length > 0 && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowRateHistory(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-xl border border-gray-200 bg-white shadow-lg p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Rate history</p>
                    <div className="space-y-2">
                      {combinedRateHistory.map((entry, i) => {
                        const prev = combinedRateHistory[i + 1];
                        const change = prev ? entry.rate - prev.rate : null;
                        return (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.source === "user" ? "bg-purple-400" : "bg-teal-400"}`} />
                              <span className="text-xs text-gray-500 truncate">
                                {entry.source === "user" ? "User override" : entry.note ?? "From statement"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {change !== null && change !== 0 && (
                                <span className={`text-[10px] font-medium ${change > 0 ? "text-red-500" : "text-green-600"}`}>
                                  {change > 0 ? "↑" : "↓"}{Math.abs(change).toFixed(2)}%
                                </span>
                              )}
                              <span className="text-xs font-semibold text-gray-900">{entry.rate}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[10px] text-gray-400 flex items-center gap-3">
                      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-teal-400 inline-block" /> From statement</span>
                      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-purple-400 inline-block" /> User override</span>
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : isInvestment ? (
        /* Investment account KPIs: Portfolio Value · Change · Return Rate */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
          {/* Portfolio Value */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Portfolio Value</p>
            <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(data.netWorth ?? 0, currency)}</p>
            {(() => {
              const delta = previousMonth != null ? (data.netWorth ?? 0) - previousMonth.netWorth : null;
              if (delta === null) return <p className="mt-1.5 text-xs text-gray-400">First month tracked</p>;
              if (delta === 0)    return <p className="mt-1.5 text-xs text-gray-400">No change</p>;
              const abs = Math.abs(delta);
              const label = abs >= 1000 ? `${delta > 0 ? "+" : "−"}${CURRENCY_SYMBOL[currency] ?? "$"}${Math.round(abs / 1000)}k` : `${delta > 0 ? "+" : "−"}${fmt(abs, currency)}`;
              return <p className={`mt-1.5 text-xs font-medium ${delta > 0 ? "text-green-600" : "text-red-500"}`}>{delta > 0 ? "↑" : "↓"} {label} vs last month</p>;
            })()}
          </div>

          {/* Contributions this period (income = contributions/transfers in) */}
          {(data.income?.total ?? 0) > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Contributions</p>
              <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(data.income?.total ?? 0, currency)}</p>
              <p className="mt-1.5 text-xs text-gray-400">deposits &amp; transfers in</p>
            </div>
          )}

          {/* Return Rate (APY) */}
          {idToken && accountKey && (
            <div className="relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Return Rate (APY)</p>
              <AprEditor
                accountKey={accountKey}
                currentRate={effectiveRate}
                extractedRate={extractedRate}
                token={idToken}
                onSaved={(rate) => {
                  setEffectiveRate(rate ?? extractedRate);
                  fetch(`/api/user/account-rates/history?accountKey=${encodeURIComponent(accountKey)}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                  })
                    .then((r) => r.json())
                    .then((j) => setRateHistory(j.history ?? []))
                    .catch(() => {});
                }}
              />
              <p className="mt-1.5 text-xs text-gray-400">
                {effectiveRate !== null ? "User-set" : extractedRate !== null ? "From statement" : "Not set"}
              </p>
            </div>
          )}
        </div>
      ) : (
        /* Per-account KPIs: Balance · Income · Spent */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
          {/* Balance */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Balance</p>
            <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(data.netWorth ?? 0, currency)}</p>
            {(() => {
              const delta = previousMonth != null ? (data.netWorth ?? 0) - previousMonth.netWorth : null;
              if (delta === null) return <p className="mt-1.5 text-xs text-gray-400">First month tracked</p>;
              if (delta === 0)    return <p className="mt-1.5 text-xs text-gray-400">No change</p>;
              const abs = Math.abs(delta);
              const label = abs >= 1000 ? `${delta > 0 ? "+" : "−"}${CURRENCY_SYMBOL[currency] ?? "$"}${Math.round(abs / 1000)}k` : `${delta > 0 ? "+" : "−"}${fmt(abs, currency)}`;
              return <p className={`mt-1.5 text-xs font-medium ${delta > 0 ? "text-green-600" : "text-red-500"}`}>{delta > 0 ? "↑" : "↓"} {label} vs last month</p>;
            })()}
          </div>

          {/* Income — only for accounts that receive deposits */}
          {hasIncome && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Income this month</p>
              <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(data.income?.total ?? 0, currency)}</p>
              {data.income?.total ? (
                <p className="mt-1.5 text-xs text-gray-400">deposits &amp; transfers in</p>
              ) : (
                <p className="mt-1.5 text-xs text-gray-400">No deposits this month</p>
              )}
            </div>
          )}

          {/* Spent */}
          {hasSpending && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Spent this month</p>
              <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(spentThisMonth, currency)}</p>
              {spentThisMonth > 0 ? (
                <p className="mt-1.5 text-xs text-gray-400">{spentThisMonthCount} transactions incl. transfers</p>
              ) : (
                <p className="mt-1.5 text-xs text-gray-400">No expenses this month</p>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Payment frequency strip (debt accounts only) ─────────────────── */}
      {isDebtAccount && (
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 shrink-0">Payment frequency</span>
          <div className="flex gap-1.5 flex-wrap">
            {PAYMENT_FREQ_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleFrequencyChange(opt.value)}
                disabled={savingFreq}
                className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
                  paymentFrequency === opt.value
                    ? "bg-purple-600 text-white"
                    : "border border-gray-200 text-gray-500 hover:border-purple-300 hover:text-purple-600"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {savingFreq && <span className="text-xs text-gray-400">Saving…</span>}
        </div>
      )}

      {/* Sub-account breakdown (e.g. HELOC revolving + mortgage term portions) */}
      {isDebtAccount && data.subAccounts && data.subAccounts.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <p className="px-5 pt-4 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Breakdown</p>
          <div className="divide-y divide-gray-100">
            {data.subAccounts.map((sub) => (
              <div key={sub.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{sub.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    <span className="capitalize">{sub.type}</span>
                    {sub.apr != null ? ` · ${sub.apr}% APR` : ""}
                    {sub.maturityDate ? ` · matures ${new Date(sub.maturityDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : ""}
                  </p>
                </div>
                <div className="ml-4 text-right shrink-0">
                  <p className="text-sm font-semibold text-gray-900 tabular-nums">{fmt(sub.balance)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {data.netWorth ? `${Math.round((sub.balance / Math.abs(data.netWorth)) * 100)}% of total` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Investment holdings breakdown ────────────────────────────────── */}
      {isInvestment && (data.holdings ?? []).length > 0 && (
        <HoldingsCard holdings={data.holdings!} totalValue={data.netWorth ?? 0} />
      )}

      {/* Balance trend chart */}
      {filteredHistory.length >= 2 && (
        <div className="mt-2 mb-6">
          <NetWorthChart history={filteredHistory} isDebt={isDebtAccount} />
        </div>
      )}

      {/* Spending cards */}
      {hasSpending && (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div className="space-y-6">
            {hasIncome && <IncomeCard income={data.income} />}
            <ExpensesCard expenses={data.expenses} />
          </div>
          <div className="space-y-6">
            {hasIncome && <SavingsRateCard data={data} />}
            <SubscriptionsCard subscriptions={data.subscriptions ?? []} />
          </div>
        </div>
      )}

      <InsightsSection insights={data.insights ?? []} />

      </> /* end overview tab */}

      {/* ── HISTORY TAB ──────────────────────────────────────────────────── */}
      {activeTab === "history" && stmtHistory.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-gray-500">{stmtHistory.length} entr{stmtHistory.length !== 1 ? "ies" : "y"}</p>
            <div className="flex items-center gap-2">
              {baselineMonth && (
                <button onClick={() => handleSetBaseline(baselineMonth)} className="text-xs text-purple-600 hover:underline">
                  Clear baseline
                </button>
              )}
              <button
                onClick={() => setShowCsvImport((v) => !v)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${showCsvImport ? "border-teal-300 bg-teal-50 text-teal-700 hover:bg-teal-100" : "border-gray-200 text-gray-600 hover:border-teal-300 hover:bg-teal-50 hover:text-teal-700"}`}
              >
                {showCsvImport ? "✕ Cancel import" : "+ Import CSV"}
              </button>
              <button
                onClick={openSnapshotForm}
                className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-600 hover:bg-purple-100 transition"
              >
                + Update balance
              </button>
              <Link
                href="/account/debug"
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-400 hover:border-amber-300 hover:bg-amber-50 hover:text-amber-600 transition"
                title="Open parse debugger"
              >
                🔍 Debug parse
              </Link>
            </div>
          </div>

          {/* Inline CSV import panel */}
          {showCsvImport && idToken && (
            <div className="rounded-xl border border-teal-200 bg-teal-50/30 p-5">
              <CsvImportPanel idToken={idToken} preselectedAccountSlug={slug}
                onReset={() => setShowCsvImport(false)}
                onImportComplete={() => idToken && loadAccountData(idToken)} />
            </div>
          )}
          {baselineMonth && (
            <p className="text-xs text-gray-400">
              Trend starts from <span className="font-medium text-gray-600">{shortMonth(baselineMonth)}</span>.
            </p>
          )}
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Month</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Balance</th>
                  {isDebtAccount && (
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">APR</th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Baseline</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...stmtHistory].reverse().map((entry) => {
                  const isBaseline    = baselineMonth === entry.yearMonth;
                  const beforeBaseline = baselineMonth != null && entry.yearMonth < baselineMonth;
                  // Determine if APR changed from previous row
                  const allReal = [...stmtHistory].filter((e) => !e.isCarryForward && !e.isManualSnapshot);
                  const prevReal = allReal[allReal.findIndex((e) => e.yearMonth === entry.yearMonth) + 1];
                  const rateChanged = entry.interestRate !== null && prevReal?.interestRate !== null &&
                    entry.interestRate !== prevReal?.interestRate;
                  return (
                    <tr key={entry.isManualSnapshot ? `snap-${entry.snapshotId}` : entry.yearMonth}
                      className={`transition ${beforeBaseline ? "opacity-40" : ""} ${entry.isManualSnapshot ? "bg-purple-50/30" : ""} ${reparsingId === entry.statementId ? "bg-yellow-50 opacity-60" : ""}`}>
                      <td className="px-4 py-3 font-medium text-gray-800">{shortMonth(entry.yearMonth)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                        <span className={entry.isCarryForward ? "text-gray-400" : ""}>
                          {fmt(entry.netWorth, currency)}
                        </span>
                      </td>
                      {isDebtAccount && (
                        <td className="px-4 py-3 text-right">
                          {entry.interestRate !== null ? (
                            <span className={`text-sm tabular-nums ${rateChanged ? "font-semibold text-amber-600" : "text-gray-700"}`}>
                              {entry.interestRate}%
                              {rateChanged && <span className="ml-1 text-xs">↑</span>}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        {entry.isManualSnapshot ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-600">
                            ✎ manual
                          </span>
                        ) : entry.note === "Estimated (backfilled)" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                            ⟵ backfilled
                          </span>
                        ) : entry.isCarryForward ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                            ~ estimated
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
                            ✓ uploaded
                          </span>
                        )}
                        {entry.note && entry.note !== "Estimated (backfilled)" && (
                          <span className="ml-1.5 text-xs text-gray-400 italic" title={entry.note}>"{entry.note}"</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!entry.isManualSnapshot && (
                          <button
                            onClick={() => handleSetBaseline(entry.yearMonth)}
                            className={`rounded-full px-2 py-0.5 text-xs font-medium transition ${
                              isBaseline ? "bg-purple-100 text-purple-700" : "text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                            }`}
                          >
                            {isBaseline ? "● baseline" : "set baseline"}
                          </button>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {entry.isManualSnapshot && entry.snapshotId ? (
                          <button
                            onClick={() => handleDeleteSnapshot(entry.snapshotId!)}
                            disabled={deletingSnap === entry.snapshotId}
                            className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-40"
                          >
                            {deletingSnap === entry.snapshotId ? "…" : "Delete"}
                          </button>
                        ) : !entry.isCarryForward && entry.statementId ? (
                          <div className="flex items-center justify-end gap-2">
                            {entry.source !== "csv" && (
                              <button
                                onClick={() => handleViewFile(entry.statementId)}
                                className="text-xs text-purple-500 hover:underline"
                                title="Open original uploaded document"
                              >
                                View
                              </button>
                            )}
                            {entry.source === "csv" ? (
                              <span className="text-[10px] rounded-full bg-teal-50 border border-teal-200 px-2 py-0.5 text-teal-600 font-medium">CSV</span>
                            ) : (
                              <button
                                onClick={() => handleReparse(entry.statementId)}
                                disabled={reparsingId === entry.statementId || deletingId === entry.statementId}
                                className="text-xs text-blue-400 hover:text-blue-600 disabled:opacity-40 flex items-center gap-1"
                                title="Re-extract data from the original PDF with latest AI logic"
                              >
                                {reparsingId === entry.statementId
                                  ? <><span className="animate-spin inline-block">↻</span> Parsing…</>
                                  : "Re-parse"}
                              </button>
                            )}
                            <button
                              onClick={() => handleDelete(entry.statementId)}
                              disabled={deletingId === entry.statementId || reparsingId === entry.statementId}
                              className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-40"
                            >
                              {deletingId === entry.statementId ? "…" : "Delete"}
                            </button>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            <span className="font-medium text-gray-500">Set baseline</span> to exclude older months from the trend chart.
          </p>
        </div>
      )}

      {/* ── TRANSACTIONS TAB ──────────────────────────────────────────────── */}
      {activeTab === "transactions" && (
        <div>
          {isInvestment && (
            <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5">
              <p className="text-xs text-blue-700">
                <span className="font-semibold">Portfolio activity</span> — these are fund transactions (buys, sells, dividends, transfers), not personal expenses.
              </p>
            </div>
          )}
          {txPayments > 0 && (
            <div className="mb-4 rounded-lg bg-blue-50 border border-blue-100 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-medium text-blue-700">Payments received</span>
              <span className="text-sm font-semibold text-blue-900">{fmt(txPayments)}</span>
            </div>
          )}
          {txLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
            </div>
          ) : txns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-12 text-center">
              <p className="text-sm text-gray-400">No transactions for {txMonth ? shortMonth(txMonth) : "this month"}.</p>
              <p className="mt-1 text-xs text-gray-400">Upload a statement or select a different month above.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="divide-y divide-gray-100">
                {txns.map((txn, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{txn.merchant}</p>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {txn.date && <span className="text-xs text-gray-400">{fmtDate(txn.date)}</span>}
                        {txn.category && <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">{txn.category}</span>}
                        {txn.recurring && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-600">↻ {txn.recurring}</span>}
                      </div>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{fmt(txn.amount, currency)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-gray-400">{txns.length} transaction{txns.length !== 1 ? "s" : ""}</span>
                <span className="text-xs font-semibold text-gray-700">{fmt(txData?.total ?? 0, currency)} total</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Add balance entry modal ────────────────────────────────────────── */}
      {showSnapshotForm && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Add balance entry</h3>
                <p className="text-sm text-gray-400 mt-0.5">{data?.accountName ?? slug}</p>
              </div>
              <button onClick={() => setShowSnapshotForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            <div className="mb-4 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 text-xs text-blue-700">
              <strong>Statement data stays intact.</strong> This entry only updates the displayed balance for the selected month. Your next uploaded statement will take over automatically.
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Balance {isDebtAccount ? "(enter what you owe)" : ""}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={snapBalance}
                  onChange={(e) => setSnapBalance(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
            </div>

            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">As of month</label>
              <input
                type="month"
                value={snapMonth}
                onChange={(e) => setSnapMonth(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>

            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Note <span className="font-normal text-gray-400">(optional)</span></label>
              <input
                type="text"
                value={snapNote}
                onChange={(e) => setSnapNote(e.target.value)}
                placeholder="e.g. Checked online banking today"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>

            {snapError && <p className="mb-3 text-sm text-red-600">{snapError}</p>}

            <div className="flex gap-3">
              <button onClick={() => setShowSnapshotForm(false)}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition">
                Cancel
              </button>
              <button onClick={handleSaveSnapshot} disabled={snapSaving}
                className="flex-1 rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition disabled:opacity-50">
                {snapSaving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
