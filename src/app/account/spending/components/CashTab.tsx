"use client";

import { useEffect, useState } from "react";
import type { CashCommitment, CashFrequency } from "@/app/api/user/cash-commitments/route";
import { formatCurrency } from "@/lib/currencyUtils";

interface CashTabProps {
  token: string | null;
}

export function CashTab({ token }: CashTabProps) {
  const [expenses, setExpenses] = useState<CashCommitment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<CashCommitment | null>(null);

  useEffect(() => {
    if (token) {
      loadExpenses();
    }
  }, [token]);

  async function loadExpenses() {
    if (!token) return;
    setLoading(true);
    try {
      const res = await fetch("/api/user/cash-commitments", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.items || []);
      }
    } catch (error) {
      console.error("Failed to load cash expenses:", error);
    } finally {
      setLoading(false);
    }
  }

  async function handleTogglePause(expense: CashCommitment) {
    if (!token) return;
    const newStatus = expense.status === "paused" ? "active" : "paused";
    
    try {
      const res = await fetch("/api/user/cash-commitments", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: expense.id,
          status: newStatus,
        }),
      });
      if (res.ok) {
        await loadExpenses();
      }
    } catch (error) {
      console.error("Failed to toggle pause:", error);
    }
  }

  async function handleSkipMonth(expense: CashCommitment) {
    if (!token) return;
    const month = prompt("Enter month to skip (YYYY-MM):");
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      if (month !== null) alert("Invalid format. Use YYYY-MM (e.g., 2026-12)");
      return;
    }

    const skippedMonths = expense.skippedMonths || [];
    if (skippedMonths.includes(month)) {
      alert("This month is already skipped");
      return;
    }

    try {
      const res = await fetch("/api/user/cash-commitments", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          id: expense.id,
          skippedMonths: [...skippedMonths, month],
        }),
      });
      if (res.ok) {
        await loadExpenses();
      }
    } catch (error) {
      console.error("Failed to skip month:", error);
    }
  }

  async function handleDelete(id: string) {
    if (!token || !confirm("Delete this expense?")) return;
    
    try {
      const res = await fetch(`/api/user/cash-commitments?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await loadExpenses();
      }
    } catch (error) {
      console.error("Failed to delete expense:", error);
    }
  }

  function handleEdit(expense: CashCommitment) {
    setEditingExpense(expense);
    setShowAddModal(true);
  }

  function handleAdd() {
    setEditingExpense(null);
    setShowAddModal(true);
  }

  function handleCloseModal() {
    setShowAddModal(false);
    setEditingExpense(null);
  }

  async function handleSave() {
    await loadExpenses();
    handleCloseModal();
  }

  const frequencyLabels: Record<CashFrequency, string> = {
    weekly: "Weekly",
    biweekly: "Every 2 weeks",
    monthly: "Monthly",
    quarterly: "Every 3 months",
    yearly: "Yearly",
    once: "One-time",
  };

  const FREQ_MONTHLY: Record<CashFrequency, number> = {
    weekly: 52 / 12,
    biweekly: 26 / 12,
    monthly: 1,
    quarterly: 1 / 3,
    yearly: 1 / 12,
    once: 0,
  };

  function getMonthlyEquivalent(expense: CashCommitment): number {
    if (expense.status === "paused") return 0;
    return expense.amount * FREQ_MONTHLY[expense.frequency];
  }

  function getNextDue(expense: CashCommitment): string {
    if (expense.status === "paused") return "Paused";
    if (expense.frequency === "once") return "One-time";
    
    const today = new Date();
    const floor = new Date(expense.startDate || expense.createdAt);
    
    // Simple next due calculation based on frequency
    let next = new Date(floor);
    while (next < today) {
      switch (expense.frequency) {
        case "weekly":
          next.setDate(next.getDate() + 7);
          break;
        case "biweekly":
          next.setDate(next.getDate() + 14);
          break;
        case "monthly":
          next.setMonth(next.getMonth() + 1);
          break;
        case "quarterly":
          next.setMonth(next.getMonth() + 3);
          break;
        case "yearly":
          next.setFullYear(next.getFullYear() + 1);
          break;
      }
    }
    
    const yearMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}`;
    if (expense.skippedMonths?.includes(yearMonth)) {
      return `${next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} (skipped)`;
    }
    
    return next.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  const totalMonthly = expenses
    .filter(e => e.status !== "paused")
    .reduce((sum, e) => sum + getMonthlyEquivalent(e), 0);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Recurring Cash Spending</h2>
          <p className="mt-1 text-sm text-gray-600">
            Expenses paid by cash or not captured in statements · {formatCurrency(totalMonthly, "CAD")}/mo
          </p>
        </div>
        <button
          onClick={handleAdd}
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
        >
          + Add Expense
        </button>
      </div>

      {expenses.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-300 bg-white p-12 text-center">
          <p className="text-gray-600">No recurring cash expenses yet</p>
          <button
            onClick={handleAdd}
            className="mt-4 text-sm font-medium text-purple-600 hover:text-purple-700"
          >
            Add your first expense →
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {expenses.map((expense) => {
            const monthlyEq = getMonthlyEquivalent(expense);
            const nextDue = getNextDue(expense);

            return (
              <div
                key={expense.id}
                className={`flex items-center justify-between rounded-lg border bg-white p-4 ${
                  expense.status === "paused"
                    ? "border-gray-300 opacity-60"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">{expense.name}</h3>
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      Cash
                    </span>
                    {expense.status === "paused" && (
                      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                        Paused
                      </span>
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-sm text-gray-600">
                    <span>{formatCurrency(expense.amount, "CAD")}</span>
                    <span>·</span>
                    <span>{frequencyLabels[expense.frequency]}</span>
                    {expense.status !== "paused" && monthlyEq > 0 && (
                      <>
                        <span>·</span>
                        <span>{formatCurrency(monthlyEq, "CAD")}/mo</span>
                      </>
                    )}
                    <span>·</span>
                    <span>Next: {nextDue}</span>
                  </div>
                  {expense.skippedMonths && expense.skippedMonths.length > 0 && (
                    <p className="mt-1 text-xs text-gray-500">
                      Skipped: {expense.skippedMonths.join(", ")}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleTogglePause(expense)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    title={expense.status === "paused" ? "Resume" : "Pause"}
                  >
                    {expense.status === "paused" ? "Resume" : "Pause"}
                  </button>
                  <button
                    onClick={() => handleSkipMonth(expense)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                    title="Skip a specific month"
                  >
                    Skip
                  </button>
                  <button
                    onClick={() => handleEdit(expense)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(expense.id)}
                    className="rounded-lg px-3 py-1.5 text-sm font-medium text-red-600 hover:bg-red-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {showAddModal && (
        <ExpenseModal
          expense={editingExpense}
          token={token}
          onClose={handleCloseModal}
          onSave={handleSave}
        />
      )}
    </div>
  );
}

function ExpenseModal({
  expense,
  token,
  onClose,
  onSave,
}: {
  expense: CashCommitment | null;
  token: string | null;
  onClose: () => void;
  onSave: () => void;
}) {
  const [name, setName] = useState(expense?.name || "");
  const [amount, setAmount] = useState(expense?.amount?.toString() || "");
  const [frequency, setFrequency] = useState<CashFrequency>(expense?.frequency || "monthly");
  const [category, setCategory] = useState(expense?.category || "Home services");
  const [notes, setNotes] = useState(expense?.notes || "");
  const [startDate, setStartDate] = useState(expense?.startDate || "");
  const [saving, setSaving] = useState(false);

  const categories = [
    "Home services",
    "Groceries",
    "Dining",
    "Transportation",
    "Healthcare",
    "Subscriptions",
    "Entertainment",
    "Shopping",
    "Other",
  ];

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !name || !amount || !category) return;

    setSaving(true);
    try {
      const body: Partial<CashCommitment> = {
        name,
        amount: parseFloat(amount),
        frequency,
        category,
        notes: notes || undefined,
        startDate: startDate || undefined,
      };

      if (expense) {
        body.id = expense.id;
        await fetch("/api/user/cash-commitments", {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      } else {
        await fetch("/api/user/cash-commitments", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        });
      }

      onSave();
    } catch (error) {
      console.error("Failed to save expense:", error);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-gray-900/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-2xl">
          <h2 className="mb-4 text-lg font-semibold text-gray-900">
            {expense ? "Edit Expense" : "Add Cash Expense"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Name</label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., Gym membership"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Amount (CAD)</label>
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Frequency</label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as CashFrequency)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Every 3 months</option>
                <option value="yearly">Yearly</option>
                <option value="once">One-time</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>{cat}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Start date (optional)
              </label>
              <input
                type="month"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              />
              <p className="mt-1 text-xs text-gray-500">
                When did this expense start? Leave empty if unsure.
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={2}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
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
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}
