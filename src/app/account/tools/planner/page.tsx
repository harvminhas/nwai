"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { Plan, PlanLinkedTransaction, PlanCashEntry } from "@/app/api/user/plans/route";
import { formatCurrency } from "@/lib/currencyUtils";
import { useConfirm } from "@/components/useConfirm";
import { useToast } from "@/components/useToast";

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
    setLoading(true);
    try {
      const res = await fetch("/api/user/plans", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const data = await res.json();
        setPlans(data.items || []);
      }
    } catch (error) {
      console.error("Failed to load plans:", error);
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
            token={token}
            onSelectPlan={setSelectedPlan}
            onDelete={handleDeletePlan}
            onRefresh={() => token && loadPlans(token)}
          />
        )}

        {/* In Progress Plans */}
        {inProgress.length > 0 && (
          <PlanSection
            title="In Progress"
            plans={inProgress}
            token={token}
            onSelectPlan={setSelectedPlan}
            onDelete={handleDeletePlan}
            onRefresh={() => token && loadPlans(token)}
          />
        )}

        {/* Done Plans */}
        {done.length > 0 && (
          <PlanSection
            title="Done"
            plans={done}
            token={token}
            onSelectPlan={setSelectedPlan}
            onDelete={handleDeletePlan}
            onRefresh={() => token && loadPlans(token)}
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
  token,
  onSelectPlan,
  onDelete,
  onRefresh,
}: {
  title: string;
  plans: Plan[];
  token: string | null;
  onSelectPlan: (plan: Plan) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
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
            token={token}
            onSelect={() => onSelectPlan(plan)}
            onDelete={() => onDelete(plan.id)}
          />
        ))}
      </div>
    </div>
  );
}

function PlanCard({
  plan,
  token,
  onSelect,
  onDelete,
}: {
  plan: Plan;
  token: string | null;
  onSelect: () => void;
  onDelete: () => void;
}) {
  const spent = plan.linkedTransactions.reduce((sum, tx) => sum + tx.amount, 0) +
                plan.cashEntries.reduce((sum, entry) => sum + entry.amount, 0);
  const remaining = plan.budget - spent;
  const percentSpent = plan.budget > 0 ? (spent / plan.budget) * 100 : 0;
  
  // Check if upcoming and calculate monthly savings needed
  const today = new Date().toISOString().split("T")[0];
  const isUpcoming = plan.startDate > today;
  const monthsUntilStart = isUpcoming ? 
    Math.max(1, Math.ceil((new Date(plan.startDate).getTime() - new Date().getTime()) / (30 * 24 * 60 * 60 * 1000))) : 0;
  const monthlySavings = isUpcoming && monthsUntilStart > 0 ? remaining / monthsUntilStart : 0;

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr + "T00:00:00");
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <button
            onClick={onSelect}
            className="text-left hover:text-purple-600"
          >
            <h3 className="font-semibold text-gray-900">{plan.name}</h3>
          </button>
          <p className="mt-1 text-sm text-gray-600">
            {formatDate(plan.startDate)} – {formatDate(plan.endDate)}
          </p>
          
          {/* Progress bar */}
          <div className="mt-3">
            <div className="flex items-center justify-between text-sm mb-1">
              <span className="text-gray-700">
                {formatCurrency(spent, "CAD")} of {formatCurrency(plan.budget, "CAD")}
              </span>
              <span className={remaining >= 0 ? "text-green-600 font-medium" : "text-red-600 font-medium"}>
                {remaining >= 0 ? "Under" : "Over"} {formatCurrency(Math.abs(remaining), "CAD")}
              </span>
            </div>
            <div className="h-2 w-full rounded-full bg-gray-200 overflow-hidden">
              <div
                className={`h-full transition-all ${
                  percentSpent > 100 ? "bg-red-500" : percentSpent > 80 ? "bg-yellow-500" : "bg-green-500"
                }`}
                style={{ width: `${Math.min(percentSpent, 100)}%` }}
              />
            </div>
          </div>

          {/* Upcoming savings recommendation */}
          {isUpcoming && monthlySavings > 0 && (
            <p className="mt-2 text-xs text-purple-600 font-medium">
              Set aside {formatCurrency(monthlySavings, "CAD")}/mo to be ready
            </p>
          )}
        </div>

        <button
          onClick={onDelete}
          className="ml-4 rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
        >
          Delete
        </button>
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
}: {
  plan: Plan;
  token: string | null;
  onClose: () => void;
  onUpdate: () => void;
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
      await fetch("/api/user/plans", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updated),
      });
      onUpdate();
    } catch (error) {
      console.error("Failed to unlink transaction:", error);
    }
  }

  async function handleRemoveCashEntry(id: string) {
    if (!token) return;
    
    const updated = {
      ...plan,
      cashEntries: plan.cashEntries.filter((entry) => entry.id !== id),
    };

    try {
      await fetch("/api/user/plans", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updated),
      });
      onUpdate();
    } catch (error) {
      console.error("Failed to remove cash entry:", error);
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
        <LinkTransactionModal
          plan={plan}
          token={token}
          onClose={() => setShowLinkTx(false)}
          onUpdate={onUpdate}
        />
      )}

      {/* Add Cash Modal */}
      {showAddCash && (
        <AddCashModal
          plan={plan}
          token={token}
          onClose={() => setShowAddCash(false)}
          onUpdate={onUpdate}
        />
      )}
    </>
  );
}

function LinkTransactionModal({
  plan,
  token,
  onClose,
  onUpdate,
}: {
  plan: Plan;
  token: string | null;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [search, setSearch] = useState("");
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Load transactions when modal opens
  useEffect(() => {
    if (token) {
      loadTransactions();
    }
  }, [token]);

  async function loadTransactions() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/user/statements/consolidated", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setTransactions(data.expenseTxns || []);
      }
    } catch (error) {
      console.error("Failed to load transactions:", error);
    } finally {
      setLoading(false);
    }
  }

  const filtered = transactions.filter((tx) => {
    if (!search) return true;
    const query = search.toLowerCase();
    return (
      tx.merchant?.toLowerCase().includes(query) ||
      tx.date?.includes(query) ||
      tx.amount?.toString().includes(query)
    );
  });

  async function handleSave() {
    if (!token) return;

    const newLinked: PlanLinkedTransaction[] = Array.from(selected).map((txFingerprint) => {
      const tx = transactions.find((t) => t.txFingerprint === txFingerprint)!;
      return {
        txFingerprint,
        merchant: tx.merchant,
        date: tx.date,
        amount: tx.amount,
        category: tx.category || "Other",
      };
    });

    const updated = {
      ...plan,
      linkedTransactions: [...plan.linkedTransactions, ...newLinked],
    };

    try {
      await fetch("/api/user/plans", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updated),
      });
      onUpdate();
      onClose();
    } catch (error) {
      console.error("Failed to link transactions:", error);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
        <div className="w-full max-w-2xl max-h-[80vh] rounded-xl bg-white shadow-2xl flex flex-col">
          <div className="border-b border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900">Link Transactions</h2>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchant, date, or amount..."
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
            />
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
              </div>
            ) : (
              <div className="space-y-2">
                {filtered.slice(0, 50).map((tx) => (
                  <label
                    key={tx.txFingerprint}
                    className="flex items-center gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(tx.txFingerprint)}
                      onChange={(e) => {
                        const next = new Set(selected);
                        if (e.target.checked) {
                          next.add(tx.txFingerprint);
                        } else {
                          next.delete(tx.txFingerprint);
                        }
                        setSelected(next);
                      }}
                      className="h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-900">{tx.merchant}</p>
                      <p className="text-xs text-gray-500">{tx.date} · {tx.category}</p>
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      {formatCurrency(tx.amount, "CAD")}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="border-t border-gray-200 p-6 flex gap-3">
            <button
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={selected.size === 0}
              className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-50"
            >
              Link {selected.size} Transaction{selected.size !== 1 ? "s" : ""}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function AddCashModal({
  plan,
  token,
  onClose,
  onUpdate,
}: {
  plan: Plan;
  token: string | null;
  onClose: () => void;
  onUpdate: () => void;
}) {
  const [amount, setAmount] = useState("");
  const [note, setNote] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !amount || !note) return;

    setSaving(true);
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

      await fetch("/api/user/plans", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(updated),
      });
      onUpdate();
      onClose();
    } catch (error) {
      console.error("Failed to add cash entry:", error);
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
