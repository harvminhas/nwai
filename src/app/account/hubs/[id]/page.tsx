"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { formatCurrency } from "@/lib/currencyUtils";
import AccountSwitcher from "@/components/AccountSwitcher";
import type { GeneralHub, ExpenseTransaction, IncomeTransaction } from "@/lib/types";

interface HubTransaction extends ExpenseTransaction {
  type: "expense" | "income";
  fingerprint: string;
}

export default function HubDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const hubId = params.id;

  const [token, setToken] = useState<string | null>(null);
  const [hub, setHub] = useState<GeneralHub | null>(null);
  const [transactions, setTransactions] = useState<HubTransaction[]>([]);
  const [total, setTotal] = useState(0);
  const [currency] = useState("USD");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/user/hubs/${hubId}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      
      if (!res.ok) {
        if (res.status === 404) throw new Error("Hub not found");
        throw new Error("Failed to load hub");
      }

      const data = await res.json();
      setHub(data.hub);
      setTransactions(data.transactions ?? []);
      setTotal(data.total ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hub");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
      await load(tok);
    });
  }, [router, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !hub) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
        <Link href="/account/hubs" className="text-sm text-gray-500 hover:text-purple-600">
          Hubs
        </Link>
        <p className="mt-4 text-red-600">{error ?? "Hub not found"}</p>
      </div>
    );
  }

  // Group by month
  const byMonth: Record<string, HubTransaction[]> = {};
  for (const tx of transactions) {
    const month = tx.date?.slice(0, 7) ?? "unknown";
    if (!byMonth[month]) byMonth[month] = [];
    byMonth[month].push(tx);
  }
  const months = Object.keys(byMonth).sort().reverse();

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      {toast && (
        <div
          className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg text-sm font-medium ${
            toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"
          }`}
        >
          <span>{toast.ok ? "✓" : "!"}</span>
          <span>{toast.msg}</span>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/account/hubs" className="hover:text-purple-600">
            Hubs
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">{hub.name}</span>
        </div>
        <AccountSwitcher />
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium bg-${hub.color}-100 text-${hub.color}-700`}
        >
          General hub
        </span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900">{hub.name}</h1>

      {/* Total spending */}
      <div className="mt-5 rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
          Total spending
        </p>
        <p className="mt-2 text-2xl font-bold text-gray-900 tabular-nums">
          {formatCurrency(total, currency)}
        </p>
        <p className="mt-1.5 text-xs text-gray-400">
          {transactions.length} {transactions.length === 1 ? "transaction" : "transactions"}
        </p>
      </div>

      {/* Transactions by month */}
      <div className="mt-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
          Transactions
        </h2>
        {months.length > 0 ? (
          <div className="space-y-6">
            {months.map((month) => {
              const monthTxns = byMonth[month];
              const monthTotal = monthTxns.reduce(
                (sum, tx) => sum + (tx.type === "expense" ? tx.amount : 0),
                0
              );
              const [y, m] = month.split("-");
              const monthLabel =
                m && y
                  ? new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1).toLocaleDateString(
                      "en-US",
                      { month: "long", year: "numeric" }
                    )
                  : month;

              return (
                <div key={month}>
                  <div className="mb-2 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">{monthLabel}</h3>
                    <p className="text-sm font-bold text-gray-900 tabular-nums">
                      {formatCurrency(monthTotal, currency)}
                    </p>
                  </div>
                  <div className="space-y-2">
                    {monthTxns.map((tx) => (
                      <div
                        key={tx.fingerprint}
                        className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3"
                      >
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{tx.merchant}</p>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                            <span>{tx.category}</span>
                            <span>•</span>
                            <span>
                              {tx.date
                                ? new Date(tx.date).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                  })
                                : "No date"}
                            </span>
                          </div>
                        </div>
                        <p className="text-sm font-bold text-gray-900 tabular-nums">
                          {formatCurrency(tx.amount, currency)}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-5">
            <p className="text-sm text-gray-600">
              No transactions linked yet. Tag transactions with this hub to track spending.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
