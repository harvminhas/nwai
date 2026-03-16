"use client";

import { useEffect, useState } from "react";
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

// ── constants ─────────────────────────────────────────────────────────────────

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
const DEBT_TYPES = ["mortgage", "loan"];

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

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(value);
}

// ── types ─────────────────────────────────────────────────────────────────────

interface StatementHistoryEntry {
  yearMonth: string;
  netWorth: number;
  uploadedAt: string;
  statementId: string;
  isCarryForward: boolean;
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

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
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

        // Per-account statement history from consolidated API
        const acctHistory: StatementHistoryEntry[] =
          json.accountStatementHistory?.[slug] ?? [];
        setStmtHistory(acctHistory);

        // Build chart history — mark carry-forward months as estimates
        const chartHistory = (Array.isArray(json.history) ? json.history : []).map(
          (h: { yearMonth: string; netWorth: number; expensesTotal?: number }) => ({
            ...h,
            isEstimate: acctHistory.find((e) => e.yearMonth === h.yearMonth)?.isCarryForward ?? false,
          })
        );
        setHistory(chartHistory);

        // Restore saved baseline from localStorage
        const saved = localStorage.getItem(`baseline-${slug}`);
        if (saved) setBaselineMonth(saved);
      } catch { setError("Failed to load account"); }
      finally { setLoading(false); }
    });
  }, [router, slug]);

  async function handleDelete(statementId: string) {
    if (!idToken || !confirm("Delete this statement?")) return;
    setDeletingId(statementId);
    try {
      await fetch(`/api/user/statements/${statementId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      // Reload
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

  function handleSetBaseline(ym: string) {
    const newBaseline = baselineMonth === ym ? null : ym;
    setBaselineMonth(newBaseline);
    if (newBaseline) localStorage.setItem(`baseline-${slug}`, newBaseline);
    else localStorage.removeItem(`baseline-${slug}`);
  }

  // Filter history to only show months on/after baseline
  const filteredHistory = baselineMonth
    ? history.filter((h) => h.yearMonth >= baselineMonth)
    : history;

  // ── early returns ────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  if (error || !data || !yearMonth) return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-800">{error || "No data for this account."}</p>
        <Link href="/account/accounts" className="mt-4 inline-block text-purple-600 hover:underline">
          Back to accounts
        </Link>
      </div>
    </div>
  );

  const accountType = data.accountType ?? "other";
  const isDebtAccount = DEBT_TYPES.includes(accountType);
  const hasIncome = accountType === "checking" || accountType === "savings" || (data.income?.total ?? 0) > 0;
  const hasSpending = ["checking", "savings", "credit"].includes(accountType) ||
    (data.expenses?.total ?? 0) > 0 || (data.subscriptions?.length ?? 0) > 0;
  const linkedAssets = manualAssets.filter((a) => a.linkedAccountSlug === slug);
  const linkedAssetsTotal = linkedAssets.reduce((s, a) => s + a.value, 0);
  const outstandingDebt = Math.abs(data.netWorth ?? 0);
  const equity = linkedAssetsTotal - outstandingDebt;

  const carryForwardCount = stmtHistory.filter((e) => e.isCarryForward).length;
  const hasIncompleteMonths = carryForwardCount > 0;

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
      {hasIncompleteMonths && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="text-sm">
            <p className="font-medium text-amber-800">
              {carryForwardCount} month{carryForwardCount !== 1 ? "s" : ""} estimated
            </p>
            <p className="mt-0.5 text-amber-700">
              Months marked <span className="font-medium">~estimated</span> use the most recent uploaded balance.
              Upload statements for those months or set a baseline to exclude earlier data from trends.
            </p>
          </div>
        </div>
      )}

      {/* Equity card for mortgage/loan */}
      {isDebtAccount && linkedAssets.length > 0 && (
        <div className="mb-6 rounded-xl border border-purple-200 bg-purple-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 mb-3">Equity breakdown</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {linkedAssets.map((a) => (
              <div key={a.id} className="rounded-lg bg-white p-3 shadow-sm">
                <p className="text-xs text-gray-500 truncate">{a.label}</p>
                <p className="font-bold text-gray-900">{formatCurrency(a.value)}</p>
                <Link href="/account/assets" className="text-xs text-purple-500 hover:underline">Edit →</Link>
              </div>
            ))}
            <div className="rounded-lg bg-white p-3 shadow-sm">
              <p className="text-xs text-gray-500">Outstanding balance</p>
              <p className="font-bold text-red-600">−{formatCurrency(outstandingDebt)}</p>
            </div>
            <div className={`rounded-lg p-3 shadow-sm ${equity >= 0 ? "bg-green-50" : "bg-red-50"}`}>
              <p className="text-xs text-gray-500">Your equity</p>
              <p className={`font-bold text-lg ${equity >= 0 ? "text-green-700" : "text-red-600"}`}>
                {formatCurrency(equity)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Nudge to link asset */}
      {isDebtAccount && linkedAssets.length === 0 && (
        <div className="mb-6 rounded-xl border-2 border-dashed border-purple-200 bg-purple-50/50 p-5 flex items-center justify-between gap-4">
          <div>
            <p className="font-semibold text-gray-900">
              {accountType === "mortgage" ? "🏠 What's your property worth?" : "🚗 Add the asset behind this loan"}
            </p>
            <p className="mt-0.5 text-sm text-gray-600">
              Link an asset to calculate your true equity — it only takes a second.
            </p>
          </div>
          <Link
            href={`/account/assets?link=${slug}&category=${accountType === "mortgage" ? "property" : "vehicle"}`}
            className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
          >
            Add asset
          </Link>
        </div>
      )}

      {/* KPI cards */}
      <ConsolidatedProgressHero
        data={data}
        previousMonth={previousMonth}
        monthLabel={monthLabel(yearMonth)}
      />

      {/* Balance trend chart */}
      {filteredHistory.length >= 2 && (
        <div className="mt-6">
          <NetWorthChart history={filteredHistory} />
        </div>
      )}

      {/* ── Statement history table ─────────────────────────────────────────── */}
      {stmtHistory.length > 0 && (
        <div className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="font-semibold text-gray-900">Statement history</h2>
            {baselineMonth && (
              <button
                onClick={() => handleSetBaseline(baselineMonth)}
                className="text-xs text-purple-600 hover:underline"
              >
                Clear baseline
              </button>
            )}
          </div>

          {baselineMonth && (
            <p className="mb-3 text-xs text-gray-400">
              Trend chart starts from <span className="font-medium text-gray-600">{shortMonth(baselineMonth)}</span>.
              Months before this are excluded.
            </p>
          )}

          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Month</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Balance</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Baseline</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...stmtHistory].reverse().map((entry) => {
                  const isBaseline = baselineMonth === entry.yearMonth;
                  const beforeBaseline = baselineMonth != null && entry.yearMonth < baselineMonth;
                  return (
                    <tr
                      key={entry.yearMonth}
                      className={`transition ${beforeBaseline ? "opacity-40" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-800">
                        {shortMonth(entry.yearMonth)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                        <span className={entry.isCarryForward ? "text-gray-400" : ""}>
                          {formatCurrency(entry.netWorth)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {entry.isCarryForward ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                            <span>~</span> estimated
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
                            ✓ uploaded
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => handleSetBaseline(entry.yearMonth)}
                          title={isBaseline ? "Remove baseline" : "Set as trend start"}
                          className={`rounded-full px-2 py-0.5 text-xs font-medium transition ${
                            isBaseline
                              ? "bg-purple-100 text-purple-700"
                              : "text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                          }`}
                        >
                          {isBaseline ? "● baseline" : "set baseline"}
                        </button>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!entry.isCarryForward && entry.statementId && (
                          <div className="flex items-center justify-end gap-2">
                            <Link
                              href={`/dashboard/${entry.statementId}`}
                              className="text-xs text-purple-500 hover:underline"
                            >
                              View
                            </Link>
                            <button
                              onClick={() => handleDelete(entry.statementId)}
                              disabled={deletingId === entry.statementId}
                              className="text-xs text-gray-400 hover:text-red-500 disabled:opacity-40"
                            >
                              {deletingId === entry.statementId ? "…" : "Delete"}
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="mt-2 text-xs text-gray-400">
            <span className="font-medium text-gray-500">Set baseline</span> to exclude older months from the trend chart.
            Upload a statement for an estimated month to make it accurate.
          </p>
        </div>
      )}

      {/* Spending section */}
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
    </div>
  );
}
