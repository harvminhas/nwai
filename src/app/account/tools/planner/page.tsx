"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { Plan, PlanLinkedTransaction, PlanCashEntry } from "@/app/api/user/plans/route";
import { formatCurrency } from "@/lib/currencyUtils";
import { useConfirm } from "@/components/useConfirm";
import { useToast } from "@/components/useToast";
import { TransactionPicker } from "@/components/transactions/TransactionPicker";
import { reselectPlanById } from "./linkTransactions";
import { PlanCard } from "./PlanCard";

export default function PlannerPage() {
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirm();
  const { success, error, Toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
      loadPlans(tok);
    });
  }, [router]);

  async function loadPlans(tok: string) {
    try {
      const res = await fetch("/api/user/plans", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) {
        error("Failed to load plans. Please try again.");
        return;
      }
      const data = await res.json();
      const items: Plan[] = data.items || [];
      setPlans(items);
      setSelectedPlan((p) => reselectPlanById(items, p));
    } catch (err) {
      console.error("Failed to load plans:", err);
      error("Failed to load plans. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  function categorizePlans(plans: Plan[]) {
    const today = new Date().toISOString().split("T")[0];
    return {
      upcoming: plans.filter((p) => p.startDate > today),
      inProgress: plans.filter((p) => p.startDate <= today && p.endDate >= today),
      done: plans.filter((p) => p.endDate < today),
    };
  }

  const { upcoming, inProgress, done } = categorizePlans(plans);

  async function handleDeletePlan(id: string) {
    if (!token) return;
    
    const confirmed = await confirm({
      title: "Delete this plan?",
      message: "This will permanently delete the plan and all its linked transactions.",
      confirmLabel: "Delete",
      variant: "danger",
    });
    
    if (!confirmed) return;
    
    try {
      const res = await fetch(`/api/user/plans?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await loadPlans(token);
        success("Plan deleted");
      } else {
        error("Failed to delete plan. Please try again.");
      }
    } catch (err) {
      console.error("Failed to delete plan:", err);
      error("Failed to delete plan. Please try again.");
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
        {/* Header */}
        <div className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-gray-900">Planner</h1>
            <p className="mt-1 text-sm text-gray-600">
              Track spending for specific goals or events
            </p>
          </div>
          <button
            onClick={() => setShowCreateModal(true)}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
          >
            + New Plan
          </button>
        </div>

        {/* Upcoming Plans */}
        {upcoming.length > 0 && (
          <PlanSection
            title="Upcoming"
            plans={upcoming}
            onSelectPlan={setSelectedPlan}
            onDelete={handleDeletePlan}
          />
        )}

        {/* In Progress Plans */}
        {inProgress.length > 0 && (
          <PlanSection
            title="In Progress"
            plans={inProgress}
            onSelectPlan={setSelectedPlan}
            onDelete={handleDeletePlan}
          />
        )}

        {/* Done Plans */}
        {done.length > 0 && (
          <PlanSection
            title="Done"
            plans={done}
            onSelectPlan={setSelectedPlan}
            onDelete={handleDeletePlan}
          />
        )}

        {/* Empty state */}
        {plans.length === 0 && (
          <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center">
            <p className="text-gray-600">No plans yet</p>
            <button
              onClick={() => setShowCreateModal(true)}
              className="mt-4 text-sm font-medium text-purple-600 hover:text-purple-700"
            >
              Create your first plan →
            </button>
          </div>
        )}
      </div>

      {/* Create Plan Modal */}
      {showCreateModal && (
        <CreatePlanModal
          token={token}
          onClose={() => setShowCreateModal(false)}
          onSave={() => {
            setShowCreateModal(false);
            if (token) loadPlans(token);
          }}
        />
      )}

      {/* Plan Detail Modal */}
      {selectedPlan && (
        <PlanDetailModal
          plan={selectedPlan}
          token={token}
          onClose={() => setSelectedPlan(null)}
          onError={error}
          onUpdate={() => {
            if (token) loadPlans(token);
          }}
        />
      )}
      
      {/* Dialogs and Toasts */}
      <ConfirmDialog />
      <Toast />
    </div>
  );
}

function PlanSection({
  title,
  plans,
  onSelectPlan,
  onDelete,
}: {
  title: string;
  plans: Plan[];
  onSelectPlan: (plan: Plan) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="mb-8">
      <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-gray-500">
        {title}
      </h2>
      <div className="space-y-3">
        {plans.map((plan) => (
          <PlanCard
            key={plan.id}
            plan={plan}
            onSelect={() => onSelectPlan(plan)}
            onDelete={() => onDelete(plan.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CreatePlanModal({
  token,
  onClose,
  onSave,
}: {
  token: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [budget, setBudget] = useState("");
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !name || !startDate || !endDate || !budget) return;

    setSaving(true);
    try {
      await fetch("/api/user/plans", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name,
          startDate,
          endDate,
          budget: parseFloat(budget),
        }),
      });
      onSave();
    } catch (error) {
      console.error("Failed to create plan:", error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">New Plan</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Europe Trip"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  required
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-gray-700">End Date</label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  required
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Budget</label>
              <input
                type="number"
                step="0.01"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                required
              />
            </div>
            <div className="flex gap-3">
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

function PlanDetailModal({
  plan,
  token,
  onClose,
  onUpdate,
  onError,
}: {
  plan: Plan;
  token: string | null;
  onClose: () => void;
  onUpdate: () => void;
  onError: (message: string) => void;
}) {
  const [showLinkTx, setShowLinkTx] = useState(false);
  const [showAddCash, setShowAddCash] = useState(false);

  const spent = plan.linkedTransactions.reduce((sum, tx) => sum + tx.amount, 0) +
                plan.cashEntries.reduce((sum, entry) => sum + entry.amount, 0);

  async function handleUnlinkTransaction(txFingerprint: string) {
    if (!token) return;
    
    const updated = {
      ...plan,
      linkedTransactions: plan.linkedTransactions.filter((tx) => tx.txFingerprint !== txFingerprint),
    };

    try {
      const res = await fetch("/api/user/plans", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updated),
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

  async function handleRemoveCashEntry(id: string) {
    if (!token) return;
    
    const updated = {
      ...plan,
      cashEntries: plan.cashEntries.filter((entry) => entry.id !== id),
    };

    try {
      const res = await fetch("/api/user/plans", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        onError("Failed to remove cash entry. Please try again.");
        return;
      }
      onUpdate();
    } catch (err) {
      console.error("Failed to remove cash entry:", err);
      onError("Failed to remove cash entry. Please try again.");
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-y-0 right-0 z-50 w-full max-w-2xl overflow-y-auto bg-white shadow-2xl">
        {/* Sticky Header */}
        <div className="sticky top-0 z-10 border-b border-gray-200 bg-white px-6 py-4">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold text-gray-900">{plan.name}</h2>
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-gray-400 hover:bg-gray-100"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Summary */}
          <div className="rounded-lg border border-gray-200 bg-gray-50 p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm text-gray-600">Spent</span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(spent, "CAD")}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-sm text-gray-600">Budget</span>
              <span className="text-lg font-bold text-gray-900">{formatCurrency(plan.budget, "CAD")}</span>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-3">
            <button
              onClick={() => setShowLinkTx(true)}
              className="flex-1 rounded-lg border border-purple-600 px-4 py-2 text-sm font-semibold text-purple-600 hover:bg-purple-50"
            >
              Link Transactions
            </button>
            <button
              onClick={() => setShowAddCash(true)}
              className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
            >
              Add Cash
            </button>
          </div>

          {/* Linked Transactions */}
          {plan.linkedTransactions.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
                Linked Transactions ({plan.linkedTransactions.length})
              </h3>
              <div className="space-y-2">
                {plan.linkedTransactions.map((tx) => (
                  <div
                    key={tx.txFingerprint}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{tx.merchant}</p>
                      <p className="text-xs text-gray-500">{tx.date} · {tx.category}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-900">
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

          {/* Cash Entries */}
          {plan.cashEntries.length > 0 && (
            <div>
              <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-gray-500">
                Cash Entries ({plan.cashEntries.length})
              </h3>
              <div className="space-y-2">
                {plan.cashEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-3"
                  >
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{entry.note}</p>
                      <p className="text-xs text-gray-500">{entry.date}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-semibold text-gray-900">
                        {formatCurrency(entry.amount, "CAD")}
                      </span>
                      <button
                        onClick={() => handleRemoveCashEntry(entry.id)}
                        className="text-xs text-red-600 hover:text-red-700"
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Link Transaction Modal */}
      {showLinkTx && (
        <TransactionPicker
          token={token}
          context="expenses"
          linkedFingerprints={plan.linkedTransactions.map((tx) => tx.txFingerprint)}
          onClose={() => setShowLinkTx(false)}
          onError={onError}
          onConfirm={async (selectedTxs) => {
            if (!token) {
              throw new Error("Failed to link transactions. Please try again.");
            }
            const newLinked: PlanLinkedTransaction[] = selectedTxs.map((tx) => ({
              txFingerprint: tx.txFingerprint,
              merchant: tx.merchant,
              date: tx.date,
              amount: tx.amount,
              category: tx.category || "Other",
            }));
            const res = await fetch("/api/user/plans", {
              method: "PUT",
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                ...plan,
                linkedTransactions: [...plan.linkedTransactions, ...newLinked],
              }),
            });
            if (!res.ok) {
              throw new Error("Failed to link transactions. Please try again.");
            }
            onUpdate();
          }}
        />
      )}

      {/* Add Cash Modal */}
      {showAddCash && (
        <AddCashModal
          plan={plan}
          token={token}
          onClose={() => setShowAddCash(false)}
          onUpdate={onUpdate}
          onError={onError}
        />
      )}
    </>
  );
}

function AddCashModal({
  plan,
  token,
  onClose,
  onUpdate,
  onError,
}: {
  plan: Plan;
  token: string | null;
  onClose: () => void;
  onUpdate: () => void;
  onError: (message: string) => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !amount || !note) return;

    setSaving(true);
    setSaveError(null);
    try {
      const newEntry: PlanCashEntry = {
        id: crypto.randomUUID(),
        amount: parseFloat(amount),
        note,
        date,
        createdAt: new Date().toISOString(),
      };

      const updated = {
        ...plan,
        cashEntries: [...plan.cashEntries, newEntry],
      };

      const res = await fetch("/api/user/plans", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updated),
      });
      if (!res.ok) {
        const message = "Failed to add cash entry. Please try again.";
        setSaveError(message);
        onError(message);
        return;
      }
      onUpdate();
      onClose();
    } catch (err) {
      console.error("Failed to add cash entry:", err);
      const message = "Failed to add cash entry. Please try again.";
      setSaveError(message);
      onError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">Add Cash</h2>
          {saveError && <p className="mb-4 text-sm text-red-600">{saveError}</p>}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Amount</label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Note</label>
              <input
                type="text"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="What was this for?"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                required
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">Date</label>
              <input
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                required
              />
            </div>
            <div className="flex gap-3">
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
                {saving ? "Adding..." : "Add"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
