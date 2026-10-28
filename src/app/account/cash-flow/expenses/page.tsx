"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { CashCommitment, CashFrequency } from "@/app/api/user/cash-commitments/route";
import { formatCurrency } from "@/lib/currencyUtils";

export default function CashFlowExpensesPage() {
  const router = useRouter();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [expenses, setExpenses] = useState<CashCommitment[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingExpense, setEditingExpense] = useState<CashCommitment | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
      loadExpenses(tok);
    });
  }, [router]);

  async function loadExpenses(tok: string) {
    setLoading(true);
    try {
      const res = await fetch("/api/user/cash-commitments", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (res.ok) {
        const data = await res.json();
        setExpenses(data.items || []);
      }
    } catch (error) {
      console.error("Failed to load expenses:", error);
    } finally {
      setLoading(false);
    }
  }

  function handleAdd() {
    setEditingExpense(null);
    setShowAddModal(true);
  }

  function handleEdit(expense: CashCommitment) {
    setEditingExpense(expense);
    setShowAddModal(true);
  }

  async function handleDelete(id: string) {
    if (!token || !confirm("Delete this expense?")) return;
    
    try {
      const res = await fetch(`/api/user/cash-commitments?id=${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        await loadExpenses(token);
      }
    } catch (error) {
      console.error("Failed to delete expense:", error);
    }
  }

  function handleCloseModal() {
    setShowAddModal(false);
    setEditingExpense(null);
  }

  async function handleSave() {
    if (!token) return;
    await loadExpenses(token);
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-12">
      <div className="mx-auto max-w-4xl px-4 py-8">
        {/* Header */}
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-gray-900">Cash Flow</h1>
          <p className="mt-1 text-sm text-gray-600">
            Track recurring expenses paid by cash or not captured in statements
          </p>
        </div>

        {/* Add button */}
        <div className="mb-6">
          <button
            onClick={handleAdd}
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700"
          >
            + Add Expense
          </button>
        </div>

        {/* Expenses list */}
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
            {expenses.map((expense) => (
              <div
                key={expense.id}
                className="flex items-center justify-between rounded-lg border border-gray-200 bg-white p-4 hover:border-gray-300"
              >
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-gray-900">{expense.name}</h3>
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      Cash
                    </span>
                  </div>
                  <div className="mt-1 flex items-center gap-3 text-sm text-gray-600">
                    <span>{formatCurrency(expense.amount, "CAD")}</span>
                    <span>·</span>
                    <span>{frequencyLabels[expense.frequency]}</span>
                    <span>·</span>
                    <span>{expense.category}</span>
                  </div>
                  {expense.notes && (
                    <p className="mt-1 text-xs text-gray-500">{expense.notes}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
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
            ))}
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
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
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
          <h2 className="mb-4 text-xl font-semibold text-gray-900">
            {expense ? "Edit Expense" : "Add Expense"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Lawn care"
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
                required
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Amount
              </label>
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
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Frequency
              </label>
              <select
                value={frequency}
                onChange={(e) => setFrequency(e.target.value as CashFrequency)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
              >
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
                <option value="quarterly">Every 3 months</option>
                <option value="yearly">Yearly</option>
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Category
              </label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
              >
                {categories.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Start Date (optional)
              </label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">
                Notes (optional)
              </label>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Additional details..."
                rows={2}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
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
