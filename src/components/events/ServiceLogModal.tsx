"use client";

import { useCallback, useEffect, useState } from "react";
import TagCashPaymentPanel from "@/components/events/TagCashPaymentPanel";
import type { RawTx } from "@/components/events/TagPicker";
import type { VisitLog } from "@/lib/events/types";
import { getCurrencySymbol } from "@/lib/currencyUtils";

export interface ServiceLogModalProps {
  open: boolean;
  onClose: () => void;
  eventId: string;
  headers: Record<string, string>;
  homeCurrency: string;
  /** Run after a successful log save or statement tag / untag */
  onAfterChange?: () => void | Promise<void>;
}

export default function ServiceLogModal({
  open,
  onClose,
  eventId,
  headers,
  homeCurrency,
  onAfterChange,
}: ServiceLogModalProps) {
  const [logModalStep, setLogModalStep] = useState<"pick" | "statement" | "manual">("pick");
  const [logDate, setLogDate] = useState(() => new Date().toISOString().substring(0, 10));
  const [logNote, setLogNote] = useState("");
  const [showPaymentInForm, setShowPaymentInForm] = useState(false);
  const [logPayMethod, setLogPayMethod] = useState<"cash" | "card">("cash");
  const [logPayAmount, setLogPayAmount] = useState("");
  const [savingVisit, setSavingVisit] = useState(false);

  const hc = homeCurrency;
  const curSym = getCurrencySymbol(hc).trim();

  useEffect(() => {
    if (!open) return;
    setLogModalStep("pick");
    setShowPaymentInForm(false);
    setLogPayAmount("");
    setLogNote("");
    setLogDate(new Date().toISOString().substring(0, 10));
  }, [open]);

  const closeLogModal = useCallback(() => {
    setLogModalStep("pick");
    setShowPaymentInForm(false);
    setLogPayAmount("");
    setLogNote("");
    setLogDate(new Date().toISOString().substring(0, 10));
    onClose();
  }, [onClose]);

  const handleServiceStatementTag = useCallback(
    async (_evId: string, amountDelta: number, _date?: string, tx?: RawTx) => {
      await onAfterChange?.();
      if (tx && amountDelta >= 0) closeLogModal();
    },
    [onAfterChange, closeLogModal],
  );

  useEffect(() => {
    if (!open) return;
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        closeLogModal();
        return;
      }
      if (logModalStep !== "pick") return;
      if (e.key === "1") {
        e.preventDefault();
        setLogModalStep("statement");
      } else if (e.key === "2") {
        e.preventDefault();
        setLogModalStep("manual");
        setShowPaymentInForm(false);
        setLogPayAmount("");
        setLogNote("");
        setLogDate(new Date().toISOString().substring(0, 10));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, logModalStep, closeLogModal]);

  async function handleSaveVisit(e: React.FormEvent) {
    e.preventDefault();
    const manualPayment = showPaymentInForm;
    const payAmt = manualPayment ? parseFloat(logPayAmount) : NaN;
    if (manualPayment && (!Number.isFinite(payAmt) || payAmt <= 0)) return;
    setSavingVisit(true);
    try {
      const body: Record<string, unknown> = { date: logDate };
      if (logNote.trim()) body.note = logNote.trim();
      if (manualPayment) {
        body.paymentMethod = logPayMethod;
        body.amount = payAmt;
      }
      const res = await fetch(`/api/user/events/${eventId}/visits`, {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        const json = (await res.json()) as { visit: VisitLog };
        if (json.visit) await onAfterChange?.();
        closeLogModal();
      }
    } finally {
      setSavingVisit(false);
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget && !savingVisit) closeLogModal();
      }}
    >
      <div
        className="w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {logModalStep === "pick" && (
          <>
            <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-2">
              <div className="min-w-0 pr-2">
                <h2 className="text-lg font-semibold text-gray-900 tracking-tight">What are you logging?</h2>
                <p className="text-sm text-gray-500 mt-1.5">Pick how you want to record this.</p>
              </div>
              <button
                type="button"
                onClick={closeLogModal}
                disabled={savingVisit}
                className="shrink-0 rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <div className="px-5 pb-1 pt-3 space-y-2.5">
              <button
                type="button"
                onClick={() => setLogModalStep("statement")}
                className="group flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3.5 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-gray-50 text-gray-600 group-hover:border-indigo-100 group-hover:bg-white"
                  aria-hidden
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">Tag from statement</span>
                  <span className="mt-0.5 block text-xs leading-snug text-gray-500">
                    Find a transaction in your uploaded statements and label it.
                  </span>
                </div>
                <span className="shrink-0 text-gray-300 group-hover:text-indigo-400" aria-hidden>
                  →
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setLogModalStep("manual");
                  setShowPaymentInForm(false);
                  setLogPayAmount("");
                  setLogNote("");
                  setLogDate(new Date().toISOString().substring(0, 10));
                }}
                className="group flex w-full items-center gap-3 rounded-xl border border-gray-200 bg-white px-3.5 py-3.5 text-left shadow-sm transition hover:border-indigo-300 hover:bg-indigo-50/40"
              >
                <span
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-100 bg-gray-50 text-gray-600 group-hover:border-indigo-100 group-hover:bg-white"
                  aria-hidden
                >
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                    />
                  </svg>
                </span>
                <div className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-gray-900">Create manual log</span>
                  <span className="mt-0.5 block text-xs leading-snug text-gray-500">
                    Record a check-in, a cash payment, or anything not on a statement yet.
                  </span>
                </div>
                <span className="shrink-0 text-gray-300 group-hover:text-indigo-400" aria-hidden>
                  →
                </span>
              </button>
            </div>

            <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-gray-100 bg-gray-50 px-5 py-3 text-xs text-gray-500">
              <span className="inline-flex flex-wrap items-center gap-1.5">
                Press{" "}
                <kbd className="rounded border border-gray-200 bg-white px-1.5 py-px font-mono text-[11px] font-medium text-gray-700 shadow-sm">
                  1
                </kbd>{" "}
                or{" "}
                <kbd className="rounded border border-gray-200 bg-white px-1.5 py-px font-mono text-[11px] font-medium text-gray-700 shadow-sm">
                  2
                </kbd>{" "}
                to choose
              </span>
              <span className="inline-flex items-center gap-1.5">
                <kbd className="rounded border border-gray-200 bg-white px-1.5 py-px font-mono text-[11px] font-medium text-gray-700 shadow-sm">
                  Esc
                </kbd>{" "}
                to close
              </span>
            </div>
          </>
        )}

        {logModalStep === "statement" && (
          <>
            <div className="grid grid-cols-[2.25rem_1fr_2.25rem] items-center gap-1 border-b border-gray-100 px-2 py-2.5">
              <button
                type="button"
                aria-label="Back"
                onClick={() => setLogModalStep("pick")}
                className="flex h-9 w-9 items-center justify-center rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-800"
              >
                ←
              </button>
              <h3 className="text-center text-sm font-semibold text-gray-900 truncate px-1">Tag from statement</h3>
              <button
                type="button"
                aria-label="Close"
                onClick={closeLogModal}
                className="flex h-9 w-9 items-center justify-center justify-self-end rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              <p className="text-xs text-gray-600">
                Tagging saves immediately. Payment only — no visit. The dialog closes after you tag a transaction.
              </p>
              <TagCashPaymentPanel
                eventId={eventId}
                headers={headers}
                isOpen
                bordered={false}
                statementPickerOnly
                postCashPayment={async () => false}
                onCashSaved={() => {}}
                onClose={() => {}}
                onTransactionTagged={handleServiceStatementTag}
                homeCurrency={hc}
              />
            </div>
          </>
        )}

        {logModalStep === "manual" && (
          <>
            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 border-b border-gray-100 px-3 py-3">
              <button
                type="button"
                onClick={() => setLogModalStep("pick")}
                className="justify-self-start text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                {"< Back"}
              </button>
              <h3 className="text-center text-base font-semibold text-gray-900">Manual log</h3>
              <button
                type="button"
                aria-label="Close"
                onClick={closeLogModal}
                className="justify-self-end flex h-9 w-9 items-center justify-center rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSaveVisit} className="flex flex-col">
              <div className="space-y-4 border-b border-gray-100 px-5 py-5">
                <div>
                  <label htmlFor="service-modal-log-date" className="mb-1.5 block text-sm font-medium text-gray-900">
                    Date
                  </label>
                  <input
                    id="service-modal-log-date"
                    type="date"
                    value={logDate}
                    max={new Date().toISOString().substring(0, 10)}
                    onChange={(e) => setLogDate(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 shadow-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-900/20"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="service-modal-log-note" className="mb-1.5 block text-sm font-medium text-gray-900">
                    Note
                  </label>
                  <textarea
                    id="service-modal-log-note"
                    value={logNote}
                    onChange={(e) => setLogNote(e.target.value)}
                    placeholder="What did you check, or what happened? e.g. balances looked good, paid landlord by e-transfer"
                    rows={4}
                    className="min-h-[100px] w-full resize-y rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 placeholder:text-gray-400 shadow-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-900/20"
                  />
                </div>
              </div>

              <div className="border-b border-gray-100 bg-gray-50 px-5 py-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">Add a payment</p>
                    <p className="mt-0.5 text-xs text-gray-500">For cash or off-statement payments</p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showPaymentInForm}
                    onClick={() => {
                      setShowPaymentInForm((v) => {
                        if (v) setLogPayAmount("");
                        return !v;
                      });
                    }}
                    className={`flex h-7 w-12 shrink-0 items-center rounded-full p-0.5 transition-colors ${
                      showPaymentInForm ? "justify-end bg-gray-900" : "justify-start bg-gray-300"
                    }`}
                  >
                    <span className="h-5 w-5 rounded-full bg-white shadow-sm" aria-hidden />
                  </button>
                </div>

                {showPaymentInForm && (
                  <div className="mt-4 space-y-3 border-t border-gray-200/80 pt-4">
                    <div className="flex flex-wrap gap-5">
                      {(["cash", "card"] as const).map((m) => (
                        <label key={m} className="flex cursor-pointer items-center gap-2 text-sm text-gray-800">
                          <input
                            type="radio"
                            name="serviceModalLogPayMethod"
                            value={m}
                            checked={logPayMethod === m}
                            onChange={() => setLogPayMethod(m)}
                            className="h-4 w-4 border-gray-300 text-gray-900 focus:ring-gray-900"
                          />
                          {m === "cash" ? "Cash" : "Card"}
                        </label>
                      ))}
                    </div>
                    {logPayMethod === "card" && (
                      <p className="text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
                        Card is a placeholder — tag the bank transaction from your statement when it posts.
                      </p>
                    )}
                    <div>
                      <span className="mb-1.5 block text-xs font-medium text-gray-600">Amount</span>
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-gray-500">{curSym}</span>
                        <input
                          type="number"
                          min="0.01"
                          step="0.01"
                          value={logPayAmount}
                          onChange={(e) => setLogPayAmount(e.target.value)}
                          placeholder="0.00"
                          className="w-full max-w-[200px] rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-gray-400 focus:outline-none focus:ring-1 focus:ring-gray-900/20"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-5 py-4">
                <p className="text-sm text-gray-600">{showPaymentInForm ? "Visit + Payment" : "Visit only"}</p>
                <div className="ml-auto flex items-center gap-2">
                  <button
                    type="button"
                    onClick={closeLogModal}
                    disabled={savingVisit}
                    className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={savingVisit || (showPaymentInForm && !logPayAmount)}
                    className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-gray-800 disabled:opacity-50"
                  >
                    {savingVisit ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
