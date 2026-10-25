"use client";

import React, { useEffect, useState, useCallback, Suspense } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { UserStatementSummary } from "@/lib/types";
import { buildAccountSlug } from "@/lib/accountSlug";

// ── coverage helpers ──────────────────────────────────────────────────────────

function stmtYearMonth(s: UserStatementSummary): string {
  if (s.statementDate) return s.statementDate.slice(0, 7);
  return s.uploadedAt.slice(0, 7);
}

function stmtAccountSlug(s: UserStatementSummary): string {
  return buildAccountSlug(s.bankName, s.accountId, s.accountName, s.accountType);
}

function stmtDisplayName(s: UserStatementSummary): string {
  if (s.accountName) return s.accountName;
  const id = s.accountId ? ` (${s.accountId})` : "";
  return `${s.bankName ?? "Unknown"}${id}`;
}

function addMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthRange(from: string, to: string): string[] {
  const months: string[] = [];
  let cur = from;
  while (cur <= to) {
    months.push(cur);
    cur = addMonths(cur, 1);
  }
  return months;
}

function shortMo(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function longMo(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function monthName(ym: string): string {
  const [y, m] = ym.split("-");
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "long" });
}

function missingMonthsLabel(months: string[]) {
  const names = [...months].sort().map(monthName);
  if (names.length === 0) return null;
  const bold = (n: string, i: number) => (
    <strong key={i} className="font-semibold text-gray-800">{n}</strong>
  );
  if (names.length === 1) return <>Missing {bold(names[0], 0)}</>;
  const parts: React.ReactNode[] = [];
  names.forEach((n, i) => {
    if (i > 0) parts.push(i === names.length - 1 ? " and " : ", ");
    parts.push(bold(n, i));
  });
  return <>Missing {parts}</>;
}

function accountTypeIcon(type: string) {
  const t = type.toLowerCase();
  if (t === "credit") return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
    </svg>
  );
  if (t === "checking" || t === "savings" || t === "cash") return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 14v3m4-3v3m4-3v3M3 21h18M3 10h18M3 7l9-4 9 4M4 10h16v11H4V10z" />
    </svg>
  );
  if (t === "mortgage" || t === "loan" || t.includes("equity") || t.includes("heloc") || t.includes("line")) return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
    </svg>
  );
  // investment / retirement / default
  return (
    <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  );
}

type CoverageStatus = "uploaded" | "gap" | "carried" | "future";

interface AccountCoverage {
  slug: string;
  displayName: string;
  accountType: string;
  firstMonth: string;
  lastMonth: string;
  uploadedMonths: Set<string>;
  statementDue: boolean;
}

/**
 * Returns whether a new statement is likely available for this account.
 * Uses the median issue day-of-month from historical statements and an 8-day
 * grace period (3 days bank delay + 5 days upload window).
 */
function isStatementDue(slug: string, statements: UserStatementSummary[]): boolean {
  const GRACE_DAYS = 8;
  const acctStmts = statements.filter(
    (s) => s.status === "completed" && !s.superseded && buildAccountSlug(s.bankName, s.accountId, s.accountName, s.accountType) === slug && s.statementDate,
  );
  if (acctStmts.length === 0) return false;

  const dates      = acctStmts.map((s) => s.statementDate!).filter(Boolean).sort();
  const latestStmt = dates[dates.length - 1];

  // Typical issue day-of-month (median)
  const issueDays  = dates.map((d) => parseInt(d.slice(8, 10), 10)).filter((n) => n > 0);
  const sortedDays = [...issueDays].sort((a, b) => a - b);
  const typicalDay = sortedDays[Math.floor(sortedDays.length / 2)] ?? 1;

  // Build a date safely — clamp typicalDay to the last real day of the month
  // so e.g. day-31 in April doesn't silently overflow to May 1.
  function safeDate(year: number, month: number, day: number): Date {
    const lastDay = new Date(year, month + 1, 0).getDate();
    return new Date(year, month, Math.min(day, lastDay));
  }

  // Expected date = most recent occurrence of typicalDay on or before today
  const today   = new Date();
  const todayMs = today.getTime();
  let expYear   = today.getFullYear();
  let expMonth  = today.getMonth();
  let exp       = safeDate(expYear, expMonth, typicalDay);
  if (exp.getTime() > todayMs) {
    expMonth -= 1;
    if (expMonth < 0) { expMonth = 11; expYear -= 1; }
    exp = safeDate(expYear, expMonth, typicalDay);
  }

  const expectedDate = exp.toISOString().slice(0, 10);
  const daysOverdue  = Math.round((todayMs - exp.getTime()) / 86_400_000);

  return latestStmt < expectedDate && daysOverdue > GRACE_DAYS;
}

function buildCoverage(statements: UserStatementSummary[]): {
  accounts: AccountCoverage[];
  months: string[];
  currentMonth: string;
} {
  const completed = statements.filter((s) => s.status === "completed" && !s.superseded);
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  // Group by slug
  const map = new Map<string, AccountCoverage>();
  for (const s of completed) {
    const slug = stmtAccountSlug(s);
    const ym   = stmtYearMonth(s);
    let entry  = map.get(slug);
    if (!entry) {
      entry = {
        slug,
        displayName: stmtDisplayName(s),
        accountType: s.accountType ?? "other",
        firstMonth: ym,
        lastMonth: ym,
        uploadedMonths: new Set(),
        statementDue: false,
      };
      map.set(slug, entry);
    }
    entry.uploadedMonths.add(ym);
    if (ym < entry.firstMonth) entry.firstMonth = ym;
    if (ym > entry.lastMonth)  entry.lastMonth  = ym;
  }

  const accounts = Array.from(map.values())
    .map((a) => ({ ...a, statementDue: isStatementDue(a.slug, statements) }))
    .sort((a, b) => {
      // Sort accounts with a due statement to the top
      if (a.statementDue !== b.statementDue) return a.statementDue ? -1 : 1;
      return a.displayName.localeCompare(b.displayName);
    });

  // Show only the last 6 months (or fewer if data is newer)
  const sixMonthsAgo = addMonths(currentMonth, -5);
  const globalFirst = accounts.reduce((min, a) => a.firstMonth < min ? a.firstMonth : min, currentMonth);
  const rangeStart = globalFirst > sixMonthsAgo ? globalFirst : sixMonthsAgo;
  const months = monthRange(rangeStart, currentMonth);

  return { accounts, months, currentMonth };
}

// ── page ──────────────────────────────────────────────────────────────────────

function ActivityContent() {
  const router = useRouter();
  const [statements, setStatements] = useState<UserStatementSummary[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);
  const [token, setToken]         = useState<string | null>(null);
  const [expandedAccounts, setExpandedAccounts] = useState<Set<string>>(new Set());
  const [coverageHistoryExpanded, setCoverageHistoryExpanded] = useState(false);

  function toggleAccount(slug: string) {
    setExpandedAccounts((prev) => {
      const next = new Set(prev);
      next.has(slug) ? next.delete(slug) : next.add(slug);
      return next;
    });
  }

  const loadData = useCallback(async (tok: string, silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const stmtRes  = await fetch("/api/user/statements", { headers: { Authorization: `Bearer ${tok}` } });
      const stmtJson = await stmtRes.json().catch(() => ({}));
      if (!stmtRes.ok) { setError(stmtJson.error || "Failed to load"); return; }
      setStatements(stmtJson.statements ?? []);
    } catch { setError("Failed to load statements"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      loadData(tok);
    });
  }, [router, loadData]);

  // Silently re-fetch when user navigates back (e.g. after uploading a statement)
  useEffect(() => {
    function handleVisible() {
      if (document.visibilityState === "visible" && token) loadData(token, true);
    }
    function handlePageShow(e: PageTransitionEvent) {
      if (e.persisted && token) loadData(token, true);
    }
    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, [token, loadData]);

  // ── coverage data ────────────────────────────────────────────────────────────
  const { accounts: coverageAccounts, months: coverageMonths, currentMonth } =
    !loading && statements.length > 0
      ? buildCoverage(statements)
      : { accounts: [], months: [], currentMonth: "" };

  const totalGaps = coverageAccounts.reduce((sum, acc) => {
    return sum + coverageMonths.filter((mo) => {
      if (mo > acc.lastMonth || mo < acc.firstMonth) return false;
      if (mo >= currentMonth) return false;
      return !acc.uploadedMonths.has(mo);
    }).length;
  }, 0);

  const dueAccounts = coverageAccounts.filter((a) => a.statementDue);

  // ── new derived values for redesigned statements tab ─────────────────────────
  const accountsNeedingUpload = coverageAccounts.filter((acc) => {
    const hasGaps = coverageMonths.some(
      (mo) => mo >= acc.firstMonth && mo < currentMonth && !acc.uploadedMonths.has(mo),
    );
    return hasGaps || acc.statementDue;
  });
  const needsAttentionCount  = accountsNeedingUpload.length;
  const totalMissing         = totalGaps + dueAccounts.length;

  const justArrivedAccounts  = accountsNeedingUpload.filter((a) => a.statementDue);
  const catchingUpAccounts   = accountsNeedingUpload.filter((a) => !a.statementDue);

  const lastUploadDate =
    [...statements]
      .filter((s) => s.status === "completed")
      .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0]?.uploadedAt ?? null;

  const lastUploadLabel = lastUploadDate
    ? (() => {
        const days = Math.floor(
          (Date.now() - new Date(lastUploadDate).getTime()) / 86_400_000,
        );
        if (days === 0) return "today";
        if (days === 1) return "yesterday";
        return `${days} days ago`;
      })()
    : null;

  const coveragePct = (() => {
    let total = 0; let uploaded = 0;
    for (const acc of coverageAccounts) {
      for (const mo of coverageMonths) {
        if (mo < acc.firstMonth || mo > currentMonth) continue;
        total++;
        if (acc.uploadedMonths.has(mo)) uploaded++;
      }
    }
    return total > 0 ? Math.round((uploaded / total) * 100) : 100;
  })();

  function getCellStatus(acc: AccountCoverage, mo: string): CoverageStatus {
    if (mo > currentMonth) return "future";
    if (mo < acc.firstMonth) return "future"; // before this account existed
    if (acc.uploadedMonths.has(mo)) return "uploaded";
    // Current month: treat as a gap if a new statement is due but not yet uploaded
    if (mo === currentMonth && acc.statementDue) return "gap";
    if (mo > acc.lastMonth) return "carried"; // carried forward from last upload
    return "gap"; // between first and last but no upload
  }

  function AccountRow({
    acc,
    missingMonths,
    isExpanded,
    onToggle,
  }: {
    acc: AccountCoverage;
    missingMonths: string[];
    isExpanded: boolean;
    onToggle: () => void;
  }) {
    return (
      <div>
        <button
          onClick={onToggle}
          className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50/60 transition"
        >
          <div className="shrink-0 flex h-9 w-9 items-center justify-center rounded-xl bg-gray-100 text-gray-600">
            {accountTypeIcon(acc.accountType)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{acc.displayName}</p>
            <p className="text-xs text-gray-500 mt-0.5">{missingMonthsLabel(missingMonths)}</p>
          </div>
          <svg
            className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${isExpanded ? "rotate-180" : ""}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {isExpanded && (
          <div className="border-t border-gray-100 bg-gray-50/50 px-4 pb-4 pt-3 flex flex-wrap gap-2">
            {missingMonths.map((mo) => (
              <Link
                key={mo}
                href="/upload"
                className="inline-flex items-center gap-1.5 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 transition"
              >
                <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
                {longMo(mo)}
              </Link>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Header */}
      <div className="mb-6">
        <h1 className="font-bold text-3xl text-gray-900">Statements</h1>
        {!loading && (
          <p className="mt-1 text-sm text-gray-500">
            {needsAttentionCount > 0 ? (
              <>
                <strong className="font-semibold text-gray-900">
                  {needsAttentionCount} account{needsAttentionCount !== 1 ? "s" : ""}
                </strong>{" "}
                {needsAttentionCount === 1 ? "is" : "are"} waiting for an upload. Tap any to add the file.
              </>
            ) : coverageAccounts.length > 0 ? (
              "All accounts are up to date."
            ) : (
              "Upload your first statement to get started."
            )}
          </p>
        )}
      </div>

      {loading && (
        <div className="flex min-h-[30vh] items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {!loading && (
        <div className="space-y-6">

          {/* Empty state */}
          {coverageAccounts.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
              <p className="text-sm text-gray-500">No statements uploaded yet.</p>
              <Link href="/upload" className="mt-2 inline-block text-sm font-medium text-purple-600 hover:underline">
                Upload your first statement →
              </Link>
            </div>
          )}

          {/* ── Just arrived group ── */}
          {justArrivedAccounts.length > 0 && (
            <div className="space-y-2">
              <p className="flex items-start gap-2 text-sm text-gray-600">
                <span className="mt-[5px] h-2 w-2 shrink-0 rounded-full bg-blue-400" />
                <span>
                  <strong className="font-semibold text-gray-900">Just arrived</strong>
                  {" — your latest statements are ready to download from your bank"}
                </span>
              </p>
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
                {justArrivedAccounts.map((acc) => {
                  const gapMonths = coverageMonths.filter(
                    (mo) => mo >= acc.firstMonth && mo < currentMonth && !acc.uploadedMonths.has(mo),
                  );
                  const allMissing = [...gapMonths, currentMonth];
                  const isExpanded = expandedAccounts.has(acc.slug);
                  return (
                    <AccountRow
                      key={acc.slug}
                      acc={acc}
                      missingMonths={allMissing}
                      isExpanded={isExpanded}
                      onToggle={() => toggleAccount(acc.slug)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Catching up group ── */}
          {catchingUpAccounts.length > 0 && (
            <div className="space-y-2">
              <p className="text-sm text-gray-600">
                <strong className="font-semibold text-gray-900">Catching up</strong>
                {" — these have been waiting a bit longer"}
              </p>
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
                {catchingUpAccounts.map((acc) => {
                  const gapMonths = coverageMonths.filter(
                    (mo) => mo >= acc.firstMonth && mo < currentMonth && !acc.uploadedMonths.has(mo),
                  );
                  const isExpanded = expandedAccounts.has(acc.slug);
                  return (
                    <AccountRow
                      key={acc.slug}
                      acc={acc}
                      missingMonths={gapMonths}
                      isExpanded={isExpanded}
                      onToggle={() => toggleAccount(acc.slug)}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Coverage history — collapsible ── */}
          {coverageAccounts.length > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              <button
                onClick={() => setCoverageHistoryExpanded((v) => !v)}
                className="w-full flex items-center gap-3 px-4 py-3.5 text-left hover:bg-gray-50/60 transition"
              >
                <div className="shrink-0 flex h-8 w-8 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                  <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h18M3 6h18M3 14h18M3 18h18" />
                  </svg>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">Coverage history</p>
                  <p className="text-xs text-gray-400">
                    {coveragePct}% across {coverageAccounts.length} account{coverageAccounts.length !== 1 ? "s" : ""} · last {coverageMonths.length} months
                  </p>
                </div>
                <svg
                  className={`h-4 w-4 shrink-0 text-gray-400 transition-transform ${coverageHistoryExpanded ? "rotate-180" : ""}`}
                  fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                >
                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {coverageHistoryExpanded && (
                <div className="border-t border-gray-100 overflow-x-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/60">
                        <th className="sticky left-0 z-10 bg-gray-50 px-4 py-2.5 text-left font-semibold text-gray-600 min-w-[180px]">Account</th>
                        {coverageMonths.map((mo) => (
                          <th key={mo} className={`px-2 py-2.5 text-center font-medium whitespace-nowrap ${mo === currentMonth ? "text-purple-600" : "text-gray-400"}`}>
                            {shortMo(mo)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {coverageAccounts.map((acc) => (
                        <tr key={acc.slug} className="hover:bg-gray-50/50">
                          <td className="sticky left-0 z-10 bg-white px-4 py-2.5">
                            <p className="font-medium text-gray-800 truncate max-w-[160px]">{acc.displayName}</p>
                            <span className="text-[10px] capitalize text-gray-400">{acc.accountType}</span>
                          </td>
                          {coverageMonths.map((mo) => {
                            const s = getCellStatus(acc, mo);
                            const bg = s === "uploaded" ? "bg-green-500" : s === "carried" ? "bg-amber-400" : s === "gap" ? "bg-red-400" : "bg-gray-100 border border-gray-200";
                            return (
                              <td key={mo} className="px-2 py-2.5 text-center">
                                <span className={`inline-block h-4 w-4 rounded-sm ${bg}`} />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

export default function ActivityPage() {
  return <Suspense><ActivityContent /></Suspense>;
}
