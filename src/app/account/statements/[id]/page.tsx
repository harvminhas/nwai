"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import Sidebar from "@/components/Sidebar";
import type { ParsedStatementData, IncomeTransaction, ExpenseTransaction } from "@/lib/types";
import { CategoryPicker, categoryColor } from "@/app/account/spending/shared";
import { INCOME_CATEGORIES } from "@/lib/incomeEngine";

// ── constants ─────────────────────────────────────────────────────────────────

const SUPPORTED_CURRENCIES = [
  { code: "CAD", label: "CAD — Canadian Dollar" },
  { code: "USD", label: "USD — US Dollar" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "GBP", label: "GBP — British Pound" },
  { code: "AUD", label: "AUD — Australian Dollar" },
  { code: "CHF", label: "CHF — Swiss Franc" },
  { code: "JPY", label: "JPY — Japanese Yen" },
  { code: "MXN", label: "MXN — Mexican Peso" },
  { code: "INR", label: "INR — Indian Rupee" },
  { code: "HKD", label: "HKD — Hong Kong Dollar" },
];

const ACCOUNT_TYPES = [
  { value: "checking",   label: "Chequing / Checking" },
  { value: "savings",    label: "Savings" },
  { value: "credit",     label: "Credit Card" },
  { value: "investment", label: "Investment / TFSA / RRSP" },
  { value: "mortgage",   label: "Mortgage" },
  { value: "loan",       label: "Loan / Line of Credit" },
  { value: "other",      label: "Other" },
];

// ── types ─────────────────────────────────────────────────────────────────────

interface StatementDetail {
  id: string;
  status: string;
  fileName: string;
  uploadedAt: string | null;
  parsedData: ParsedStatementData | null;
  partialParsedData: Partial<ParsedStatementData> | null;
  parseError: string | null;
  accountSlug: string | null;
  yearMonth: string | null;
}

interface ReviewForm {
  bankName: string;
  accountName: string;
  accountType: string;
  yearMonth: string;
  currency: string;
  closingBalance: string;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

function fmtMonth(ym: string | null | undefined): string {
  if (!ym) return "—";
  const [y, m] = ym.split("-");
  if (!y || !m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

/** Safe in-app path from `?returnTo=` (open-redirect safe). */
function safeReturnPath(raw: string | null): string | null {
  if (!raw) return null;
  let s: string;
  try {
    s = decodeURIComponent(raw.trim());
  } catch {
    return null;
  }
  if (!s.startsWith("/") || s.startsWith("//")) return null;
  if (s.includes("://")) return null;
  if (!s.startsWith("/account")) return null;
  return s;
}

/** Values for income `<select>`: canonical list plus legacy/stored label if needed. */
function incomeCategoryOptions(current: string | undefined): string[] {
  const out = new Set<string>([...INCOME_CATEGORIES]);
  if (current && !out.has(current)) out.add(current);
  return Array.from(out);
}

function fmtCurrency(amount: number | undefined, currency?: string): string {
  if (amount === undefined || amount === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency || "USD",
    minimumFractionDigits: 2,
  }).format(amount);
}

// ── field components ──────────────────────────────────────────────────────────

function ReviewField({
  label,
  error,
  children,
}: {
  label: string;
  error?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label className={`mb-1 block text-xs font-semibold uppercase tracking-wide ${error ? "text-red-500" : "text-gray-500"}`}>
        {label}
        {error && <span className="ml-1 font-normal normal-case">(required)</span>}
      </label>
      {children}
    </div>
  );
}

// ── client-side recompute (mirrors server recomputeTotals) ───────────────────

function recomputeClient(
  base: ParsedStatementData,
  incomeTxns: IncomeTransaction[],
  expenseTxns: ExpenseTransaction[],
): ParsedStatementData {
  const incomeTotal   = incomeTxns.reduce((s, t)  => s + (t.amount ?? 0), 0);
  const expensesTotal = expenseTxns.reduce((s, t) => s + (t.amount ?? 0), 0);

  const srcMap = new Map<string, number>();
  for (const t of incomeTxns) {
    const k = (t.source ?? "Unknown").trim();
    srcMap.set(k, (srcMap.get(k) ?? 0) + t.amount);
  }

  const catMap = new Map<string, number>();
  for (const t of expenseTxns) {
    const k = (t.category ?? "Other").trim();
    catMap.set(k, (catMap.get(k) ?? 0) + t.amount);
  }

  return {
    ...base,
    income: {
      ...base.income,
      transactions: incomeTxns,
      total: incomeTotal,
      sources: Array.from(srcMap.entries()).map(([description, amount]) => ({ description, amount })),
    },
    expenses: {
      ...base.expenses,
      transactions: expenseTxns,
      total: expensesTotal,
      categories: Array.from(catMap.entries()).map(([name, amount]) => ({
        name, amount,
        percentage: expensesTotal > 0 ? Math.round((amount / expensesTotal) * 100) : 0,
      })),
    },
    savingsRate: incomeTotal > 0
      ? Math.round(((incomeTotal - expensesTotal) / incomeTotal) * 100)
      : 0,
  };
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function StatementDetailPage() {
  const params = useParams();
  const statementId = params.id as string;
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnPath = safeReturnPath(searchParams.get("returnTo"));
  const backHref = returnPath ?? "/account/statements";
  const backLabel = !returnPath
    ? "All statements"
    : returnPath.includes("/account/accounts/")
      ? "Back to account"
      : "Back";

  const [token, setToken] = useState<string | null>(null);
  const [statement, setStatement] = useState<StatementDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Review form state
  const [form, setForm] = useState<ReviewForm>({
    bankName: "",
    accountName: "",
    accountType: "checking",
    yearMonth: "",
    currency: "CAD",
    closingBalance: "",
  });
  const [formErrors, setFormErrors] = useState<Partial<Record<keyof ReviewForm, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reparse state
  const [reparsing, setReparsing] = useState(false);

  // ── Transaction drawer state ───────────────────────────────────────────────
  const [drawerOpen,     setDrawerOpen]     = useState(false);
  const [drawerIsNew,        setDrawerIsNew]        = useState(false);
  const [drawerType,         setDrawerType]         = useState<"expense" | "income">("expense");
  const [drawerOriginalType, setDrawerOriginalType] = useState<"expense" | "income">("expense");
  const [drawerIdx,      setDrawerIdx]      = useState<number>(-1);
  const [drawerName,     setDrawerName]     = useState("");
  const [drawerAmount,   setDrawerAmount]   = useState("");
  const [drawerDate,     setDrawerDate]     = useState("");
  const [drawerCategory, setDrawerCategory] = useState("Other");
  const [drawerSaving,   setDrawerSaving]   = useState(false);
  const [drawerErr,      setDrawerErr]      = useState<string | null>(null);
  const drawerCategoryBtnRef = useRef<HTMLButtonElement>(null);
  const [drawerCategoryPickerOpen, setDrawerCategoryPickerOpen] = useState(false);

  const [savedToast, setSavedToast] = useState(false);

  const loadStatement = useCallback(async (tok: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/user/statements/${statementId}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        setLoadError(j.error ?? "Failed to load statement");
        return;
      }
      const data: StatementDetail = await res.json();
      setStatement(data);

      // Pre-fill the review form from partial AI data (if any)
      if (data.status === "needs_review") {
        const p = data.partialParsedData;
        const ym = p?.statementDate ? p.statementDate.slice(0, 7) : "";
        setForm({
          bankName: p?.bankName ?? "",
          accountName: p?.accountName ?? "",
          accountType: p?.accountType ?? "checking",
          yearMonth: ym,
          currency: p?.currency ?? "CAD",
          closingBalance: p?.netWorth !== undefined && p?.netWorth !== null ? String(p.netWorth) : "",
        });
      }
    } catch {
      setLoadError("Failed to load statement");
    } finally {
      setLoading(false);
    }
  }, [statementId]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      loadStatement(tok);
    });
  }, [router, loadStatement]);

  useEffect(() => {
    if (!drawerOpen) setDrawerCategoryPickerOpen(false);
  }, [drawerOpen]);

  function update(fields: Partial<ReviewForm>) {
    setForm((prev) => ({ ...prev, ...fields }));
    // Clear errors on change
    const keys = Object.keys(fields) as (keyof ReviewForm)[];
    setFormErrors((prev) => {
      const next = { ...prev };
      keys.forEach((k) => { delete next[k]; });
      return next;
    });
  }

  async function handleSave() {
    if (!token || !statement) return;

    // Validate
    const errors: Partial<Record<keyof ReviewForm, boolean>> = {};
    if (!form.bankName.trim()) errors.bankName = true;
    if (!form.yearMonth || !/^\d{4}-\d{2}$/.test(form.yearMonth)) errors.yearMonth = true;
    if (!form.currency.trim()) errors.currency = true;
    if (form.closingBalance === "" || isNaN(Number(form.closingBalance))) errors.closingBalance = true;
    if (Object.keys(errors).length > 0) { setFormErrors(errors); return; }

    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch(`/api/user/statements/${statementId}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          bankName: form.bankName.trim(),
          accountName: form.accountName.trim() || undefined,
          accountType: form.accountType,
          yearMonth: form.yearMonth,
          currency: form.currency,
          closingBalance: Number(form.closingBalance),
        }),
      });
      const json = await res.json();
      if (!res.ok) { setSaveError(json.error ?? "Failed to save"); return; }
      router.push(backHref);
    } catch {
      setSaveError("Failed to save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function handleReparse() {
    if (!token) return;
    setReparsing(true);
    try {
      const res = await fetch(`/api/user/statements/${statementId}/reparse`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) { alert("Could not retry. Please try again."); return; }
      fetch("/api/parse", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ statementId }),
      }).then(() => { if (token) loadStatement(token); }).catch(() => {});
      // Optimistically switch to processing state
      setStatement((prev) => prev ? { ...prev, status: "processing" } : prev);
    } catch {
      alert("Retry failed. Please try again.");
    } finally {
      setReparsing(false);
    }
  }

  // ── Drawer helpers ────────────────────────────────────────────────────────

  function openEdit(type: "expense" | "income", idx: number) {
    const p = statement?.parsedData;
    if (!p) return;
    const tx = type === "expense"
      ? p.expenses.transactions![idx]
      : p.income.transactions![idx];
    setDrawerType(type);
    setDrawerOriginalType(type);
    setDrawerIdx(idx);
    setDrawerIsNew(false);
    setDrawerName(type === "expense" ? (tx as ExpenseTransaction).merchant : (tx as IncomeTransaction).source);
    setDrawerAmount(String(tx.amount));
    setDrawerDate(tx.date ?? "");
    setDrawerCategory(tx.category ?? (type === "expense" ? "Other" : "Other"));
    setDrawerErr(null);
    setDrawerOpen(true);
    setDrawerCategoryPickerOpen(false);
  }

  function openNew(type: "expense" | "income") {
    setDrawerType(type);
    setDrawerIdx(-1);
    setDrawerIsNew(true);
    setDrawerName(""); setDrawerAmount(""); setDrawerDate(""); setDrawerCategory("Other");
    setDrawerErr(null);
    setDrawerCategoryPickerOpen(false);
    setDrawerOpen(true);
  }

  async function commitDrawer(
    incomeTxns: IncomeTransaction[],
    expenseTxns: ExpenseTransaction[],
    previousParsed: ParsedStatementData,
  ) {
    if (!token) return;
    const optimistic = recomputeClient(previousParsed, incomeTxns, expenseTxns);
    setStatement((prev) => prev ? { ...prev, parsedData: optimistic } : prev);
    setDrawerOpen(false);
    try {
      const res = await fetch(`/api/user/statements/${statementId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ action: "save_transactions", incomeTxns, expenseTxns }),
      });
      const json = await res.json().catch(() => ({}));
      if (res.ok && json.parsedData) {
        setStatement((prev) => prev ? { ...prev, parsedData: json.parsedData } : prev);
        setSavedToast(true);
        setTimeout(() => setSavedToast(false), 6000);
      } else if (!res.ok) {
        setStatement((prev) => prev ? { ...prev, parsedData: previousParsed } : prev);
      }
    } catch {
      setStatement((prev) => prev ? { ...prev, parsedData: previousParsed } : prev);
    } finally {
      setDrawerSaving(false);
    }
  }

  async function handleDrawerSave() {
    const p = statement?.parsedData;
    if (!p) return;
    const amt = parseFloat(drawerAmount);
    if (!drawerName.trim() || isNaN(amt) || amt <= 0) {
      setDrawerErr("Name and a positive amount are required.");
      return;
    }
    setDrawerSaving(true); setDrawerErr(null);

    let incomeTxns:  IncomeTransaction[]  = [...(p.income.transactions   ?? [])];
    let expenseTxns: ExpenseTransaction[] = [...(p.expenses.transactions ?? [])];

    const typeChanged = !drawerIsNew && drawerType !== drawerOriginalType;

    if (drawerType === "expense") {
      const tx: ExpenseTransaction = { merchant: drawerName.trim(), amount: amt, date: drawerDate || undefined, category: drawerCategory };
      if (drawerIsNew || typeChanged) {
        if (typeChanged) incomeTxns = incomeTxns.filter((_, i) => i !== drawerIdx);
        expenseTxns = [...expenseTxns, tx];
      } else {
        expenseTxns = expenseTxns.map((t, i) => i === drawerIdx ? { ...t, ...tx } : t);
      }
    } else {
      const tx: IncomeTransaction = { source: drawerName.trim(), amount: amt, date: drawerDate || undefined, category: drawerCategory };
      if (drawerIsNew || typeChanged) {
        if (typeChanged) expenseTxns = expenseTxns.filter((_, i) => i !== drawerIdx);
        incomeTxns = [...incomeTxns, tx];
      } else {
        incomeTxns = incomeTxns.map((t, i) => i === drawerIdx ? { ...t, ...tx } : t);
      }
    }

    await commitDrawer(incomeTxns, expenseTxns, p);
  }

  async function handleDrawerDelete() {
    const p = statement?.parsedData;
    if (!p || drawerIsNew) return;
    setDrawerSaving(true);

    const incomeTxns  = (p.income.transactions   ?? []).filter((_, i) => !(drawerType === "income"  && i === drawerIdx));
    const expenseTxns = (p.expenses.transactions ?? []).filter((_, i) => !(drawerType === "expense" && i === drawerIdx));

    await commitDrawer(incomeTxns, expenseTxns, p);
  }

  // ── render ────────────────────────────────────────────────────────────────

  const parsed = statement?.parsedData;
  const isNeedsReview = statement?.status === "needs_review";
  const isCompleted = statement?.status === "completed";
  const isProcessing = statement?.status === "processing";

  return (
    <div className="flex min-h-screen bg-gray-50">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-4 pt-4 pb-12 sm:px-6 sm:pt-8">

          {/* Back link */}
          <Link
            href={backHref}
            className="mb-5 inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 transition-colors"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
            {backLabel}
          </Link>

          {/* Loading */}
          {loading && (
            <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-5 py-8 text-sm text-gray-500 shadow-sm">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-gray-400 border-t-transparent" />
              Loading statement…
            </div>
          )}

          {/* Load error */}
          {!loading && loadError && (
            <div className="rounded-xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-700">
              {loadError}
            </div>
          )}

          {/* Processing */}
          {!loading && isProcessing && (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-6 text-center">
              <span className="mb-3 inline-block h-5 w-5 animate-spin rounded-full border-2 border-amber-500 border-t-transparent" />
              <p className="text-sm font-medium text-amber-800">Analyzing statement…</p>
              <p className="mt-1 text-xs text-amber-600">This usually takes under a minute. You can close this page.</p>
            </div>
          )}

          {/* Needs review — editable form */}
          {!loading && isNeedsReview && statement && (
            <div className="space-y-5">
              {/* Header */}
              <div>
                <h1 className="text-xl font-bold text-gray-900">Review statement</h1>
                <p className="mt-1 text-sm text-gray-500 font-mono truncate">{statement.fileName}</p>
              </div>

              {/* Error banner */}
              <div className="flex items-start gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3.5">
                <svg className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126z" />
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 15.75h.007v.008H12v-.008z" />
                </svg>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-amber-900">AI couldn't extract statement details</p>
                  <p className="mt-0.5 text-xs text-amber-700">
                    {statement.parseError ?? "The AI was unable to read this statement."}
                    {" "}Fill in the fields below to add it manually.
                  </p>
                </div>
              </div>

              {/* Review form */}
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm divide-y divide-gray-100">
                <div className="px-5 py-4">
                  <h2 className="text-sm font-semibold text-gray-700">Statement details</h2>
                  <p className="mt-0.5 text-xs text-gray-400">Fields in red couldn&apos;t be detected — please fill them in.</p>
                </div>

                <div className="px-5 py-5 space-y-5">
                  {/* Bank name */}
                  <ReviewField label="Bank / Institution" error={formErrors.bankName}>
                    <input
                      type="text"
                      value={form.bankName}
                      onChange={(e) => update({ bankName: e.target.value })}
                      placeholder="e.g. TD Bank, RBC, Chase"
                      className={`w-full rounded-lg border px-3 py-2 text-base text-gray-900 outline-none transition focus:ring-2 ${
                        formErrors.bankName
                          ? "border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-200"
                          : "border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-100"
                      }`}
                    />
                  </ReviewField>

                  {/* Account name */}
                  <ReviewField label="Account name (optional)">
                    <input
                      type="text"
                      value={form.accountName}
                      onChange={(e) => update({ accountName: e.target.value })}
                      placeholder="e.g. Everyday Chequing, Sapphire Reserve"
                      className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                    />
                  </ReviewField>

                  {/* Account type + Currency row */}
                  <div className="grid grid-cols-2 gap-4">
                    <ReviewField label="Account type">
                      <select
                        value={form.accountType}
                        onChange={(e) => update({ accountType: e.target.value })}
                        className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-base text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
                      >
                        {ACCOUNT_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    </ReviewField>

                    <ReviewField label="Currency" error={formErrors.currency}>
                      <select
                        value={form.currency}
                        onChange={(e) => update({ currency: e.target.value })}
                        className={`w-full rounded-lg border px-3 py-2 text-base text-gray-900 outline-none transition focus:ring-2 ${
                          formErrors.currency
                            ? "border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-200"
                            : "border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-100"
                        }`}
                      >
                        {SUPPORTED_CURRENCIES.map((c) => (
                          <option key={c.code} value={c.code}>{c.label}</option>
                        ))}
                      </select>
                    </ReviewField>
                  </div>

                  {/* Statement period + Closing balance row */}
                  <div className="grid grid-cols-2 gap-4">
                    <ReviewField label="Statement period" error={formErrors.yearMonth}>
                      <input
                        type="month"
                        value={form.yearMonth}
                        onChange={(e) => update({ yearMonth: e.target.value })}
                        className={`w-full rounded-lg border px-3 py-2 text-base text-gray-900 outline-none transition focus:ring-2 ${
                          formErrors.yearMonth
                            ? "border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-200"
                            : "border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-100"
                        }`}
                      />
                    </ReviewField>

                    <ReviewField label="Closing balance" error={formErrors.closingBalance}>
                      <div className="relative">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                          {form.currency || "$"}
                        </span>
                        <input
                          type="number"
                          step="0.01"
                          value={form.closingBalance}
                          onChange={(e) => update({ closingBalance: e.target.value })}
                          placeholder="0.00"
                          className={`w-full rounded-lg border py-2 pr-3 pl-10 text-base text-gray-900 outline-none transition focus:ring-2 ${
                            formErrors.closingBalance
                              ? "border-red-400 bg-red-50 focus:border-red-500 focus:ring-red-200"
                              : "border-gray-300 bg-white focus:border-blue-500 focus:ring-blue-100"
                          }`}
                        />
                      </div>
                      <p className="mt-1 text-[11px] text-gray-400">Use a negative number for credit card balances owed.</p>
                    </ReviewField>
                  </div>
                </div>

                {/* Save error */}
                {saveError && (
                  <div className="px-5 py-3 text-sm text-red-600 bg-red-50 border-t border-red-100">
                    {saveError}
                  </div>
                )}

                {/* Actions */}
                <div className="flex items-center justify-between gap-3 px-5 py-4">
                  <button
                    onClick={handleReparse}
                    disabled={reparsing || saving}
                    className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 transition"
                  >
                    {reparsing ? "Retrying…" : "↺ Retry AI parse"}
                  </button>
                  <button
                    onClick={handleSave}
                    disabled={saving || reparsing}
                    className="rounded-lg bg-blue-600 px-5 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50 transition"
                  >
                    {saving ? "Saving…" : "Save & complete"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Completed — read-only summary */}
          {!loading && isCompleted && statement && (
            <div className="space-y-5">
              {/* Header */}
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h1 className="text-xl font-bold text-gray-900">Statement details</h1>
                  <p className="mt-1 text-sm text-gray-500 font-mono truncate">{statement.fileName}</p>
                </div>
                <span className="mt-1 inline-flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-2.5 py-0.5 text-xs font-medium text-green-700">
                  <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                  Ingested
                </span>
              </div>

              {/* Key metrics */}
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {[
                  { label: "Bank", value: parsed?.bankName ?? "—" },
                  { label: "Period", value: fmtMonth(statement.yearMonth) },
                  { label: "Currency", value: parsed?.currency ?? "—" },
                  { label: "Balance", value: fmtCurrency(parsed?.netWorth, parsed?.currency) },
                ].map((item) => (
                  <div key={item.label} className="rounded-xl border border-gray-200 bg-white px-4 py-3.5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">{item.label}</p>
                    <p className="mt-1 text-sm font-bold text-gray-900 truncate">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Income / Expenses */}
              {(parsed?.income?.total !== undefined || parsed?.expenses?.total !== undefined) && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Income</p>
                    <p className="mt-1 text-xl font-bold text-green-700 tabular-nums">{fmtCurrency(parsed?.income?.total, parsed?.currency)}</p>
                    {(parsed?.income?.sources?.length ?? 0) > 0 && (
                      <ul className="mt-2 space-y-1">
                        {parsed!.income.sources.slice(0, 4).map((s, i) => (
                          <li key={i} className="flex items-center justify-between text-xs text-gray-500">
                            <span className="truncate">{s.description}</span>
                            <span className="ml-2 tabular-nums">{fmtCurrency(s.amount, parsed?.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white px-5 py-4 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wide text-gray-400">Expenses</p>
                    <p className="mt-1 text-xl font-bold text-red-600 tabular-nums">{fmtCurrency(parsed?.expenses?.total, parsed?.currency)}</p>
                    {(parsed?.expenses?.categories?.length ?? 0) > 0 && (
                      <ul className="mt-2 space-y-1">
                        {parsed!.expenses.categories.slice(0, 4).map((c, i) => (
                          <li key={i} className="flex items-center justify-between text-xs text-gray-500">
                            <span className="truncate">{c.name}</span>
                            <span className="ml-2 tabular-nums">{fmtCurrency(c.amount, parsed?.currency)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              )}

              {/* Income transactions */}
              {(parsed?.income?.transactions?.length ?? 0) > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                    <p className="text-sm font-semibold text-gray-700">
                      Income
                      <span className="ml-2 text-xs font-normal text-gray-400">{parsed!.income.transactions!.length}</span>
                    </p>
                    <button
                      onClick={() => openNew("income")}
                      className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      Add
                    </button>
                  </div>
                  <ul className="divide-y divide-gray-100">
                    {parsed!.income.transactions!.map((tx, i) => (
                      <li
                        key={i}
                        onClick={() => openEdit("income", i)}
                        className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-gray-50 transition"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-gray-800">{tx.source}</p>
                          <p className="text-xs text-gray-400">{tx.category ?? "Income"}{tx.date ? ` · ${fmtDate(tx.date)}` : ""}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <p className="tabular-nums text-sm font-medium text-green-700">{fmtCurrency(tx.amount, parsed?.currency)}</p>
                          <svg className="h-4 w-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Expense transactions */}
              <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
                  <p className="text-sm font-semibold text-gray-700">
                    Expenses
                    <span className="ml-2 text-xs font-normal text-gray-400">{parsed?.expenses?.transactions?.length ?? 0}</span>
                  </p>
                  <button
                    onClick={() => openNew("expense")}
                    className="flex items-center gap-1 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 transition"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                    </svg>
                    Add
                  </button>
                </div>
                {(parsed?.expenses?.transactions?.length ?? 0) > 0 ? (
                  <ul className="divide-y divide-gray-100">
                    {parsed!.expenses.transactions!.map((tx, i) => (
                      <li
                        key={i}
                        onClick={() => openEdit("expense", i)}
                        className="flex cursor-pointer items-center gap-3 px-5 py-2.5 hover:bg-gray-50 transition"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm text-gray-800">{tx.merchant}</p>
                          <p className="text-xs text-gray-400">{tx.category}{tx.date ? ` · ${fmtDate(tx.date)}` : ""}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          <p className="tabular-nums text-sm font-medium text-gray-700">{fmtCurrency(tx.amount, parsed?.currency)}</p>
                          <svg className="h-4 w-4 text-gray-300" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                          </svg>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="px-5 py-6 text-center text-sm text-gray-400">No expense transactions — tap Add to add one.</p>
                )}
              </div>

              {/* Upload date */}
              {statement.uploadedAt && (
                <p className="text-xs text-gray-400 text-center">
                  Uploaded {fmtDate(statement.uploadedAt)}
                </p>
              )}
            </div>
          )}

        </div>
      </main>

      {/* ── Save confirmation toast ───────────────────────────────────────── */}
      {savedToast && (
        <div className="fixed bottom-6 left-1/2 z-50 -translate-x-1/2">
          <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3 shadow-lg">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-green-100">
              <svg className="h-3.5 w-3.5 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
              </svg>
            </span>
            <div className="text-sm">
              <span className="font-medium text-gray-900">Saved.</span>
              <span className="ml-1 text-gray-500">Insights will update on your next page load.</span>
            </div>
            <button
              onClick={() => setSavedToast(false)}
              className="shrink-0 text-gray-300 hover:text-gray-500 transition"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* ── Transaction edit drawer ────────────────────────────────────────── */}
      {drawerOpen && (
        <div className="fixed inset-0 z-50 flex">
          {/* Backdrop */}
          <div className="flex-1 bg-black/30" onClick={() => { if (!drawerSaving) setDrawerOpen(false); }} />

          {/* Panel */}
          <div className="flex w-80 flex-col bg-white shadow-2xl sm:w-96">

            {/* Header */}
            <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
              <h2 className="text-sm font-semibold text-gray-900">
                {drawerIsNew ? "Add transaction" : "Edit transaction"}
              </h2>
              <button
                onClick={() => setDrawerOpen(false)}
                disabled={drawerSaving}
                className="rounded p-1 text-gray-400 hover:text-gray-700 disabled:opacity-40 transition"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Fields */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

              {/* Type */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Type</label>
                <select
                  value={drawerType}
                  onChange={(e) => {
                    setDrawerType(e.target.value as "expense" | "income");
                    setDrawerCategory("Other");
                    setDrawerCategoryPickerOpen(false);
                  }}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                >
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                </select>
              </div>

              {/* Merchant / Source */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  {drawerType === "expense" ? "Merchant" : "Source"}
                </label>
                <input
                  value={drawerName}
                  onChange={(e) => setDrawerName(e.target.value)}
                  placeholder={drawerType === "expense" ? "e.g. Amazon, Tim Hortons" : "e.g. MAM Pay, CRA"}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                />
              </div>

              {/* Amount */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Amount</label>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-gray-400">
                    {parsed?.currency ?? "$"}
                  </span>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={drawerAmount}
                    onChange={(e) => setDrawerAmount(e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-3 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                  />
                </div>
              </div>

              {/* Date */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Date</label>
                <input
                  type="date"
                  value={drawerDate}
                  onChange={(e) => setDrawerDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                />
              </div>

              {/* Category — expense: shared CategoryPicker; income: canonical income list */}
              <div>
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Category</label>
                {drawerType === "expense" ? (
                  <>
                    <button
                      ref={drawerCategoryBtnRef}
                      type="button"
                      onClick={() => setDrawerCategoryPickerOpen((o) => !o)}
                      disabled={drawerSaving}
                      className="flex w-full items-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none transition hover:bg-gray-50 focus:border-blue-500 focus:ring-2 focus:ring-blue-100 disabled:opacity-50"
                    >
                      <span
                        className="h-2 w-2 shrink-0 rounded-full"
                        style={{ backgroundColor: categoryColor(drawerCategory) }}
                      />
                      <span className="min-w-0 flex-1 truncate text-left">{drawerCategory}</span>
                      <svg className="h-4 w-4 shrink-0 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {drawerCategoryPickerOpen && (
                      <CategoryPicker
                        anchorRef={drawerCategoryBtnRef}
                        current={drawerCategory}
                        headerHint={null}
                        onSelect={(cat) => {
                          setDrawerCategoryPickerOpen(false);
                          if (cat === "Income - Salary") {
                            setDrawerType("income");
                            setDrawerCategory("Salary");
                          } else if (cat === "Income - Other") {
                            setDrawerType("income");
                            setDrawerCategory("Other");
                          } else {
                            setDrawerCategory(cat);
                          }
                        }}
                        onClose={() => setDrawerCategoryPickerOpen(false)}
                      />
                    )}
                  </>
                ) : (
                  <select
                    value={drawerCategory}
                    onChange={(e) => setDrawerCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 transition"
                  >
                    {incomeCategoryOptions(drawerCategory).map((c) => (
                      <option key={c} value={c}>{c}</option>
                    ))}
                  </select>
                )}
              </div>

              {drawerErr && <p className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600">{drawerErr}</p>}
            </div>

            {/* Actions */}
            <div className="space-y-2 border-t border-gray-100 px-5 py-4">
              <button
                onClick={handleDrawerSave}
                disabled={drawerSaving}
                className="w-full rounded-lg bg-gray-900 py-2.5 text-sm font-semibold text-white hover:bg-gray-700 disabled:opacity-50 transition"
              >
                {drawerSaving ? "Saving…" : drawerIsNew ? "Add transaction" : "Save changes"}
              </button>
              {!drawerIsNew && (
                <button
                  onClick={handleDrawerDelete}
                  disabled={drawerSaving}
                  className="w-full rounded-lg border border-red-200 py-2 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50 transition"
                >
                  Delete transaction
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
