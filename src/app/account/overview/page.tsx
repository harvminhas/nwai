"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ConsolidatedCurrentDashboard from "@/components/ConsolidatedCurrentDashboard";
import type { DashboardAlert } from "@/app/api/user/insights/route";
import ParseStatusBanner from "@/components/ParseStatusBanner";

// ── page ──────────────────────────────────────────────────────────────────────

export default function OverviewPage() {
  const router = useRouter();

  const [alerts,  setAlerts]  = useState<DashboardAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [token,   setToken]   = useState<string | null>(null);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const res  = await fetch("/api/user/insights", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      if (res.ok) setAlerts(json.alerts ?? []);
    } catch { /* non-critical */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      load(tok);
    });
  }, [router, load]);

  const urgentCount = alerts.filter((a) => a.severity === "high" || a.severity === "medium").length;

  return (
    <div>
      {/* ── Financial snapshot ────────────────────────────────────────── */}
      <div className="mx-auto max-w-4xl px-4 pt-5 pb-6 sm:px-6">

        {token && <ParseStatusBanner onRefresh={() => load(token)} />}

        <div className="mb-5">
          <h1 className="text-2xl font-bold text-gray-900">Financial Health</h1>
          <p className="mt-0.5 text-sm text-gray-400">Your net worth, balances, and account snapshot</p>
        </div>

        <ConsolidatedCurrentDashboard />
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
    </div>
  );
}
