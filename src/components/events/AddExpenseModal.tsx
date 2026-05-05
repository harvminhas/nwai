"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/components/events/useBodyScrollLock";
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

  useBodyScrollLock(open);

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
  if (typeof document === "undefined") return null;

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-hidden overscroll-none bg-black/40">
      <div
        className="flex h-[100svh] min-h-0 min-w-0 w-full max-w-[100vw] items-center justify-center overflow-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] supports-[height:100dvh]:h-[100dvh] sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget && !savingExpense) closeAddExpenseModal();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-expense-modal-title"
          className="box-border mx-auto flex min-h-0 min-w-0 w-full max-w-[min(32rem,calc(100vw-1.75rem-env(safe-area-inset-left)-env(safe-area-inset-right)))] max-h-[min(85svh,85dvh)] flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
        <div className="flex min-w-0 shrink-0 items-start justify-between gap-2 border-b border-gray-100 px-5 pt-5 pb-3">
          <div className="min-w-0 pr-2">
            <h2 id="add-expense-modal-title" className="text-lg font-semibold leading-tight text-gray-900">
              Add expense
            </h2>
            <p className="mt-0.5 truncate text-sm text-gray-500" title={eventName}>
              to {eventName}
            </p>
          </div>
          <button
            type="button"
            onClick={closeAddExpenseModal}
            disabled={savingExpense}
            className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        <div className="min-w-0 shrink-0 flex border-b border-gray-100 px-2">
          <button
            type="button"
            onClick={() => setAddExpenseTab("statement")}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 py-3 text-sm font-semibold transition ${
              addExpenseTab === "statement"
                ? "border-b-2 border-purple-600 text-gray-900"
                : "border-b-2 border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
              />
            </svg>
            <span className="truncate">From statement</span>
          </button>
          <button
            type="button"
            onClick={() => setAddExpenseTab("manual")}
            className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 py-3 text-sm font-semibold transition ${
              addExpenseTab === "manual"
                ? "border-b-2 border-purple-600 text-gray-900"
                : "border-b-2 border-transparent text-gray-500 hover:text-gray-700"
            }`}
          >
            <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
              />
            </svg>
            <span className="truncate">Manual entry</span>
          </button>
        </div>

        <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain">
          {addExpenseTab === "statement" && (
            <div className="min-w-0 p-5">
              <p className="mb-3 break-words text-xs text-gray-600">
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
            <form onSubmit={handleAddManualExpense} className="flex min-w-0 flex-col">
              <div className="divide-y divide-gray-100">
                <div className="grid min-w-0 grid-cols-1 items-center gap-2 px-5 py-3 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)] sm:gap-6">
                  <label htmlFor="add-expense-desc" className="text-sm text-gray-700">
                    Description <span className="text-red-500">*</span>
                  </label>
                  <input
                    id="add-expense-desc"
                    value={expenseDescription}
                    onChange={(e) => setExpenseDescription(e.target.value)}
                    placeholder="e.g. Train tickets, dinner at Sukiyabashi"
                    required
                    className="min-w-0 max-w-full w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                  />
                </div>
                <div className="grid min-w-0 grid-cols-1 gap-1 px-5 py-3 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)] sm:gap-6 sm:items-start">
                  <label htmlFor="add-expense-amt" className="pt-2 text-sm text-gray-700">
                    Amount <span className="text-red-500">*</span>
                  </label>
                  <div>
                    <div className="flex min-w-0 items-center gap-2">
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
                        className="min-w-0 w-full max-w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30 sm:max-w-[220px]"
                      />
                    </div>
                    <p className="mt-1.5 text-xs text-gray-400">
                      {hc} · paid in foreign currency? Convert first or note in description.
                    </p>
                  </div>
                </div>
                <div className="grid min-w-0 grid-cols-1 items-center gap-2 px-5 py-3 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)] sm:gap-6">
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
                    className="min-w-0 max-w-full w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30 sm:max-w-[240px]"
                  />
                </div>
                <div className="grid min-w-0 grid-cols-1 items-center gap-2 px-5 py-3 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)] sm:gap-6">
                  <label htmlFor="add-expense-cat" className="text-sm text-gray-700">
                    Category
                  </label>
                  <select
                    id="add-expense-cat"
                    value={expenseCategory}
                    onChange={(e) => setExpenseCategory(e.target.value)}
                    className="min-w-0 max-w-full w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                  >
                    {PARENT_CATEGORIES.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid min-w-0 grid-cols-1 items-center gap-2 px-5 py-3 sm:grid-cols-[minmax(0,160px)_minmax(0,1fr)] sm:gap-6">
                  <label htmlFor="add-expense-paid" className="text-sm text-gray-700">
                    Paid from
                  </label>
                  <select
                    id="add-expense-paid"
                    value={expensePaidFrom}
                    onChange={(e) => setExpensePaidFrom(e.target.value as "cash" | "card")}
                    className="min-w-0 max-w-full w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                  >
                    <option value="cash">Cash</option>
                    <option value="card">Card (statement not available yet)</option>
                  </select>
                </div>
              </div>

              <div className="flex min-w-0 flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-4">
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
    </div>,
    document.body,
  );
}
