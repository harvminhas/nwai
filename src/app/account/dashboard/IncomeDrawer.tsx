"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, Tooltip } from "recharts";
import { fmt, getCurrencySymbol } from "@/lib/currencyUtils";
import type { SourceMonthData } from "@/lib/incomeEngine";

// ─── helpers ──────────────────────────────────────────────────────────────────

function shortMo(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function fmtAmt(v: number, currency: string) {
  const sym = getCurrencySymbol(currency);
  if (Math.abs(v) >= 1_000) return `${sym}${Math.round(Math.abs(v) / 1_000)}k`;
  return fmt(v, currency);
}

// ─── component ────────────────────────────────────────────────────────────────

interface IncomeDrawerProps {
  sourceName: string | null;
  token: string | null;
  homeCurrency: string;
  isOpen: boolean;
  onClose: () => void;
}

export function IncomeDrawer({ sourceName, token, homeCurrency, isOpen, onClose }: IncomeDrawerProps) {
  const [history, setHistory] = useState<SourceMonthData[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!sourceName || !token) return;
    setLoading(true);
    setHistory([]);
    fetch("/api/user/statements/consolidated", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((json) => {
        const sourceHist: Record<string, SourceMonthData[]> = json.incomeSourceHistory ?? {};
        const months = (sourceHist[sourceName] ?? [])
          .slice()
          .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
        setHistory(months);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [sourceName, token]);

  const chartData = [...history].reverse().slice(-12).map((m) => ({
    ym: m.yearMonth,
    amount: m.amount,
  }));

  const recentMonths = history.slice(0, 3);
  const allTxns = recentMonths.flatMap((m) =>
    m.transactions.map((t) => ({ ...t, yearMonth: m.yearMonth }))
  );
  const sourceSlug = encodeURIComponent(sourceName ?? "");

  const typical = history.length > 0
    ? Math.round(history.slice(0, 6).reduce((s, m) => s + m.amount, 0) / Math.min(history.length, 6))
    : 0;

  return (
    <>
      {/* backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/20 transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />
      {/* panel */}
      <div
        className={`fixed right-0 top-0 z-50 h-full w-full max-w-lg bg-white shadow-2xl flex flex-col transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-widest text-green-600">Income Source</p>
            <h2 className="text-lg font-bold text-gray-900 mt-0.5">{sourceName}</h2>
          </div>
          <button onClick={onClose} className="rounded-full p-2 text-gray-400 hover:bg-gray-100 transition">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto">
          {loading && (
            <div className="flex items-center justify-center h-32 text-sm text-gray-400">Loading…</div>
          )}

          {!loading && history.length === 0 && (
            <div className="flex items-center justify-center h-32 text-sm text-gray-400">No history found</div>
          )}

          {!loading && history.length > 0 && (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Typical</p>
                  <p className="text-base font-bold text-green-600 tabular-nums">+{fmt(typical, homeCurrency)}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Months seen</p>
                  <p className="text-base font-bold text-gray-800">{history.length}</p>
                </div>
                <div className="px-4 py-3">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Last received</p>
                  <p className="text-base font-bold text-gray-800">{shortMo(history[0].yearMonth)}</p>
                </div>
              </div>

              {/* Bar chart */}
              {chartData.length > 1 && (
                <div className="px-6 pt-5 pb-2">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-3">Monthly Income</p>
                  <ResponsiveContainer width="100%" height={140}>
                    <BarChart data={chartData} barSize={18} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                      <XAxis dataKey="ym" tickFormatter={shortMo} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} />
                      <YAxis tickFormatter={(v) => fmtAmt(v, homeCurrency)} tick={{ fontSize: 10, fill: "#9ca3af" }} axisLine={false} tickLine={false} width={40} />
                      <Tooltip
                        formatter={(v) => [fmt(Number(v ?? 0), homeCurrency), "Income"]}
                        labelFormatter={(l) => shortMo(l as string)}
                        contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e5e7eb" }}
                      />
                      <Bar dataKey="amount" radius={[3, 3, 0, 0]}>
                        {chartData.map((d, i) => (
                          <Cell key={d.ym} fill={i === chartData.length - 1 ? "#16a34a" : "#86efac"} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Recent transactions */}
              <div className="px-6 pt-4 pb-2">
                <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-2">Recent Deposits</p>
                {allTxns.length === 0 && <p className="text-xs text-gray-400">No transactions found</p>}
                <div className="divide-y divide-gray-50">
                  {allTxns.slice(0, 10).map((t, i) => (
                    <div key={i} className="flex items-center justify-between py-2.5">
                      <div>
                        <p className="text-xs text-gray-700">{t.date ? fmtDate(t.date) : shortMo(t.yearMonth)}</p>
                        {t.accountSlug && <p className="text-[11px] text-gray-400">{t.accountSlug}</p>}
                      </div>
                      <p className="text-sm font-semibold text-green-600 tabular-nums">+{fmt(t.amount, homeCurrency)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* footer */}
        <div className="border-t border-gray-100 px-6 py-4">
          <Link
            href={`/account/income/${sourceSlug}`}
            onClick={onClose}
            className="flex items-center gap-2 text-sm font-semibold text-purple-600 hover:underline"
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
            </svg>
            Open full income source page
          </Link>
        </div>
      </div>
    </>
  );
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useIncomeDrawer() {
  const [drawerSource, setDrawerSource] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDrawer(sourceName: string) {
    setDrawerSource(sourceName);
    requestAnimationFrame(() => requestAnimationFrame(() => setDrawerOpen(true)));
  }
  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setDrawerSource(null), 300);
  }

  return { drawerSource, drawerOpen, openDrawer, closeDrawer };
}
