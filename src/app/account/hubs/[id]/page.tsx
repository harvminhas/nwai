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
  const [showLinkTxnModal, setShowLinkTxnModal] = useState(false);
  const [availableTxns, setAvailableTxns] = useState<HubTransaction[]>([]);
  const [txnSearch, setTxnSearch] = useState("");
  const [selectedTxn, setSelectedTxn] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const [hubRes, txnsRes] = await Promise.all([
        fetch(`/api/user/hubs/${hubId}`, { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/spending/transactions?months=12&limit=2000", { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      
      if (!hubRes.ok) {
        if (hubRes.status === 404) throw new Error("Hub not found");
        throw new Error("Failed to load hub");
      }

      const data = await hubRes.json();
      setHub(data.hub);
      setTransactions(data.transactions ?? []);
      setTotal(data.total ?? 0);

      if (txnsRes.ok) {
        const txnsData = await txnsRes.json();
        setAvailableTxns(txnsData.transactions ?? []);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load hub");
    } finally {
      setLoading(false);
    }
  }, [hubId]);

  const linkTransaction = async () => {
    if (!token || !hub || !selectedTxn) return;
    setLinking(true);
    try {
      const res = await fetch("/api/user/tx-links", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: selectedTxn,
          hubId: hub.id,
          role: "grouped_under",
        }),
      });
      if (!res.ok) throw new Error("Failed to link transaction");
      setToast({ msg: "Transaction linked", ok: true });
      setShowLinkTxnModal(false);
      setSelectedTxn(null);
      setTxnSearch("");
      await load(token);
    } catch {
      setToast({ msg: "Could not link transaction", ok: false });
    } finally {
      setLinking(false);
    }
  };

  const unlinkTransaction = async (fingerprint: string) => {
    if (!token || !hub) return;
    if (!confirm("Remove this transaction link?")) return;
    try {
      const res = await fetch("/api/user/tx-links", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          hubId: hub.id,
          role: "grouped_under",
        }),
      });
      if (!res.ok) throw new Error("Failed to unlink");
      setToast({ msg: "Transaction unlinked", ok: true });
      await load(token);
    } catch {
      setToast({ msg: "Could not unlink transaction", ok: false });
    }
  };

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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">
            Transactions
          </h2>
          <button
            onClick={() => setShowLinkTxnModal(true)}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition"
          >
            Link transaction
          </button>
        </div>
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
                        className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-3"
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
                        <button
                          onClick={() => unlinkTransaction(tx.fingerprint)}
                          className="shrink-0 rounded-lg border border-gray-200 px-2 py-1 text-xs font-medium text-gray-400 hover:border-red-300 hover:text-red-600 transition"
                        >
                          Unlink
                        </button>
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

      {/* Link Transaction Modal */}
      {showLinkTxnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowLinkTxnModal(false)}>
          <div className="max-w-3xl w-full rounded-xl bg-white p-6 shadow-xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Link Transaction</h3>
            <p className="mt-2 text-sm text-gray-600">
              Select a transaction to group under this hub.
            </p>

            <div className="mt-4">
              <input
                type="text"
                value={txnSearch}
                onChange={(e) => setTxnSearch(e.target.value)}
                placeholder="Search by merchant..."
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
              />
            </div>

            <div className="mt-4 flex-1 overflow-y-auto">
              <div className="space-y-2">
                {availableTxns
                  .filter((tx: any) => !txnSearch || tx.merchant?.toLowerCase().includes(txnSearch.toLowerCase()) || tx.description?.toLowerCase().includes(txnSearch.toLowerCase()))
                  .filter((tx: any) => !transactions.some((t) => t.fingerprint === tx.fingerprint))
                  .slice(0, 50)
                  .map((tx: any) => (
                    <button
                      key={tx.fingerprint}
                      onClick={() => setSelectedTxn(tx.fingerprint)}
                      className={`w-full text-left rounded-lg border p-3 transition ${
                        selectedTxn === tx.fingerprint
                          ? "border-purple-400 bg-purple-50"
                          : "border-gray-200 hover:border-purple-200"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{tx.merchant || tx.description}</p>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                            <span>{tx.accountLabel ?? "Unknown"}</span>
                            <span>•</span>
                            <span>{tx.category}</span>
                            <span>•</span>
                            <span>{tx.date ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date"}</span>
                          </div>
                        </div>
                        <p className="text-sm font-bold text-gray-900 tabular-nums">
                          {formatCurrency(tx.amount, currency)}
                        </p>
                      </div>
                    </button>
                  ))}
                {availableTxns.filter((tx: any) => !txnSearch || tx.merchant?.toLowerCase().includes(txnSearch.toLowerCase())).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">No transactions found</p>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-gray-200 pt-4">
              <button
                onClick={() => {
                  setShowLinkTxnModal(false);
                  setSelectedTxn(null);
                  setTxnSearch("");
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={linkTransaction}
                disabled={!selectedTxn || linking}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition"
              >
                {linking ? "Linking..." : "Link Transaction"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
