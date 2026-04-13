"use client";

/**
 * PromoClaimBanner
 *
 * Silently checks localStorage for a pending promo code (set by /promo/[code])
 * and auto-redeems it once the user is authenticated.
 *
 * Mount this once inside the authenticated app shell (e.g. dashboard).
 * It renders nothing if there is no pending code; shows a dismissible
 * success/error banner after attempting redemption.
 */

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";

const PROMO_STORAGE_KEY = "nwai_pending_promo";

type BannerState = "idle" | "redeeming" | "success" | "error" | "already_active";

function durationLabel(days: number): string {
  if (days % 365 === 0) return `${days / 365} year${days / 365 > 1 ? "s" : ""}`;
  if (days % 30 === 0)  return `${days / 30} month${days / 30 > 1 ? "s" : ""}`;
  return `${days} days`;
}

export default function PromoClaimBanner() {
  const [state,     setState]     = useState<BannerState>("idle");
  const [duration,  setDuration]  = useState<string>("");
  const [message,   setMessage]   = useState<string>("");
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only attempt if there's a stored code
    const stored = (() => { try { return localStorage.getItem(PROMO_STORAGE_KEY); } catch { return null; } })();
    if (!stored) return;

    const { auth } = getFirebaseClient();
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) return;
      setState("redeeming");

      try {
        const token = await user.getIdToken();
        const res   = await fetch("/api/user/redeem-promo", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ code: stored }),
        });
        const data = await res.json();

        if (res.ok) {
          setDuration(durationLabel(data.durationDays));
          setState("success");
          try { localStorage.removeItem(PROMO_STORAGE_KEY); } catch { /* ignore */ }
        } else if (data.error?.includes("already have an active promo")) {
          setState("already_active");
          try { localStorage.removeItem(PROMO_STORAGE_KEY); } catch { /* ignore */ }
        } else {
          setMessage(data.error ?? "Could not apply promo code.");
          setState("error");
        }
      } catch {
        setMessage("Could not apply promo code. Try visiting your promo link again.");
        setState("error");
      }
    });

    return () => unsub();
  }, []);

  if (state === "idle" || state === "redeeming" || dismissed) return null;

  if (state === "success") {
    return (
      <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div>
            <p className="text-sm font-semibold text-green-900">Promo applied — you&apos;re on Pro!</p>
            <p className="text-xs text-green-700 mt-0.5">
              {duration} of Pro access has been added to your account. All features are now unlocked.
            </p>
          </div>
        </div>
        <button onClick={() => setDismissed(true)} className="shrink-0 text-green-500 hover:text-green-700 transition text-xs mt-0.5">✕</button>
      </div>
    );
  }

  if (state === "already_active") {
    return (
      <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
        <p className="text-sm text-blue-800">You already have active Pro access — no action needed.</p>
        <button onClick={() => setDismissed(true)} className="shrink-0 text-blue-400 hover:text-blue-600 transition text-xs">✕</button>
      </div>
    );
  }

  if (state === "error") {
    return (
      <div className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
        <div className="flex items-start gap-2.5">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm text-amber-800">{message}</p>
        </div>
        <button onClick={() => setDismissed(true)} className="shrink-0 text-amber-500 hover:text-amber-700 transition text-xs">✕</button>
      </div>
    );
  }

  return null;
}
