"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import { categoryColor, shortMonth } from "./shared";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";

// ─── types ────────────────────────────────────────────────────────────────────

export interface DrawerTxn {
  date?: string;
  ym: string;
  amount: number;
  currency?: string;
  category: string;
  accountLabel?: string;
}

export interface DrawerMerchant {
  name: string;
  displayName?: string;
  total: number;
  count: number;
  avgAmount: number;
  category: string;
  currency?: string;
  lastDate?: string;
  monthly: { ym: string; total: number; count: number }[];
  transactions: DrawerTxn[];
}

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDec(v: number, originalCurrency?: string, homeCurrency = "USD") {
  const cur = originalCurrency ?? homeCurrency;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: cur,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

function fmtAxis(v: number) {
  const sym = getCurrencySymbol();
  if (v >= 1000) return `${sym}${Math.round(v / 1000)}k`;
  return v === 0 ? `${sym}0` : String(Math.round(v));
}

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ─── component ────────────────────────────────────────────────────────────────

export function MerchantDrawer({
  slug,
  token,
  homeCurrency,
  isOpen,
  onClose,
}: {
  slug: string | null;
  token: string | null;
  homeCurrency: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [merchant, setMerchant] = useState<DrawerMerchant | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [selectedYm, setSelectedYm] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || !token || !isOpen) return;
    setLoading(true); setError(null); setMerchant(null); setSelectedYm(null);
    fetch(`/api/user/spending/merchants?slug=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (json.merchant) setMerchant(json.merchant);
        else setError("No data found for this merchant.");
      })
      .catch(() => setError("Failed to load merchant data."))
      .finally(() => setLoading(false));
  }, [slug, token, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const color         = merchant ? categoryColor(merchant.category) : "#a855f7";
  const displayedName = merchant?.displayName ?? merchant?.name ?? (slug ?? "");
  const monthlyAvg    = merchant && merchant.monthly.length > 0
    ? merchant.total / merchant.monthly.length : 0;

  const chartData = merchant?.monthly.map((m) => ({
    label: shortMonth(m.ym), ym: m.ym, total: m.total,
  })) ?? [];

  const filteredTxns = selectedYm
    ? (merchant?.transactions ?? []).filter((t) => t.ym === selectedYm)
    : [...(merchant?.transactions ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <h2 className="truncate text-base font-bold text-gray-900">{displayedName}</h2>
            </div>
            {merchant && (
              <p className="mt-0.5 text-xs text-gray-400">
                {formatCurrency(merchant.total, homeCurrency, merchant.currency, true)} total
                <span className="mx-1">·</span>
                {formatCurrency(Math.round(monthlyAvg), homeCurrency, undefined, true)}/mo avg
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}

          {merchant && !loading && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-3 divide-x divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="px-3 py-3 text-center">
                  <p className="text-[11px] text-gray-400">Transactions</p>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">{merchant.count}</p>
                </div>
                <div className="px-3 py-3 text-center">
                  <p className="text-[11px] text-gray-400">Avg amount</p>
                  <p className="mt-0.5 text-sm font-bold text-gray-900 tabular-nums">
                    {formatCurrency(merchant.avgAmount, homeCurrency, merchant.currency, true)}
                  </p>
                </div>
                <div className="px-3 py-3 text-center">
                  <p className="text-[11px] text-gray-400">Active months</p>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">{merchant.monthly.length}</p>
                </div>
              </div>

              {/* Monthly trend */}
              {chartData.length >= 1 && (
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly spending</p>
                    {selectedYm && (
                      <button
                        onClick={() => setSelectedYm(null)}
                        className="text-xs font-medium text-purple-600 hover:underline"
                      >
                        {shortMonth(selectedYm)} ✕
                      </button>
                    )}
                  </div>
                  <div className="h-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }} style={{ outline: "none" }} tabIndex={-1}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={40} />
                        <Tooltip
                          formatter={(v) => [formatCurrency(Number(v), homeCurrency, merchant.currency, true), "Spent"]}
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                          cursor={{ fill: "rgba(0,0,0,0.04)" }}
                        />
                        <Bar
                          dataKey="total"
                          radius={[3, 3, 0, 0]}
                          activeBar={false}
                          style={{ cursor: "pointer" }}
                          onClick={(data) => {
                            const ym = (data as unknown as { ym?: string })?.ym ?? null;
                            setSelectedYm((prev) => prev === ym ? null : ym);
                          }}
                        >
                          {chartData.map((entry) => (
                            <Cell
                              key={entry.ym}
                              fill={color}
                              opacity={!selectedYm || entry.ym === selectedYm ? 1 : 0.35}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Transactions */}
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {selectedYm ? `${shortMonth(selectedYm)} transactions` : "All transactions"}
                  </p>
                  <span className="text-xs text-gray-400">{filteredTxns.length}</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {filteredTxns.map((txn, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-500">
                            {txn.date ? fmtDate(txn.date) : shortMonth(txn.ym)}
                          </span>
                          {txn.accountLabel && (
                            <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{txn.accountLabel}</span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(txn.category) }} />
                          <span className="text-xs text-gray-400">{txn.category}</span>
                        </div>
                      </div>
                      <p className="ml-3 shrink-0 text-sm font-semibold text-gray-800 tabular-nums">
                        −{fmtDec(Math.abs(txn.amount), txn.currency ?? homeCurrency)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer — link to full merchant page */}
        {slug && (
          <div className="border-t border-gray-100 p-4">
            <Link
              href={`/account/spending/merchant/${encodeURIComponent(slug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 py-2.5 text-sm font-medium text-gray-500 transition hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open full merchant page
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

// ─── hook ─────────────────────────────────────────────────────────────────────

export function useMerchantDrawer() {
  const [drawerSlug, setDrawerSlug] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openDrawer(slug: string) {
    setDrawerSlug(slug);
    requestAnimationFrame(() => requestAnimationFrame(() => setDrawerOpen(true)));
  }
  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setDrawerSlug(null), 300);
  }

  return { drawerSlug, drawerOpen, openDrawer, closeDrawer };
}
