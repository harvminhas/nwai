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
import {
  dateRangeErrorForSave,
  formatYearSubtotal,
  groupPlans,
  todayISO,
} from "./planList";

export default function PlannerPage() {
  const router = useRouter();
  const { confirm, ConfirmDialog } = useConfirm();
  const { success, error, Toast } = useToast();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Plan | null>(null);
  const [selectedPlan, setSelectedPlan] = useState<Plan | null>(null);
  const [pastOpen, setPastOpen] = useState(false);

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

  const today = todayISO();
  const { inProgress, futureByYear, past } = groupPlans(plans, today);

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

  async function patchPlan(id: string, body: Record<string, unknown>) {
    if (!token) return false;
    try {
      const res = await fetch("/api/user/plans", {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, ...body }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        error(typeof data.error === "string" ? data.error : "Could not update this plan. Please try again.");
        return false;
      }
      await loadPlans(token);
      return true;
    } catch (err) {
      console.error("Failed to update plan:", err);
      error("Could not update this plan. Please try again.");
      return false;
    }
  }

  async function handleMarkComplete(id: string) {
    const ok = await patchPlan(id, { completedAt: new Date().toISOString() });
    if (ok) success("Plan marked complete");
  }

  async function handleUndoComplete(id: string) {
    const ok = await patchPlan(id, { completedAt: null });
    if (ok) success("Marked as not complete");
  }

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden bg-gray-50 pb-12">
      <div className="mx-auto max-w-6xl px-4 py-8">
        {/* Header */}
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold text-gray-900">Planner</h1>
            <p className="mt-1 text-sm text-gray-600">
              Track spending for specific goals or events
            </p>
          </div>
          <button
            onClick={() => {
              setEditingPlan(null);
              setShowCreateModal(true);
            }}
            className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
          >
            + New Plan
          </button>
        </div>

        {inProgress.length > 0 && (
          <PlanSection
            title="In progress"
            plans={inProgress}
            today={today}
            onSelectPlan={setSelectedPlan}
            onDelete={handleDeletePlan}
            onEdit={(plan) => {
              setEditingPlan(plan);
              setShowCreateModal(true);
            }}
            onMarkComplete={handleMarkComplete}
            onUndoComplete={handleUndoComplete}
          />
        )}

        {futureByYear.map((group) => (
          <div key={group.year} className="mb-8">
            <div className="mb-3 flex items-baseline justify-between gap-3">
              <h2 className="text-sm font-semibold text-gray-900">{group.year}</h2>
              <p className="min-w-0 truncate text-right text-xs text-gray-400 sm:text-sm">
                {formatYearSubtotal(group.plans.length, group.budgetTotal, "CAD")}
              </p>
            </div>
            <div className="space-y-3">
              {group.plans.map((plan) => (
                <PlanCard
                  key={plan.id}
                  plan={plan}
                  today={today}
                  onSelect={() => setSelectedPlan(plan)}
                  onDelete={() => handleDeletePlan(plan.id)}
                  onEdit={() => {
                    setEditingPlan(plan);
                    setShowCreateModal(true);
                  }}
                  onMarkComplete={() => handleMarkComplete(plan.id)}
                  onUndoComplete={() => handleUndoComplete(plan.id)}
                />
              ))}
            </div>
          </div>
        ))}

        {past.length > 0 && (
          <div className="mb-8">
            <button
              type="button"
              aria-expanded={pastOpen}
              onClick={() => setPastOpen((open) => !open)}
              className="mb-3 flex w-full min-w-0 items-center gap-2 text-left"
            >
              <svg
                className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${pastOpen ? "rotate-90" : ""}`}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                aria-hidden="true"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
              <h2 className="text-sm font-bold uppercase tracking-wide text-gray-500">Past</h2>
              <span className="text-sm text-gray-400">{past.length}</span>
            </button>
            {pastOpen && (
              <div className="space-y-3">
                {past.map((plan) => (
                  <PlanCard
                    key={plan.id}
                    plan={plan}
                    today={today}
                    onSelect={() => setSelectedPlan(plan)}
                    onDelete={() => handleDeletePlan(plan.id)}
                    onEdit={() => {
                      setEditingPlan(plan);
                      setShowCreateModal(true);
                    }}
                    onMarkComplete={() => handleMarkComplete(plan.id)}
                    onUndoComplete={() => handleUndoComplete(plan.id)}
                  />
                ))}
              </div>
            )}
          </div>
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

      {/* Create / edit plan */}
      {showCreateModal && (
        <CreatePlanModal
          token={token}
          existing={editingPlan}
          onClose={() => {
            setShowCreateModal(false);
            setEditingPlan(null);
          }}
          onSave={() => {
            setShowCreateModal(false);
            setEditingPlan(null);
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
  today,
  onSelectPlan,
  onDelete,
  onEdit,
  onMarkComplete,
  onUndoComplete,
}: {
  title: string;
  plans: Plan[];
  today: string;
  onSelectPlan: (plan: Plan) => void;
  onDelete: (id: string) => void;
  onEdit: (plan: Plan) => void;
  onMarkComplete: (id: string) => void;
  onUndoComplete: (id: string) => void;
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
            today={today}
            onSelect={() => onSelectPlan(plan)}
            onDelete={() => onDelete(plan.id)}
            onEdit={() => onEdit(plan)}
            onMarkComplete={() => onMarkComplete(plan.id)}
            onUndoComplete={() => onUndoComplete(plan.id)}
          />
        ))}
      </div>
    </div>
  );
}

function CreatePlanModal({
  token,
  existing,
  onClose,
  onSave,
}: {
  token: string | null;
  existing: Plan | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(existing?.name ?? "");
  const [startDate, setStartDate] = useState(existing?.startDate ?? "");
  const [endDate, setEndDate] = useState(existing?.endDate ?? "");
  const [budget, setBudget] = useState(existing ? String(existing.budget) : "");
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  function setDates(nextStart: string, nextEnd: string) {
    setStartDate(nextStart);
    setEndDate(nextEnd);
    if (!nextStart || !nextEnd) {
      setFormError(null);
      return;
    }
    setFormError(dateRangeErrorForSave(nextStart, nextEnd, existing));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !name || !startDate || !endDate || !budget) return;

    const dateError = dateRangeErrorForSave(startDate, endDate, existing);
    if (dateError) {
      setFormError(dateError);
      return;
    }

    setSaving(true);
    setFormError(null);
    try {
      const isEdit = Boolean(existing);
      const res = await fetch("/api/user/plans", {
        method: isEdit ? "PATCH" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(
          isEdit
            ? {
                id: existing!.id,
                name,
                startDate,
                endDate,
                budget: parseFloat(budget),
              }
            : {
                name,
                startDate,
                endDate,
                budget: parseFloat(budget),
              },
        ),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setFormError(
          typeof data.error === "string"
            ? data.error
            : "Could not save this plan. Please try again.",
        );
        return;
      }
      onSave();
    } catch (err) {
      console.error("Failed to save plan:", err);
      setFormError("Could not save this plan. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">
            {existing ? "Edit plan" : "New Plan"}
          </h2>
          {formError && (
            <p className="mb-4 text-sm text-red-600" role="alert">
              {formError}
            </p>
          )}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="plan-name" className="mb-1 block text-sm font-medium text-gray-700">Name</label>
              <input
                id="plan-name"
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Europe Trip"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                required
              />
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="min-w-0">
                <label htmlFor="plan-start-date" className="mb-1 block text-sm font-medium text-gray-700">Start Date</label>
                <input
                  id="plan-start-date"
                  type="date"
                  value={startDate}
                  onChange={(e) => setDates(e.target.value, endDate)}
                  className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  required
                />
              </div>
              <div className="min-w-0">
                <label htmlFor="plan-end-date" className="mb-1 block text-sm font-medium text-gray-700">End Date</label>
                <input
                  id="plan-end-date"
                  type="date"
                  value={endDate}
                  onChange={(e) => setDates(startDate, e.target.value)}
                  className="w-full min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                  required
                />
              </div>
            </div>
            <div>
              <label htmlFor="plan-budget" className="mb-1 block text-sm font-medium text-gray-700">Budget</label>
              <input
                id="plan-budget"
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
                {saving ? (existing ? "Saving..." : "Creating...") : existing ? "Save" : "Create"}
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
