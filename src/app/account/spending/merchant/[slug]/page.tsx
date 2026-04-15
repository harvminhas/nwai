"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from "recharts";
import { categoryColor, CategoryPicker } from "@/app/account/spending/shared";
import type { MerchantSummary } from "@/app/api/user/spending/merchants/route";
import { fmt, getCurrencySymbol, formatCurrency } from "@/lib/currencyUtils";
import {
  MerchantForecastProvider,
  MerchantForecastSection,
  MerchantSpendCadencePill,
} from "@/components/MerchantForecastSection";
import { PROFILE_REFRESHED_EVENT, useProfileRefresh } from "@/contexts/ProfileRefreshContext";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDec(v: number, originalCurrency?: string, homeCurrency = "USD") {
  const cur = originalCurrency ?? homeCurrency;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: cur,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}
function fmtAxis(v: number, homeCurrency = "USD") {
  const sym = getCurrencySymbol(homeCurrency);
  if (v >= 1_000) return `${sym}${Math.round(v / 1_000)}k`;
  return v === 0 ? `${sym}0` : `${sym}${Math.round(v)}`;
}
function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
function fmtDateShort(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function MerchantDetailPage() {
  const router = useRouter();
  const params = useParams();
  const slug = decodeURIComponent(params.slug as string);

  const [merchant, setMerchant] = useState<MerchantSummary | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [homeCurrency, setHomeCurrency] = useState<string>("USD");
  const [sortField, setSortField]   = useState<"date" | "amount">("date");
  const [sortDir, setSortDir]       = useState<"asc" | "desc">("desc");
  const [selectedYm, setSelectedYm] = useState<string | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);
  const categoryBtnRef = useRef<HTMLButtonElement>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  // Subscription-only record (when no merchant transaction history exists)
  const [subOnlyRecord, setSubOnlyRecord] = useState<{
    name: string; amount: number; frequency: string; cancelled: boolean;
  } | null>(null);
  const { requestProfileRefresh } = useProfileRefresh();

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true);
      try {
        const tok = await user.getIdToken();
        setIdToken(tok);
        const res = await fetch(
          `/api/user/spending/merchants?slug=${encodeURIComponent(slug)}`,
          { headers: { Authorization: `Bearer ${tok}` } }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.merchant) {
          // No merchant transaction history — try to load the subscription record
          // so the user can at least see and manage it (e.g. mark as cancelled).
          const cadenceRes = await fetch(
            `/api/user/spending/merchant-cadence?slug=${encodeURIComponent(slug)}`,
            { headers: { Authorization: `Bearer ${tok}` } },
          ).catch(() => null);
          const cadenceJson = cadenceRes ? await cadenceRes.json().catch(() => ({})) : {};
          if (cadenceJson.cadence || typeof cadenceJson.cancelled === "boolean") {
            setSubOnlyRecord({
              name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              amount: 0,
              frequency: cadenceJson.cadence?.frequency ?? "monthly",
              cancelled: cadenceJson.cancelled ?? false,
            });
            setCancelled(cadenceJson.cancelled ?? false);
          } else {
            setError("No spending history found for this merchant.");
          }
          setLoading(false);
          return;
        }
        setMerchant(json.merchant ?? null);
        if (json.homeCurrency) setHomeCurrency(json.homeCurrency);
      } catch {
        setError("Failed to load merchant data");
      } finally {
        setLoading(false);
      }
    });
  }, [router, slug]);

  useEffect(() => {
    if (!idToken) return;
    const reloadMerchant = () => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/user/spending/merchants?slug=${encodeURIComponent(slug)}`,
            { headers: { Authorization: `Bearer ${idToken}` } },
          );
          const json = await res.json().catch(() => ({}));
          if (json.merchant) setMerchant(json.merchant);
        } catch {
          /* ignore */
        }
      })();
    };
    window.addEventListener(PROFILE_REFRESHED_EVENT, reloadMerchant);
    return () => window.removeEventListener(PROFILE_REFRESHED_EVENT, reloadMerchant);
  }, [idToken, slug]);

  // Load cancelled status from cadence API
  useEffect(() => {
    if (!idToken) return;
    fetch(`/api/user/spending/merchant-cadence?slug=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then((r) => r.json())
      .then((j) => { if (typeof j.cancelled === "boolean") setCancelled(j.cancelled); })
      .catch(() => {});
  }, [idToken, slug]);

  async function handleCancelledToggle() {
    if (!idToken || cancelSaving) return;
    const next = !cancelled;
    setCancelled(next);
    setCancelSaving(true);
    try {
      await fetch("/api/user/spending/merchant-cadence", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ slug, cancelled: next }),
      });
      requestProfileRefresh();
    } catch {
      setCancelled(!next); // revert on error
    } finally {
      setCancelSaving(false);
    }
  }

  function toggleSort(field: "date" | "amount") {
    if (sortField === field) {
      setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    } else {
      setSortField(field);
      setSortDir("desc");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
      </div>
    );
  }

  // Subscription record exists but no merchant transaction history (e.g. "Annual Fee")
  if (subOnlyRecord) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8">
        <Link
          href="/account/spending?tab=merchants"
          className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Merchants
        </Link>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{subOnlyRecord.name}</h1>
              <p className="mt-1 text-sm text-gray-400">
                Recurring · {subOnlyRecord.frequency} · No transaction history in spending data
              </p>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${
              subOnlyRecord.cancelled
                ? "border-red-200 bg-red-50 text-red-600"
                : "border-emerald-200 bg-emerald-50 text-emerald-700"
            }`}>
              {subOnlyRecord.cancelled ? "Cancelled" : "Active"}
            </span>
          </div>

          <div className="mt-6 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This item appears in your <strong>Upcoming</strong> feed because it was detected as a recurring charge,
            but it has no individual merchant transactions to display. If you've cancelled it, mark it as inactive below.
          </div>

          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                if (!idToken || cancelSaving) return;
                const next = !cancelled;
                setCancelled(next);
                setSubOnlyRecord((r) => r ? { ...r, cancelled: next } : r);
                setCancelSaving(true);
                try {
                  await fetch("/api/user/spending/merchant-cadence", {
                    method: "PATCH",
                    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ slug, cancelled: next }),
                  });
                  requestProfileRefresh();
                } catch {
                  setCancelled(!next);
                  setSubOnlyRecord((r) => r ? { ...r, cancelled: !next } : r);
                } finally {
                  setCancelSaving(false);
                }
              }}
              disabled={cancelSaving || !idToken}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${
                cancelled
                  ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
                  : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
              }`}
            >
              {cancelSaving ? "Saving…" : cancelled ? "Reactivate (show in Upcoming)" : "Mark as cancelled (hide from Upcoming)"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error || !merchant) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12 text-center">
        <p className="text-sm text-red-500">{error ?? "Merchant not found."}</p>
        <Link href="/account/spending?tab=merchants" className="mt-4 inline-block text-sm text-purple-600 hover:underline">
          ← Back to Merchants
        </Link>
      </div>
    );
  }

  const color = categoryColor(merchant.category);
  const chartData = merchant.monthly.map((m) => ({
    label: shortMonth(m.ym),
    ym: m.ym,
    total: m.total,
    count: m.count,
  }));
  const maxMonthly = Math.max(...merchant.monthly.map((m) => m.total), 1);

  // Sort + filter transactions
  const filteredTxns = selectedYm
    ? merchant.transactions.filter((t) => t.ym === selectedYm)
    : merchant.transactions;
  const sortedTxns = [...filteredTxns].sort((a, b) => {
    if (sortField === "date") {
      const cmp = (a.date ?? a.ym).localeCompare(b.date ?? b.ym);
      return sortDir === "desc" ? -cmp : cmp;
    } else {
      const cmp = Math.abs(a.amount) - Math.abs(b.amount);
      return sortDir === "desc" ? -cmp : cmp;
    }
  });

  const activeMonths = merchant.monthly.length;
  const monthlyAvg   = activeMonths > 0 ? merchant.total / activeMonths : 0;
  const firstSeen = merchant.firstDate ? fmtDate(merchant.firstDate) : (merchant.monthly[0]?.ym ? shortMonth(merchant.monthly[0].ym) : "—");
  const lastSeen  = merchant.lastDate  ? fmtDate(merchant.lastDate)  : (merchant.monthly.at(-1)?.ym ? shortMonth(merchant.monthly.at(-1)!.ym) : "—");

  const selectedEntry = selectedYm ? chartData.find((e) => e.ym === selectedYm) : null;
  const selectedAvg   = selectedEntry && selectedEntry.count > 0
    ? selectedEntry.total / selectedEntry.count : 0;
  const vsAvgPct = monthlyAvg > 0 && selectedEntry
    ? Math.round(((selectedEntry.total - monthlyAvg) / monthlyAvg) * 100) : 0;

  /** Captured for async handler — TS does not narrow `merchant` inside nested functions. */
  const merchantRow = merchant;

  async function handleMerchantCategorySelect(newCategory: string) {
    setCategoryPickerOpen(false);
    if (!idToken) return;
    const prevCategory = merchantRow.category;
    setMerchant((m) => (m ? { ...m, category: newCategory } : m));
    try {
      const res = await fetch("/api/user/category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: merchantRow.name, category: newCategory }),
      });
      if (res.ok) requestProfileRefresh();
    } catch {
      setMerchant((m) => (m ? { ...m, category: prevCategory } : m));
    }
  }

  return (
    <MerchantForecastProvider slug={slug} merchantName={merchant.name} avgAmount={merchant.avgAmount} lastSeenDate={merchant.lastDate} idToken={idToken}>
      <div className="mx-auto max-w-3xl space-y-6 px-4 py-8">
      {/* Header */}
      <div>
        <Link
          href="/account/spending?tab=merchants"
          className="mb-4 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Merchants
        </Link>
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-gray-900">{merchant.name}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button
                ref={categoryBtnRef}
                type="button"
                onClick={() => setCategoryPickerOpen((o) => !o)}
                className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-xs font-medium text-gray-700 transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-800"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                <span>{merchant.category || "Other"}</span>
                <svg className="h-3 w-3 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              <MerchantSpendCadencePill />
              {/* Cancelled toggle — only meaningful when a recurring cadence is set */}
              <button
                type="button"
                onClick={handleCancelledToggle}
                disabled={cancelSaving}
                title={cancelled ? "Mark as active — will appear in Upcoming" : "Mark as cancelled — hide from Upcoming"}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium transition disabled:opacity-60 ${
                  cancelled
                    ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                    : "border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100"
                }`}
              >
                {cancelled ? (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
                    Cancelled
                  </>
                ) : (
                  <>
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                    Active
                  </>
                )}
              </button>
            </div>
            {categoryPickerOpen && categoryBtnRef.current && (
              <CategoryPicker
                anchorRef={categoryBtnRef}
                current={merchant.category || "Other"}
                onSelect={handleMerchantCategorySelect}
                onClose={() => setCategoryPickerOpen(false)}
              />
            )}
          </div>
        </div>
      </div>

      {/* KPI overview — switches between all-time and selected-month view */}
      {selectedEntry ? (
        /* ── Selected month hero ── */
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="px-5 pt-5 pb-4">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-400">
              {shortMonth(selectedYm!)}
            </p>
            <p className="mt-1 text-4xl font-bold text-gray-900">{formatCurrency(selectedEntry.total, homeCurrency, undefined, true)}</p>
            <p className={`mt-1 text-sm font-medium ${vsAvgPct > 0 ? "text-red-500" : vsAvgPct < 0 ? "text-green-600" : "text-gray-400"}`}>
              {vsAvgPct > 0 ? "↑" : vsAvgPct < 0 ? "↓" : "="}{" "}
              {Math.abs(vsAvgPct)}% vs {formatCurrency(monthlyAvg, homeCurrency, undefined, true)} avg
            </p>
          </div>
          <div className="grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100">
            {[
              { label: "Transactions",  value: selectedEntry.count.toString() },
              { label: "Avg per visit", value: fmtDec(selectedAvg, undefined, homeCurrency) },
              { label: "of total",      value: `${Math.round((selectedEntry.total / merchant.total) * 100)}%` },
            ].map(({ label, value }) => (
              <div key={label} className="px-4 py-3">
                <p className="text-[11px] text-gray-400">{label}</p>
                <p className="mt-0.5 text-base font-bold text-gray-800">{value}</p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── All-time overview ── */
        <>
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="px-5 pt-5 pb-4">
              <p className="text-xs font-medium uppercase tracking-wide text-gray-400">Total spent</p>
              <p className="mt-1 text-4xl font-bold text-gray-900">{formatCurrency(merchant.total, homeCurrency, undefined, true)}</p>
              <p className="mt-1 text-sm text-gray-400">{formatCurrency(monthlyAvg, homeCurrency, undefined, true)}/mo avg · {activeMonths} active months</p>
            </div>
            <div className="grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100">
              {[
                { label: "Transactions",  value: merchant.count.toString() },
                { label: "Avg per visit", value: fmtDec(merchant.avgAmount, undefined, homeCurrency) },
                { label: "Active months", value: activeMonths.toString() },
              ].map(({ label, value }) => (
                <div key={label} className="px-4 py-3">
                  <p className="text-[11px] text-gray-400">{label}</p>
                  <p className="mt-0.5 text-base font-bold text-gray-800">{value}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Timeline row */}
          <div className="flex gap-6 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm text-sm">
            <div>
              <p className="text-xs text-gray-500">First seen</p>
              <p className="mt-0.5 font-medium text-gray-800">{firstSeen}</p>
            </div>
            <div>
              <p className="text-xs text-gray-500">Last seen</p>
              <p className="mt-0.5 font-medium text-gray-800">{lastSeen}</p>
            </div>
          </div>
        </>
      )}

      <MerchantForecastSection />

      {/* Monthly bar chart — click to filter transactions */}
      {chartData.length >= 2 && (
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-700">Monthly spending</p>
              <p className="text-[11px] text-gray-400">Tap a bar to filter transactions</p>
            </div>
            {selectedYm && (
              <button
                onClick={() => setSelectedYm(null)}
                className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 transition"
              >
                {shortMonth(selectedYm)} ✕
              </button>
            )}
          </div>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} style={{ outline: "none" }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(v) => fmtAxis(v, homeCurrency)} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
                <Tooltip
                  formatter={(v) => [fmtDec(Number(v), undefined, homeCurrency), "Spent"]}
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                />
                <Bar
                  dataKey="total"
                  radius={[4, 4, 0, 0]}
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

      {/* Transaction list */}
      <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <p className="text-sm font-semibold text-gray-700">
            {selectedYm ? `${shortMonth(selectedYm)} transactions` : "All transactions"}
            <span className="ml-1 text-xs font-normal text-gray-400">({sortedTxns.length})</span>
          </p>
          <div className="flex items-center gap-1">
            <span className="text-xs text-gray-400">Sort:</span>
            {(["date", "amount"] as const).map((field) => {
              const active = sortField === field;
              return (
                <button
                  key={field}
                  onClick={() => toggleSort(field)}
                  className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium transition capitalize ${
                    active ? "bg-gray-100 text-gray-700" : "text-gray-400 hover:text-gray-600"
                  }`}
                >
                  {field}
                  {active && (
                    <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round"
                        d={sortDir === "desc" ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </div>
        <div className="divide-y divide-gray-100">
          {sortedTxns.map((txn, i) => (
            <div key={i} className="flex items-center justify-between px-5 py-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-xs text-gray-500">
                    {txn.date ? fmtDateShort(txn.date) : shortMonth(txn.ym)}
                    <span className="ml-2 text-gray-400">{shortMonth(txn.ym)}</span>
                  </p>
                  {txn.accountLabel && (
                    <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{txn.accountLabel}</span>
                  )}
                </div>
                <span
                  className="mt-0.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs capitalize"
                  style={{ backgroundColor: categoryColor(txn.category) + "18", color: categoryColor(txn.category) }}
                >
                  {txn.category}
                </span>
              </div>
              <p className="ml-4 shrink-0 text-sm font-semibold text-gray-800 tabular-nums">
                −{fmtDec(Math.abs(txn.amount), txn.currency, homeCurrency)}
              </p>
            </div>
          ))}
        </div>
      </div>
      </div>
    </MerchantForecastProvider>
  );
}
