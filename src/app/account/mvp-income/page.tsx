"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import { computeDetailedIncomeMetrics, type DetailedIncomeMetrics } from "@/lib/incomeMetrics";
import type { MonthlyHistoryEntry, FinancialProfileCache } from "@/lib/financialProfile";
import type { IncomeTxnRecord } from "@/lib/extractTransactions";
import { fmt } from "@/lib/currencyUtils";

interface IncomePageData {
  profile: FinancialProfileCache;
  metrics: DetailedIncomeMetrics;
}

export default function MvpIncomePage() {
  const router = useRouter();
  const { buildHeaders } = useActiveProfile();
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<IncomePageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<"overview" | "sources" | "categories" | "transactions">("overview");

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
    });
  }, [router]);

  useEffect(() => {
    if (!token) return;

    const loadData = async () => {
      try {
        const res = await fetch("/api/user/statements/consolidated", {
          headers: buildHeaders(token),
        });
        
        if (res.ok) {
          const profile: FinancialProfileCache = await res.json();
          const currentYear = new Date().getFullYear();
          const metrics = computeDetailedIncomeMetrics(
            profile.monthlyHistory,
            profile.incomeTxns,
            "last3",
            currentYear,
            true
          );
          
          setData({ profile, metrics });
        }
      } catch (error) {
        console.error("Failed to load income data:", error);
      } finally {
        setLoading(false);
      }
    };

    loadData();
  }, [token, buildHeaders]);

  if (loading || !data) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-violet-600 border-t-transparent" />
      </div>
    );
  }

  const { profile, metrics } = data;
  const currency = profile.homeCurrency;

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-white">
      <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mb-6 flex items-baseline gap-3">
          <h1 className="text-[28px] font-bold leading-tight tracking-tight text-gray-900">Income</h1>
          <span className="text-[13px] text-gray-400">Cash flow · example data</span>
        </div>

        {/* Tabs */}
        <div className="mb-6 flex gap-2">
          {["overview", "sources", "categories", "transactions"].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab as typeof activeTab)}
              className={`rounded-full border px-4 py-2 text-[14px] font-medium transition-all ${
                activeTab === tab
                  ? "border-gray-900 bg-gray-900 text-white shadow-sm"
                  : "border-gray-200 bg-white text-gray-500 hover:border-gray-400 hover:text-gray-900"
              }`}
            >
              {tab.charAt(0).toUpperCase() + tab.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {activeTab === "overview" && (
          <>
            {/* Summary Cards */}
            <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
              <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
                <div className="text-[12px] font-bold uppercase tracking-wider text-gray-500">Current monthly</div>
                <div className="mt-1 text-[28px] font-bold leading-tight tracking-tight text-gray-900">
                  {fmt(metrics.currentMonthly, currency)}
                </div>
                <div className="mt-1 text-[12px] text-gray-400">
                  regular take-home · {metrics.currentBasisLabel}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
                <div className="text-[12px] font-bold uppercase tracking-wider text-gray-500">12-month average</div>
                <div className="mt-1 text-[28px] font-bold leading-tight tracking-tight text-gray-900">
                  {fmt(metrics.averageMonthly, currency)}
                </div>
                <div className="mt-1 text-[12px] text-gray-400">
                  regular pay, {profile.allTxMonths[0]} to {profile.allTxMonths[profile.allTxMonths.length - 1]}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
                <div className="text-[12px] font-bold uppercase tracking-wider text-gray-500">This year</div>
                <div className="mt-1 text-[28px] font-bold leading-tight tracking-tight text-gray-900">
                  {fmt(metrics.ytdTotal, currency)}
                </div>
                <div className="mt-1 text-[12px] text-gray-400">
                  projected {fmt(metrics.projectedFullYear, currency)} incl. {fmt(metrics.ytdOneOff, currency)} bonus
                </div>
              </div>
            </div>

            {/* Monthly Income Chart */}
            <div className="rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-[15px] font-bold text-gray-900">Monthly income</h2>
                <div className="flex gap-4 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-violet-600" />
                    Regular pay
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-400" />
                    One-off
                  </span>
                </div>
              </div>
              <div className="h-48 text-[11px] text-gray-400">
                [12-month income chart would go here - reuse existing chart component]
              </div>
            </div>

            {/* Sources Table */}
            <div className="mt-6 rounded-2xl border border-gray-200/60 bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-[15px] font-bold text-gray-900">Sources</h2>
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="pb-3 pr-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      Source
                    </th>
                    <th className="pb-3 px-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      Type
                    </th>
                    <th className="pb-3 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      Last 3 months
                    </th>
                    <th className="pb-3 px-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      12-month avg
                    </th>
                    <th className="pb-3 pl-3 text-right text-[11px] font-semibold uppercase tracking-wider text-gray-400">
                      This year
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.regularSources.slice(0, 3).map((source, idx) => (
                    <tr key={idx} className="border-b border-gray-50">
                      <td className="py-3 pr-3 text-gray-900">{source.source}</td>
                      <td className="py-3 px-3 text-gray-500">Regular</td>
                      <td className="py-3 px-3 text-right tabular-nums text-gray-900">
                        {fmt(source.amount, currency)}/mo
                      </td>
                      <td className="py-3 px-3 text-right tabular-nums text-gray-900">
                        {fmt(source.amount, currency)}/mo
                      </td>
                      <td className="py-3 pl-3 text-right tabular-nums text-gray-900">
                        {fmt(source.amount * 12, currency)}
                      </td>
                    </tr>
                  ))}
                  {metrics.oneOffSources.slice(0, 1).map((source, idx) => (
                    <tr key={`oneoff-${idx}`} className="border-b border-gray-50">
                      <td className="py-3 pr-3 text-gray-900">{source.source}</td>
                      <td className="py-3 px-3">
                        <span className="inline-block rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-900">
                          one-off
                        </span>
                      </td>
                      <td className="py-3 px-3 text-right text-gray-400">—</td>
                      <td className="py-3 px-3 text-right text-gray-400">—</td>
                      <td className="py-3 pl-3 text-right tabular-nums text-gray-900">
                        {fmt(source.amount, currency)}
                      </td>
                    </tr>
                  ))}
                  <tr className="font-semibold">
                    <td className="pt-3 pr-3">Total</td>
                    <td className="pt-3 px-3" />
                    <td className="pt-3 px-3 text-right tabular-nums">
                      {fmt(metrics.currentMonthly, currency)}/mo
                    </td>
                    <td className="pt-3 px-3 text-right tabular-nums">
                      {fmt(metrics.averageMonthly, currency)}/mo
                    </td>
                    <td className="pt-3 pl-3 text-right tabular-nums">{fmt(metrics.ytdTotal, currency)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Other tabs would show different views */}
        {activeTab !== "overview" && (
          <div className="rounded-2xl border border-gray-200/60 bg-white p-12 text-center shadow-sm">
            <p className="text-gray-400">{activeTab.charAt(0).toUpperCase() + activeTab.slice(1)} view coming soon</p>
          </div>
        )}
      </div>
    </div>
  );
}
