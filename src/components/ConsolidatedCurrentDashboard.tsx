"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ConsolidatedProgressHero from "@/components/ConsolidatedProgressHero";
import NetWorthChart from "@/components/NetWorthChart";
import IncomeCard from "@/components/IncomeCard";
import ExpensesCard from "@/components/ExpensesCard";
import SavingsRateCard from "@/components/SavingsRateCard";
import SubscriptionsCard from "@/components/SubscriptionsCard";
import InsightsSection from "@/components/InsightsSection";
import DashboardCtas from "@/components/DashboardCtas";
import type { ParsedStatementData } from "@/lib/types";

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function ConsolidatedCurrentDashboard() {
  const router = useRouter();
  const [data, setData] = useState<ParsedStatementData | null>(null);
  const [previousMonth, setPreviousMonth] = useState<{
    netWorth: number;
    assets: number;
    debts: number;
  } | null>(null);
  const [yearMonth, setYearMonth] = useState<string | null>(null);
  const [history, setHistory] = useState<{ yearMonth: string; netWorth: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statementCount, setStatementCount] = useState(0);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/account/login");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch("/api/user/statements/consolidated", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          setError((json.error as string) || "Failed to load dashboard");
          return;
        }
        setData(json.data ?? null);
        setStatementCount(json.count ?? 0);
        setPreviousMonth(json.previousMonth ?? null);
        setYearMonth(json.yearMonth ?? null);
        setHistory(Array.isArray(json.history) ? json.history : []);
      } catch {
        setError("Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    });
    return () => unsubscribe();
  }, [router]);

  if (loading) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !data || !yearMonth) {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-800">{error || "No consolidated data yet."}</p>
      </div>
    );
  }

  return (
    <>
      <div className="mb-4 text-sm text-gray-500">
        As of {monthLabel(yearMonth)}
        {statementCount > 0 && ` · ${statementCount} statement${statementCount !== 1 ? "s" : ""} combined`}
      </div>

      <ConsolidatedProgressHero
        data={data}
        previousMonth={previousMonth}
        monthLabel={monthLabel(yearMonth)}
      />

      {history.length >= 2 && (
        <div className="mt-8">
          <NetWorthChart history={history} />
        </div>
      )}

      {((data.income?.total ?? 0) > 0 || (data.expenses?.total ?? 0) > 0 || (data.subscriptions?.length ?? 0) > 0) && (
        <>
          <div className="mb-6 mt-10">
            <h2 className="font-semibold text-lg text-gray-900">
              {(data.income?.total ?? 0) > 0 ? "Income & spending" : "Spending"}
            </h2>
            <p className="text-sm text-gray-500">Details from your latest statements</p>
          </div>
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-6">
              {(data.income?.total ?? 0) > 0 && <IncomeCard income={data.income} />}
              <ExpensesCard expenses={data.expenses} />
            </div>
            <div className="space-y-6">
              {(data.income?.total ?? 0) > 0 && <SavingsRateCard data={data} />}
              <SubscriptionsCard subscriptions={data.subscriptions ?? []} />
            </div>
          </div>
        </>
      )}

      <InsightsSection insights={data.insights ?? []} />

      <DashboardCtas />
    </>
  );
}
