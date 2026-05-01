"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import Sidebar from "@/components/Sidebar";
import type { PendingAccount, ExistingIngested } from "@/app/api/user/pending-setup/route";

// ── constants ─────────────────────────────────────────────────────────────────

const SETUP_SESSION_KEY = "nwai_setup_session";

const SUPPORTED_CURRENCIES = [
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "AUD", label: "AUD — Australian Dollar" },
];

const ACCOUNT_TYPES = [
  { value: "checking",   label: "Chequing" },
  { value: "savings",    label: "Savings" },
  { value: "credit",     label: "Credit Card" },
  { value: "investment", label: "Investment / TFSA / RRSP" },
  { value: "mortgage",   label: "Mortgage" },
  { value: "loan",       label: "Loan / Line of Credit" },
  { value: "other",      label: "Other" },
];

const AGE_BUCKETS = [
  { id: "new",    label: "Less than 6 months",  months: 0,  detail: "No backfill needed." },
  { id: "6to24",  label: "6 months — 2 years",  months: 12, detail: "~1 year of estimated history." },
  { id: "2to5",   label: "2 — 5 years",         months: 30, detail: "~2.5 years of estimated history." },
  { id: "5plus",  label: "5+ years",             months: -1, detail: "Estimated back to your earliest statement." },
] as const;

type BucketId = typeof AGE_BUCKETS[number]["id"];

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtYM(ym: string): string {
  if (!ym) return "";
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function accountTypeIcon(t: string): string {
  switch (t) {
    case "checking": return "🏦";
    case "savings":  return "💰";
    case "credit":   return "💳";
    case "investment": return "📈";
    case "mortgage": case "loan": return "🏠";
    default: return "📄";
  }
}

function accountTypeColor(t: string) {
  switch (t) {
    case "checking": case "savings": return "bg-green-50 border-green-200";
    case "credit":   return "bg-orange-50 border-orange-200";
    case "mortgage": case "loan": return "bg-red-50 border-red-200";
    case "investment": return "bg-blue-50 border-blue-200";
    default: return "bg-gray-50 border-gray-200";
  }
}

function monthsDiff(from: string, to: string): number {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return Math.max(0, (ty - fy) * 12 + (tm - fm));
}

// ── account setup form ────────────────────────────────────────────────────────

interface AccountFormState {
  accountName: string;
  accountType: string;
  currency: string;
  ageBucket: BucketId | null;
  // account confirmation (when accountConfirmNeeded)
  confirmMode: "new" | "existing";
  existingSlug: string;
  // resolved slug (after slug-confirm API call)
  resolvedSlug: string;
  // step
  step: "confirm" | "details" | "done" | "skipped";
  saving: boolean;
  error: string | null;
}

function AccountCard({
  account,
  idToken,
  onComplete,
}: {
  account: PendingAccount;
  idToken: string;
  onComplete: (skipped: boolean) => void;
}) {
  const [form, setForm] = useState<AccountFormState>({
    accountName:   account.accountName,
    accountType:   account.accountType,
    currency:      account.inferredCurrency,
    ageBucket:     null,
    confirmMode:   account.existingAccounts.length > 0 ? "existing" : "new",
    existingSlug:  account.suggestedSlug ?? account.existingAccounts[0]?.slug ?? "",
    resolvedSlug:  account.accountSlug,
    step:          account.accountConfirmNeeded ? "confirm" : "details",
    saving:        false,
    error:         null,
  });

  const update = (patch: Partial<AccountFormState>) =>
    setForm((prev) => ({ ...prev, ...patch }));

  // Step 1: account confirmation (only when accountConfirmNeeded)
  const handleConfirm = async () => {
    update({ saving: true, error: null });
    try {
      const chosenSlug = form.confirmMode === "existing" ? form.existingSlug : account.accountSlug;
      const res = await fetch("/api/user/account-slug-confirm", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({
          statementId:       account.primaryStatementId,
          bankTypeKey:       account.bankTypeKey ?? account.accountSlug,
          confirmedSlug:     chosenSlug,
          isExistingAccount: form.confirmMode === "existing",
          nickname:          form.confirmMode === "new" && form.accountName.trim() ? form.accountName.trim() : undefined,
        }),
      });
      if (!res.ok) { update({ saving: false, error: "Couldn't save — try again." }); return; }
      update({ resolvedSlug: chosenSlug, saving: false });
      // If merging into existing, no further setup needed
      if (form.confirmMode === "existing") {
        await dismiss(account.statementIds);
        onComplete(false);
        return;
      }
      update({ step: "details" });
    } catch { update({ saving: false, error: "Network error — try again." }); }
  };

  // Step 2: details (currency + age)
  const handleSave = async () => {
    if (!form.ageBucket) return;
    update({ saving: true, error: null });
    try {
      const bucket = AGE_BUCKETS.find((b) => b.id === form.ageBucket)!;
      const backfillMonths = bucket.months === -1
        ? (account.oldestMonth ? monthsDiff(account.oldestMonth, account.firstStatementYearMonth) : 12)
        : bucket.months;

      const [ccyRes, bfRes] = await Promise.all([
        fetch("/api/user/currency-overrides", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({ accountSlug: form.resolvedSlug, currency: form.currency, confirmed: true }),
        }),
        fetch("/api/user/account-backfills", {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
          body: JSON.stringify({
            statementId:             account.primaryStatementId,
            accountSlug:             form.resolvedSlug,
            accountName:             form.accountName,
            accountType:             form.accountType,
            backfillMonths,
            firstBalance:            account.firstBalance,
            firstStatementYearMonth: account.firstStatementYearMonth,
          }),
        }),
      ]);

      if (!ccyRes.ok || !bfRes.ok) {
        update({ saving: false, error: "Couldn't save — try again." });
        return;
      }
      await dismiss(account.statementIds);
      update({ saving: false, step: "done" });
      onComplete(false);
    } catch { update({ saving: false, error: "Network error — try again." }); }
  };

  const handleSkip = async () => {
    await dismiss(account.statementIds);
    update({ step: "skipped" });
    onComplete(true);
  };

  const dismiss = async (ids: string[]) => {
    try {
      await fetch("/api/user/setup-dismiss", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${idToken}` },
        body: JSON.stringify({ statementIds: ids }),
      });
    } catch { /* best-effort */ }
  };

  if (form.step === "done" || form.step === "skipped") return null;

  const oldestStatementLabel = account.firstStatementYearMonth ? fmtYM(account.firstStatementYearMonth) : null;

  return (
    <div className="rounded-2xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      {/* Card header */}
      <div className="flex items-start justify-between gap-4 px-6 py-5 border-b border-gray-100">
        <div className="flex items-center gap-3 min-w-0">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border text-lg ${accountTypeColor(account.accountType)}`}>
            {accountTypeIcon(account.accountType)}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 truncate">{account.accountName}</p>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 border border-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700 uppercase tracking-wide">
                ⊙ Auto-detected
              </span>
              <span className="text-xs text-gray-400">
                {account.statementCount} statement{account.statementCount !== 1 ? "s" : ""}
                {account.txCount > 0 ? ` · ${account.txCount} transactions` : ""}
              </span>
            </div>
          </div>
        </div>
        <span className="shrink-0 text-xs font-semibold text-amber-600 uppercase tracking-wide">Needs setup</span>
      </div>

      <div className="px-6 py-6 space-y-6">

        {/* ── Confirm step ── */}
        {form.step === "confirm" && (
          <>
            <p className="text-sm text-gray-600">
              We couldn&apos;t find an account number on this statement. Choose how to track it.
            </p>
            <div className="space-y-2">
              {account.existingAccounts.length > 0 && (
                <label className={`flex items-start gap-3 cursor-pointer rounded-xl border-2 px-4 py-3 transition ${
                  form.confirmMode === "existing" ? "border-purple-500 bg-purple-50" : "border-gray-200 hover:border-gray-300"
                }`}>
                  <input type="radio" name={`confirm-${account.accountSlug}`} value="existing"
                    checked={form.confirmMode === "existing"}
                    onChange={() => update({ confirmMode: "existing" })}
                    className="mt-0.5 accent-purple-600 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800">Add to existing account</p>
                    <p className="text-xs text-gray-400 mt-0.5">Merge with a previously set-up account.</p>
                    {form.confirmMode === "existing" && (
                      <select value={form.existingSlug} onChange={(e) => update({ existingSlug: e.target.value })}
                        className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400">
                        {account.existingAccounts.map((a) => (
                          <option key={a.slug} value={a.slug}>{a.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                </label>
              )}
              <label className={`flex items-start gap-3 cursor-pointer rounded-xl border-2 px-4 py-3 transition ${
                form.confirmMode === "new" ? "border-purple-500 bg-purple-50" : "border-gray-200 hover:border-gray-300"
              }`}>
                <input type="radio" name={`confirm-${account.accountSlug}`} value="new"
                  checked={form.confirmMode === "new"}
                  onChange={() => update({ confirmMode: "new" })}
                  className="mt-0.5 accent-purple-600 shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800">New account</p>
                  <p className="text-xs text-gray-400 mt-0.5">Track as a separate account.</p>
                  {form.confirmMode === "new" && (
                    <input type="text" value={form.accountName}
                      onChange={(e) => update({ accountName: e.target.value })}
                      placeholder="e.g. RBC Savings"
                      className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400" />
                  )}
                </div>
              </label>
            </div>
            {form.error && <p className="text-xs text-red-600">{form.error}</p>}
            <div className="flex items-center justify-between pt-2">
              <button onClick={handleSkip} className="text-sm text-gray-400 hover:text-gray-600 transition">
                Skip — I&apos;ll set this up later
              </button>
              <button onClick={handleConfirm} disabled={form.saving || (form.confirmMode === "new" && !form.accountName.trim())}
                className="rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40 transition">
                {form.saving ? "Saving…" : "Continue →"}
              </button>
            </div>
          </>
        )}

        {/* ── Details step ── */}
        {form.step === "details" && (
          <>
            {/* Account name + type row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Account name <span className="font-normal text-gray-400">how it appears in your dashboard</span>
                </label>
                <input type="text" value={form.accountName}
                  onChange={(e) => update({ accountName: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">Account type</label>
                <select value={form.accountType} onChange={(e) => update({ accountType: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400">
                  {ACCOUNT_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
            </div>

            {/* Currency + opening balance row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Currency <span className="font-normal text-gray-400">detected from transactions</span>
                </label>
                <select value={form.currency} onChange={(e) => update({ currency: e.target.value })}
                  className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-purple-400">
                  {SUPPORTED_CURRENCIES.map((c) => <option key={c.code} value={c.code}>{c.label}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  Opening balance <span className="font-normal text-gray-400">from oldest statement</span>
                </label>
                <input type="text" readOnly
                  value={account.firstBalance !== 0 ? account.firstBalance.toLocaleString("en-US", { style: "currency", currency: form.currency, maximumFractionDigits: 2 }) : "—"}
                  className="w-full rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-sm text-gray-600 cursor-not-allowed" />
              </div>
            </div>

            {/* Account age */}
            {account.backfillPromptNeeded && (
              <div>
                <label className="block text-xs font-semibold text-gray-600 mb-1">
                  How long have you had this account? <span className="font-normal text-gray-400">used for net worth backfill</span>
                </label>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {AGE_BUCKETS.map((b) => (
                    <button key={b.id} onClick={() => update({ ageBucket: b.id })}
                      className={`rounded-xl border-2 px-3 py-3 text-left transition ${
                        form.ageBucket === b.id ? "border-purple-500 bg-purple-50" : "border-gray-200 bg-gray-50 hover:border-gray-300"
                      }`}>
                      <p className={`text-sm font-semibold leading-tight ${form.ageBucket === b.id ? "text-purple-700" : "text-gray-700"}`}>{b.label}</p>
                    </button>
                  ))}
                </div>
                {oldestStatementLabel && (
                  <div className="mt-3 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2.5">
                    <p className="text-xs text-amber-800">
                      <span className="font-semibold">Why this matters:</span> Your oldest uploaded statement is from {oldestStatementLabel}.
                      Since this account predates that, we&apos;ll assume a flat balance before then so your net worth
                      history doesn&apos;t show a misleading jump on the day you started uploading.
                    </p>
                  </div>
                )}
              </div>
            )}

            {form.error && <p className="text-xs text-red-600">{form.error}</p>}

            <div className="flex items-center justify-between pt-2 border-t border-gray-100">
              <button onClick={handleSkip} className="text-sm text-gray-400 hover:text-gray-600 transition">
                Skip — I&apos;ll set this up later
              </button>
              <button onClick={handleSave}
                disabled={form.saving || (account.backfillPromptNeeded && !form.ageBucket)}
                className="rounded-xl bg-gray-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-40 transition">
                {form.saving ? "Saving…" : "Confirm and continue →"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── existing account row ──────────────────────────────────────────────────────

function ExistingRow({ account }: { account: ExistingIngested }) {
  const range = [account.oldestMonth, account.newestMonth]
    .filter(Boolean)
    .map(fmtYM)
    .join(" — ");
  return (
    <div className="flex items-center gap-4 px-5 py-3.5">
      <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border text-sm ${accountTypeColor(account.accountType)}`}>
        {accountTypeIcon(account.accountType)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-800">{account.accountName}</p>
        <p className="text-xs text-gray-400">
          {account.statementCount} statement{account.statementCount !== 1 ? "s" : ""}
          {account.txCount > 0 ? ` · ${account.txCount} transactions added` : ""}
        </p>
      </div>
      <div className="shrink-0 flex items-center gap-3">
        {range && <span className="text-xs text-gray-400 tabular-nums whitespace-nowrap">{range}</span>}
        <span className="inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-[11px] font-semibold text-green-700">
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          Ingested
        </span>
      </div>
    </div>
  );
}

// ── main setup page ───────────────────────────────────────────────────────────

function SetupContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [idToken, setIdToken] = useState<string | null>(null);
  const [pending, setPending] = useState<PendingAccount[]>([]);
  const [ingested, setIngested] = useState<ExistingIngested[]>([]);
  const [batchStatCount, setBatchStatCount] = useState(0);
  const [batchTxCount, setBatchTxCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [completedSlugs, setCompletedSlugs] = useState<Set<string>>(new Set());
  const [existingOpen, setExistingOpen] = useState(false);

  // Session IDs — from URL param or localStorage
  const sessionIds = (() => {
    const fromUrl = searchParams.get("ids");
    if (fromUrl) return fromUrl.split(",").filter(Boolean);
    try {
      const raw = localStorage.getItem(SETUP_SESSION_KEY);
      return raw ? (JSON.parse(raw) as string[]) : [];
    } catch { return []; }
  })();

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const idParam = sessionIds.length > 0 ? `?ids=${sessionIds.join(",")}` : "";
      const res = await fetch(`/api/user/pending-setup${idParam}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      const json = await res.json();
      setPending(json.pendingAccounts ?? []);
      setIngested(json.batchIngested ?? []);
      setBatchStatCount(json.batchStatementCount ?? 0);
      setBatchTxCount(json.batchTxCount ?? 0);
    } catch { /* ignore */ }
    finally { setLoading(false); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setIdToken(tok);
      load(tok);
    });
  }, [router, load]);

  const handleAccountComplete = (slug: string) => {
    setCompletedSlugs((prev) => new Set([...prev, slug]));
  };

  const remaining = pending.filter((a) => !completedSlugs.has(a.accountSlug));
  const allDone = pending.length > 0 && remaining.length === 0;
  const noPending = !loading && pending.length === 0;

  // Redirect to Today when all accounts are set up
  useEffect(() => {
    if (allDone) {
      try { localStorage.removeItem(SETUP_SESSION_KEY); } catch { /* */ }
      const t = setTimeout(() => router.push("/account/dashboard"), 1200);
      return () => clearTimeout(t);
    }
  }, [allDone, router]);

  // Derived stats
  const newCount = pending.length;
  const knownCount = ingested.length;
  const hasSession = sessionIds.length > 0 || batchStatCount > 0;
  const statCount = hasSession ? (batchStatCount || sessionIds.length) : 0;

  return (
    <div className="mx-auto max-w-2xl lg:max-w-3xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-7">
        <div className="flex items-center gap-2 mb-2">
          <svg className="h-4 w-4 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="text-xs font-bold uppercase tracking-widest text-green-600">Statements Processed</span>
        </div>
        <h1 className="text-2xl font-extrabold text-gray-900 sm:text-3xl leading-tight">
          {noPending ? "All accounts are set up." : "Here's what we found in your statements."}
        </h1>
        {!noPending && (
          <p className="mt-2 text-sm text-gray-500">
            We parsed everything and matched it to accounts.
            {newCount > 0 && ` ${newCount} account${newCount !== 1 ? "s" : ""} need${newCount === 1 ? "s" : ""} a quick setup before we hand you the keys to your Today page.`}
          </p>
        )}
      </div>

      {loading && (
        <div className="flex justify-center py-16">
          <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
        </div>
      )}

      {!loading && (
        <>
          {/* Stats bar — only when we have session context */}
          {hasSession && (statCount > 0 || knownCount > 0 || newCount > 0) && (
            <div className="mb-6 grid grid-cols-4 divide-x divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {[
                { label: "STATEMENTS", value: String(statCount || (newCount + knownCount)), sub: "all parsed cleanly" },
                { label: "ACCOUNTS",   value: String(newCount + knownCount), sub: `${knownCount} known · ${newCount} new` },
                { label: "TRANSACTIONS", value: batchTxCount > 0 ? batchTxCount.toLocaleString() : "—", sub: "categorized" },
                { label: "COVERAGE",   value: "—", sub: "" },
              ].map((s) => (
                <div key={s.label} className="px-4 py-3.5">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-gray-400">{s.label}</p>
                  <p className="mt-0.5 text-xl font-bold tabular-nums text-gray-900">{s.value}</p>
                  <p className="mt-0.5 text-[11px] text-gray-400 leading-tight">{s.sub}</p>
                </div>
              ))}
            </div>
          )}

          {/* Added to existing accounts (collapsible) */}
          {ingested.length > 0 && (
            <div className="mb-6">
              <button onClick={() => setExistingOpen((o) => !o)}
                className="w-full flex items-center justify-between text-left">
                <div>
                  <h2 className="font-semibold text-gray-900">Added to existing accounts</h2>
                  <p className="text-xs text-gray-400 mt-0.5">
                    These statements were folded into accounts you&apos;ve already set up. No action needed.
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0 ml-4">
                  <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">
                    {ingested.length} account{ingested.length !== 1 ? "s" : ""} · Ready
                  </span>
                  <svg className={`h-4 w-4 text-gray-400 transition-transform ${existingOpen ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </div>
              </button>
              {existingOpen && (
                <div className="mt-3 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden divide-y divide-gray-100">
                  {ingested.map((a) => <ExistingRow key={a.accountSlug} account={a} />)}
                </div>
              )}
            </div>
          )}

          {/* New accounts to set up */}
          {remaining.length > 0 && idToken && (
            <div>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h2 className="font-semibold text-gray-900">New accounts to set up</h2>
                  <p className="text-sm text-gray-500 mt-0.5">
                    We auto-detected what we could. A few details help us avoid false signals —
                    especially the account age, which lets us correctly model your net worth before
                    you started uploading.
                  </p>
                </div>
                <span className="shrink-0 ml-4 text-xs font-semibold text-gray-400 uppercase tracking-wide whitespace-nowrap">
                  {remaining.length} account{remaining.length !== 1 ? "s" : ""} · Needs review
                </span>
              </div>
              <div className="space-y-4">
                {remaining.map((account) => (
                  <AccountCard
                    key={account.accountSlug}
                    account={account}
                    idToken={idToken}
                    onComplete={(skipped) => {
                      void skipped;
                      handleAccountComplete(account.accountSlug);
                    }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* All done state */}
          {allDone && (
            <div className="rounded-2xl border border-green-200 bg-green-50 px-6 py-8 text-center">
              <div className="flex justify-center mb-3">
                <svg className="h-10 w-10 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <p className="font-semibold text-gray-900 text-lg">All set! Heading to your Today page…</p>
            </div>
          )}

          {/* No pending (came here from Today page, already all done) */}
          {noPending && (
            <div className="rounded-2xl border border-gray-200 bg-gray-50 px-6 py-12 text-center">
              <p className="font-semibold text-gray-700">All accounts are confirmed — nothing to do here.</p>
              <button onClick={() => router.push("/account/dashboard")}
                className="mt-4 rounded-xl bg-gray-900 px-5 py-2 text-sm font-semibold text-white hover:bg-gray-800 transition">
                Go to Today →
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function SetupPage() {
  return (
    <div className="min-h-screen bg-[#f8f7f4]">
      <Sidebar />
      <div className="lg:pl-56">
        <div className="lg:hidden h-14" />
        <Suspense>
          <SetupContent />
        </Suspense>
      </div>
    </div>
  );
}
