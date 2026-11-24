"use client";

/**
 * Daily spend target on Tools → Trackers. Same API and card as the Daily
 * spend page; no tracker math here. With no target, points to Daily spend.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import type { DailySpendTrackerView } from "@/lib/dailySpendTracker";
import { TrackerCard as DailySpendTrackerCard } from "./TrackerCard";

export const DAILY_SPEND_HREF = "/account/tools/daily-spend";
export const START_FROM_DAILY_SPEND_LABEL = "Start one from Daily spend";

type ConfirmFn = (options: {
  title: string;
  message: string;
  confirmLabel?: string;
  variant?: "danger" | "default";
}) => Promise<boolean>;

export function DailySpendTrackerSection({
  token,
  confirm,
  onError,
}: {
  token: string | null;
  confirm: ConfirmFn;
  onError?: (message: string) => void;
}) {
  const [loading, setLoading] = useState(true);
  const [stopping, setStopping] = useState(false);
  const [view, setView] = useState<DailySpendTrackerView | null>(null);
  const [currency, setCurrency] = useState("CAD");

  useEffect(() => {
    if (!token) return;
    const abort = new AbortController();
    (async () => {
      try {
        const res = await fetch("/api/user/daily-spend/tracker", {
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        if (!res.ok) throw new Error("Failed to load daily spend target");
        const body = (await res.json()) as {
          tracker: DailySpendTrackerView | null;
          currency?: string;
        };
        if (abort.signal.aborted) return;
        setView(body.tracker ?? null);
        if (body.currency) setCurrency(body.currency);
      } catch (err) {
        if (abort.signal.aborted) return;
        onError?.(err instanceof Error ? err.message : "Failed to load daily spend target");
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function stopTracking() {
    if (!token) return;
    const ok = await confirm({
      title: "Stop tracking?",
      message: "This clears your daily target and month-by-month results.",
      confirmLabel: "Stop tracking",
      variant: "danger",
    });
    if (!ok) return;
    setStopping(true);
    try {
      const res = await fetch("/api/user/daily-spend/tracker", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to stop tracking");
      setView(null);
    } catch (err) {
      onError?.(err instanceof Error ? err.message : "Failed to stop tracking");
    } finally {
      setStopping(false);
    }
  }

  if (loading) return null;

  return (
    <section className="mb-6 min-w-0" aria-labelledby="daily-spend-target-heading">
      <div className="mb-2 flex min-w-0 flex-wrap items-baseline justify-between gap-2">
        <h2 id="daily-spend-target-heading" className="text-sm font-semibold text-gray-900">
          Daily spend target
        </h2>
        <Link
          href={DAILY_SPEND_HREF}
          className="text-sm font-medium text-emerald-800 hover:underline"
        >
          Open Daily spend
        </Link>
      </div>
      {view ? (
        <div className="max-w-xl">
          <DailySpendTrackerCard
            view={view}
            currency={currency}
            onStop={stopTracking}
            stopping={stopping}
          />
        </div>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-600">
          No daily spend target yet.{" "}
          <Link href={DAILY_SPEND_HREF} className="font-medium text-emerald-800 hover:underline">
            {START_FROM_DAILY_SPEND_LABEL} →
          </Link>
        </div>
      )}
    </section>
  );
}
