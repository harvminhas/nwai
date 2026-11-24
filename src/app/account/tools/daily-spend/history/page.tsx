"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { IntactAmount } from "@/components/IntactAmount";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatMonthYear } from "@/lib/dateFormatting";
import type { DailySpendTrackerView } from "@/lib/dailySpendTracker";
import {
  CARD_CLASS,
  PAGE_CLASS,
  PAGE_INNER_CLASS,
  SUBTITLE_CLASS,
  TITLE_CLASS,
} from "../dailySpendReadLayout";

function money(amount: number, currency: string): string {
  return formatCurrency(amount, currency, undefined, true);
}

function moneyPerDay(amount: number, currency: string): string {
  return `${money(amount, currency)}/day`;
}

export default function DailySpendTrackerHistoryPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<DailySpendTrackerView | null>(null);
  const [currency, setCurrency] = useState("CAD");

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      setToken(await user.getIdToken());
    });
  }, [router]);

  useEffect(() => {
    if (!token) return;
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    (async () => {
      try {
        const res = await fetch("/api/user/daily-spend/tracker", {
          headers: { Authorization: `Bearer ${token}` },
          signal: abort.signal,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(typeof body.error === "string" ? body.error : "Failed to load history");
        }
        const body = (await res.json()) as {
          tracker: DailySpendTrackerView | null;
          currency?: string;
        };
        if (!abort.signal.aborted) {
          setView(body.tracker);
          if (body.currency) setCurrency(body.currency);
        }
      } catch (err) {
        if (abort.signal.aborted) return;
        setError(err instanceof Error ? err.message : "Failed to load history");
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [token]);

  if (loading && !view) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error && !view) {
    return (
      <div className={PAGE_CLASS}>
        <div className={PAGE_INNER_CLASS}>
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  const months = [...(view?.finishedMonths ?? [])].reverse();

  return (
    <div className={PAGE_CLASS}>
      <div className={PAGE_INNER_CLASS}>
        <Link href="/account/tools/daily-spend" className="text-sm text-emerald-800 hover:underline">
          ← Back to Daily spend
        </Link>
        <h1 className={`${TITLE_CLASS} mt-3`}>Month-by-month history</h1>
        <p className={SUBTITLE_CLASS}>Finished months only. This month is not in this list.</p>

        {!view ? (
          <div className={`${CARD_CLASS} mt-4`}>
            <p className="text-sm text-gray-600">You are not tracking a daily target yet.</p>
          </div>
        ) : (
          <>
            <div className={`${CARD_CLASS} mt-4`}>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
                Total kept
              </p>
              <IntactAmount
                className={`mt-2 block text-3xl font-semibold ${
                  view.totalKept < 0 ? "text-red-700" : "text-gray-900"
                }`}
              >
                {money(view.totalKept, currency)}
              </IntactAmount>
              <p className="mt-2 text-sm text-gray-500">
                Across {view.finishedMonths.length} finished{" "}
                {view.finishedMonths.length === 1 ? "month" : "months"} since{" "}
                {formatMonthYear(view.record.startMonth)}.
              </p>
            </div>

            {months.length === 0 ? (
              <div className={`${CARD_CLASS} mt-4`}>
                <p className="text-sm text-gray-600">
                  No finished month yet. Tracking starts in {formatMonthYear(view.record.startMonth)}.
                </p>
              </div>
            ) : (
              <ul className="mt-4 flex min-w-0 flex-col gap-3">
                {months.map((month) => (
                  <li key={month.yearMonth} className={CARD_CLASS}>
                    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
                      <h2 className="text-sm font-semibold text-gray-900">
                        {formatMonthYear(month.yearMonth)}
                      </h2>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
                          month.hit ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"
                        }`}
                      >
                        {month.hit ? "Hit" : "Miss"}
                      </span>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-sm">
                      <p className="text-gray-500">Actual / day</p>
                      <IntactAmount className="text-right font-medium text-gray-900">
                        {moneyPerDay(month.actualDaily, currency)}
                      </IntactAmount>
                      <p className="text-gray-500">Target / day</p>
                      <IntactAmount className="text-right font-medium text-gray-900">
                        {moneyPerDay(month.targetDaily, currency)}
                      </IntactAmount>
                      <p className="text-gray-500">Actual / month</p>
                      <IntactAmount className="text-right font-medium text-gray-900">
                        {money(month.actualMonth, currency)}
                      </IntactAmount>
                      <p className="text-gray-500">Target / month</p>
                      <IntactAmount className="text-right font-medium text-gray-900">
                        {money(month.targetMonth, currency)}
                      </IntactAmount>
                      <p className="text-gray-500">Kept</p>
                      <IntactAmount
                        className={`text-right font-medium ${
                          month.kept < 0 ? "text-red-700" : "text-emerald-800"
                        }`}
                      >
                        {money(month.kept, currency)}
                      </IntactAmount>
                      <p className="text-gray-500">Promised</p>
                      <IntactAmount className="text-right font-medium text-gray-900">
                        {money(month.promised, currency)}
                      </IntactAmount>
                    </div>
                    {month.themesOverUsual.length > 0 && (
                      <p className="mt-3 text-sm text-gray-600">
                        {month.themesOverUsual.map((t) => t.label).join(", ")} went over the usual.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
    </div>
  );
}
