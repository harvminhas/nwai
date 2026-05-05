"use client";

import { useState, useEffect } from "react";
import { fmt, HOME_CURRENCY, getCurrencySymbol } from "@/lib/currencyUtils";
import type { RawTx } from "@/components/events/TagPicker";

function fmtShortDate(iso: string): string {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export interface TagCashPaymentPanelProps {
  eventId: string;
  headers: Record<string, string>;
  isOpen: boolean;
  onClose: () => void;
  onTransactionTagged?: (eventId: string, amountDelta: number, date?: string, tx?: RawTx) => void;
  postCashPayment: (p: { date: string; amount: number; note?: string; paymentMethod?: "cash" | "card" }) => Promise<boolean>;
  onCashSaved: (amount: number, date: string) => void;
  homeCurrency?: string;
  /** When true, wraps in a card with border (default). Set false for inline/borderless use. */
  bordered?: boolean;
  /**
   * Embed only the "From Statement" tagging list — no tabs, no footer.
   * Use inside a parent form where Cancel/Save are handled externally.
   */
  statementPickerOnly?: boolean;
}

export default function TagCashPaymentPanel({
  eventId,
  headers,
  isOpen,
  onClose,
  onTransactionTagged,
  postCashPayment,
  onCashSaved,
  homeCurrency,
  bordered = true,
  statementPickerOnly = false,
}: TagCashPaymentPanelProps) {
  const cur    = homeCurrency ?? HOME_CURRENCY;
  const curSym = getCurrencySymbol(cur).trim();
  const todayISO = new Date().toISOString().substring(0, 10);

  const [paymentTab, setPaymentTab]         = useState<"statement" | "manual">("statement");
  const [manualMethod, setManualMethod]     = useState<"cash" | "card">("cash");
  const [allTxns, setAllTxns]               = useState<RawTx[]>([]);
  const [loadingTxns, setLoadingTxns]       = useState(false);
  const [txSearch, setTxSearch]             = useState("");
  const [taggedFingerprints, setTaggedFingerprints] = useState<Set<string>>(new Set());
  const [sessionTagged, setSessionTagged]   = useState<Set<string>>(new Set());
  const [sessionUntagged, setSessionUntagged] = useState<Set<string>>(new Set());
  const [tagging, setTagging]               = useState<string | null>(null);
  const [manualAmt, setManualAmt]           = useState("");
  const [manualNote, setManualNote]         = useState("");
  const [manualDate, setManualDate]         = useState(todayISO);
  const [savingManual, setSavingManual]     = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setPaymentTab("statement");
    setManualMethod("cash");
    setTxSearch("");
    setManualAmt("");
    setManualNote("");
    setManualDate(new Date().toISOString().substring(0, 10));
    setLoadingTxns(true);
    (async () => {
      try {
        const [txRes, evRes] = await Promise.all([
          fetch(`/api/user/spending/transactions?months=12`, { headers }),
          fetch(`/api/user/events/${eventId}`, { headers }),
        ]);
        const [txJson, evJson] = await Promise.all([txRes.json(), evRes.json()]);
        setAllTxns(txJson.transactions ?? []);
        const fps = new Set<string>((evJson.transactions ?? []).map((t: RawTx) => t.fingerprint));
        setTaggedFingerprints(fps);
        setSessionTagged(new Set());
        setSessionUntagged(new Set());
      } finally {
        setLoadingTxns(false);
      }
    })();
  }, [isOpen, eventId, headers]);

  async function handleTagTx(tx: RawTx) {
    setTagging(tx.fingerprint);
    try {
      const res = await fetch("/api/user/tx-tags", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: tx.fingerprint, add: [eventId], date: tx.date }),
      });
      if (res.ok) {
        setSessionTagged((prev) => new Set([...prev, tx.fingerprint]));
        setSessionUntagged((prev) => { const s = new Set(prev); s.delete(tx.fingerprint); return s; });
        onTransactionTagged?.(eventId, tx.amount, tx.date, tx);
      }
    } finally { setTagging(null); }
  }

  async function handleUntagTx(tx: RawTx) {
    setTagging(tx.fingerprint);
    try {
      const res = await fetch("/api/user/tx-tags", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ fingerprint: tx.fingerprint, remove: [eventId], date: tx.date }),
      });
      if (res.ok) {
        setSessionUntagged((prev) => new Set([...prev, tx.fingerprint]));
        setSessionTagged((prev) => { const s = new Set(prev); s.delete(tx.fingerprint); return s; });
        onTransactionTagged?.(eventId, -tx.amount, tx.date, tx);
      }
    } finally { setTagging(null); }
  }

  async function handleSaveManual(e: React.MouseEvent) {
    e.stopPropagation();
    const amt = parseFloat(manualAmt);
    if (!amt || amt <= 0) return;
    setSavingManual(true);
    try {
      const ok = await postCashPayment({
        date: manualDate,
        amount: amt,
        paymentMethod: manualMethod,
        ...(manualNote.trim() ? { note: manualNote.trim() } : {}),
      });
      if (ok) { onCashSaved(amt, manualDate); onClose(); }
    } finally { setSavingManual(false); }
  }

  function isTaggedFn(fp: string) {
    return (taggedFingerprints.has(fp) || sessionTagged.has(fp)) && !sessionUntagged.has(fp);
  }
  const filteredTxns = allTxns
    .filter((t) => !txSearch || t.description.toLowerCase().includes(txSearch.toLowerCase()))
    .sort((a, b) => (isTaggedFn(a.fingerprint) ? 0 : 1) - (isTaggedFn(b.fingerprint) ? 0 : 1));

  if (!isOpen) return null;

  const wrapper = bordered
    ? "mt-3 min-w-0 max-w-full rounded-xl border border-gray-100 bg-white overflow-hidden"
    : "min-w-0 max-w-full overflow-x-hidden bg-white overflow-hidden";

  return (
    <div className={wrapper} onClick={(e) => e.stopPropagation()}>
      {!statementPickerOnly && (
        <div className="flex border-b border-gray-100">
          {(["statement", "manual"] as const).map((tab) => (
            <button key={tab} type="button" onClick={() => setPaymentTab(tab)}
              className={`flex-1 py-2.5 text-xs font-semibold transition ${
                paymentTab === tab ? "bg-white text-gray-900 border-b-2 border-indigo-600" : "bg-gray-50 text-gray-500 hover:text-gray-700"
              }`}>
              {tab === "statement" ? "From Statement" : "Manual Entry"}
            </button>
          ))}
        </div>
      )}

      {/* From Statement */}
      {(statementPickerOnly || paymentTab === "statement") && (
        <div className="min-w-0 overflow-x-hidden px-4 pt-3 pb-1">
          <input
            value={txSearch}
            onChange={(e) => setTxSearch(e.target.value)}
            placeholder="Search merchant…"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") e.preventDefault();
            }}
            className="mb-3 min-w-0 max-w-full box-border w-full rounded-lg border border-gray-200 px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
          {loadingTxns ? (
            <p className="text-xs text-gray-400 py-4 text-center">Loading…</p>
          ) : filteredTxns.length === 0 ? (
            <p className="text-xs text-gray-400 py-4 text-center">
              {txSearch ? "No transactions match" : "No transactions in the last 12 months"}
            </p>
          ) : (
            <div className={statementPickerOnly ? "w-full" : "mx-0 max-h-56 w-full max-w-full touch-pan-y overflow-x-hidden overflow-y-auto overscroll-y-contain [-webkit-overflow-scrolling:touch]"}>
              {filteredTxns.map((tx, i) => {
                const tagged     = isTaggedFn(tx.fingerprint);
                const prevTagged = i > 0 ? isTaggedFn(filteredTxns[i - 1].fingerprint) : true;
                const showDiv    = !tagged && prevTagged && filteredTxns.some((t) => isTaggedFn(t.fingerprint));
                return (
                  <div key={tx.fingerprint}>
                    {showDiv && (
                      <div className="flex items-center gap-2 px-4 py-1.5 bg-gray-50">
                        <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Other transactions</span>
                      </div>
                    )}
                    <div
                      className={`flex min-w-0 flex-col gap-2 px-4 py-2.5 border-b border-gray-50 sm:flex-row sm:items-center sm:gap-3 ${tagged ? "bg-emerald-50 border-l-2 border-l-emerald-400" : ""}`}
                    >
                      <div className="min-w-0 flex-1 overflow-hidden">
                        <div className="flex min-w-0 items-center gap-1.5">
                          <p className={`min-w-0 flex-1 max-w-[100%] text-xs font-semibold truncate ${tagged ? "text-emerald-900" : "text-gray-800"}`}>{tx.description}</p>
                          {tagged && <span className="shrink-0 rounded-full bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700">Tagged ✓</span>}
                        </div>
                        <p className={`truncate text-[11px] ${tagged ? "text-emerald-600" : "text-gray-400"}`} title={`${fmtShortDate(tx.date)} · ${tx.accountLabel}`}>
                          {fmtShortDate(tx.date)} · {tx.accountLabel}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center justify-end gap-2 sm:gap-3">
                      <span className={`text-xs font-semibold tabular-nums ${tagged ? "text-emerald-800" : "text-gray-800"}`}>
                        {fmt(tx.amount, cur)}
                      </span>
                      {tagged ? (
                        <button type="button" onClick={() => handleUntagTx(tx)} disabled={tagging === tx.fingerprint}
                          className="shrink-0 rounded-lg border border-red-200 bg-white px-2 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50 disabled:opacity-50 sm:px-3">
                          {tagging === tx.fingerprint ? "…" : "Untag"}
                        </button>
                      ) : (
                        <button type="button" onClick={() => handleTagTx(tx)} disabled={tagging === tx.fingerprint}
                          className="shrink-0 rounded-lg bg-indigo-50 px-2 py-1.5 text-xs font-medium text-indigo-700 transition hover:bg-indigo-100 disabled:opacity-50 sm:px-3">
                          {tagging === tx.fingerprint ? "…" : "Tag"}
                        </button>
                      )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="py-2" />
        </div>
      )}

      {/* Manual Entry */}
      {!statementPickerOnly && paymentTab === "manual" && (
        <div className="px-4 py-3 space-y-3">
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">How did you pay?</p>
            <div className="flex gap-4">
              {(["cash", "card"] as const).map((m) => (
                <label key={m} className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-700">
                  <input type="radio" name="manualMethod" value={m} checked={manualMethod === m}
                    onChange={() => setManualMethod(m)} className="accent-indigo-600" />
                  {m === "cash" ? "Cash" : "Card"}
                </label>
              ))}
            </div>
            {manualMethod === "card" && (
              <p className="mt-1.5 text-[11px] text-amber-600 bg-amber-50 rounded-lg px-2.5 py-1.5">
                Placeholder — tag the real transaction when your statement arrives.
              </p>
            )}
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Date</p>
            <input type="date" value={manualDate} max={todayISO}
              onChange={(e) => { e.stopPropagation(); setManualDate(e.target.value); }}
              onClick={(e) => e.stopPropagation()}
              className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">Amount</p>
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-gray-400">{curSym}</span>
              <input type="number" min="0" step="0.01" value={manualAmt} onChange={(e) => setManualAmt(e.target.value)}
                placeholder="0.00" autoFocus
                className="w-32 rounded-lg border border-gray-200 bg-white px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
          <input value={manualNote} onChange={(e) => setManualNote(e.target.value)}
            placeholder="Note (optional)"
            className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
      )}

      {!statementPickerOnly && (
        <div className="flex items-center justify-end gap-2 px-4 pb-3">
          <button type="button" onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="rounded-lg px-3 py-1.5 text-xs font-medium text-gray-500 hover:text-gray-700 border border-gray-200">
            Cancel
          </button>
          {paymentTab === "manual" && (
            <button type="button" onClick={handleSaveManual} disabled={savingManual || !manualAmt}
              className="rounded-lg bg-indigo-600 px-4 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50 transition">
              {savingManual ? "Saving…" : manualMethod === "cash" ? "Save cash payment" : "Save card placeholder"}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
