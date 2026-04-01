"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";
import { PLANS } from "@/lib/plans";

const FREE_FEATURES = [
  "5 statement uploads / month",
  "6 months of history",
  "Net worth tracking",
  "Spending overview",
];

const PRO_FEATURES = [
  "Unlimited uploads",
  "Full history",
  "AI insights & chat",
  "Forecasting & projections",
  "Goals tracking",
  "Debt payoff planner",
  "CSV / PDF export",
  "What-if scenarios",
];

function BillingContent() {
  const { planId, loading: planLoading } = usePlan();
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [token,      setToken]      = useState<string | null>(null);
  const [working,    setWorking]    = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Subscription detail fetched from Firestore (via /api/user/billing-info)
  const [subInfo, setSubInfo] = useState<{
    status?: string;
    currentPeriodEnd?: string;
    manualPro?: boolean;
  } | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);

      // Fetch subscription detail
      const res  = await fetch("/api/user/billing-info", { headers: { Authorization: `Bearer ${tok}` } });
      const json = res.ok ? await res.json().catch(() => ({})) : {};
      setSubInfo(json);
    });
  }, [router]);

  // Handle return from Stripe Checkout
  useEffect(() => {
    if (searchParams.get("session_id")) {
      setSuccessMsg("You're now on Pro! Welcome aboard.");
    }
    if (searchParams.get("canceled")) {
      setError("Checkout was cancelled. You were not charged.");
    }
  }, [searchParams]);

  async function handleUpgrade() {
    if (!token) return;
    setWorking(true); setError(null);
    try {
      const res  = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error ?? "Failed to start checkout");
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setWorking(false);
    }
  }

  async function handleManage() {
    if (!token) return;
    setWorking(true); setError(null);
    try {
      const res  = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = await res.json();
      if (!res.ok || !json.url) throw new Error(json.error ?? "Failed to open portal");
      window.location.href = json.url;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setWorking(false);
    }
  }

  const isPro        = planId === "pro";
  const isManualPro  = subInfo?.manualPro === true;
  const periodEnd    = subInfo?.currentPeriodEnd
    ? new Date(subInfo.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  if (planLoading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 pt-6 pb-12 sm:px-6">
      <h1 className="text-2xl font-bold text-gray-900 mb-1">Billing</h1>
      <p className="text-sm text-gray-500 mb-8">Manage your subscription and plan.</p>

      {successMsg && (
        <div className="mb-6 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {successMsg}
        </div>
      )}
      {error && (
        <div className="mb-6 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
          {error}
        </div>
      )}

      {/* Current plan banner */}
      <div className={`rounded-2xl border p-5 mb-6 ${isPro ? "border-purple-200 bg-purple-50" : "border-gray-200 bg-white"}`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Current plan</p>
            <div className="flex items-center gap-2">
              <p className="text-xl font-bold text-gray-900">{PLANS[planId].name}</p>
              {isPro && (
                <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Active
                </span>
              )}
              {isManualPro && (
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                  Complimentary
                </span>
              )}
            </div>
            {isPro && !isManualPro && periodEnd && (
              <p className="mt-1 text-xs text-gray-500">
                {subInfo?.status === "canceled" ? "Access until" : "Renews"} {periodEnd}
              </p>
            )}
          </div>
          <div className="text-right shrink-0">
            <p className="text-2xl font-bold text-gray-900">
              {isPro ? "$9.99" : "$0"}
            </p>
            <p className="text-xs text-gray-400">{isPro ? "/ month" : "free"}</p>
          </div>
        </div>

        {isPro && !isManualPro && (
          <button
            onClick={handleManage}
            disabled={working}
            className="mt-4 w-full rounded-lg border border-purple-300 bg-white py-2.5 text-sm font-semibold text-purple-700 hover:bg-purple-50 transition disabled:opacity-60"
          >
            {working ? "Opening portal…" : "Manage subscription →"}
          </button>
        )}
      </div>

      {/* Plan comparison */}
      <div className="grid gap-4 sm:grid-cols-2">
        {/* Free */}
        <div className={`rounded-2xl border p-5 ${!isPro ? "border-gray-300 bg-white ring-2 ring-gray-200" : "border-gray-200 bg-white"}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-bold text-gray-900">Free</p>
              <p className="text-xs text-gray-400 mt-0.5">$0 forever</p>
            </div>
            {!isPro && (
              <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-gray-600">
                Current
              </span>
            )}
          </div>
          <ul className="space-y-2">
            {FREE_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-gray-600">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
        </div>

        {/* Pro */}
        <div className={`rounded-2xl border p-5 ${isPro ? "border-purple-300 bg-purple-50 ring-2 ring-purple-200" : "border-purple-200 bg-white"}`}>
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-bold text-gray-900">Pro</p>
              <p className="text-xs text-gray-400 mt-0.5">$9.99 / month</p>
            </div>
            {isPro ? (
              <span className="rounded-full bg-purple-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                Current
              </span>
            ) : (
              <span className="rounded-full bg-purple-100 px-2.5 py-0.5 text-[10px] font-semibold text-purple-700">
                Recommended
              </span>
            )}
          </div>
          <ul className="space-y-2">
            {PRO_FEATURES.map((f) => (
              <li key={f} className="flex items-start gap-2 text-sm text-gray-700">
                <svg className="mt-0.5 h-4 w-4 shrink-0 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {f}
              </li>
            ))}
          </ul>
          {!isPro && (
            <button
              onClick={handleUpgrade}
              disabled={working}
              className="mt-5 w-full rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 py-3 text-sm font-bold text-white hover:from-purple-700 hover:to-purple-800 transition shadow-sm disabled:opacity-60"
            >
              {working ? "Redirecting…" : "Upgrade to Pro →"}
            </button>
          )}
        </div>
      </div>

      <p className="mt-6 text-center text-xs text-gray-400">
        Payments are securely processed by Stripe. Cancel anytime.
      </p>
    </div>
  );
}

export default function BillingPage() {
  return (
    <Suspense>
      <BillingContent />
    </Suspense>
  );
}
