"use client";

import { useEffect, useMemo, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  buildCashFlowView,
  type CashFlowSummary,
} from "@/lib/cashFlowSummary";
import { useAccountTrendRange } from "@/lib/useAccountTrendRange";
import { CashFlowView } from "./CashFlowView";

function CashFlowPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { range, handleRangeChange } = useAccountTrendRange(searchParams);
  const [summary, setSummary] = useState<CashFlowSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const tok = await user.getIdToken();
        const res = await fetch("/api/user/cash-flow-summary", {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({ error: "Failed to load cash flow" }));
          throw new Error(data.error || "Failed to load cash flow");
        }
        const data = (await res.json()) as CashFlowSummary;
        setSummary(data);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load cash flow");
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  const view = useMemo(() => {
    if (!summary) return null;
    return buildCashFlowView(summary, range, selectedMonth);
  }, [summary, range, selectedMonth]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !summary || !view) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
        <p className="text-red-600">{error || "Failed to load cash flow"}</p>
      </div>
    );
  }

  return (
    <CashFlowView
      currency={summary.currency}
      view={view}
      range={range}
      onRangeChange={(next) => {
        handleRangeChange(next);
      }}
      onSelectMonth={setSelectedMonth}
    />
  );
}

export default function CashFlowPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-[50vh] items-center justify-center">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
        </div>
      }
    >
      <CashFlowPageContent />
    </Suspense>
  );
}
