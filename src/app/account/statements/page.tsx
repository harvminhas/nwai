"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { useActiveProfile } from "@/contexts/ActiveProfileContext";
import ParseStatusBanner, { addPendingParse } from "@/components/ParseStatusBanner";
import type { UserStatementSummary } from "@/lib/types";
import { computeStatementCoverage } from "@/lib/statementCoverage";
import type { StatementCoverageGrid } from "@/lib/statementCoverage";

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

function resetLabel(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function statusDotClass(status: string, needsAccountSetup?: boolean) {
  if (needsAccountSetup) return "bg-amber-400";
  if (status === "processing") return "bg-amber-400 animate-pulse";
  if (status === "error") return "bg-red-400";
  if (status === "needs_review") return "bg-orange-400";
  return "bg-green-500";
}

function acctDotColor(t?: string) {
  switch (t) {
    case "checking": case "savings": return "bg-green-500";
    case "credit":   return "bg-orange-400";
    case "mortgage": case "loan": return "bg-red-400";
    case "investment": return "bg-blue-500";
    default: return "bg-gray-400";
  }
}

function bankInitials(name: string): string {
  const words = name.split(/\s+/).filter(w => w.length > 0);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 2).map(w => w[0].toUpperCase()).join("");
}

function bankColor(name: string): string {
  // Simple hash to color
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const colors = [
    "bg-purple-600",
    "bg-blue-600",
    "bg-green-600",
    "bg-red-600",
    "bg-indigo-600",
    "bg-pink-600",
    "bg-teal-600",
  ];
  return colors[Math.abs(hash) % colors.length];
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function StatementsPage() {
  const router = useRouter();
  const { buildHeaders, isOwn } = useActiveProfile();
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
  const [auditLog, setAuditLog] = useState<Array<{ id: string; timestamp: string; title: string; subtitle: string | null; actorEmail: string | null }>>([]);
  const [activeTab, setActiveTab] = useState<"coverage" | "uploads">("coverage");
  const [showOnlyGaps, setShowOnlyGaps] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadStatements = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const res  = await fetch("/api/user/statements", { headers: buildHeaders(tok) });
      const json = await res.json();
      if (!res.ok) { setError(json.error ?? "Failed to load"); return; }
      setStatements(json.statements ?? []);
      setQuota(json.quota ?? null);
      if (json.homeCurrency) setHomeCurrency(json.homeCurrency);
    } catch { setError("Failed to load statements"); }
    finally { setLoading(false); }
  }, [buildHeaders]);

  // Check for pending account setups (used for hard-block)
  const checkPendingSetup = useCallback(async (tok: string) => {
    try {
      const res  = await fetch("/api/user/pending-setup", { headers: buildHeaders(tok) });
      const json = await res.json();
      setPendingSetupCount(json.pendingCount ?? 0);
      return (json.pendingCount ?? 0) as number;
    } catch { return 0; }
  }, [buildHeaders]);

  const loadAuditLog = useCallback(async (tok: string) => {
    try {
      const res  = await fetch("/api/user/activity", { headers: buildHeaders(tok) });
      const json = await res.json();
      if (!res.ok) return;
      type ActivityEvent = { id: string; type: string; timestamp: string; title: string; subtitle: string | null; meta: Record<string, unknown> };
      const all: ActivityEvent[] = json.events ?? [];
      const deletions = all
        .filter((e) => e.type === "statement_delete")
        .map((e) => ({
          id: e.id,
          timestamp: e.timestamp,
          title: e.title,
          subtitle: e.subtitle,
          actorEmail: (e.meta.actorEmail as string | null) ?? null,
        }));
      setAuditLog(deletions);
    } catch { /* non-fatal */ }
  }, [buildHeaders]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      await Promise.all([loadStatements(tok), checkPendingSetup(tok), loadAuditLog(tok)]);
    });
  }, [router, loadStatements, checkPendingSetup, loadAuditLog]);

  // Reload when the user switches between their own profile and a shared partner's
  useEffect(() => {
    if (!token) return;
    Promise.all([loadStatements(token), checkPendingSetup(token), loadAuditLog(token)]);
  }, [isOwn]); // eslint-disable-line react-hooks/exhaustive-deps

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
  }, [token, checkPendingSetup, router]);

  // ── upload handler ──────────────────────────────────────────────────────────

  const uploadFiles = useCallback(async (files: File[]) => {
    if (!token || files.length === 0) return;
    if (pendingSetupCount > 0) return;
    setUploadError(null);
    for (const file of files) {
      const formData = new FormData();
      formData.append("file", file);
      try {
        const res  = await fetch("/api/upload", { method: "POST", headers: buildHeaders(token), body: formData });
        const data = await res.json();
        if (res.status === 409 && data.error === "duplicate") continue;
        if (!res.ok) { setUploadError(data.error || "Upload failed"); return; }
        const sid = data.statementId as string;
        addPendingParse(sid, file.name);
        fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statementId: sid }) }).catch(() => {});
      } catch { setUploadError("Upload failed. Please try again."); return; }
    }
    setTimeout(() => loadStatements(token), 1500);
  }, [token, loadStatements, pendingSetupCount, buildHeaders]);

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
      const res = await fetch(`/api/user/statements/${id}`, { method: "DELETE", headers: buildHeaders(token) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); alert(j.error ?? "Delete failed"); return; }
      setStatements((prev) => prev.filter((s) => s.id !== id));
      loadAuditLog(token);
    } catch { alert("Delete failed. Please try again."); }
    finally { setDeletingId(null); setConfirmId(null); }
  }

  async function handleReparse(id: string) {
    if (!token || reparsingId !== null) return;
    setReparsingId(id);
    try {
      const res = await fetch(`/api/user/statements/${id}/reparse`, { method: "POST", headers: buildHeaders(token) });
      if (!res.ok) { alert("Could not retry. Please try again."); return; }
      setStatements((prev) => prev.map((s) => s.id === id ? { ...s, status: "processing" } : s));
      fetch("/api/parse", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ statementId: id }) })
        .then(() => { if (token) loadStatements(token); }).catch(() => {});
    } catch { alert("Retry failed. Please try again."); }
    finally { setReparsingId(null); }
  }

  // ── derived stats ───────────────────────────────────────────────────────────

  const totalCount = statements.length;
  const uniqueAccounts = new Set(statements.filter(s => s.bankName && s.accountId).map((s) => `${s.bankName}|${s.accountId}`)).size;
  
  // Compute coverage grid
  const coverageData: StatementCoverageGrid | null = totalCount > 0 ? computeStatementCoverage(statements) : null;

  // Quota display
  const showQuota = quota && !quota.isPro;
  const quotaUsed = quota ? (quota.onetimeRemaining > 0 ? quota.onetimeUsed : quota.monthlyUsed) : 0;
  const quotaLimit = quota ? (quota.onetimeRemaining > 0 ? quota.onetimeLimit : quota.monthlyLimit) : 0;
  const quotaLabel = (quota?.onetimeRemaining ?? 0) > 0
    ? `${quota!.onetimeRemaining} of ${quota!.onetimeLimit} starter uploads left`
    : `${quota?.monthlyUsed ?? 0} of ${quota?.monthlyLimit ?? 0} uploads used this month`;
  const quotaSubLabel = (quota?.onetimeRemaining ?? 0) > 0
    ? `One-time pool (resets never)`
    : `Resets ${resetLabel(quota?.monthlyResetAt ?? "")}`;
  const quotaPct = quotaLimit > 0 ? Math.min(1, quotaUsed / quotaLimit) : 0;
  const quotaBarColor = quotaPct >= 1 ? "bg-red-500" : quotaPct >= 0.75 ? "bg-amber-500" : "bg-green-500";

  // Filter coverage data for gaps-only view
  const displayGroups = coverageData && showOnlyGaps
    ? coverageData.groups.map(g => ({
        ...g,
        accounts: g.accounts.filter(a => a.missingCount > 0)
      })).filter(g => g.accounts.length > 0)
    : coverageData?.groups ?? [];

  return (
    <div className="mx-auto max-w-2xl lg:max-w-7xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      <ParseStatusBanner
        onRefresh={() => token && loadStatements(token)}
        onAllComplete={handleAllParsesComplete}
      />

      {/* Hard-block banner */}
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
      <div className="mb-3 flex items-center justify-between gap-4">
        <h1 className="font-bold text-2xl sm:text-3xl text-gray-900">Statements</h1>
        <label className={`rounded-full px-4 py-2 text-sm font-semibold text-white transition shadow-md ${
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

      {/* Summary line */}
      {!loading && !error && totalCount > 0 && coverageData && (
        <p className="mb-4 text-sm text-gray-500">
          <span className="font-semibold text-gray-900">{totalCount}</span> statements · <span className="font-semibold text-gray-900">{uniqueAccounts}</span> accounts{coverageData.totalMissing > 0 && (
            <> · <span className="font-semibold text-red-600">{coverageData.totalMissing} missing month{coverageData.totalMissing !== 1 ? "s" : ""}</span> across {coverageData.accountsWithGaps} account{coverageData.accountsWithGaps !== 1 ? "s" : ""}</>
          )}
        </p>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
        </div>
      )}
      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      {!loading && !error && (
        <>
          {/* Inline dropzone */}
          <div
            ref={dropRef}
            onDragOver={(e) => { if (pendingSetupCount > 0) return; e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => { if (pendingSetupCount > 0) { e.preventDefault(); return; } handleDrop(e); }}
            onClick={() => { if (pendingSetupCount === 0) fileInputRef.current?.click(); }}
            className={`mb-4 flex items-center gap-3 sm:gap-4 rounded-xl border-2 border-dashed px-4 py-3 sm:px-5 sm:py-4 transition ${
              pendingSetupCount > 0
                ? "border-gray-200 bg-gray-50 opacity-50 cursor-not-allowed"
                : isDragging ? "cursor-pointer border-purple-400 bg-purple-50" : "cursor-pointer border-purple-200 bg-gradient-to-r from-purple-50 to-white hover:border-purple-300"
            }`}
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-purple-100 bg-white">
              <svg className="h-4 w-4 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
              </svg>
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-gray-800">Drop PDF statements here <span className="font-normal text-gray-500">or <span className="text-purple-700 underline decoration-dotted">browse</span></span></p>
              <p className="hidden sm:block text-xs text-gray-400 mt-0.5">TD, RBC, CIBC, BMO, Scotiabank, Amex & more · we match each file to its account and month</p>
            </div>
          </div>
          {uploadError && <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm text-red-700">{uploadError}</p>}

          {/* Tabs + toggle */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <div className="flex gap-2">
              <button
                onClick={() => setActiveTab("coverage")}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition border ${
                  activeTab === "coverage"
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                }`}
              >
                Coverage
              </button>
              <button
                onClick={() => setActiveTab("uploads")}
                className={`rounded-full px-4 py-2 text-sm font-semibold transition border ${
                  activeTab === "uploads"
                    ? "bg-gray-900 text-white border-gray-900"
                    : "bg-white text-gray-500 border-gray-200 hover:border-gray-300"
                }`}
              >
                All uploads <span className="text-xs opacity-70 ml-1">{totalCount}</span>
              </button>
            </div>
            {activeTab === "coverage" && coverageData && coverageData.accountsWithGaps > 0 && (
              <label className="ml-auto flex items-center gap-2 text-sm text-gray-700 cursor-pointer select-none">
                <input
                  type="checkbox"
                  className="sr-only"
                  checked={showOnlyGaps}
                  onChange={(e) => setShowOnlyGaps(e.target.checked)}
                />
                <span className={`relative w-9 h-5 rounded-full transition ${showOnlyGaps ? "bg-purple-600" : "bg-gray-200"}`}>
                  <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition ${showOnlyGaps ? "translate-x-4" : ""}`} />
                </span>
                <span className="hidden sm:inline">Show only accounts with gaps</span>
                <span className="sm:hidden">Only gaps</span>
              </label>
            )}
          </div>

          {/* Coverage tab */}
          {activeTab === "coverage" && (
            <>
              {totalCount === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
                  <p className="text-sm font-medium text-gray-600">No statements uploaded yet</p>
                  <p className="mt-1 text-xs text-gray-400">Drop files into the zone above or click "+ Add statements" to get started.</p>
                </div>
              ) : coverageData ? (
                <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  {/* Legend */}
                  <div className="flex flex-wrap gap-x-4 gap-y-2 px-4 sm:px-5 py-3 border-b border-gray-100 text-xs text-gray-500">
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-green-600" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                      </svg>
                      Uploaded
                    </span>
                    <span className="flex items-center gap-2">
                      <svg className="w-5 h-5 text-red-600" viewBox="0 0 20 20" fill="currentColor">
                        <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
                      </svg>
                      Missing — click to upload
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 border-2 border-dashed border-gray-300 rounded bg-gradient-to-br from-gray-50 to-gray-100" />
                      Not yet due (current month)
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="w-5 h-5 flex items-center justify-center">
                        <span className="w-3 h-0.5 bg-gray-300 rounded" />
                      </span>
                      Account not open / closed
                    </span>
                  </div>

                  {/* Desktop grid */}
                  <div className="hidden lg:block overflow-x-auto">
                    <div className="min-w-max">
                      {/* Header */}
                      <div className="grid grid-cols-[minmax(220px,1fr)_repeat(13,46px)_96px] gap-1 items-center px-2 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400">
                        <div className="px-3">Account</div>
                        {coverageData.months.map((m, i) => {
                          const isYearStart = i === 0 || m.shortLabel === "Jan";
                          return (
                            <div key={m.yearMonth} className="text-center leading-tight">
                              <div>{m.shortLabel}</div>
                              {isYearStart && <div className="text-[10px] text-gray-400 h-3">&apos;{m.yearMonth.slice(2, 4)}</div>}
                            </div>
                          );
                        })}
                        <div className="text-right px-3">Gaps</div>
                      </div>

                      {/* Rows */}
                      {displayGroups.map((group) => (
                        <div key={group.bankName}>
                          {/* Institution header */}
                          <div className="grid grid-cols-[minmax(220px,1fr)_repeat(13,46px)_96px] gap-1 items-center px-2 py-2 border-t border-gray-100">
                            <div className="flex items-center gap-2 px-3 text-xs font-bold uppercase tracking-wide text-gray-700">
                              <span className={`flex h-6 w-6 items-center justify-center rounded-lg text-white text-[9px] font-bold ${bankColor(group.bankName)}`}>
                                {bankInitials(group.bankName)}
                              </span>
                              {group.bankName}
                            </div>
                          </div>

                          {/* Account rows */}
                          {group.accounts.map((acc) => (
                            <div key={acc.accountSlug} className="grid grid-cols-[minmax(220px,1fr)_repeat(13,46px)_96px] gap-1 items-center px-2 py-1">
                              <div className="min-w-0 px-3">
                                <p className="truncate text-sm font-semibold text-gray-800">{acc.accountName || "Unnamed Account"}</p>
                                <p className="text-xs text-gray-500">
                                  {acc.accountType.charAt(0).toUpperCase() + acc.accountType.slice(1)} · ••{acc.accountId.slice(-4)}
                                </p>
                              </div>

                              {acc.cells.map((cell) => (
                                <div
                                  key={cell.yearMonth}
                                  className={`h-8 rounded-lg flex items-center justify-center text-xs font-bold transition ${
                                    cell.state === "uploaded"
                                      ? "bg-green-100 text-green-600"
                                      : cell.state === "missing"
                                      ? "border-2 border-red-400 bg-red-50 text-red-600 cursor-pointer hover:bg-red-600 hover:text-white hover:border-red-600"
                                      : cell.state === "not_yet_due"
                                      ? "border-2 border-dashed border-gray-300 bg-gradient-to-br from-gray-50 to-gray-100"
                                      : "bg-transparent flex items-center justify-center"
                                  }`}
                                  onClick={() => {
                                    if (cell.state === "missing" && pendingSetupCount === 0) {
                                      fileInputRef.current?.click();
                                    }
                                  }}
                                  title={
                                    cell.state === "uploaded"
                                      ? `${fmtMonth(cell.yearMonth)} · uploaded`
                                      : cell.state === "missing"
                                      ? `${fmtMonth(cell.yearMonth)} · missing — click to upload`
                                      : cell.state === "not_yet_due"
                                      ? `${fmtMonth(cell.yearMonth)} · not yet due`
                                      : `${fmtMonth(cell.yearMonth)} · account not open`
                                  }
                                >
                                  {cell.state === "uploaded" && (
                                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                                    </svg>
                                  )}
                                  {cell.state === "missing" && (
                                    <>
                                      <span className="group-hover:hidden">!</span>
                                      <span className="hidden group-hover:inline text-[10px]">Upload</span>
                                    </>
                                  )}
                                  {cell.state === "blank" && (
                                    <span className="w-3 h-0.5 bg-gray-300 rounded" />
                                  )}
                                </div>
                              ))}

                              <div className="px-3 text-right">
                                {acc.missingCount > 0 ? (
                                  <span className="inline-block rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-semibold text-red-600">
                                    {acc.missingCount} missing
                                  </span>
                                ) : (
                                  <span className="inline-block text-xs font-semibold text-green-600">✓ Complete</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Mobile layout */}
                  <div className="lg:hidden divide-y divide-gray-100">
                    {displayGroups.map((group) =>
                      group.accounts.map((acc) => (
                        <div key={acc.accountSlug} className="px-4 py-3">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-semibold text-gray-800">{acc.accountName || "Unnamed Account"}</p>
                              <p className="text-xs text-gray-500">{group.bankName} · {acc.accountType.charAt(0).toUpperCase() + acc.accountType.slice(1)} · ••{acc.accountId.slice(-4)}</p>
                            </div>
                            {acc.missingCount > 0 ? (
                              <span className="shrink-0 rounded-full bg-red-50 border border-red-200 px-2.5 py-0.5 text-xs font-semibold text-red-600">
                                {acc.missingCount} missing
                              </span>
                            ) : (
                              <span className="shrink-0 text-xs font-semibold text-green-600">✓ Complete</span>
                            )}
                          </div>

                          {/* Dots */}
                          <div className="grid grid-cols-13 gap-1">
                            {acc.cells.map((cell) => (
                              <div
                                key={cell.yearMonth}
                                className={`h-3.5 rounded ${
                                  cell.state === "uploaded"
                                    ? "bg-green-500"
                                    : cell.state === "missing"
                                    ? "border-2 border-red-400 bg-red-50 relative"
                                    : cell.state === "not_yet_due"
                                    ? "border-2 border-dashed border-gray-300"
                                    : "border-b-2 border-gray-200 h-2"
                                }`}
                              >
                                {cell.state === "missing" && (
                                  <span className="absolute inset-0 flex items-center justify-center text-[9px] font-extrabold text-red-600">!</span>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Date labels */}
                          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                            <span>{coverageData.months[0].label}</span>
                            <span>{coverageData.months[coverageData.months.length - 1].label}</span>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* Footer */}
                  <div className="border-t border-gray-100 px-4 sm:px-5 py-3 text-xs text-gray-400">
                    Statements are expected monthly per account. Accounts with missing months are listed first. Hover a red cell to upload that month.
                  </div>
                </div>
              ) : null}
            </>
          )}

          {/* All uploads tab */}
          {activeTab === "uploads" && totalCount > 0 && (
            <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {/* Header row (desktop only) */}
              <div className="hidden sm:grid grid-cols-[40px_1.6fr_90px_110px_80px_120px_90px] gap-3 items-center px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-gray-400 border-b border-gray-100">
                <span />
                <span>File · account</span>
                <span>Period</span>
                <span>Uploaded</span>
                <span>Txns</span>
                <span className="text-right">Net change</span>
                <span />
              </div>

              {/* Rows */}
              <div className="divide-y divide-gray-100">
                {statements.slice(0, 8).map((s) => {
                  const isCSV = s.source === "csv";
                  const monthStr = s.csvDateRange
                    ? `${fmtDate(s.csvDateRange.from)} – ${fmtDate(s.csvDateRange.to)}`
                    : s.statementDate ? fmtMonth(s.statementDate.slice(0, 7)) : "Unknown period";
                  const isDeleting = deletingId === s.id;
                  const isConfirm = confirmId === s.id;
                  const isReparsing = reparsingId === s.id;
                  const acctLabel = [s.bankName, s.accountName].filter(Boolean).join(" ");

                  return (
                    <div
                      key={s.id}
                      onClick={(e) => {
                        if ((e.target as HTMLElement).closest("button, a")) return;
                        router.push(`/account/statements/${s.id}`);
                      }}
                      className="grid grid-cols-[36px_1fr_auto] sm:grid-cols-[40px_1.6fr_90px_110px_80px_120px_90px] gap-2 sm:gap-3 items-center px-3 py-3 hover:bg-gray-50 transition cursor-pointer"
                    >
                      {/* PDF icon */}
                      <div className="w-9 h-9 rounded-lg bg-red-50 text-red-600 flex items-center justify-center text-[10px] font-bold">
                        PDF
                      </div>

                      {/* File + account */}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-mono text-gray-800">{s.fileName || monthStr}</p>
                        <p className="text-xs text-gray-500 truncate">{acctLabel}</p>
                      </div>

                      {/* Period */}
                      <span className="hidden sm:block rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 justify-self-start whitespace-nowrap">
                        {s.statementDate ? fmtMonth(s.statementDate.slice(0, 7)) : "—"}
                      </span>

                      {/* Uploaded */}
                      <span className="hidden sm:block text-xs text-gray-500">
                        {s.uploadedAt ? timeAgo(s.uploadedAt) : "—"}
                      </span>

                      {/* Txns */}
                      <span className="hidden sm:block text-xs text-gray-500">
                        {s.txCount ? `${s.txCount} txns` : "—"}
                      </span>

                      {/* Net change */}
                      <span className={`text-sm font-bold tabular-nums ${s.netWorth && s.netWorth < 0 ? "text-gray-900" : "text-green-600"} text-right`}>
                        {s.netWorth ? `${s.netWorth >= 0 ? "+" : "−"}${homeCurrency}$${Math.abs(s.netWorth).toFixed(2)}` : "—"}
                      </span>

                      {/* Status */}
                      <div className="flex items-center gap-1 justify-self-end">
                        {s.status === "completed" && (
                          <span className="text-xs font-semibold text-green-600">✓ Parsed</span>
                        )}
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
                          <div className="flex items-center gap-1">
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
                    </div>
                  );
                })}
              </div>

              {/* Footer */}
              {statements.length > 8 && (
                <div className="border-t border-gray-100 px-4 py-3 text-center text-xs text-gray-400">
                  Showing 8 of {totalCount} · <button className="font-semibold text-purple-600 hover:underline">Load more</button>
                </div>
              )}
            </div>
          )}

          {/* Empty state for uploads tab */}
          {activeTab === "uploads" && totalCount === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
              <p className="text-sm font-medium text-gray-600">No statements uploaded yet</p>
              <p className="mt-1 text-xs text-gray-400">Drop files into the zone above or click "+ Add statements" to get started.</p>
            </div>
          )}
        </>
      )}

      {/* Supported banks strip (empty state only) */}
      {!loading && !error && totalCount === 0 && (
        <div className="mt-5 flex items-center gap-2 rounded-lg border border-gray-100 bg-white px-4 py-2.5 shadow-sm">
          <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-gray-400">Supported</span>
          <div className="flex flex-wrap gap-x-3 gap-y-1">
            {supportedBanks(homeCurrency).map((bank) => (
              <span key={bank} className="text-xs font-medium text-gray-600">{bank}</span>
            ))}
          </div>
        </div>
      )}

      {/* Quota footer */}
      {showQuota && (
        <div className="mt-5 rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
          <div className="flex items-center justify-between mb-2">
            <p className="text-sm text-gray-700">{quotaLabel}</p>
            <p className="text-xs text-gray-400">{quotaSubLabel}</p>
          </div>
          <div className="h-2 w-full rounded-full bg-gray-100 overflow-hidden">
            <div className={`h-full rounded-full transition-all ${quotaBarColor}`} style={{ width: `${Math.max(quotaPct * 100, quotaUsed > 0 ? 2 : 0)}%` }} />
          </div>
          <p className="mt-2.5 text-xs text-gray-500">
            Free plan allowance.{" "}
            <Link href="/account/billing" className="font-medium text-purple-600 hover:underline">Upgrade to Pro for unlimited uploads →</Link>
          </p>
          {quota.onetimeRemaining === 0 && quota.monthlyUsed >= quota.monthlyLimit && (
            <p className="mt-2 text-xs font-medium text-red-600">
              You&apos;ve used all your free uploads this month.{" "}
              <Link href="/account/billing" className="text-purple-600 hover:underline">Upgrade to Pro →</Link>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
