"use client";

import { useEffect, useState } from "react";
import { fmt } from "@/lib/currencyUtils";

export interface RawTx {
  fingerprint: string;
  date: string;
  description: string;
  amount: number;
  category: string;
  accountLabel: string;
}

interface TagPickerProps {
  eventId: string;
  eventName: string;
  taggedFingerprints: Set<string>;
  headers: Record<string, string>;
  onTagged: (tx: RawTx) => void;
  onClose: () => void;
}

function txDate(iso: string) {
  return new Date(iso + "T00:00:00").toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });
}

export default function TagPicker({
  eventId,
  eventName,
  taggedFingerprints,
  headers,
  onTagged,
  onClose,
}: TagPickerProps) {
  const [txns, setTxns]     = useState<RawTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ]             = useState("");
  const [tagging, setTagging] = useState<string | null>(null);
  const [pendingNote, setPendingNote] = useState<{ tx: RawTx; note: string } | null>(null);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/user/spending/transactions?months=12`, { headers })
      .then((r) => r.json())
      .then((j) => setTxns(j.transactions ?? []))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = txns.filter((t) => {
    if (!q) return true;
    return t.description.toLowerCase().includes(q.toLowerCase());
  });

  async function handleTag(tx: RawTx, note?: string) {
    setTagging(tx.fingerprint);
    setPendingNote(null);
    try {
      const res = await fetch("/api/user/tx-tags", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint: tx.fingerprint,
          add: [eventId],
          ...(note ? { note } : {}),
        }),
      });
      if (res.ok) onTagged(tx);
    } finally {
      setTagging(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40">
      <div className="w-full max-w-lg rounded-t-2xl sm:rounded-2xl bg-white shadow-xl max-h-[85vh] flex flex-col">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4 shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Tag a transaction</h2>
            <p className="text-xs text-gray-400 mt-0.5">{eventName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
        </div>
        <div className="px-4 pt-3 pb-2 shrink-0">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search merchant…"
            autoFocus
            className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
          />
        </div>

        {pendingNote && (
          <div className="mx-4 mb-2 rounded-xl border border-purple-100 bg-purple-50 p-3 shrink-0">
            <p className="text-xs font-semibold text-purple-700 mb-2">
              Add a note for &quot;{pendingNote.tx.description}&quot;{" "}
              <span className="font-normal">(optional)</span>
            </p>
            <div className="flex gap-2">
              <input
                value={pendingNote.note}
                onChange={(e) => setPendingNote({ ...pendingNote, note: e.target.value })}
                placeholder="e.g. Flight to Paris, deposit…"
                className="flex-1 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
                onKeyDown={(e) => { if (e.key === "Enter") handleTag(pendingNote.tx, pendingNote.note); }}
                autoFocus
              />
              <button
                onClick={() => handleTag(pendingNote.tx, pendingNote.note)}
                disabled={tagging !== null}
                className="shrink-0 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-50"
              >
                {tagging ? "…" : "Confirm"}
              </button>
              <button
                onClick={() => handleTag(pendingNote.tx)}
                className="shrink-0 rounded-lg border border-purple-200 px-3 py-1.5 text-xs font-medium text-purple-600 hover:bg-purple-100"
              >
                Skip
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto divide-y divide-gray-50 px-2 pb-4">
          {loading ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading transactions…</div>
          ) : filtered.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">
              {q ? "No transactions match your search" : "No transactions in the last 12 months"}
            </div>
          ) : (
            filtered.map((tx) => {
              const alreadyTagged = taggedFingerprints.has(tx.fingerprint);
              return (
                <div key={tx.fingerprint} className={`flex items-center gap-3 px-2 py-3 ${alreadyTagged ? "opacity-50" : ""}`}>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{tx.description}</p>
                    <p className="text-xs text-gray-400">{txDate(tx.date)} · {tx.category} · {tx.accountLabel}</p>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="text-sm font-semibold text-gray-900">{fmt(tx.amount)}</span>
                    {alreadyTagged ? (
                      <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs font-medium text-gray-400">Tagged ✓</span>
                    ) : (
                      <button
                        onClick={() => setPendingNote({ tx, note: "" })}
                        disabled={tagging === tx.fingerprint || pendingNote?.tx.fingerprint === tx.fingerprint}
                        className="rounded-lg bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-50"
                      >
                        {tagging === tx.fingerprint ? "…" : "Tag"}
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
