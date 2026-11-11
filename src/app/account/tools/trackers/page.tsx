"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type {
  Tracker,
  TrackerDefaultFilter,
  TrackerLinkedTransaction,
} from "@/app/api/user/trackers/route";
import { formatCurrency } from "@/lib/currencyUtils";
import { useConfirm } from "@/components/useConfirm";
import { useToast } from "@/components/useToast";
import { TransactionPicker } from "@/components/transactions/TransactionPicker";
import { reselectById } from "@/components/transactions/linkTransactions";
import { TrackerCard } from "./TrackerCard";
import {
  computeTrackerTotals,
  trackerCsvFilename,
  trackerTransactionsToCsv,
} from "./trackerTotals";

export default function TrackersPage() {
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirm();
  const { success, error, Toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [trackers, setTrackers] = useState<Tracker[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedTracker, setSelectedTracker] = useState<Tracker | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
      loadTrackers(tok);
    });
  }, [router]);

  async function loadTrackers(tok: string) {
    try {
      const res = await fetch("/api/user/trackers", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) {
        error("Failed to load trackers. Please try again.");
        return;
      }
      const data = await res.json();
      const items: Tracker[] = data.items || [];
      setTrackers(items);
      setSelectedTracker((t) => reselectById(items, t));
    } catch (err) {
      console.error("Failed to load trackers:", err);
      error("Failed to load trackers. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function handleDeleteTracker(id: string) {
    if (!token) return;

    const confirmed = await confirm({
      title: "Delete this tracker?",
      message: "This will permanently delete the tracker and its linked transactions. Statement data is unchanged.",
      confirmLabel: "Delete",
      variant: "danger",
    });

    if (!confirmed) return;

    try {
      const res = await fetch(`/api/user/trackers?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        if (selectedTracker?.id === id) setSelectedTracker(null);
        await loadTrackers(token);
        success("Tracker deleted");
      } else {
        error("Failed to delete tracker. Please try again.");
      }
    } catch (err) {
      console.error("Failed to delete tracker:", err);
      error("Failed to delete tracker. Please try again.");
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <div className="mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-gray-900">Trackers</h1>
            <p className="mt-1 text-sm text-gray-600">
              Group past income and spending into named buckets like Taxes 2027 or Work Expenses
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
          >
            + New Tracker
          </button>
        </div>

        {trackers.length > 0 && (
          <div className="space-y-3">
            {trackers.map((tracker) => (
              <TrackerCard
                key={tracker.id}
                tracker={tracker}
                onSelect={() => setSelectedTracker(tracker)}
                onDelete={() => handleDeleteTracker(tracker.id)}
              />
            ))}
          </div>
        )}

        {trackers.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-gray-600">No trackers yet</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 text-sm font-medium text-purple-600 hover:text-purple-700"
            >
              Create your first tracker →
            </button>
          </div>
        )}
      </div>

      {showCreateModal && (
        <CreateTrackerModal
          token={token}
          onClose={() => setShowCreateModal(false)}
          onSave={() => {
            setShowCreateModal(false);
            if (token) loadTrackers(token);
          }}
          onError={error}
        />
      )}

      {selectedTracker && (
        <TrackerDetailModal
          tracker={selectedTracker}
          token={token}
          onClose={() => setSelectedTracker(null)}
          onError={error}
          onUpdate={() => {
            if (token) loadTrackers(token);
          }}
        />
      )}

      <ConfirmDialog />
      <Toast />
    </div>
  );
}

const FILTER_OPTIONS: { id: TrackerDefaultFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "income", label: "Income" },
  { id: "spending", label: "Spending" },
];

function CreateTrackerModal({
  token,
  onClose,
  onSave,
  onError,
}: {
  token: string | null;
  onClose: () => void;
  onSave: () => void;
  onError: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [defaultFilter, setDefaultFilter] = useState<TrackerDefaultFilter>("all");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !name.trim()) return;

    setSaving(true);
    try {
      const res = await fetch("/api/user/trackers", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim(),
          defaultFilter,
        }),
      });
      if (!res.ok) {
        onError("Failed to create tracker. Please try again.");
        return;
      }
      onSave();
    } catch (err) {
      console.error("Failed to create tracker:", err);
      onError("Failed to create tracker. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">New Tracker</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Taxes 2027"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Description <span className="font-normal text-gray-500">(optional)</span>
              </label>
              <input
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="e.g. CRA instalments and refunds"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
              />
            </div>
            <div>
              <p className="mb-2 text-sm font-medium text-gray-700">Default filter</p>
              <div className="flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => {
                  const active = defaultFilter === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setDefaultFilter(option.id)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                        active
                          ? "bg-purple-600 text-white"
                          : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
              <p className="mt-2 text-xs text-gray-500">
                Used when linking transactions. Spending-only trackers (lunches, gas) can default to Spending.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={onClose}
                className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving}
                className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {saving ? "Creating..." : "Create"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

function TrackerDetailModal({
  tracker,
  token,
  onClose,
  onUpdate,
  onError,
}: {
  tracker: Tracker;
  token: string | null;
  onClose: () => void;
  onUpdate: () => void;
  onError: (message: string) => void;
}) {
  const [showLinkTx, setShowLinkTx] = useState(false);
  const totals = computeTrackerTotals(tracker.linkedTransactions);
  const linked = [...tracker.linkedTransactions].sort((a, b) => b.date.localeCompare(a.date));

  async function handleUnlinkTransaction(txFingerprint: string) {
    if (!token) return;

    try {
      const res = await fetch("/api/user/trackers", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...tracker,
          linkedTransactions: tracker.linkedTransactions.filter((tx) => tx.txFingerprint !== txFingerprint),
        }),
      });
      if (!res.ok) {
        onError("Failed to unlink transaction. Please try again.");
        return;
      }
      onUpdate();
    } catch (err) {
      console.error("Failed to unlink transaction:", err);
      onError("Failed to unlink transaction. Please try again.");
    }
  }

  function handleExportCsv() {
    const csv = trackerTransactionsToCsv(tracker.linkedTransactions);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = trackerCsvFilename(tracker.name);
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="break-words text-xl font-semibold text-gray-900">{tracker.name}</h2>
              {tracker.description ? (
                <p className="mt-1 break-words text-sm text-gray-600">{tracker.description}</p>
              ) : null}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-lg p-2 text-gray-400 hover:bg-gray-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-gray-600">Income in</span>
              <span className="text-lg font-bold text-green-700">{formatCurrency(totals.incomeIn, "CAD")}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm text-gray-600">Spending out</span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(totals.spendingOut, "CAD")}</span>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-gray-200 pt-2">
              <span className="text-sm text-gray-600">Net</span>
              <span className={`text-lg font-bold ${totals.net >= 0 ? "text-green-700" : "text-red-600"}`}>
                {formatCurrency(totals.net, "CAD")}
              </span>
            </div>
          </div>

          <div className="flex flex-wrap gap-3">
            <button
              onClick={() => setShowLinkTx(true)}
              className="flex-1 rounded-lg border border-purple-600 px-4 py-2 text-sm font-semibold text-purple-600 hover:bg-purple-50"
            >
              Link Transactions
            </button>
            <button
              onClick={handleExportCsv}
              disabled={linked.length === 0}
              className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              Export CSV
            </button>
          </div>

          {linked.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
                Linked Transactions ({linked.length})
              </h3>
              <div className="space-y-2">
                {linked.map((tx) => (
                  <div
                    key={`${tx.kind}-${tx.txFingerprint}`}
                    className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-gray-900">{tx.merchant}</p>
                      <p className="text-xs text-gray-500">
                        {tx.date} · {tx.kind === "income" ? "Income" : "Spending"} · {tx.category}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className={`text-sm font-semibold ${tx.kind === "income" ? "text-green-700" : "text-gray-900"}`}>
                        {tx.kind === "income" ? "+" : "−"}
                        {formatCurrency(tx.amount, "CAD")}
                      </span>
                      <button
                        onClick={() => handleUnlinkTransaction(tx.txFingerprint)}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Unlink
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {linked.length === 0 && (
            <p className="text-sm text-gray-500">
              No transactions linked yet. Link past income or spending to start totaling this tracker.
            </p>
          )}
        </div>
      </div>

      {showLinkTx && (
        <TransactionPicker
          token={token}
          context="both"
          defaultFilter={tracker.defaultFilter}
          linkedFingerprints={tracker.linkedTransactions.map((tx) => tx.txFingerprint)}
          onClose={() => setShowLinkTx(false)}
          onError={onError}
          onConfirm={async (selectedTxs) => {
            if (!token) {
              throw new Error("Failed to link transactions. Please try again.");
            }
            const newLinked: TrackerLinkedTransaction[] = selectedTxs.map((tx) => ({
              txFingerprint: tx.txFingerprint,
              merchant: tx.merchant,
              date: tx.date,
              amount: tx.amount,
              category: tx.category || (tx.kind === "income" ? "Income" : "Other"),
              kind: tx.kind,
            }));
            const res = await fetch("/api/user/trackers", {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                ...tracker,
                linkedTransactions: [...tracker.linkedTransactions, ...newLinked],
              }),
            });
            if (!res.ok) {
              throw new Error("Failed to link transactions. Please try again.");
            }
            onUpdate();
          }}
        />
      )}
    </>
  );
}
