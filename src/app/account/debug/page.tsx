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
    </div>
  );
}
