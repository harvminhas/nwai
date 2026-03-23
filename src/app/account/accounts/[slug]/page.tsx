"use client";

import { useEffect, useState, useRef } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ConsolidatedProgressHero from "@/components/ConsolidatedProgressHero";
import NetWorthChart from "@/components/NetWorthChart";
import IncomeCard from "@/components/IncomeCard";
import ExpensesCard from "@/components/ExpensesCard";
import SavingsRateCard from "@/components/SavingsRateCard";
import SubscriptionsCard from "@/components/SubscriptionsCard";
import InsightsSection from "@/components/InsightsSection";
import type { ParsedStatementData, ManualAsset } from "@/lib/types";
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
  const bank = bankName.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const acct = (accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return acct !== "unknown" ? `${bank}__${acct}` : bank;
}

// ── types ─────────────────────────────────────────────────────────────────────

interface StatementHistoryEntry {
  yearMonth: string;
  netWorth: number;
  uploadedAt: string;
  statementId: string;
  isCarryForward: boolean;
  interestRate: number | null;
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

  // APR / frequency state
  const [effectiveRate, setEffectiveRate]       = useState<number | null>(null);
  const [extractedRate, setExtractedRate]       = useState<number | null>(null);
  const [accountKey, setAccountKey]             = useState<string>("");
  const [rateHistory, setRateHistory]           = useState<RateHistoryEntry[]>([]);
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>("monthly");
  const [savingFreq, setSavingFreq]             = useState(false);

  // Balance snapshot state
  const [showSnapshotForm,  setShowSnapshotForm]  = useState(false);
  const [snapBalance,       setSnapBalance]       = useState("");
  const [snapMonth,         setSnapMonth]         = useState("");
  const [snapNote,          setSnapNote]          = useState("");
  const [snapSaving,        setSnapSaving]        = useState(false);
  const [snapError,         setSnapError]         = useState<string | null>(null);
  const [deletingSnap,      setDeletingSnap]      = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const token = await user.getIdToken();
      setIdToken(token);
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

        const acctHistory: StatementHistoryEntry[] = json.accountStatementHistory?.[slug] ?? [];
        setStmtHistory(acctHistory);

        const chartHistory = (Array.isArray(json.history) ? json.history : []).map(
          (h: { yearMonth: string; netWorth: number; expensesTotal?: number }) => ({
            ...h,
            isEstimate: acctHistory.find((e) => e.yearMonth === h.yearMonth)?.isCarryForward ?? false,
          })
        );
        setHistory(chartHistory);

        const saved = localStorage.getItem(`baseline-${slug}`);
        if (saved) setBaselineMonth(saved);

        // Load APR for this account
        const parsed = json.data as ParsedStatementData | null;
        if (parsed?.bankName) {
          const key = toAccountKey(parsed.bankName, parsed.accountId);
          setAccountKey(key);

          // Fetch current effective rate
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
            // Fall back to rate embedded in parsed data
            setExtractedRate(typeof parsed.interestRate === "number" ? parsed.interestRate : null);
            setEffectiveRate(typeof parsed.interestRate === "number" ? parsed.interestRate : null);
          }

          // Fetch user rate change history
          const histRes = await fetch(
            `/api/user/account-rates/history?accountKey=${encodeURIComponent(key)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const histJson = await histRes.json().catch(() => ({}));
          setRateHistory(histJson.history ?? []);
        }
      } catch { setError("Failed to load account"); }
      finally { setLoading(false); }
    });
  }, [router, slug]);

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
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-800">{error || "No data for this account."}</p>
        <Link href="/account/accounts" className="mt-4 inline-block text-purple-600 hover:underline">Back to accounts</Link>
      </div>
    </div>
  );

  const accountType    = data.accountType ?? "other";
  const isDebtAccount  = DEBT_TYPES.has(accountType);
  const hasIncome      = accountType === "checking" || accountType === "savings" || (data.income?.total ?? 0) > 0;
  const hasSpending    = ["checking", "savings", "credit"].includes(accountType) ||
    (data.expenses?.total ?? 0) > 0 || (data.subscriptions?.length ?? 0) > 0;
  const linkedAssets      = manualAssets.filter((a) => a.linkedAccountSlug === slug);
  const linkedAssetsTotal = linkedAssets.reduce((s, a) => s + a.value, 0);
  const outstandingDebt   = Math.abs(data.netWorth ?? 0);
  const equity            = linkedAssetsTotal - outstandingDebt;
  const prevDebt          = previousMonth ? Math.abs(previousMonth.debts ?? previousMonth.netWorth) : null;
  const paidDown          = prevDebt !== null ? prevDebt - outstandingDebt : null;
  const carryForwardCount = stmtHistory.filter((e) => e.isCarryForward).length;

  const freqConfig = PAYMENT_FREQ_OPTIONS.find((f) => f.value === paymentFrequency) ?? PAYMENT_FREQ_OPTIONS[3];
  const perPaymentInterest = effectiveRate !== null && outstandingDebt > 0
    ? (outstandingDebt * effectiveRate) / 100 / freqConfig.perYear
    : null;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">

      {/* Breadcrumb */}
      <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
        <Link href="/account/accounts" className="hover:text-purple-600">Accounts</Link>
        <span>/</span>
        <span className="font-medium text-gray-700">{data.accountName ?? data.bankName ?? slug}</span>
      </div>

      {/* Account meta */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLOR[accountType] ?? TYPE_COLOR.other}`}>
          {TYPE_LABEL[accountType] ?? accountType}
        </span>
        {data.bankName && <span className="text-sm text-gray-500">{data.bankName}</span>}
        {data.accountId && data.accountId !== "unknown" && (
          <span className="text-sm text-gray-400">{data.accountId}</span>
        )}
      </div>
      <p className="mb-6 text-sm text-gray-500">
        As of {monthLabel(yearMonth)}
        {statementCount > 0 && ` · ${statementCount} statement${statementCount !== 1 ? "s" : ""}`}
      </p>

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
        /* Debt-specific KPIs: Outstanding Balance + Paid Down */
        <div className="grid grid-cols-2 gap-4 mb-6">
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
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {paidDown !== null && paidDown > 0 ? "Paid Down This Period" : "Monthly Payment"}
            </p>
            <p className="mt-2 font-bold text-2xl text-gray-900 md:text-3xl">
              {paidDown !== null ? fmt(Math.abs(paidDown)) : (data.expenses?.total ? fmt(data.expenses.total) : "—")}
            </p>
            <p className="mt-1.5 text-xs text-gray-400">vs previous statement</p>
          </div>
        </div>
      ) : (
        /* Standard KPI cards for non-debt accounts */
        <ConsolidatedProgressHero
          data={data}
          previousMonth={previousMonth}
          monthLabel={monthLabel(yearMonth)}
        />
      )}

      {/* ── APR / Interest Rate card ──────────────────────────────────────── */}
      {(isDebtAccount || accountType === "savings" || accountType === "investment") && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">
                {isDebtAccount ? "Interest Rate (APR)" : "Return Rate (APY)"}
              </p>
              {idToken && accountKey && (
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
              )}
              <p className="mt-1.5 text-xs text-gray-400">
                {effectiveRate !== null && effectiveRate === extractedRate
                  ? "Extracted from latest statement"
                  : effectiveRate !== null
                  ? "User-set override"
                  : extractedRate !== null
                  ? `AI detected ${extractedRate}% — click Edit to confirm`
                  : "Not found in statement — set manually"}
              </p>
            </div>
            {isDebtAccount && perPaymentInterest !== null && (
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-400">Est. interest per payment</p>
                <p className="text-lg font-bold text-red-600">{fmt(perPaymentInterest)}</p>
                <p className="text-xs text-gray-400">{freqConfig.label} · {freqConfig.perYear}×/yr</p>
              </div>
            )}
          </div>

          {/* Payment frequency selector (debt accounts only) */}
          {isDebtAccount && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <div className="flex items-center gap-3 flex-wrap">
                <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 shrink-0">
                  Payment frequency
                </span>
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
            </div>
          )}

          {/* APR history timeline */}
          {combinedRateHistory.length > 0 && (
            <div className="mt-4 border-t border-gray-100 pt-4">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Rate history</p>
              <div className="space-y-2.5">
                {combinedRateHistory.map((entry, i) => {
                  const prev = combinedRateHistory[i + 1];
                  const change = prev ? entry.rate - prev.rate : null;
                  return (
                    <div key={i} className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className={`h-2 w-2 shrink-0 rounded-full ${
                          entry.source === "user" ? "bg-purple-400" : "bg-teal-400"
                        }`} />
                        <span className="text-xs text-gray-500">{fmtDate(entry.changedAt)}</span>
                        <span className="text-xs text-gray-400 truncate">
                          {entry.source === "user" ? "User override" : entry.note ?? "From statement"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        {change !== null && change !== 0 && (
                          <span className={`text-xs font-medium ${change > 0 ? "text-red-500" : "text-green-600"}`}>
                            {change > 0 ? "↑" : "↓"} {Math.abs(change).toFixed(2)}%
                          </span>
                        )}
                        <span className="text-sm font-semibold text-gray-900">{entry.rate}%</span>
                      </div>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-gray-400">
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-teal-400 inline-block" /> From statement
                </span>
                <span className="mx-2">·</span>
                <span className="inline-flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-purple-400 inline-block" /> User override
                </span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Balance trend chart */}
      {filteredHistory.length >= 2 && (
        <div className="mt-2 mb-6">
          <NetWorthChart history={filteredHistory} />
        </div>
      )}

      {/* ── Statement history table ─────────────────────────────────────────── */}
      {stmtHistory.length > 0 && (
        <div className="mt-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Statement history</h2>
            <div className="flex items-center gap-3">
              {baselineMonth && (
                <button onClick={() => handleSetBaseline(baselineMonth)} className="text-xs text-purple-600 hover:underline">
                  Clear baseline
                </button>
              )}
              <button
                onClick={openSnapshotForm}
                className="rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-600 hover:bg-purple-100 transition"
              >
                + Update balance
              </button>
            </div>
          </div>
          {baselineMonth && (
            <p className="mb-3 text-xs text-gray-400">
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
                      className={`transition ${beforeBaseline ? "opacity-40" : ""} ${entry.isManualSnapshot ? "bg-purple-50/30" : ""}`}>
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
                            <Link href={`/dashboard/${entry.statementId}`} className="text-xs text-purple-500 hover:underline">View</Link>
                            <button
                              onClick={() => handleDelete(entry.statementId)}
                              disabled={deletingId === entry.statementId}
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
          <p className="mt-2 text-xs text-gray-400">
            <span className="font-medium text-gray-500">Set baseline</span> to exclude older months from the trend chart.
          </p>
        </div>
      )}

      {/* Spending section (checking/savings/credit only) */}
      {hasSpending && (
        <>
          <div className="mb-6 mt-10">
            <h2 className="font-semibold text-lg text-gray-900">
              {hasIncome ? "Income & spending" : "Spending"}
            </h2>
            <p className="text-sm text-gray-500">From latest statements for this account</p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              {hasIncome && <IncomeCard income={data.income} />}
              <ExpensesCard expenses={data.expenses} />
            </div>
            <div className="space-y-6">
              {hasIncome && <SavingsRateCard data={data} />}
              <SubscriptionsCard subscriptions={data.subscriptions ?? []} />
            </div>
          </div>
        </>
      )}

      <InsightsSection insights={data.insights ?? []} />

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
