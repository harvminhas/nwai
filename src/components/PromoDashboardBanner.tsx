"use client";

/**
 * PromoDashboardBanner
 *
 * Shown at the top of the dashboard for free-plan users when an active
 * promo campaign exists. Renders as a slim collapsible pill — clicking
 * "Enter code →" expands the code input inline. Users must TYPE their
 * code — it is never revealed by the API.
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

  const [campaign,  setCampaign]  = useState<FeaturedCampaign | null>(null);
  const [code,      setCode]      = useState("");
  const [idToken,   setIdToken]   = useState<string | null>(null);
  const [applying,  setApplying]  = useState(false);
  const [error,     setError]     = useState<string | null>(null);
  const [success,   setSuccess]   = useState(false);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [expanded,  setExpanded]  = useState(false);

  useEffect(() => {
    if (planId !== "free") return;
    fetch("/api/promo/featured")
      .then((r) => r.json())
      .then((d) => setCampaign(d.campaign ?? null))
      .catch(() => {});
  }, [planId]);

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
      await refresh();
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setApplying(false);
    }
  }

  if (planId !== "free" || !campaign || dismissed) return null;

  const duration = durationLabel(campaign.durationDays);

  // ── Success state ────────────────────────────────────────────────────────
  if (success) {
    const expiry = expiresAt
      ? new Date(expiresAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })
      : null;
    return (
      <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-2.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-base shrink-0">🎉</span>
            <span className="text-sm font-semibold text-green-800">You&apos;re on Pro!</span>
            <span className="text-xs text-green-600">
              {duration} active.{expiry && <> Expires <strong>{expiry}</strong>.</>}
            </span>
          </div>
          <button onClick={() => setDismissed(true)} className="shrink-0 text-green-400 hover:text-green-600 transition" aria-label="Dismiss">
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    );
  }

  // ── Collapsed / expanded pill ────────────────────────────────────────────
  return (
    <div className="mb-4 rounded-xl border border-purple-200 bg-purple-50/60 overflow-hidden">

      {/* Slim header row — always visible */}
      <div className="flex items-center justify-between gap-3 px-4 py-2.5">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 min-w-0 flex-1 text-left group"
        >
          <span className="text-sm shrink-0" aria-hidden="true">🎉</span>
          <span className="text-xs font-semibold text-purple-800 group-hover:text-purple-900 transition truncate">
            Special offer — get {duration} of Pro free
          </span>
          <span className="ml-1 text-xs text-purple-400 shrink-0 group-hover:text-purple-600 transition">
            {expanded ? "hide" : "enter code →"}
          </span>
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="shrink-0 text-purple-300 hover:text-purple-500 transition"
          aria-label="Dismiss"
        >
          <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {/* Expanded code entry */}
      {expanded && (
        <div className="border-t border-purple-100 bg-white px-4 py-3">
          <p className="text-xs text-purple-600 mb-2">
            Have a promo code? Enter it below to unlock all Pro features instantly.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={code}
              onChange={(e) => { setCode(e.target.value.toUpperCase()); setError(null); }}
              onKeyDown={(e) => e.key === "Enter" && handleApply()}
              placeholder="Enter code"
              maxLength={32}
              autoFocus
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
          {error && <p className="mt-1.5 text-xs text-red-600">{error}</p>}
        </div>
      )}
    </div>
  );
}
