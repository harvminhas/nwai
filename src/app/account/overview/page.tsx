"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import ConsolidatedCurrentDashboard from "@/components/ConsolidatedCurrentDashboard";
import { FinancialFutureModules } from "@/components/FinancialFutureModules";
import type { DashboardAlert } from "@/app/api/user/insights/route";
import ParseStatusBanner from "@/components/ParseStatusBanner";
import { getCurrencySymbol, HOME_CURRENCY } from "@/lib/currencyUtils";

// ── page ──────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const router = useRouter();
  const { buildHeaders } = useActiveProfile();

  const [alerts,  setAlerts]  = useState<DashboardAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState<string | null>(null);

  const [monthlyExpenses, setMonthlyExpenses] = useState(0);
  const [liquidAssets, setLiquidAssets] = useState(0);
  const [incomeHistory, setIncomeHistory] = useState<{ incomeTotal: number }[]>([]);
  const [healthHc, setHealthHc] = useState(HOME_CURRENCY);
  const [healthReady, setHealthReady] = useState(false);
  const [retirementOpen, setRetirementOpen] = useState(false);
  const [insuranceOpen, setInsuranceOpen] = useState(false);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const res  = await fetch("/api/user/insights", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setAlerts(json.alerts ?? []);
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  }, []);

  const handleAllParsesComplete = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch("/api/user/pending-setup", { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if ((json.pendingCount ?? 0) > 0) {
        try {
          const raw = localStorage.getItem("nwai_setup_session");
          const ids: string[] = raw ? JSON.parse(raw) : [];
          const idParam = ids.length > 0 ? `?ids=${ids.join(",")}` : "";
          router.push(`/account/setup${idParam}`);
        } catch {
          router.push("/account/setup");
        }
      }
    } catch { /* ignore */ }
  }, [token, router]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      load(tok);
    });
  }, [router, load]);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setHealthReady(false);
    (async () => {
      try {
        const res = await fetch("/api/user/statements/consolidated", {
          headers: buildHeaders(token),
        });
        const json = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) {
          setMonthlyExpenses(json.typicalMonthlyExpenses ?? 0);
          setLiquidAssets(json.liquidAssets ?? 0);
          setIncomeHistory(Array.isArray(json.history) ? json.history : []);
          setHealthHc(json.homeCurrency ?? HOME_CURRENCY);
        }
      } catch {
        /* non-critical */
      } finally {
        if (!cancelled) setHealthReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token, buildHeaders]);

  const urgentCount = alerts.filter((a) => a.severity === "high" || a.severity === "medium").length;
  const healthSym = getCurrencySymbol(healthHc);

  return (
    <div>
      {/* ── Financial snapshot ────────────────────────────────────────── */}
      <div className="mx-auto max-w-4xl px-4 pt-5 pb-6 sm:px-6">

        {token && (
          <ParseStatusBanner onRefresh={() => load(token)} onAllComplete={handleAllParsesComplete} />
        )}

        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">Financial Health</h1>
          <p className="mt-0.5 text-sm text-gray-400">Your net worth, balances, and readiness snapshot</p>
        </div>

        <ConsolidatedCurrentDashboard />

        {healthReady && (
          <div className="mt-10 pt-8 border-t border-gray-100">
            <FinancialFutureModules
              monthlyExpenses={monthlyExpenses}
              liquidAssets={liquidAssets}
              history={incomeHistory}
              currencySymbol={healthSym}
              onRetirementOpen={() => setRetirementOpen(true)}
              onInsuranceOpen={() => setInsuranceOpen(true)}
            />
          </div>
        )}
      </div>

      {/* ── Compact Today shortcut ───────────────────────────────────── */}
      {!loading && (
        <div className="border-t border-gray-100">
          <div className="mx-auto max-w-4xl px-4 py-4 sm:px-6">
            <Link
              href="/account/dashboard"
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm hover:border-purple-300 hover:shadow-md transition group"
            >
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-full bg-purple-50 text-purple-600 group-hover:bg-purple-100 transition">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Today — alerts &amp; upcoming</p>
                  <p className="text-xs text-gray-400">
                    {urgentCount > 0
                      ? `${urgentCount} alert${urgentCount !== 1 ? "s" : ""} need${urgentCount === 1 ? "s" : ""} attention`
                      : "No urgent alerts right now"}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {urgentCount > 0 && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-700">
                    {urgentCount}
                  </span>
                )}
                <svg className="h-4 w-4 text-gray-300 group-hover:text-purple-400 transition" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                </svg>
              </div>
            </Link>
          </div>
        </div>
      )}

      {retirementOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Retirement readiness</h2>
            <p className="text-sm text-gray-500 mb-4">
              Coming soon — we&apos;ll project your trajectory to retirement and show if you&apos;re on track.
            </p>
            <button
              type="button"
              onClick={() => setRetirementOpen(false)}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}

      {insuranceOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/20 px-4">
          <div className="w-full max-w-md rounded-2xl bg-white shadow-xl p-6">
            <h2 className="text-base font-semibold text-gray-900 mb-2">Life insurance gap</h2>
            <p className="text-sm text-gray-500 mb-4">
              Coming soon — we&apos;ll calculate the coverage gap to keep your family financially secure.
            </p>
            <button
              type="button"
              onClick={() => setInsuranceOpen(false)}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
