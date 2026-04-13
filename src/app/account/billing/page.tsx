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

interface FeaturedCampaign {
  durationDays: number;
  description: string;
}

function durationLabel(days: number): string {
  if (days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? "s" : ""}`;
  if (days % 30 === 0)  return `${days / 30} month${days / 30 > 1 ? "s" : ""}`;
  return `${days} days`;
}

function BillingContent() {
  const { planId, loading: planLoading, refresh } = usePlan();
  const searchParams = useSearchParams();
  const router       = useRouter();

  const [token,        setToken]        = useState<string | null>(null);
  const [working,      setWorking]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const [successMsg,   setSuccessMsg]   = useState<string | null>(null);
  const [featured,     setFeatured]     = useState<FeaturedCampaign | null | undefined>(undefined);
  const [promoCode,    setPromoCode]    = useState("");
  const [promoApplying,setPromoApplying]= useState(false);
  const [promoError,   setPromoError]   = useState<string | null>(null);
  const [promoSuccess, setPromoSuccess] = useState(false);
  const [promoExpiry,  setPromoExpiry]  = useState<string | null>(null);

  const [subInfo, setSubInfo] = useState<{
    status?: string;
    currentPeriodEnd?: string;
    cancelAtPeriodEnd?: boolean;
    manualPro?: boolean;
    _raw?: Record<string, unknown>;
  } | null>(null);

  const fetchSubInfo = async (tok: string) => {
    const res  = await fetch("/api/user/billing-info", { headers: { Authorization: `Bearer ${tok}` } });
    const json = res.ok ? await res.json().catch(() => ({})) : {};
    setSubInfo(json);
    // Always refresh PlanContext — billing-info syncs Firestore as a side-effect
    // so /api/user/plan will return the correct plan regardless of webhook status.
    await refresh();
    return json;
  };

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken(/* forceRefresh */ true);
      setToken(tok);
      await fetchSubInfo(tok);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  // When returning from Stripe portal via client-side navigation the component
  // doesn't remount, so onAuthStateChanged won't re-fire. Watch for searchParams
  // changing while we already have a token (covers the ?from_portal=1 redirect).
  useEffect(() => {
    if (!token || !searchParams.get("from_portal")) return;
    fetchSubInfo(token);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, searchParams]);

  // Re-fetch whenever the user returns to this tab/page (covers portal redirect,
  // bfcache restore, alt-tab back, etc.)
  useEffect(() => {
    const refetch = () => {
      if (document.visibilityState !== "visible") return;
      const { auth } = getFirebaseClient();
      const user = auth.currentUser;
      if (!user) return;
      user.getIdToken(true).then((tok) => {
        setToken(tok);
        fetchSubInfo(tok);
      });
    };
    document.addEventListener("visibilitychange", refetch);
    // also covers bfcache (browser back/forward)
    window.addEventListener("pageshow", refetch);
    return () => {
      document.removeEventListener("visibilitychange", refetch);
      window.removeEventListener("pageshow", refetch);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Handle return from Stripe Checkout — poll until webhook updates Firestore
  useEffect(() => {
    if (searchParams.get("canceled")) {
      setError("Checkout was cancelled. You were not charged.");
      return;
    }
    if (!searchParams.get("session_id")) return;

    // Poll /api/user/plan up to 10 times (10 s) waiting for webhook to land
    let attempts = 0;
    const MAX = 10;
    const poll = async () => {
      await refresh();
      attempts++;
      // planId won't update synchronously — re-check via API directly
      const { auth } = (await import("@/lib/firebase")).getFirebaseClient();
      const user = auth.currentUser;
      if (!user) return;
      const tok  = await user.getIdToken();
      const res  = await fetch("/api/user/plan", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json().catch(() => ({}));
      if (json.plan === "pro") {
        setSuccessMsg("You're now on Pro! Welcome aboard.");
        return;
      }
      if (attempts < MAX) setTimeout(poll, 1000);
      else setSuccessMsg("You're now on Pro! Welcome aboard."); // show anyway
    };
    poll();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch featured promo campaign once on mount
  useEffect(() => {
    fetch("/api/promo/featured")
      .then((r) => r.json())
      .then((d) => setFeatured(d.campaign ?? null))
      .catch(() => setFeatured(null));
  }, []);

  async function handleApplyPromo() {
    const trimmed = promoCode.trim().toUpperCase();
    if (!trimmed || !token) return;
    setPromoApplying(true); setPromoError(null);
    try {
      const res  = await fetch("/api/user/redeem-promo", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) { setPromoError(data.error ?? "Invalid code."); return; }
      setPromoExpiry(data.expiresAt ?? null);
      setPromoSuccess(true);
      await refresh();
    } catch {
      setPromoError("Something went wrong. Please try again.");
    } finally {
      setPromoApplying(false);
    }
  }

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

  const isManualPro       = subInfo?.manualPro === true;
  const subStatus         = subInfo?.status ?? null;
  const cancelAtPeriodEnd = subInfo?.cancelAtPeriodEnd === true;
  // When Stripe data is loaded, use it exclusively — never fall back to the
  // cached planId (which could still say "pro" after cancellation).
  const isSubActive = subStatus === "active" || subStatus === "trialing";
  const isPro       = isManualPro || (subInfo !== null ? isSubActive : planId === "pro");
  const periodEnd   = subInfo?.currentPeriodEnd
    ? new Date(subInfo.currentPeriodEnd).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
    : null;

  if (planLoading && !subInfo) return (
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

      {/* Special offer banner — shown only to free users when a campaign is live */}
      {!isPro && featured && !promoSuccess && (
        <div className="mb-6 rounded-2xl border border-purple-200 bg-gradient-to-r from-purple-50 to-white px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-xl shrink-0 mt-0.5" aria-hidden="true">🎉</span>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-purple-900">
                Special offer — get {durationLabel(featured.durationDays)} of Pro free
              </p>
              <p className="text-xs text-purple-600 mt-0.5">
                Have a promo code? Enter it below to unlock all Pro features instantly.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  value={promoCode}
                  onChange={(e) => { setPromoCode(e.target.value.toUpperCase()); setPromoError(null); }}
                  onKeyDown={(e) => e.key === "Enter" && handleApplyPromo()}
                  placeholder="Enter code"
                  maxLength={32}
                  className="w-44 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-sm font-mono uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-purple-400"
                />
                <button
                  onClick={handleApplyPromo}
                  disabled={promoApplying || !promoCode.trim()}
                  className="rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
                >
                  {promoApplying ? "Applying…" : "Apply"}
                </button>
              </div>
              {promoError && <p className="mt-1.5 text-xs text-red-600">{promoError}</p>}
            </div>
          </div>
        </div>
      )}
      {promoSuccess && (() => {
        const expiry = promoExpiry
          ? new Date(promoExpiry).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
          : null;
        const dur = featured ? durationLabel(featured.durationDays) : "Pro";
        return (
          <div className="mb-6 rounded-2xl border border-green-200 bg-green-50 px-6 py-5">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-100">
                <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <div>
                <p className="text-base font-bold text-green-900">You&apos;re on Pro! 🎉</p>
                <p className="mt-0.5 text-sm text-green-700">
                  {dur} of Pro access is now active.{" "}
                  {expiry && <span>Access expires <strong>{expiry}</strong>.</span>}
                </p>
                <p className="mt-1 text-xs text-green-600">
                  All features are unlocked — forecasts, AI insights, goals, debt planner, and more.
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Current plan banner */}
      <div className={`rounded-2xl border p-5 mb-6 ${
        subStatus === "canceled"  ? "border-gray-300 bg-gray-50"
        : cancelAtPeriodEnd       ? "border-amber-200 bg-amber-50"
        : isPro                   ? "border-purple-200 bg-purple-50"
        : "border-gray-200 bg-white"
      }`}>
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-1">Current plan</p>
            <div className="flex items-center gap-2">
              <p className="text-xl font-bold text-gray-900">
                {isPro && subStatus !== "canceled" ? "Pro" : "Free"}
              </p>
              {isPro && !cancelAtPeriodEnd && subStatus !== "canceled" && (
                <span className="rounded-full bg-purple-600 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Active
                </span>
              )}
              {cancelAtPeriodEnd && subStatus !== "canceled" && (
                <span className="rounded-full bg-amber-500 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Cancelling
                </span>
              )}
              {subStatus === "canceled" && (
                <span className="rounded-full bg-gray-400 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                  Cancelled
                </span>
              )}
              {isManualPro && (
                <span className="rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-semibold text-gray-600">
                  Complimentary
                </span>
              )}
            </div>
            {isPro && !isManualPro && subStatus !== "canceled" && periodEnd && (
              <p className="mt-1 text-xs text-gray-500">
                {cancelAtPeriodEnd
                  ? `Pro access until ${periodEnd} — you won't be charged again`
                  : `Renews ${periodEnd}`}
              </p>
            )}
            {subStatus === "canceled" && (
              <p className="mt-1 text-xs text-gray-500">Your subscription has ended.</p>
            )}
          </div>
          <div className="flex flex-col items-end gap-2 shrink-0">
            <div className="text-right">
              <p className="text-2xl font-bold text-gray-900">
                {isPro && subStatus !== "canceled" ? "$9.99" : "$0"}
              </p>
              <p className="text-xs text-gray-400">
                {isPro && subStatus !== "canceled" ? "/ month" : "free"}
              </p>
            </div>
            {/* Manual refresh button */}
            {token && (
              <button
                onClick={() => fetchSubInfo(token)}
                className="text-[11px] text-gray-400 hover:text-gray-600 underline"
              >
                Refresh status
              </button>
            )}
          </div>
        </div>

        {isPro && !isManualPro && subStatus !== "canceled" && (
          <div className="mt-4 flex gap-2">
            {cancelAtPeriodEnd ? (
              <>
                <button
                  onClick={handleManage}
                  disabled={working}
                  className="flex-1 rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition disabled:opacity-60"
                >
                  {working ? "Opening portal…" : "Resume subscription"}
                </button>
                <button
                  onClick={handleManage}
                  disabled={working}
                  className="rounded-lg border border-gray-200 bg-white px-4 py-2.5 text-sm font-medium text-gray-500 hover:bg-gray-50 transition disabled:opacity-60"
                >
                  Manage
                </button>
              </>
            ) : (
              <button
                onClick={handleManage}
                disabled={working}
                className="w-full rounded-lg border border-purple-300 bg-white py-2.5 text-sm font-semibold text-purple-700 hover:bg-purple-50 transition disabled:opacity-60"
              >
                {working ? "Opening portal…" : "Manage subscription →"}
              </button>
            )}
          </div>
        )}
        {subStatus === "canceled" && (
          <button
            onClick={handleUpgrade}
            disabled={working}
            className="mt-4 w-full rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 py-2.5 text-sm font-bold text-white hover:from-purple-700 hover:to-purple-800 transition shadow-sm disabled:opacity-60"
          >
            {working ? "Redirecting…" : "Resubscribe to Pro →"}
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
