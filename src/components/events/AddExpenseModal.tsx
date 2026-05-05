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

type Step = "pick" | "statement" | "manual";

export default function AddExpenseModal({
  open,
  onClose,
  eventId,
  eventName,
  headers,
  homeCurrency,
  onAfterChange,
}: AddExpenseModalProps) {
  const [step, setStep] = useState<Step>("pick");
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
    setStep("pick");
    setExpenseDescription("");
    setExpenseAmount("");
    setExpenseDate(new Date().toISOString().substring(0, 10));
    setExpenseCategory("Dining");
    setExpensePaidFrom("cash");
  }, [open]);

  const close = useCallback(() => {
    setStep("pick");
    setExpenseDescription("");
    setExpenseAmount("");
    setExpenseDate(new Date().toISOString().substring(0, 10));
    setExpenseCategory("Dining");
    setExpensePaidFrom("cash");
    onClose();
  }, [onClose]);

  const handleProjectStatementTag = useCallback(
    async (_evId: string, amountDelta: number, _date?: string, tx?: RawTx) => {
      await onAfterChange?.();
      if (tx && amountDelta >= 0) close();
    },
    [onAfterChange, close],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        if (step !== "pick") {
          setStep("pick");
        } else {
          close();
        }
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, step, close]);

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
        close();
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
          if (e.target === e.currentTarget && !savingExpense) close();
        }}
      >
        <div
          className="box-border mx-auto flex min-h-0 min-w-0 w-full max-w-[min(32rem,calc(100vw-1.75rem-env(safe-area-inset-left)-env(safe-area-inset-right)))] max-h-[min(85svh,85dvh)] flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-y-contain">

            {/* ── Step: pick ── */}
            {step === "pick" && (
              <>
                <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-2">
                  <div className="min-w-0 pr-2">
                    <h2 className="text-lg font-semibold tracking-tight text-gray-900">Add expense</h2>
                    <p className="mt-1 truncate text-sm text-gray-500" title={eventName}>to {eventName}</p>
                  </div>
                  <button
                    type="button"
                    onClick={close}
                    disabled={savingExpense}
                    className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                    aria-label="Close"
                  >
                    ✕
                  </button>
                </div>

                <div className="px-5 pb-1 pt-3 space-y-2.5">
                  <button
                    type="button"
                    onClick={() => setStep("statement")}
                    className="group flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3.5 text-left shadow-sm transition hover:border-purple-300 hover:bg-purple-50/40"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-gray-50 text-gray-600 group-hover:border-purple-100 group-hover:bg-white">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-gray-900">Tag from statement</span>
                      <span className="mt-0.5 block text-xs leading-snug text-gray-500">
                        Find a transaction in your uploaded statements and label it.
                      </span>
                    </div>
                    <span className="shrink-0 text-gray-300 group-hover:text-purple-400">→</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setStep("manual")}
                    className="group flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3.5 text-left shadow-sm transition hover:border-purple-300 hover:bg-purple-50/40"
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-gray-50 text-gray-600 group-hover:border-purple-100 group-hover:bg-white">
                      <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                      </svg>
                    </span>
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-gray-900">Enter manually</span>
                      <span className="mt-0.5 block text-xs leading-snug text-gray-500">
                        Record a cash payment or any spend not on a statement yet.
                      </span>
                    </div>
                    <span className="shrink-0 text-gray-300 group-hover:text-purple-400">→</span>
                  </button>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs text-gray-500">
                  <span className="inline-flex items-center gap-1.5">
                    <kbd className="rounded border border-gray-200 bg-white px-1.5 py-px font-mono text-[11px] font-medium text-gray-700 shadow-sm">Esc</kbd>{" "}
                    to close
                  </span>
                </div>
              </>
            )}

            {/* ── Step: statement ── */}
            {step === "statement" && (
              <>
                <div className="grid grid-cols-[2.25rem_1fr_2.25rem] items-center gap-1 border-b border-gray-100 px-2 py-2.5">
                  <button
                    type="button"
                    aria-label="Back"
                    onClick={() => setStep("pick")}
                    className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
                  >
                    ←
                  </button>
                  <h3 className="truncate px-1 text-center text-sm font-semibold text-gray-900">Tag from statement</h3>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={close}
                    className="flex h-9 w-9 items-center justify-center justify-self-end rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>
                <div className="p-5 space-y-3">
                  <p className="text-xs text-gray-600">
                    Tagging saves immediately and counts toward this project&apos;s budget. The dialog closes after you tag a transaction.
                  </p>
                  <TagCashPaymentPanel
                    eventId={eventId}
                    headers={headers}
                    isOpen={step === "statement"}
                    bordered={false}
                    statementPickerOnly
                    postCashPayment={async () => false}
                    onCashSaved={() => {}}
                    onClose={() => {}}
                    onTransactionTagged={handleProjectStatementTag}
                    homeCurrency={hc}
                  />
                </div>
              </>
            )}

            {/* ── Step: manual ── */}
            {step === "manual" && (
              <>
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-gray-100 px-3 py-3">
                  <button
                    type="button"
                    onClick={() => setStep("pick")}
                    className="justify-self-start text-sm font-medium text-gray-600 hover:text-gray-900"
                  >
                    {"< Back"}
                  </button>
                  <h3 className="text-center text-base font-semibold text-gray-900">Manual entry</h3>
                  <button
                    type="button"
                    aria-label="Close"
                    onClick={close}
                    className="justify-self-end flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                  >
                    ✕
                  </button>
                </div>

                <form onSubmit={handleAddManualExpense} className="flex flex-col">
                  <div className="space-y-4 border-b border-gray-100 px-5 py-5">
                    <div>
                      <label htmlFor="add-expense-desc" className="mb-1.5 block text-sm font-medium text-gray-900">
                        Description <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="add-expense-desc"
                        value={expenseDescription}
                        onChange={(e) => setExpenseDescription(e.target.value)}
                        placeholder="e.g. Train tickets, dinner"
                        required
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                      />
                    </div>
                    <div>
                      <label htmlFor="add-expense-amt" className="mb-1.5 block text-sm font-medium text-gray-900">
                        Amount <span className="text-red-500">*</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 text-sm text-gray-400">{curSym}</span>
                        <input
                          id="add-expense-amt"
                          type="number"
                          min="0.01"
                          step="0.01"
                          required
                          value={expenseAmount}
                          onChange={(e) => setExpenseAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                        />
                      </div>
                      <p className="mt-1.5 text-xs text-gray-400">{hc} · paid in foreign currency? Convert first.</p>
                    </div>
                    <div>
                      <label htmlFor="add-expense-date" className="mb-1.5 block text-sm font-medium text-gray-900">
                        Date <span className="text-red-500">*</span>
                      </label>
                      <input
                        id="add-expense-date"
                        type="date"
                        required
                        value={expenseDate}
                        max={new Date().toISOString().substring(0, 10)}
                        onChange={(e) => setExpenseDate(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                      />
                    </div>
                    <div>
                      <label htmlFor="add-expense-cat" className="mb-1.5 block text-sm font-medium text-gray-900">
                        Category
                      </label>
                      <select
                        id="add-expense-cat"
                        value={expenseCategory}
                        onChange={(e) => setExpenseCategory(e.target.value)}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                      >
                        {PARENT_CATEGORIES.map((c) => (
                          <option key={c} value={c}>{c}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="add-expense-paid" className="mb-1.5 block text-sm font-medium text-gray-900">
                        Paid from
                      </label>
                      <select
                        id="add-expense-paid"
                        value={expensePaidFrom}
                        onChange={(e) => setExpensePaidFrom(e.target.value as "cash" | "card")}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-purple-400 focus:outline-none focus:ring-1 focus:ring-purple-500/30"
                      >
                        <option value="cash">Cash</option>
                        <option value="card">Card</option>
                      </select>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-4">
                    <p className="text-sm text-gray-600">New expense</p>
                    <div className="ml-auto flex items-center gap-2">
                      <button
                        type="button"
                        onClick={close}
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
              </>
            )}

          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
