"use client";

/**
 * PromoDashboardBanner
 *
 * Shown at the top of the dashboard for free-plan users when an active
 * promo campaign exists. Users must TYPE their code — it is never revealed
 * by the API, so the offer stays exclusive to people who know the code.
 */

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";

interface FeaturedCampaign {
  durationDays: number;
  description: string;
}

function durationLabel(days: number): string {
  if (days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? "s" : ""}`;
  if (days % 30 === 0)  return `${days / 30} month${days / 30 > 1 ? "s" : ""}`;
  return `${days} days`;
}

export default function PromoDashboardBanner() {
  const { planId, refresh } = usePlan();

  const [campaign,   setCampaign]   = useState<FeaturedCampaign | null>(null);
  const [code,       setCode]       = useState("");
  const [idToken,    setIdToken]    = useState<string | null>(null);
  const [applying,   setApplying]   = useState(false);
  const [error,      setError]      = useState<string | null>(null);
  const [success,    setSuccess]    = useState(false);
  const [expiresAt,  setExpiresAt]  = useState<string | null>(null);
  const [dismissed,  setDismissed]  = useState(false);

  // Fetch active campaign on mount
  useEffect(() => {
    if (planId !== "free") return;
    fetch("/api/promo/featured")
      .then((r) => r.json())
      .then((d) => setCampaign(d.campaign ?? null))
      .catch(() => {});
  }, [planId]);

  // Auth token for redemption
  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      setIdToken(user ? await user.getIdToken() : null);
    });
  }, []);

  async function handleApply() {
    const trimmed = code.trim().toUpperCase();
    if (!trimmed || !idToken) return;
    setApplying(true);
    setError(null);
    try {
      const res  = await fetch("/api/user/redeem-promo", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code: trimmed }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Invalid code. Please check and try again.");
        return;
      }
      setExpiresAt(data.expiresAt ?? null);
      setSuccess(true);
      await refresh(); // update plan context immediately
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setApplying(false);
    }
  }

  // Only render for free users with an active campaign
  if (planId !== "free" || !campaign || dismissed) return null;

  const duration = durationLabel(campaign.durationDays);

  if (success) {
    const expiry = expiresAt
      ? new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : null;

    return (
      <div className="mb-4 rounded-2xl border border-green-200 bg-green-50 px-6 py-5">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-green-100">
              <svg className="h-6 w-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="text-base font-bold text-green-900">You&apos;re on Pro! 🎉</p>
              <p className="mt-0.5 text-sm text-green-700">
                {duration} of Pro access is now active.{" "}
                {expiry && <span>Access expires <strong>{expiry}</strong>.</span>}
              </p>
              <p className="mt-1 text-xs text-green-600">
                All features are unlocked — forecasts, AI insights, goals, debt planner, and more.
              </p>
            </div>
          </div>
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 text-green-400 hover:text-green-600 transition"
            aria-label="Dismiss"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-purple-200 bg-gradient-to-r from-purple-50 to-white px-5 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0 flex-1">
          <span className="text-xl shrink-0 mt-0.5" aria-hidden="true">🎉</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-bold text-purple-900">
              Special offer — get {duration} of Pro free
            </p>
            <p className="text-xs text-purple-600 mt-0.5">
              Have a promo code? Enter it below to unlock all Pro features instantly.
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <input
                value={code}
                onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
                onKeyDown={(e) => e.key === "Enter" && handleApply()}
                placeholder="Enter code"
                maxLength={32}
                className="w-44 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-sm font-mono uppercase tracking-wide placeholder:normal-case placeholder:tracking-normal focus:outline-none focus:ring-2 focus:ring-purple-400"
              />
              <button
                onClick={handleApply}
                disabled={applying || !code.trim()}
                className="rounded-lg bg-purple-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50 transition"
              >
                {applying ? "Applying…" : "Apply"}
              </button>
            </div>

            {error && (
              <p className="mt-1.5 text-xs text-red-600">{error}</p>
            )}
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-purple-300 hover:text-purple-500 transition mt-0.5"
          aria-label="Dismiss"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
