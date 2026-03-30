"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { UserStatementSummary } from "@/lib/types";

type DebugResult = {
  statementId: string;
  fileName: string;
  systemPrompt: string;
  rawResponse: string;
  parsed: unknown;
  parseError: string | null;
};

type InsightsDebugResult = {
  brief: string;
  systemPrompt: string;
  rawResponse: string | null;
  parsedCards: unknown;
  parseError: string | null;
  error?: string;
};

type Tab = "raw" | "parsed" | "prompt";
type InsightsTab = "brief" | "raw" | "cards" | "prompt";

type SpendingTxn = {
  date: string; merchant: string; category: string;
  amount: number; excluded: boolean; accountLabel: string;
};
type SpendingDebugResult = {
  cacheMetadata: {
    updatedAt: string; schemaVersion: string; sourceVersion: string;
    ageSeconds: number; totalTxns: number; monthsInHistory: number;
    negativeAmountTxns: number;
  };
  currentMonth: {
    month: string; totalBefore: number; totalAfterExcludingTransfers: number;
    difference: number; excludedByCategory: Record<string, number>;
    transactions: SpendingTxn[];
  };
  negativeAmountTransactions: { date: string; merchant: string; category: string; amount: number; txMonth: string }[];
  monthSummary: { yearMonth: string; allExpenses: number; coreExpenses: number; excluded: number; income: number }[];
};

export default function DebugParsePage() {
  const router = useRouter();
  const [idToken, setIdToken]         = useState<string | null>(null);
  const [statements, setStatements]   = useState<UserStatementSummary[]>([]);
  const [selected, setSelected]       = useState<string>("");
  const [loading, setLoading]                   = useState(false);
  const [fetching, setFetching]                 = useState(true);
  const [result, setResult]                     = useState<DebugResult | null>(null);
  const [error, setError]                       = useState<string | null>(null);
  const [tab, setTab]                           = useState<Tab>("raw");
  const [insightsLoading, setInsightsLoading]   = useState(false);
  const [insightsResult, setInsightsResult]     = useState<InsightsDebugResult | null>(null);
  const [insightsError, setInsightsError]       = useState<string | null>(null);
  const [insightsTab, setInsightsTab]           = useState<InsightsTab>("brief");

  const [spendLoading, setSpendLoading]         = useState(false);
  const [spendResult, setSpendResult]           = useState<SpendingDebugResult | null>(null);
  const [spendError, setSpendError]             = useState<string | null>(null);
  const [spendTab, setSpendTab]                 = useState<"summary" | "txns" | "history">("summary");

  const [cronLoading, setCronLoading]           = useState(false);
  const [cronResult, setCronResult]             = useState<Record<string, unknown> | null>(null);
  const [cronError, setCronError]               = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const token = await user.getIdToken();
      setIdToken(token);
      try {
        const res  = await fetch("/api/user/statements", { headers: { Authorization: `Bearer ${token}` } });
        const json = await res.json().catch(() => ({}));
        const stmts: UserStatementSummary[] = (json.statements ?? [])
          .filter((s: UserStatementSummary) => s.source !== "csv" && s.status === "completed")
          .slice(0, 50);
        setStatements(stmts);
        if (stmts.length > 0) setSelected(stmts[0].id);
      } finally {
        setFetching(false);
      }
    });
  }, [router]);

  async function runDebug() {
    if (!idToken || !selected) return;
    setLoading(true); setError(null); setResult(null);
    try {
      const res  = await fetch("/api/debug/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ statementId: selected }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "Failed"); return; }
      setResult(json as DebugResult);
      setTab("raw");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  const stmt = statements.find((s) => s.id === selected);

  async function runInsightsDebug() {
    if (!idToken) return;
    setInsightsLoading(true); setInsightsError(null); setInsightsResult(null);
    try {
      const res  = await fetch("/api/debug/insights", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: "{}",
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setInsightsError(json.error || "Failed"); return; }
      setInsightsResult(json as InsightsDebugResult);
      setInsightsTab("brief");
    } catch (e) {
      setInsightsError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setInsightsLoading(false);
    }
  }

  async function runCron() {
    if (!idToken) return;
    setCronLoading(true); setCronError(null); setCronResult(null);
    try {
      const res  = await fetch("/api/cron/refresh-external-data", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setCronError(json.error || "Failed"); return; }
      setCronResult(json);
    } catch (e) {
      setCronError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setCronLoading(false);
    }
  }

  async function runSpendingDebug(rebuild = false) {
    if (!idToken) return;
    setSpendLoading(true); setSpendError(null); setSpendResult(null);
    try {
      const url = `/api/debug/spending${rebuild ? "?rebuild=1" : ""}`;
      const res  = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setSpendError(json.error || "Failed"); return; }
      setSpendResult(json as SpendingDebugResult);
      setSpendTab("summary");
    } catch (e) {
      setSpendError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setSpendLoading(false);
    }
  }

  function fmt(n: number) {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Parse Debugger</h1>
        <p className="mt-1 text-sm text-gray-500">
          Re-sends a statement to the AI and shows the raw response, parsed JSON, and the system prompt used.
        </p>
      </div>

      {/* Statement picker */}
      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <label className="block text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
          Select statement
        </label>
        {fetching ? (
          <div className="h-8 w-48 animate-pulse rounded bg-gray-100" />
        ) : (
          <div className="flex flex-col sm:flex-row gap-3">
            <select
              value={selected}
              onChange={(e) => setSelected(e.target.value)}
              className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
            >
              {statements.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.bankName ?? "?"} · {s.accountId ?? "?"} · {s.statementDate?.slice(0, 7) ?? "?"} · {s.fileName}
                </option>
              ))}
            </select>
            <button
              onClick={runDebug}
              disabled={loading || !selected}
              className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition flex items-center gap-2"
            >
              {loading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
              {loading ? "Running…" : "▶ Run Debug Parse"}
            </button>
          </div>
        )}
        {stmt && (
          <p className="mt-2 text-xs text-gray-400">
            {stmt.accountType} · uploaded {new Date(stmt.uploadedAt).toLocaleDateString()}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>
      )}

      {result && (() => {
        const parsedObj = result.parsed && typeof result.parsed === "object" ? result.parsed as Record<string, unknown> : null;
        const expTxnCount = (parsedObj?.expenses as { transactions?: unknown[] } | undefined)?.transactions?.length ?? 0;
        const incTxnCount = (parsedObj?.income  as { transactions?: unknown[] } | undefined)?.transactions?.length ?? 0;
        return (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100">
            {(["raw", "parsed", "prompt"] as Tab[]).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-5 py-3 text-sm font-medium transition border-b-2 ${
                  tab === t
                    ? "border-purple-600 text-purple-700"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === "raw" ? "Raw AI Response" : t === "parsed" ? "Parsed JSON" : "System Prompt"}
              </button>
            ))}
            {result.parseError && (
              <span className="ml-auto self-center pr-4 text-xs font-medium text-red-500">
                ⚠ {result.parseError.split("\n")[0]}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="relative">
            <button
              onClick={() => {
                const text = tab === "raw" ? result.rawResponse
                  : tab === "parsed" ? JSON.stringify(result.parsed, null, 2)
                  : result.systemPrompt;
                navigator.clipboard.writeText(text ?? "");
              }}
              className="absolute top-3 right-3 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 transition z-10"
            >
              Copy
            </button>
            <pre className="overflow-auto max-h-[60vh] p-5 text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap bg-gray-50">
              {tab === "raw"
                ? (result.rawResponse || "(empty response)")
                : tab === "parsed"
                ? (result.parsed
                    ? JSON.stringify(result.parsed, null, 2)
                    : "(could not parse JSON)")
                : result.systemPrompt}
            </pre>
          </div>

          {/* Stats footer */}
          <div className="flex flex-wrap gap-4 border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
            <span>Statement: <span className="font-medium text-gray-600">{result.fileName}</span></span>
            <span>Raw length: <span className="font-medium text-gray-600">{result.rawResponse?.length?.toLocaleString()} chars</span></span>
            {parsedObj && (
              <>
                <span>Expense txns: <span className="font-medium text-gray-600">{expTxnCount}</span></span>
                <span>Income txns: <span className="font-medium text-gray-600">{incTxnCount}</span></span>
              </>
            )}
            {result.parseError && (
              <span className="text-red-500">Error: {result.parseError}</span>
            )}
          </div>
        </div>
        );
      })()}

      {/* ── Insights Debugger ─────────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Insights Debugger</h2>
        <p className="mt-1 text-sm text-gray-500">
          Sends your financial brief to the AI and shows exactly what was sent and what came back — without saving anything.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">Runs for your account. No data is written to Firestore.</p>
        <button
          onClick={runInsightsDebug}
          disabled={insightsLoading || !idToken}
          className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition flex items-center gap-2 shrink-0"
        >
          {insightsLoading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
          {insightsLoading ? "Running…" : "▶ Run Insights Debug"}
        </button>
      </div>

      {insightsError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{insightsError}</div>
      )}

      {insightsResult && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          {/* Tab bar */}
          <div className="flex border-b border-gray-100">
            {(["brief", "raw", "cards", "prompt"] as InsightsTab[]).map((t) => (
              <button
                key={t}
                onClick={() => setInsightsTab(t)}
                className={`px-5 py-3 text-sm font-medium transition border-b-2 ${
                  insightsTab === t
                    ? "border-purple-600 text-purple-700"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {t === "brief" ? "Brief (sent)" : t === "raw" ? "Raw AI Response" : t === "cards" ? "Parsed Cards" : "System Prompt"}
              </button>
            ))}
            {insightsResult.parseError && (
              <span className="ml-auto self-center pr-4 text-xs font-medium text-red-500">
                ⚠ {insightsResult.parseError.split("\n")[0]}
              </span>
            )}
          </div>

          {/* Content */}
          <div className="relative">
            <button
              onClick={() => {
                const text = insightsTab === "brief" ? insightsResult.brief
                  : insightsTab === "raw" ? (insightsResult.rawResponse ?? "")
                  : insightsTab === "cards" ? JSON.stringify(insightsResult.parsedCards, null, 2)
                  : insightsResult.systemPrompt;
                navigator.clipboard.writeText(text ?? "");
              }}
              className="absolute top-3 right-3 rounded-md border border-gray-200 bg-white px-2.5 py-1 text-xs text-gray-500 hover:bg-gray-50 transition z-10"
            >
              Copy
            </button>
            <pre className="overflow-auto max-h-[60vh] p-5 text-xs text-gray-700 font-mono leading-relaxed whitespace-pre-wrap bg-gray-50">
              {insightsTab === "brief"
                ? (insightsResult.brief || "(empty brief)")
                : insightsTab === "raw"
                ? (insightsResult.rawResponse || "(empty response)")
                : insightsTab === "cards"
                ? (insightsResult.parsedCards
                    ? JSON.stringify(insightsResult.parsedCards, null, 2)
                    : "(could not parse cards)")
                : insightsResult.systemPrompt}
            </pre>
          </div>

          {/* Stats footer */}
          <div className="flex flex-wrap gap-4 border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
            <span>Brief: <span className="font-medium text-gray-600">{insightsResult.brief?.length?.toLocaleString()} chars</span></span>
            <span>Response: <span className="font-medium text-gray-600">{insightsResult.rawResponse?.length?.toLocaleString() ?? "—"} chars</span></span>
            <span>Cards: <span className="font-medium text-gray-600">{Array.isArray(insightsResult.parsedCards) ? insightsResult.parsedCards.length : "—"}</span></span>
            {insightsResult.parseError && (
              <span className="text-red-500">{insightsResult.parseError}</span>
            )}
          </div>
        </div>
      )}

      {/* ── External Data Refresh ───────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">External Data Refresh</h2>
        <p className="mt-1 text-sm text-gray-500">
          Fetches Bank of Canada rates and CPI, then pushes personalized insight cards to all relevant users.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex items-center justify-between gap-4">
        <p className="text-sm text-gray-500">Only runs sources that are due for refresh. Safe to trigger manually.</p>
        <button
          onClick={runCron}
          disabled={cronLoading || !idToken}
          className="rounded-lg bg-green-600 px-5 py-2 text-sm font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition flex items-center gap-2 shrink-0"
        >
          {cronLoading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
          {cronLoading ? "Running…" : "▶ Run External Refresh"}
        </button>
      </div>

      {cronError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{cronError}</div>
      )}

      {cronResult && (
        <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Result</p>
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            <span className="text-gray-500">Users checked: <span className="font-medium text-gray-800">{String(cronResult.users ?? "—")}</span></span>
            <span className="text-gray-500">Users notified: <span className="font-medium text-gray-800">{String(cronResult.usersNotified ?? "—")}</span></span>
            <span className="text-gray-500">Refreshed: <span className="font-medium text-gray-800">{Array.isArray(cronResult.refreshed) ? (cronResult.refreshed as string[]).join(", ") || "none" : "—"}</span></span>
            <span className="text-gray-500">Skipped (not due): <span className="font-medium text-gray-800">{Array.isArray(cronResult.skipped) ? (cronResult.skipped as string[]).join(", ") || "none" : "—"}</span></span>
          </div>
          {Array.isArray(cronResult.fetchErrors) && (cronResult.fetchErrors as string[]).length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-semibold text-red-500">Fetch errors:</p>
              {(cronResult.fetchErrors as string[]).map((e, i) => (
                <p key={i} className="text-xs text-red-600 font-mono">{e}</p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Spending Cache Debugger ──────────────────────────────────────────── */}
      <div>
        <h2 className="text-xl font-bold text-gray-900">Spending Cache Debugger</h2>
        <p className="mt-1 text-sm text-gray-500">
          Shows exactly what is in the financial profile cache — before and after the &quot;Excl. transfers&quot; filter —
          so you can verify the numbers match the spending page.
        </p>
      </div>

      <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm flex flex-wrap items-center gap-3">
        <p className="text-sm text-gray-500 flex-1">Read the current cache. Use &quot;Force Rebuild&quot; to recompute from scratch.</p>
        <button
          onClick={() => runSpendingDebug(false)}
          disabled={spendLoading || !idToken}
          className="rounded-lg bg-purple-600 px-5 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition flex items-center gap-2"
        >
          {spendLoading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
          {spendLoading ? "Loading…" : "▶ Load Cache"}
        </button>
        <button
          onClick={() => runSpendingDebug(true)}
          disabled={spendLoading || !idToken}
          className="rounded-lg bg-amber-600 px-5 py-2 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-50 transition flex items-center gap-2"
        >
          {spendLoading && <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />}
          {spendLoading ? "Rebuilding…" : "↺ Force Rebuild"}
        </button>
      </div>

      {spendError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{spendError}</div>
      )}

      {spendResult && (
        <div className="space-y-4">
          {/* Cache metadata strip */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Cache Metadata</p>
            <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
              <span className="text-gray-500">Built: <span className="font-medium text-gray-800">{new Date(spendResult.cacheMetadata.updatedAt).toLocaleString()}</span> ({spendResult.cacheMetadata.ageSeconds}s ago)</span>
              <span className="text-gray-500">Schema: <span className={`font-medium ${spendResult.cacheMetadata.schemaVersion === "(none — rebuild needed)" ? "text-red-600" : "text-gray-800"}`}>{spendResult.cacheMetadata.schemaVersion}</span></span>
              <span className="text-gray-500">Source hash: <span className="font-medium text-gray-800 font-mono">{spendResult.cacheMetadata.sourceVersion}</span></span>
              <span className="text-gray-500">Total txns: <span className="font-medium text-gray-800">{spendResult.cacheMetadata.totalTxns}</span></span>
              <span className="text-gray-500">Months: <span className="font-medium text-gray-800">{spendResult.cacheMetadata.monthsInHistory}</span></span>
              {spendResult.cacheMetadata.negativeAmountTxns > 0 && (
                <span className="font-semibold text-red-600">⚠ {spendResult.cacheMetadata.negativeAmountTxns} negative-amount txns in cache</span>
              )}
            </div>
          </div>

          {/* Current month summary */}
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Current Month — {spendResult.currentMonth.month}</p>
            <div className="grid grid-cols-3 gap-4 mb-4">
              <div className="rounded-lg bg-gray-50 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">All expenses</p>
                <p className="text-lg font-bold text-gray-900">{fmt(spendResult.currentMonth.totalBefore)}</p>
              </div>
              <div className="rounded-lg bg-green-50 p-3 text-center">
                <p className="text-xs text-gray-500 mb-1">Excl. transfers</p>
                <p className="text-lg font-bold text-green-700">{fmt(spendResult.currentMonth.totalAfterExcludingTransfers)}</p>
              </div>
              <div className={`rounded-lg p-3 text-center ${spendResult.currentMonth.difference > 0 ? "bg-amber-50" : "bg-gray-50"}`}>
                <p className="text-xs text-gray-500 mb-1">Difference</p>
                <p className={`text-lg font-bold ${spendResult.currentMonth.difference > 0 ? "text-amber-700" : "text-gray-900"}`}>
                  {fmt(spendResult.currentMonth.difference)}
                </p>
              </div>
            </div>
            {Object.keys(spendResult.currentMonth.excludedByCategory).length > 0 && (
              <div>
                <p className="text-xs text-gray-400 mb-2">Excluded by category:</p>
                <div className="flex flex-wrap gap-2">
                  {Object.entries(spendResult.currentMonth.excludedByCategory).map(([cat, amt]) => (
                    <span key={cat} className="rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800">
                      {cat}: {fmt(amt)}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Tabs for detail */}
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex border-b border-gray-100">
              {(["summary", "txns", "history"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setSpendTab(t)}
                  className={`px-5 py-3 text-sm font-medium transition border-b-2 ${
                    spendTab === t ? "border-purple-600 text-purple-700" : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {t === "summary" ? "This Month Txns" : t === "txns" ? "Negative Txns" : "Monthly History"}
                </button>
              ))}
            </div>

            <div className="overflow-auto max-h-[60vh]">
              {spendTab === "summary" && (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Date</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Merchant</th>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Category</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">Amount</th>
                      <th className="text-center px-4 py-2 text-gray-500 font-medium">Excluded?</th>
                    </tr>
                  </thead>
                  <tbody>
                    {spendResult.currentMonth.transactions.map((t, i) => (
                      <tr key={i} className={`border-b border-gray-50 ${t.excluded ? "bg-amber-50" : ""}`}>
                        <td className="px-4 py-1.5 text-gray-600 font-mono">{t.date}</td>
                        <td className="px-4 py-1.5 text-gray-800">{t.merchant}</td>
                        <td className="px-4 py-1.5 text-gray-600">{t.category}</td>
                        <td className="px-4 py-1.5 text-right font-medium text-gray-800">{fmt(t.amount)}</td>
                        <td className="px-4 py-1.5 text-center">
                          {t.excluded ? <span className="text-amber-600 font-semibold">✕</span> : <span className="text-gray-300">—</span>}
                        </td>
                      </tr>
                    ))}
                    {spendResult.currentMonth.transactions.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-6 text-center text-gray-400">No transactions this month</td></tr>
                    )}
                  </tbody>
                </table>
              )}

              {spendTab === "txns" && (
                spendResult.negativeAmountTransactions.length === 0 ? (
                  <div className="px-4 py-6 text-center text-green-600 font-medium text-sm">
                    ✓ No negative-amount transactions in cache — filter is working correctly
                  </div>
                ) : (
                  <table className="w-full text-xs">
                    <thead className="sticky top-0 bg-red-50 border-b border-red-100">
                      <tr>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Month</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Date</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Merchant</th>
                        <th className="text-left px-4 py-2 text-gray-500 font-medium">Category</th>
                        <th className="text-right px-4 py-2 text-gray-500 font-medium">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {spendResult.negativeAmountTransactions.map((t, i) => (
                        <tr key={i} className="border-b border-red-50 bg-red-50/50">
                          <td className="px-4 py-1.5 font-mono text-gray-600">{t.txMonth}</td>
                          <td className="px-4 py-1.5 font-mono text-gray-600">{t.date}</td>
                          <td className="px-4 py-1.5 text-gray-800">{t.merchant}</td>
                          <td className="px-4 py-1.5 text-gray-600">{t.category}</td>
                          <td className="px-4 py-1.5 text-right font-bold text-red-600">{fmt(t.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              )}

              {spendTab === "history" && (
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-gray-50 border-b border-gray-100">
                    <tr>
                      <th className="text-left px-4 py-2 text-gray-500 font-medium">Month</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">All Expenses</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">Core (Excl. Transfers)</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">Excluded</th>
                      <th className="text-right px-4 py-2 text-gray-500 font-medium">Income</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...spendResult.monthSummary].reverse().map((h) => (
                      <tr key={h.yearMonth} className="border-b border-gray-50 hover:bg-gray-50">
                        <td className="px-4 py-1.5 font-mono font-medium text-gray-800">{h.yearMonth}</td>
                        <td className="px-4 py-1.5 text-right text-gray-600">{fmt(h.allExpenses)}</td>
                        <td className="px-4 py-1.5 text-right font-medium text-gray-800">{fmt(h.coreExpenses)}</td>
                        <td className={`px-4 py-1.5 text-right ${h.excluded > 0 ? "text-amber-600" : "text-gray-400"}`}>{fmt(h.excluded)}</td>
                        <td className="px-4 py-1.5 text-right text-green-600">{fmt(h.income)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
