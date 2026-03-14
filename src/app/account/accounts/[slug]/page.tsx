"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ConsolidatedProgressHero from "@/components/ConsolidatedProgressHero";
import NetWorthChart from "@/components/NetWorthChart";
import IncomeCard from "@/components/IncomeCard";
import ExpensesCard from "@/components/ExpensesCard";
import SavingsRateCard from "@/components/SavingsRateCard";
import SubscriptionsCard from "@/components/SubscriptionsCard";
import InsightsSection from "@/components/InsightsSection";
import type { ParsedStatementData, ManualAsset } from "@/lib/types";

const TYPE_LABEL: Record<string, string> = {
  checking: "Checking",
  savings: "Savings",
  credit: "Credit Card",
  mortgage: "Mortgage",
  investment: "Investment",
  loan: "Loan",
  other: "Other",
};

const TYPE_COLOR: Record<string, string> = {
  checking: "bg-blue-100 text-blue-700",
  savings: "bg-green-100 text-green-700",
  credit: "bg-orange-100 text-orange-700",
  mortgage: "bg-red-100 text-red-700",
  investment: "bg-purple-100 text-purple-700",
  loan: "bg-yellow-100 text-yellow-700",
  other: "bg-gray-100 text-gray-600",
};

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

const DEBT_TYPES = ["mortgage", "loan"];

export default function AccountDetailPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;

  const [data, setData] = useState<ParsedStatementData | null>(null);
  const [previousMonth, setPreviousMonth] = useState<{ netWorth: number; assets: number; debts: number } | null>(null);
  const [yearMonth, setYearMonth] = useState<string | null>(null);
  const [history, setHistory] = useState<{ yearMonth: string; netWorth: number }[]>([]);
  const [manualAssets, setManualAssets] = useState<ManualAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statementCount, setStatementCount] = useState(0);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      setLoading(true); setError(null);
      try {
        const token = await user.getIdToken();
        const res = await fetch(
          `/api/user/statements/consolidated?account=${encodeURIComponent(slug)}`,
          { headers: { Authorization: `Bearer ${token}` } }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok) { setError(json.error || "Failed to load account"); return; }
        setData(json.data ?? null);
        setStatementCount(json.count ?? 0);
        setPreviousMonth(json.previousMonth ?? null);
        setYearMonth(json.yearMonth ?? null);
        setHistory(Array.isArray(json.history) ? json.history : []);
        setManualAssets(Array.isArray(json.manualAssets) ? json.manualAssets : []);
      } catch { setError("Failed to load account"); }
      finally { setLoading(false); }
    });
  }, [router, slug]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !data || !yearMonth) {
    return (
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <p className="text-gray-800">{error || "No data for this account."}</p>
          <Link href="/account/accounts" className="mt-4 inline-block text-purple-600 hover:underline">
            Back to accounts
          </Link>
        </div>
      </div>
    );
  }

  const accountType = data.accountType ?? "other";
  const isDebtAccount = DEBT_TYPES.includes(accountType);
  const hasIncome = accountType === "checking" || accountType === "savings" || (data.income?.total ?? 0) > 0;
  const hasSpending = ["checking", "savings", "credit"].includes(accountType) ||
    (data.expenses?.total ?? 0) > 0 || (data.subscriptions?.length ?? 0) > 0;
  const linkedAssets = manualAssets.filter((a) => a.linkedAccountSlug === slug);
  const linkedAssetsTotal = linkedAssets.reduce((s, a) => s + a.value, 0);
  const outstandingDebt = Math.abs(data.netWorth ?? 0);
  const equity = linkedAssetsTotal - outstandingDebt;

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Breadcrumb */}
        <div className="mb-4 flex items-center gap-2 text-sm text-gray-500">
          <Link href="/account/accounts" className="hover:text-purple-600">Accounts</Link>
          <span>/</span>
          <span className="font-medium text-gray-700">{data.accountName ?? data.bankName ?? slug}</span>
        </div>

        {/* Account meta */}
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLOR[accountType] ?? TYPE_COLOR.other}`}>
            {TYPE_LABEL[accountType] ?? accountType}
          </span>
          {data.bankName && (
            <span className="text-sm text-gray-500">{data.bankName}</span>
          )}
          {data.accountId && data.accountId !== "unknown" && (
            <span className="text-sm text-gray-400">{data.accountId}</span>
          )}
        </div>

        <p className="mb-6 text-sm text-gray-500">
          As of {monthLabel(yearMonth)}
          {statementCount > 0 && ` · ${statementCount} statement${statementCount !== 1 ? "s" : ""}`}
        </p>

        {/* Equity card for mortgage/loan */}
        {isDebtAccount && linkedAssets.length > 0 && (
          <div className="mb-6 rounded-xl border border-purple-200 bg-purple-50 p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 mb-3">Equity breakdown</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {linkedAssets.map((a) => (
                <div key={a.id} className="rounded-lg bg-white p-3 shadow-sm">
                  <p className="text-xs text-gray-500 truncate">{a.label}</p>
                  <p className="font-bold text-gray-900">{formatCurrency(a.value)}</p>
                  <Link href="/account/assets" className="text-xs text-purple-500 hover:underline">Edit →</Link>
                </div>
              ))}
              <div className="rounded-lg bg-white p-3 shadow-sm">
                <p className="text-xs text-gray-500">Outstanding balance</p>
                <p className="font-bold text-red-600">−{formatCurrency(outstandingDebt)}</p>
              </div>
              <div className={`rounded-lg p-3 shadow-sm ${equity >= 0 ? "bg-green-50" : "bg-red-50"}`}>
                <p className="text-xs text-gray-500">Your equity</p>
                <p className={`font-bold text-lg ${equity >= 0 ? "text-green-700" : "text-red-600"}`}>
                  {formatCurrency(equity)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Nudge to add asset for unlinked mortgage/loan */}
        {isDebtAccount && linkedAssets.length === 0 && (
          <div className="mb-6 rounded-xl border-2 border-dashed border-purple-200 bg-purple-50/50 p-5 flex items-center justify-between gap-4">
            <div>
              <p className="font-semibold text-gray-900">
                {accountType === "mortgage" ? "🏠 What's your property worth?" : "🚗 Add the asset behind this loan"}
              </p>
              <p className="mt-0.5 text-sm text-gray-600">
                Link an asset to calculate your true equity — it only takes a second.
              </p>
            </div>
            <Link
              href={`/account/assets?link=${slug}&category=${accountType === "mortgage" ? "property" : "vehicle"}`}
              className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Add asset
            </Link>
          </div>
        )}

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

        {hasSpending && (
          <>
            <div className="mb-6 mt-10">
              <h2 className="font-semibold text-lg text-gray-900">
                {hasIncome ? "Income & spending" : "Spending"}
              </h2>
              <p className="text-sm text-gray-500">From latest statements for this account</p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <div className="space-y-6">
                {hasIncome && <IncomeCard income={data.income} />}
                <ExpensesCard expenses={data.expenses} />
              </div>
              <div className="space-y-6">
                {hasIncome && <SavingsRateCard data={data} />}
                <SubscriptionsCard subscriptions={data.subscriptions ?? []} />
              </div>
            </div>
          </>
        )}

        <InsightsSection insights={data.insights ?? []} />
      </div>
    </div>
  );
}
