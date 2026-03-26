"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { UserStatementSummary } from "@/lib/types";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function accountLabel(s: UserStatementSummary) {
  const bank = s.bankName ?? "Unknown Bank";
  const id   = s.accountId ? `••••${s.accountId.replace(/\D/g, "").slice(-4)}` : "";
  return [bank, id, s.accountName].filter(Boolean).join(" · ");
}

function accountTypeColor(t?: string) {
  switch (t) {
    case "checking": case "savings": return "bg-green-100 text-green-700";
    case "credit":   return "bg-orange-100 text-orange-700";
    case "mortgage": case "loan":   return "bg-red-100 text-red-700";
    case "investment": return "bg-blue-100 text-blue-700";
    default: return "bg-gray-100 text-gray-600";
  }
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function StatementsPage() {
  const router = useRouter();
  const [statements, setStatements]   = useState<UserStatementSummary[]>([]);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [deletingId, setDeletingId]   = useState<string | null>(null);
  const [confirmId, setConfirmId]     = useState<string | null>(null);
  const [token, setToken]             = useState<string | null>(null);

  const loadStatements = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const res  = await fetch("/api/user/statements", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load"); return; }
      setStatements(json.statements ?? []);
    } catch { setError("Failed to load statements"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      loadStatements(tok);
    });
  }, [router, loadStatements]);

  async function handleDelete(id: string) {
    if (!token) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/user/statements/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error ?? "Delete failed");
        return;
      }
      setStatements((prev) => prev.filter((s) => s.id !== id));
    } catch { alert("Delete failed. Please try again."); }
    finally { setDeletingId(null); setConfirmId(null); }
  }

  // ── group by account slug ────────────────────────────────────────────────
  const groups = new Map<string, UserStatementSummary[]>();
  for (const s of statements) {
    const key = `${s.bankName ?? ""}|${(s.accountId ?? "").replace(/\D/g, "").slice(-4)}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }
  // Sort each group newest-first
  for (const [, list] of groups) {
    list.sort((a, b) => new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime());
  }

  const totalCount = statements.length;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-gray-900">Uploaded data</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {totalCount} {totalCount === 1 ? "file" : "files"} · PDF statements and CSV imports
          </p>
        </div>
        <Link
          href="/upload"
          className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
        >
          + Add data
        </Link>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      {!loading && !error && groups.size === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
          <p className="text-sm font-medium text-gray-600">No statements uploaded yet</p>
          <p className="mt-1 text-xs text-gray-400">Upload a PDF statement or import a CSV to get started.</p>
          <Link href="/upload" className="mt-4 inline-block rounded-lg bg-purple-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition">
            Upload statement →
          </Link>
        </div>
      )}

      {!loading && groups.size > 0 && (
        <div className="space-y-6">
          {Array.from(groups.entries()).map(([key, list]) => {
            const first = list[0];
            return (
              <div key={key} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                {/* Account header */}
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-gray-100 bg-gray-50/60">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${accountTypeColor(first.accountType)}`}>
                      {first.accountType ?? "account"}
                    </span>
                    <span className="font-medium text-sm text-gray-800 truncate">{accountLabel(first)}</span>
                  </div>
                  <span className="shrink-0 text-xs text-gray-400">{list.length} upload{list.length !== 1 ? "s" : ""}</span>
                </div>

                {/* Statement rows */}
                <div className="divide-y divide-gray-100">
                  {list.map((s) => {
                    const isCSV    = s.source === "csv";
                    const monthStr = s.csvDateRange
                      ? `${fmtDate(s.csvDateRange.from)} – ${fmtDate(s.csvDateRange.to)}`
                      : s.statementDate
                        ? fmtMonth(s.statementDate.slice(0, 7))
                        : "Unknown period";
                    const isDeleting = deletingId === s.id;
                    const isConfirm  = confirmId === s.id;

                    return (
                      <div key={s.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                        <div className="flex items-center gap-3 min-w-0">
                          {/* Source badge */}
                          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold ${isCSV ? "bg-teal-100 text-teal-700" : "bg-purple-100 text-purple-700"}`}>
                            {isCSV ? "CSV" : "PDF"}
                          </span>

                          <div className="min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{monthStr}</p>
                            <p className="text-xs text-gray-400">
                              Uploaded {fmtDate(s.uploadedAt)}
                              {s.txCount ? ` · ${s.txCount} transactions` : ""}
                              {s.status === "processing" && <span className="ml-1.5 text-amber-500">· processing…</span>}
                              {s.status === "error" && <span className="ml-1.5 text-red-500">· parse error</span>}
                            </p>
                          </div>
                        </div>

                        {/* Delete action */}
                        <div className="shrink-0">
                          {isConfirm ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-gray-500">Remove?</span>
                              <button
                                onClick={() => handleDelete(s.id)}
                                disabled={isDeleting}
                                className="rounded px-2.5 py-1 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition"
                              >
                                {isDeleting ? "Removing…" : "Yes, remove"}
                              </button>
                              <button
                                onClick={() => setConfirmId(null)}
                                className="text-xs text-gray-400 hover:text-gray-600"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => setConfirmId(s.id)}
                              className="rounded p-1.5 text-gray-300 hover:text-red-400 hover:bg-red-50 transition"
                              title="Remove this upload"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
