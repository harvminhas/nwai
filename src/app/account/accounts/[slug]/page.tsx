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
import type { ParsedStatementData, ManualAsset } from "@/lib/types";
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
function fmt(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}
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
        const priority = e.isCarryForward ? 0 : e.isManualSnapshot ? 1 : 2;
        const existing = monthMap.get(e.yearMonth);
        if (!existing || priority > existing.priority) {
          monthMap.set(e.yearMonth, {
            yearMonth: e.yearMonth,
            netWorth: e.netWorth,
            isEstimate: e.isCarryForward,
            priority,
          });
        }
      }
      const chartHistory = Array.from(monthMap.values())
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
        .map(({ yearMonth, netWorth, isEstimate }) => ({ yearMonth, netWorth, isEstimate }));
      setHistory(chartHistory);

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
        (h: { yearMonth: string; netWorth: number; expensesTotal?: number }) => ({
          ...h,
          isEstimate: acctHistory.find((e) => e.yearMonth === h.yearMonth)?.isCarryForward ?? false,
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
      setHistory((rJson.history ?? []).map((h: { yearMonth: string; netWorth: number; expensesTotal?: number }) => ({
        ...h,
        isEstimate: acctHistory.find((e) => e.yearMonth === h.yearMonth)?.isCarryForward ?? false,
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

  const accountType    = data.accountType ?? "other";
  const isDebtAccount  = DEBT_TYPES.has(accountType);
  const hasIncome      = accountType === "checking" || accountType === "savings" || (data.income?.total ?? 0) > 0;
  // "loan" included because HELOC/LOC accounts have revolving consumer transactions
  const hasSpending    = ["checking", "savings", "credit", "loan"].includes(accountType) ||
    (data.expenses?.total ?? 0) > 0 || (data.subscriptions?.length ?? 0) > 0;

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
      </div>
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
            <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(outstandingDebt)}</p>
            {paidDown !== null && paidDown !== 0 && (
              <p className={`mt-1.5 text-xs font-medium ${paidDown > 0 ? "text-green-600" : "text-red-500"}`}>
                {paidDown > 0 ? "↓" : "↑"} {fmt(Math.abs(paidDown))} {paidDown > 0 ? "paid down" : "more debt"} vs prev month
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
      ) : (
        /* Per-account KPIs: Balance · Income · Spent */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3 mb-6">
          {/* Balance */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Balance</p>
            <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(data.netWorth ?? 0)}</p>
            {(() => {
              const delta = previousMonth != null ? (data.netWorth ?? 0) - previousMonth.netWorth : null;
              if (delta === null) return <p className="mt-1.5 text-xs text-gray-400">First month tracked</p>;
              if (delta === 0)    return <p className="mt-1.5 text-xs text-gray-400">No change</p>;
              const abs = Math.abs(delta);
              const label = abs >= 1000 ? `${delta > 0 ? "+" : "−"}$${Math.round(abs / 1000)}k` : `${delta > 0 ? "+" : "−"}${fmt(abs)}`;
              return <p className={`mt-1.5 text-xs font-medium ${delta > 0 ? "text-green-600" : "text-red-500"}`}>{delta > 0 ? "↑" : "↓"} {label} vs last month</p>;
            })()}
          </div>

          {/* Income — only for accounts that receive deposits */}
          {hasIncome && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Income this month</p>
              <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(data.income?.total ?? 0)}</p>
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
              <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">{fmt(spentThisMonth)}</p>
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
                          {fmt(entry.netWorth)}
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
                        ) : entry.isCarryForward ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                            ~ estimated
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
                            ✓ uploaded
                          </span>
                        )}
                        {entry.note && (
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
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{fmt(txn.amount)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-gray-400">{txns.length} transaction{txns.length !== 1 ? "s" : ""}</span>
                <span className="text-xs font-semibold text-gray-700">{fmt(txData?.total ?? 0)} total</span>
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
