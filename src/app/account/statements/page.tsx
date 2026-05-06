"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import ParseStatusBanner, { addPendingParse } from "@/components/ParseStatusBanner";
import type { UserStatementSummary } from "@/lib/types";

// ── bank lists ────────────────────────────────────────────────────────────────

const CA_BANKS = ["RBC", "TD", "Scotiabank", "BMO", "CIBC", "Tangerine", "Wealthsimple", "EQ Bank", "+ many more"];
const US_BANKS = ["Chase", "Wells Fargo", "Bank of America", "Citi", "Capital One", "Ally", "Discover", "US Bank", "+ many more"];

function supportedBanks(hc: string) {
  const c = hc.toUpperCase();
  if (c === "CAD") return CA_BANKS;
  if (c === "USD") return US_BANKS;
  return [...CA_BANKS.slice(0, 4), ...US_BANKS.slice(0, 4), "+ many more"];
}

// ── types ─────────────────────────────────────────────────────────────────────

interface QuotaInfo {
  isPro: boolean;
  onetimeUsed: number;
  onetimeLimit: number;
  onetimeRemaining: number;
  monthlyUsed: number;
  monthlyLimit: number;
  monthlyResetAt: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function fmtMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return fmtDate(iso);
}

function coverageMonths(statements: UserStatementSummary[]): number {
  const dates = statements
    .map((s) => s.statementDate)
    .filter(Boolean)
    .map((d) => d!.slice(0, 7))
    .sort();
  if (dates.length < 2) return dates.length;
  const [y1, m1] = dates[0].split("-").map(Number);
  const [y2, m2] = dates[dates.length - 1].split("-").map(Number);
  return (y2 - y1) * 12 + (m2 - m1) + 1;
}

function coverageDateRange(statements: UserStatementSummary[]): string {
  const dates = statements
    .map((s) => s.statementDate)
    .filter(Boolean)
    .map((d) => d!.slice(0, 7))
    .sort();
  if (dates.length === 0) return "";
  const oldest = new Date(parseInt(dates[0].split("-")[0]), parseInt(dates[0].split("-")[1]) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "numeric" });
  return `${oldest} — now`;
}

function resetLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// dot color for account type badge
function acctDotColor(t?: string) {
  switch (t) {
    case "checking": case "savings": return "bg-green-500";
    case "credit":   return "bg-orange-400";
    case "mortgage": case "loan": return "bg-red-400";
    case "investment": return "bg-blue-500";
    default: return "bg-gray-400";
  }
}

function statusDotClass(status: string) {
  if (status === "processing") return "bg-amber-400 animate-pulse";
  if (status === "error") return "bg-red-400";
  if (status === "needs_review") return "bg-orange-400";
  return "bg-green-500";
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function StatementsPage() {
  const router = useRouter();
  const [statements, setStatements] = useState<UserStatementSummary[]>([]);
  const [quota, setQuota] = useState<QuotaInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [reparsingId, setReparsingId] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [homeCurrency, setHomeCurrency] = useState("USD");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [pendingSetupCount, setPendingSetupCount] = useState(0);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStatements = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const res  = await fetch("/api/user/statements", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load"); return; }
      setStatements(json.statements ?? []);
      setQuota(json.quota ?? null);
      if (json.homeCurrency) setHomeCurrency(json.homeCurrency);
    } catch { setError("Failed to load statements"); }
    finally { setLoading(false); }
  }, []);

  // Check for pending account setups (used for hard-block)
  const checkPendingSetup = useCallback(async (tok: string) => {
    try {
      const res  = await fetch("/api/user/pending-setup", { headers: { Authorization: `Bearer ${tok}` } });
      const json = await res.json();
      setPendingSetupCount(json.pendingCount ?? 0);
      return (json.pendingCount ?? 0) as number;
    } catch { return 0; }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      await Promise.all([loadStatements(tok), checkPendingSetup(tok)]);
    });
  }, [router, loadStatements, checkPendingSetup]);

  // Called by ParseStatusBanner when all parses complete → check setup, then redirect
  const handleAllParsesComplete = useCallback(async () => {
    if (!token) return;
    const count = await checkPendingSetup(token);
    if (count > 0) {
      try {
        const raw = localStorage.getItem("nwai_setup_session");
        const ids: string[] = raw ? JSON.parse(raw) : [];
        const idParam = ids.length > 0 ? `?ids=${ids.join(",")}` : "";
        router.push(`/account/setup${idParam}`);
      } catch {
        router.push("/account/setup");
      }
    }
    // If no pending setup, just stay on statements page (already refreshed by onRefresh)
  }, [token, checkPendingSetup, router]);

  // ── upload handler ──────────────────────────────────────────────────────────

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!token || files.length === 0) return;
    // Hard block: must clear pending setups first
    if (pendingSetupCount > 0) return;
    setUploadError(null);
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res  = await fetch("/api/upload", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: formData });
        const data = await res.json();
        if (res.status === 409 && data.error === "duplicate") continue;
        if (!res.ok) { setUploadError(data.error || "Upload failed"); return; }
        const sid = data.statementId as string;
        addPendingParse(sid, file.name);
        fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statementId: sid }) }).catch(() => {});
      } catch { setUploadError("Upload failed. Please try again."); return; }
    }
    setTimeout(() => loadStatements(token), 1500);
  }, [token, loadStatements, pendingSetupCount]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      ["application/pdf","image/png","image/jpeg","image/jpg"].includes(f.type)
    );
    if (files.length) uploadFiles(files);
  }, [uploadFiles]);

  // ── delete / reparse ────────────────────────────────────────────────────────

  async function handleDelete(id: string) {
    if (!token) return;
    setDeletingId(id);
    try {
      const res = await fetch(`/api/user/statements/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Delete failed"); return; }
      setStatements((prev) => prev.filter((s) => s.id !== id));
    } catch { alert("Delete failed. Please try again."); }
    finally { setDeletingId(null); setConfirmId(null); }
  }

  async function handleReparse(id: string) {
    if (!token || reparsingId !== null) return;
    setReparsingId(id);
    try {
      const res = await fetch(`/api/user/statements/${id}/reparse`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) { alert("Could not retry. Please try again."); return; }
      setStatements((prev) => prev.map((s) => s.id === id ? { ...s, status: "processing" } : s));
      fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statementId: id }) })
        .then(() => { if (token) loadStatements(token); }).catch(() => {});
    } catch { alert("Retry failed. Please try again."); }
    finally { setReparsingId(null); }
  }

  // ── derived stats ───────────────────────────────────────────────────────────

  const totalCount     = statements.length;
  const covMonths      = coverageMonths(statements);
  const covRange       = coverageDateRange(statements);
  const latestUpload   = statements[0]?.uploadedAt ?? null;
  const latestAcct     = statements[0] ? [statements[0].bankName, statements[0].accountName].filter(Boolean).join(" ") : "";
  const uniqueAccounts = new Set(statements.map((s) => `${s.bankName}|${s.accountId}`)).size;

  // Quota display
  const showQuota = quota && !quota.isPro;
  const quotaUsed = quota ? (quota.onetimeRemaining > 0 ? quota.onetimeUsed : quota.monthlyUsed) : 0;
  const quotaLimit = quota ? (quota.onetimeRemaining > 0 ? quota.onetimeLimit : quota.monthlyLimit) : 0;
  const quotaLabel = (quota?.onetimeRemaining ?? 0) > 0
    ? `${quota!.onetimeUsed} of ${quota!.onetimeLimit} one-time uploads used`
    : `${quota?.monthlyUsed ?? 0} of ${quota?.monthlyLimit ?? 0} free uploads used this month`;
  const quotaSubLabel = (quota?.onetimeRemaining ?? 0) > 0
    ? `${quota!.onetimeRemaining} remaining · resets never`
    : `resets ${resetLabel(quota?.monthlyResetAt ?? "")}`;
  const quotaPct = quotaLimit > 0 ? Math.min(1, quotaUsed / quotaLimit) : 0;
  const quotaBarColor = quotaPct >= 1 ? "bg-red-500" : quotaPct >= 0.75 ? "bg-amber-500" : "bg-green-500";

  return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      <ParseStatusBanner
        onRefresh={() => token && loadStatements(token)}
        onAllComplete={handleAllParsesComplete}
      />

      {/* Hard-block banner — shown when accounts need setup before more uploads */}
      {pendingSetupCount > 0 && (
        <div className="mb-5 flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
          <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008z" />
          </svg>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-900">
              {pendingSetupCount} account{pendingSetupCount > 1 ? "s" : ""} need{pendingSetupCount === 1 ? "s" : ""} setup before you can upload more
            </p>
            <p className="mt-0.5 text-xs text-amber-700">
              You can&apos;t add more statements until you complete or skip the pending account setup.
            </p>
          </div>
          <a href="/account/setup"
            className="shrink-0 rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-700 transition whitespace-nowrap">
            Set up accounts →
          </a>
        </div>
      )}

      {/* Header */}
      <div className="mb-5 flex items-center justify-between">
        <div>
          <h1 className="font-bold text-2xl text-gray-900">Statements</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            Manage your uploaded statements and add new ones as they arrive from your banks.
          </p>
        </div>
        <label className={`rounded-lg px-4 py-2 text-sm font-semibold text-white transition ${
          pendingSetupCount > 0
            ? "bg-gray-300 cursor-not-allowed opacity-60"
            : "bg-purple-600 cursor-pointer hover:bg-purple-700"
        }`}>
          + Add statements
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,image/png,image/jpeg"
            multiple
            className="sr-only"
            disabled={pendingSetupCount > 0}
            onChange={(e) => {
              if (pendingSetupCount > 0) return;
              const files = Array.from(e.target.files ?? []);
              if (files.length) uploadFiles(files);
              e.target.value = "";
            }}
          />
        </label>
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
        </div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <>
          {/* Inline dropzone — disabled when pending setup */}
          <div
            ref={dropRef}
            onDragOver={(e) => { if (pendingSetupCount > 0) return; e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { if (pendingSetupCount > 0) { e.preventDefault(); return; } handleDrop(e); }}
            onClick={() => { if (pendingSetupCount === 0) fileInputRef.current?.click(); }}
            className={`mb-5 flex items-center gap-4 rounded-xl border-2 border-dashed px-5 py-4 transition ${
              pendingSetupCount > 0
                ? "border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed"
                : isDragging ? "cursor-pointer border-purple-400 bg-purple-50" : "cursor-pointer border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
            }`}
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-gray-200 bg-white shadow-sm">
              <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800">Drop new statements here</p>
              <p className="text-xs text-gray-400">Or click to browse — one file or up to 20 at a time</p>
            </div>
            <p className="shrink-0 text-xs font-medium text-gray-400 tabular-nums">~60S EACH</p>
          </div>
          {uploadError && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{uploadError}</p>}

          {/* Supported banks strip — currency-aware */}
          {totalCount === 0 && (
            <div className="mb-5 flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-4 py-2.5 shadow-sm">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-gray-400">Supported</span>
              <div className="flex flex-wrap gap-x-3 gap-y-1">
                {supportedBanks(homeCurrency).map((bank) => (
                  <span key={bank} className="text-xs font-medium text-gray-600">{bank}</span>
                ))}
              </div>
            </div>
          )}

          {/* Stats bar */}
          {totalCount > 0 && (
            <div className="mb-5 grid grid-cols-4 divide-x divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {[
                {
                  label: "STATEMENTS",
                  value: String(totalCount),
                  sub: `across ${uniqueAccounts} account${uniqueAccounts !== 1 ? "s" : ""}`,
                  warn: false,
                },
                {
                  label: "COVERAGE",
                  value: covMonths > 0 ? `${covMonths}mo` : "—",
                  sub: covRange || "upload to track",
                  warn: false,
                },
                {
                  label: "LATEST",
                  value: latestUpload ? timeAgo(latestUpload) : "—",
                  sub: latestAcct || "—",
                  warn: false,
                },
                {
                  label: "THIS MONTH",
                  value: quota?.isPro ? "∞" : `${quota?.monthlyUsed ?? 0}/${quota?.monthlyLimit ?? 0}`,
                  sub: quota?.isPro ? "Pro plan" : "Free tier limit",
                  warn: !quota?.isPro && (quota?.onetimeRemaining ?? 1) === 0 && (quota?.monthlyUsed ?? 0) >= (quota?.monthlyLimit ?? 1),
                },
              ].map((stat) => (
                <div key={stat.label} className="px-4 py-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{stat.label}</p>
                  <p className={`mt-0.5 text-xl font-bold tabular-nums leading-tight ${stat.warn ? "text-red-600" : "text-gray-900"}`}>{stat.value}</p>
                  <p className={`mt-0.5 text-[11px] leading-tight ${stat.warn ? "text-red-400" : "text-gray-400"}`}>{stat.sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {totalCount === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
              <p className="text-sm font-medium text-gray-600">No statements uploaded yet</p>
              <p className="mt-1 text-xs text-gray-400">Drop files into the zone above or click "+ Add statements" to get started.</p>
            </div>
          )}

          {/* Recent uploads list */}
          {totalCount > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-700">Recent uploads</p>
                <p className="text-xs text-gray-400 tabular-nums">{totalCount} TOTAL</p>
              </div>
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
                {statements.map((s) => {
                  const isCSV     = s.source === "csv";
                  const monthStr  = s.csvDateRange
                    ? `${fmtDate(s.csvDateRange.from)} – ${fmtDate(s.csvDateRange.to)}`
                    : s.statementDate ? fmtMonth(s.statementDate.slice(0, 7)) : "Unknown period";
                  const isDeleting  = deletingId === s.id;
                  const isConfirm   = confirmId === s.id;
                  const isReparsing = reparsingId === s.id;

                  const acctLabel = [s.bankName, s.accountName].filter(Boolean).join(" ");
                  const subtitle = s.status === "processing"
                    ? `Parsing transactions… started ${timeAgo(s.uploadedAt)}`
                    : s.status === "error"
                    ? "Parse error — click retry"
                    : s.status === "needs_review"
                    ? "Couldn't detect details — click to complete"
                    : [s.txCount ? `${s.txCount} transactions` : null, s.uploadedAt ? `uploaded ${timeAgo(s.uploadedAt)}` : null].filter(Boolean).join(" · ");

                  return (
                    <div
                      key={s.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button, a")) return;
                        router.push(`/account/statements/${s.id}`);
                      }}
                      className="flex items-center gap-3 px-4 py-3 group cursor-pointer hover:bg-gray-50/80 transition"
                    >
                      {/* Status dot */}
                      <span className={`shrink-0 h-2 w-2 rounded-full ${statusDotClass(s.status ?? "")}`} />

                      {/* Main info */}
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-mono text-gray-800">{s.fileName || monthStr}</p>
                        <p className={`text-xs mt-0.5 ${s.status === "processing" ? "text-amber-500" : s.status === "error" ? "text-red-500" : s.status === "needs_review" ? "text-orange-500" : "text-gray-400"}`}>
                          {subtitle}
                        </p>
                      </div>

                      {/* Period + dot badge */}
                      <div className="shrink-0 hidden sm:flex items-center gap-3">
                        <span className="text-xs tabular-nums text-gray-500 whitespace-nowrap">{monthStr}</span>
                        {acctLabel && (
                          <span className="inline-flex items-center gap-1.5 rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] font-medium text-gray-700">
                            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${acctDotColor(s.accountType)}`} />
                            {acctLabel}
                          </span>
                        )}
                      </div>

                      {/* Actions — visible on hover + always for confirm/error/needs_review */}
                      <div className={`shrink-0 flex items-center gap-1 ${isConfirm || s.status === "needs_review" ? "" : "opacity-0 group-hover:opacity-100 transition-opacity"}`}>
                        {s.status === "error" && (
                          <button
                            onClick={() => handleReparse(s.id)}
                            disabled={reparsingId !== null}
                            className="rounded px-2 py-0.5 text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 hover:bg-amber-100 disabled:opacity-50 transition"
                          >
                            {isReparsing ? "…" : "↺ Retry"}
                          </button>
                        )}
                        {isConfirm ? (
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs text-gray-500">Remove?</span>
                            <button onClick={() => handleDelete(s.id)} disabled={isDeleting}
                              className="rounded px-2 py-0.5 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition">
                              {isDeleting ? "…" : "Yes"}
                            </button>
                            <button onClick={() => setConfirmId(null)} className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
                          </div>
                        ) : (
                          <button onClick={() => setConfirmId(s.id)}
                            className="rounded p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 transition" title="Remove">
                            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        )}
                      </div>

                      {/* Chevron */}
                      <Link href={`/account/statements/${s.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0 rounded p-1 text-gray-300 hover:text-gray-500 transition">
                        <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                        </svg>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

        </>
      )}

      {/* Quota footer — always visible for free users once loaded */}
      {showQuota && (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-700">{quotaLabel}</p>
            <p className="text-xs text-gray-400">{quotaSubLabel}</p>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${quotaBarColor}`} style={{ width: `${Math.max(quotaPct * 100, quotaUsed > 0 ? 2 : 0)}%` }} />
          </div>
          {quota.onetimeRemaining === 0 && quota.monthlyUsed >= quota.monthlyLimit && (
            <p className="mt-2.5 text-xs text-gray-500">
              You&apos;ve used all your free uploads.{" "}
              <Link href="/account/billing" className="font-medium text-purple-600 hover:underline">Upgrade to Pro for unlimited →</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
