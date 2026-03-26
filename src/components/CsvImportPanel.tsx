"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";

// ── types ─────────────────────────────────────────────────────────────────────

interface KnownAccount {
  slug: string;
  bankName: string;
  accountId: string;
  accountType: string;
  lastMonth: string;
}

interface SampleTx {
  date: string;
  description: string;
  amount: number;
  isExpense: boolean;
}

interface Preview {
  totalRows: number;
  gapFilteredRows: number;
  skippedByGapFilter: number;
  expenseCount: number;
  incomeCount: number;
  dateRange: { from: string; to: string } | null;
  gapDateRange: { from: string; to: string } | null;
  monthsAffected: string[];
  gapCutoff: string | null;
  knownAccounts: KnownAccount[];
  detectedFormat: string;
  parseErrors: string[];
  sampleTransactions: SampleTx[];
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(v);
}

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtShortMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

// ── component ─────────────────────────────────────────────────────────────────

export default function CsvImportPanel({ idToken, initialFile, onReset, onImportComplete, preselectedAccountSlug }: {
  idToken: string;
  initialFile?: File;
  onReset?: () => void;
  /** Called after a successful import so the parent page can refresh its data. */
  onImportComplete?: () => void;
  /** When provided, skips the account selection step — used when launched from a specific account. */
  preselectedAccountSlug?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile]                   = useState<File | null>(initialFile ?? null);
  const [preview, setPreview]             = useState<Preview | null>(null);
  const [selectedAccount, setSelectedAccount] = useState<string>(preselectedAccountSlug ?? "");
  const [previewing, setPreviewing]       = useState(false);
  const [importing, setImporting]         = useState(false);
  const [importResult, setImportResult]   = useState<{
    imported: number;
    skippedByGapFilter: number;
    skippedByDuplicate: number;
    months: number;
  } | null>(null);
  const [error, setError]                 = useState<string | null>(null);

  // Auto-trigger preview when a file is handed in from the parent drop zone
  useEffect(() => {
    if (initialFile) fetchPreview(initialFile, preselectedAccountSlug);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchPreview(f: File, slug?: string) {
    setPreviewing(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", f);
      fd.append("action", "preview");
      if (slug) fd.append("accountSlug", slug);

      const res  = await fetch("/api/user/csv-import", { method: "POST", headers: { Authorization: `Bearer ${idToken}` }, body: fd });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Preview failed"); return; }
      setPreview(json.preview as Preview);
      // Auto-select if only one account
      if (!slug && (json.preview as Preview).knownAccounts.length === 1) {
        setSelectedAccount((json.preview as Preview).knownAccounts[0].slug);
      }
    } catch { setError("Failed to preview CSV"); }
    finally { setPreviewing(false); }
  }

  function handleFileDrop(f: File) {
    setFile(f);
    setPreview(null);
    setImportResult(null);
    setError(null);
    setSelectedAccount(preselectedAccountSlug ?? "");
    fetchPreview(f, preselectedAccountSlug);
  }

  async function handleImport() {
    const slug = preselectedAccountSlug ?? selectedAccount;
    if (!file || !slug) return;
    setImporting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("action", "import");
      fd.append("accountSlug", slug);

      const res  = await fetch("/api/user/csv-import", { method: "POST", headers: { Authorization: `Bearer ${idToken}` }, body: fd });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Import failed"); return; }
      setImportResult({
        imported: json.imported,
        skippedByGapFilter: json.skippedByGapFilter ?? 0,
        skippedByDuplicate: json.skippedByDuplicate ?? 0,
        months: json.monthsCreated,
      });
      setPreview(null);
      onImportComplete?.();
    } catch { setError("Import failed. Please try again."); }
    finally { setImporting(false); }
  }

  // Re-fetch preview when account selection changes
  function handleAccountChange(slug: string) {
    setSelectedAccount(slug);
    if (file) fetchPreview(file, slug);
  }

  // ── render ────────────────────────────────────────────────────────────────

  if (importResult) {
    const totalSkipped = importResult.skippedByGapFilter + importResult.skippedByDuplicate;
    return (
      <div className="rounded-xl border border-green-200 bg-white shadow-sm overflow-hidden">
        {/* Header */}
        <div className="flex items-center gap-3 bg-green-50 px-5 py-4 border-b border-green-100">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-green-100">
            <svg className="h-5 w-5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="font-semibold text-gray-900">Import complete</p>
            {importResult.months > 0 && (
              <p className="text-xs text-gray-500">{importResult.months} month{importResult.months !== 1 ? "s" : ""} updated</p>
            )}
          </div>
        </div>

        {/* Breakdown */}
        <div className="divide-y divide-gray-100">
          <div className="flex items-center justify-between px-5 py-3">
            <div className="flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-green-500" />
              <span className="text-sm text-gray-700">Added</span>
            </div>
            <span className="font-semibold text-sm text-green-700">{importResult.imported} transactions</span>
          </div>

          {importResult.skippedByGapFilter > 0 && (
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-gray-300" />
                <span className="text-sm text-gray-500">Already covered by statements</span>
              </div>
              <span className="text-sm text-gray-400">{importResult.skippedByGapFilter} skipped</span>
            </div>
          )}

          {importResult.skippedByDuplicate > 0 && (
            <div className="flex items-center justify-between px-5 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-amber-300" />
                <span className="text-sm text-gray-500">Exact duplicates</span>
              </div>
              <span className="text-sm text-gray-400">{importResult.skippedByDuplicate} skipped</span>
            </div>
          )}

          {totalSkipped === 0 && importResult.imported > 0 && (
            <div className="px-5 py-3">
              <p className="text-xs text-gray-400">No duplicates detected — all rows were new.</p>
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex flex-wrap gap-3 px-5 py-4 border-t border-gray-100 bg-gray-50/50">
          <Link href="/account/dashboard"
            className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition">
            View dashboard →
          </Link>
          <button
            onClick={() => { setFile(null); setImportResult(null); setPreview(null); setError(null); setSelectedAccount(""); onReset?.(); }}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-100 transition"
          >
            Import another
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Info callout — only shown when not launched from an account context */}
      {!preselectedAccountSlug && (
        <div className="rounded-xl bg-teal-50 border border-teal-100 px-4 py-3.5">
          <p className="text-sm font-semibold text-teal-900">Fill the current-month gap</p>
          <p className="mt-0.5 text-xs text-teal-700 leading-relaxed">
            Statements come out at month-end. Download your bank&apos;s CSV transaction export anytime during the month
            and import it here — we&apos;ll automatically skip anything already covered by your statements.
          </p>
        </div>
      )}

      {/* Drop zone */}
      {!file && !previewing && (
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) handleFileDrop(f); }}
          className="cursor-pointer rounded-xl border-2 border-dashed border-gray-200 bg-white p-10 text-center hover:border-teal-400 hover:bg-teal-50/30 transition"
        >
          <svg className="mx-auto h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="mt-3 text-sm font-medium text-gray-700">Drop your CSV file here</p>
          <p className="mt-1 text-xs text-gray-400">or click to browse · TD, RBC, Scotia, BMO, Chase, and more</p>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFileDrop(f); }} />
        </div>
      )}

      {/* Parsing spinner */}
      {previewing && (
        <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white p-5">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-teal-500 border-t-transparent" />
          <p className="text-sm text-gray-600">Parsing <span className="font-medium">{file?.name}</span>…</p>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          {error}
          <button onClick={() => { setFile(null); setError(null); }} className="ml-3 underline text-red-600 hover:text-red-800">Try again</button>
        </div>
      )}

      {/* Preview */}
      {preview && !previewing && (
        <div className="space-y-4">

          {/* Parse errors */}
          {preview.parseErrors.length > 0 && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-700">
              {preview.parseErrors.join(" · ")}
            </div>
          )}

          {/* File summary */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">CSV file detected</p>
              <button onClick={() => { setFile(null); setPreview(null); setError(null); setSelectedAccount(""); onReset?.(); }}
                className="text-xs text-gray-400 hover:text-gray-600">✕ Change file</button>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">File</p>
                <p className="mt-0.5 text-sm font-medium text-gray-800 truncate max-w-[120px]">{file?.name}</p>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Total rows</p>
                <p className="mt-0.5 text-sm font-medium text-gray-800">{preview.totalRows}</p>
              </div>
              {preview.dateRange && (
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Date range</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-800">{fmtDate(preview.dateRange.from)} – {fmtDate(preview.dateRange.to)}</p>
                </div>
              )}
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Format</p>
                <p className="mt-0.5 text-sm font-medium text-gray-800 capitalize">{preview.detectedFormat}</p>
              </div>
            </div>
          </div>

          {/* Account selection — hidden when account is already known from context */}
          {!preselectedAccountSlug && (
            preview.knownAccounts.length > 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Which account is this?</p>
                <div className="space-y-2">
                  {preview.knownAccounts.map((acc) => (
                    <label key={acc.slug} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-3 transition ${selectedAccount === acc.slug ? "border-teal-400 bg-teal-50" : "border-gray-200 hover:border-gray-300"}`}>
                      <input type="radio" name="account" value={acc.slug} checked={selectedAccount === acc.slug}
                        onChange={() => handleAccountChange(acc.slug)} className="accent-teal-600" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800">{acc.bankName} ••••{acc.accountId.replace(/\D/g, "").slice(-4)}</p>
                        <p className="text-xs text-gray-400">{acc.accountType} · last statement {fmtShortMonth(acc.lastMonth)}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            ) : (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                No existing accounts found. Upload a PDF statement first so we know which account this CSV belongs to.
              </div>
            )
          )}

          {/* Gap filter result */}
          {selectedAccount && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">What will be imported</p>

              {preview.gapFilteredRows === 0 ? (
                <div className="text-center py-4">
                  <p className="text-sm font-medium text-gray-600">Nothing new to import</p>
                  <p className="mt-1 text-xs text-gray-400">
                    All {preview.totalRows} rows are already covered by your statements
                    {preview.gapCutoff && <> (through {fmtDate(preview.gapCutoff)})</>}.
                  </p>
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className="rounded-lg bg-gray-50 p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{preview.gapFilteredRows}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">new transactions</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 text-center">
                      <p className="text-2xl font-bold text-gray-500">{preview.skippedByGapFilter}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">already covered</p>
                    </div>
                    <div className="rounded-lg bg-gray-50 p-3 text-center">
                      <p className="text-2xl font-bold text-gray-900">{preview.monthsAffected.length}</p>
                      <p className="text-[10px] text-gray-400 mt-0.5">{preview.monthsAffected.length === 1 ? "month" : "months"}</p>
                    </div>
                  </div>

                  {preview.gapDateRange && (
                    <p className="text-xs text-gray-500 mb-3">
                      Importing <span className="font-medium text-gray-700">{fmtDate(preview.gapDateRange.from)}</span>
                      {" → "}
                      <span className="font-medium text-gray-700">{fmtDate(preview.gapDateRange.to)}</span>
                      {preview.gapCutoff && <> (gap after {fmtDate(preview.gapCutoff)})</>}
                    </p>
                  )}

                  <div className="text-xs text-gray-400 mb-1 flex justify-between">
                    <span>Sample transactions</span>
                    <span>{preview.expenseCount} expenses · {preview.incomeCount} deposits</span>
                  </div>
                  <div className="divide-y divide-gray-100 rounded-lg border border-gray-100">
                    {preview.sampleTransactions.map((tx, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2">
                        <div>
                          <p className="text-xs font-medium text-gray-800 truncate max-w-[200px]">{tx.description}</p>
                          <p className="text-[10px] text-gray-400">{fmtDate(tx.date)}</p>
                        </div>
                        <span className={`text-xs font-semibold tabular-nums ${tx.isExpense ? "text-gray-700" : "text-green-600"}`}>
                          {tx.isExpense ? "-" : "+"}{fmt(tx.amount)}
                        </span>
                      </div>
                    ))}
                    {preview.gapFilteredRows > preview.sampleTransactions.length && (
                      <p className="px-3 py-2 text-[10px] text-gray-400">
                        + {preview.gapFilteredRows - preview.sampleTransactions.length} more…
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Import button */}
          {selectedAccount && preview.gapFilteredRows > 0 && (
            <button
              onClick={handleImport}
              disabled={importing}
              className="w-full rounded-lg bg-teal-600 py-3 text-sm font-semibold text-white hover:bg-teal-700 disabled:opacity-60 transition"
            >
              {importing ? "Importing…" : `Import ${preview.gapFilteredRows} transactions`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
