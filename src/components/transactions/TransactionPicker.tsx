"use client";

import { useEffect, useState } from "react";
import { formatCurrency } from "@/lib/currencyUtils";
import {
  PICKER_VISIBLE_LIMIT,
  fetchLinkableTransactions,
  filterLinkableTransactions,
  toggleTxSelection,
  transactionMetaLine,
  type LinkableTransaction,
  type TransactionPickerContext,
  type TransactionPickerFilterMode,
} from "./linkTransactions";

const FILTER_OPTIONS: { id: TransactionPickerFilterMode; label: string }[] = [
  { id: "all", label: "All" },
  { id: "income", label: "Income" },
  { id: "spending", label: "Spending" },
];

export function TransactionPicker({
  token,
  context,
  defaultFilter = "all",
  linkedFingerprints,
  onClose,
  onConfirm,
  onError,
}: {
  token: string | null;
  context: TransactionPickerContext;
  defaultFilter?: TransactionPickerFilterMode;
  linkedFingerprints: Iterable<string>;
  onClose: () => void;
  onConfirm: (selected: LinkableTransaction[]) => Promise<void>;
  onError?: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [filterMode, setFilterMode] = useState<TransactionPickerFilterMode>(defaultFilter);
  const [transactions, setTransactions] = useState<LinkableTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    setFilterMode(defaultFilter);
  }, [defaultFilter]);

  useEffect(() => {
    if (!token) return;
    const tok = token;
    let cancelled = false;

    async function loadTransactions() {
      setLoading(true);
      setLoadError(null);
      try {
        const loaded = await fetchLinkableTransactions(tok, context);
        if (cancelled) return;
        setTransactions(loaded);
      } catch (err) {
        console.error("Failed to load transactions:", err);
        const message = "Failed to load transactions. Please try again.";
        if (!cancelled) {
          setLoadError(message);
          onError?.(message);
          setTransactions([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void loadTransactions();
    return () => {
      cancelled = true;
    };
    // onError is a toast callback; omitting it avoids refetch loops from inline parents.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, context]);

  const filtered = filterLinkableTransactions(transactions, {
    linkedFingerprints,
    search,
    context,
    filterMode,
  });

  async function handleSave() {
    if (!token) return;
    setSaveError(null);

    const selectedTxs = transactions.filter((tx) => selected.has(tx.txFingerprint));
    try {
      await onConfirm(selectedTxs);
      onClose();
    } catch (err) {
      console.error("Failed to link transactions:", err);
      const message = "Failed to link transactions. Please try again.";
      setSaveError(message);
      onError?.(message);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-60 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="fixed inset-0 z-70 flex items-center justify-center p-4">
        <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-2xl">
          <div className="border-b border-gray-200 p-6">
            <h2 className="text-xl font-semibold text-gray-900">Link Transactions</h2>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search merchant, date, or amount..."
              className="mt-4 w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-purple-500 focus:outline-none"
            />
            {context === "both" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {FILTER_OPTIONS.map((option) => {
                  const active = filterMode === option.id;
                  return (
                    <button
                      key={option.id}
                      type="button"
                      onClick={() => setFilterMode(option.id)}
                      className={`rounded-full px-3 py-1.5 text-sm font-medium ${
                        active
                          ? "bg-purple-600 text-white"
                          : "border border-gray-300 bg-white text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <div className="h-6 w-6 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
              </div>
            ) : loadError && transactions.length === 0 ? (
              <p className="py-8 text-center text-sm text-red-600">{loadError}</p>
            ) : filtered.length === 0 ? (
              <p className="py-8 text-center text-sm text-gray-500">No transactions found</p>
            ) : (
              <div className="space-y-2">
                {filtered.slice(0, PICKER_VISIBLE_LIMIT).map((tx) => (
                  <label
                    key={`${tx.kind}-${tx.txFingerprint}`}
                    className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 p-3 hover:bg-gray-50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(tx.txFingerprint)}
                      onChange={(e) => {
                        setSelected(toggleTxSelection(selected, tx.txFingerprint, e.target.checked));
                      }}
                      className="mt-0.5 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-gray-900">{tx.merchant}</p>
                      <p className="break-words text-xs text-gray-500">
                        {transactionMetaLine(tx, { includeKind: context === "both" })}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-semibold text-gray-900">
                      {formatCurrency(tx.amount, "CAD")}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t border-gray-200 p-6">
            {saveError && <p className="text-sm text-red-600">{saveError}</p>}
            <div className="flex flex-wrap gap-3">
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
      </div>
    </>
  );
}
