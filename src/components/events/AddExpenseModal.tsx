"use client";

import { useCallback, useEffect, useState } from "react";
import TagCashPaymentPanel from "@/components/events/TagCashPaymentPanel";
import type { RawTx } from "@/components/events/TagPicker";
import type { ProjectLedgerEntry } from "@/lib/events/types";
import { getCurrencySymbol } from "@/lib/currencyUtils";
import { PARENT_CATEGORIES } from "@/lib/categoryTaxonomy";

export interface AddExpenseModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  eventName: string;
  headers: Record<string, string>;
  homeCurrency: string;
  onAfterChange?: () => void | Promise<void>;
}

export default function AddExpenseModal({
  open,
  onClose,
  eventId,
  eventName,
  headers,
  homeCurrency,
  onAfterChange,
}: AddExpenseModalProps) {
  const [addExpenseTab, setAddExpenseTab] = useState<"statement" | "manual">("statement");
  const [expenseDescription, setExpenseDescription] = useState("");
  const [expenseAmount, setExpenseAmount] = useState("");
  const [expenseDate, setExpenseDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [expenseCategory, setExpenseCategory] = useState("Dining");
  const [expensePaidFrom, setExpensePaidFrom] = useState<"cash" | "card">("cash");
  const [savingExpense, setSavingExpense] = useState(false);

  const hc = homeCurrency;
  const curSym = getCurrencySymbol(hc).trim();

  useEffect(() => {
    if (!open) return;
    setAddExpenseTab("statement");
    setExpenseDescription("");
    setExpenseAmount("");
    setExpenseDate(new Date().toISOString().substring(0, 10));
    setExpenseCategory("Dining");
    setExpensePaidFrom("cash");
  }, [open]);

  const closeAddExpenseModal = useCallback(() => {
    setAddExpenseTab("statement");
    setExpenseDescription("");
    setExpenseAmount("");
    setExpenseDate(new Date().toISOString().substring(0, 10));
    setExpenseCategory("Dining");
    setExpensePaidFrom("cash");
    onClose();
  }, [onClose]);

  const handleProjectStatementTag = useCallback(
    async (_evId: string, amountDelta: number, _date?: string, tx?: RawTx) => {
      if (tx && amountDelta >= 0) {
        await onAfterChange?.();
        closeAddExpenseModal();
      } else if (tx && amountDelta < 0) {
        await onAfterChange?.();
      } else {
        await onAfterChange?.();
      }
    },
    [onAfterChange, closeAddExpenseModal],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeAddExpenseModal();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, closeAddExpenseModal]);

  async function handleAddManualExpense(e: React.FormEvent) {
    e.preventDefault();
    const desc = expenseDescription.trim();
    if (!desc) return;
    const amt = parseFloat(expenseAmount);
    if (!Number.isFinite(amt) || amt <= 0) return;
    setSavingExpense(true);
    try {
      const entryType = expensePaidFrom === "cash" ? "cash" : "manual";
      const res = await fetch(`/api/user/events/${eventId}/ledger`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          date: expenseDate,
          amount: amt,
          entryType,
          note: desc,
          category: expenseCategory,
        }),
      });
      if (res.ok) {
        const json = (await res.json()) as { entry: ProjectLedgerEntry };
        if (json.entry) await onAfterChange?.();
        closeAddExpenseModal();
      }
    } finally {
      setSavingExpense(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !savingExpense) closeAddExpenseModal();
      }}
    >
      <div
        className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between border-b border-gray-100 px-5 pt-5 pb-3">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Add expense</h2>
            <p className="mt-0.5 text-sm text-gray-500">to {eventName}</p>
          </div>
          <button
            type="button"
            onClick={closeAddExpenseModal}
            disabled={savingExpense}
            className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="flex border-b border-gray-100 px-2">
          <button
            type="button"
            onClick={() => setAddExpenseTab("statement")}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-semibold transition ${
              addExpenseTab === "statement"
                ? "border-b-2 border-purple-600 text-gray-900"
                : "border-b-2 border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            From statement
          </button>
          <button
            type="button"
            onClick={() => setAddExpenseTab("manual")}
            className={`flex flex-1 items-center justify-center gap-2 py-3 text-sm font-semibold transition ${
              addExpenseTab === "manual"
                ? "border-b-2 border-purple-600 text-gray-900"
                : "border-b-2 border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
            Manual entry
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {addExpenseTab === "statement" && (
            <div className="p-5">
              <p className="mb-3 text-xs text-gray-600">
                Tag a transaction — it saves immediately and counts toward this project&apos;s budget.
              </p>
              <TagCashPaymentPanel
                eventId={eventId}
                headers={headers}
                isOpen={addExpenseTab === "statement"}
                bordered={false}
                statementPickerOnly
                postCashPayment={async () => false}
                onCashSaved={() => {}}
                onClose={() => {}}
                onTransactionTagged={handleProjectStatementTag}
                homeCurrency={hc}
              />
            </div>
          )}

          {addExpenseTab === "manual" && (
            <form onSubmit={handleAddManualExpense} className="flex flex-col">
              <div className="divide-y divide-gray-100">
                <div className="grid grid-cols-1 items-center gap-2 px-5 py-3 sm:grid-cols-[minmax(0,160px)_1fr] sm:gap-6">
                  <label htmlFor="add-expense-desc" className="text-sm text-gray-700">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="add-expense-desc"
                    value={expenseDescription}
                    onChange={(e) => setExpenseDescription(e.target.value)}
                    placeholder="e.g. Train tickets, dinner at Sukiyabashi"
                    required
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                  />
                </div>
                <div className="grid grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[minmax(0,160px)_1fr] sm:gap-6 sm:items-start">
                  <label htmlFor="add-expense-amt" className="pt-2 text-sm text-gray-700">
                    Amount <span className="text-red-500">*</span>
                  </label>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-400">{curSym}</span>
                      <input
                        id="add-expense-amt"
                        type="number"
                        min="0.01"
                        step="0.01"
                        required
                        value={expenseAmount}
                        onChange={(e) => setExpenseAmount(e.target.value)}
                        placeholder="0.00"
                        className="w-full max-w-[220px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-gray-400">
                      {hc} · paid in foreign currency? Convert first or note in description.
                    </p>
                  </div>
                </div>
                <div className="grid grid-cols-1 items-center gap-2 px-5 py-3 sm:grid-cols-[minmax(0,160px)_1fr] sm:gap-6">
                  <label htmlFor="add-expense-date" className="text-sm text-gray-700">
                    Date <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="add-expense-date"
                    type="date"
                    required
                    value={expenseDate}
                    max={new Date().toISOString().substring(0, 10)}
                    onChange={(e) => setExpenseDate(e.target.value)}
                    className="w-full max-w-[240px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                  />
                </div>
                <div className="grid grid-cols-1 items-center gap-2 px-5 py-3 sm:grid-cols-[minmax(0,160px)_1fr] sm:gap-6">
                  <label htmlFor="add-expense-cat" className="text-sm text-gray-700">
                    Category
                  </label>
                  <select
                    id="add-expense-cat"
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className="w-full max-w-[280px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                  >
                    {PARENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid grid-cols-1 items-center gap-2 px-5 py-3 sm:grid-cols-[minmax(0,160px)_1fr] sm:gap-6">
                  <label htmlFor="add-expense-paid" className="text-sm text-gray-700">
                    Paid from
                  </label>
                  <select
                    id="add-expense-paid"
                    value={expensePaidFrom}
                    onChange={(e) => setExpensePaidFrom(e.target.value as "cash" | "card")}
                    className="w-full max-w-[280px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card (statement not available yet)</option>
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-4">
                <p className="text-sm text-gray-600">New expense</p>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeAddExpenseModal}
                    disabled={savingExpense}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingExpense || !expenseDescription.trim() || !expenseAmount}
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 disabled:opacity-50"
                  >
                    {savingExpense ? "Adding…" : "Add expense"}
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
