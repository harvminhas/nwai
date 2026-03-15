"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { UserStatementSummary, ManualLiability, LiabilityCategory } from "@/lib/types";

// ── constants ─────────────────────────────────────────────────────────────────

const CATEGORY_META: Record<LiabilityCategory, { label: string; color: string; barColor: string }> = {
  mortgage:       { label: "Mortgage",        color: "bg-red-50 text-red-700",       barColor: "bg-red-400" },
  auto_loan:      { label: "Auto Loan",        color: "bg-blue-50 text-blue-700",     barColor: "bg-blue-400" },
  student_loan:   { label: "Student Loan",     color: "bg-indigo-50 text-indigo-700", barColor: "bg-indigo-400" },
  personal_loan:  { label: "Personal Loan",    color: "bg-yellow-50 text-yellow-700", barColor: "bg-yellow-400" },
  credit_card:    { label: "Credit Card",      color: "bg-orange-50 text-orange-700", barColor: "bg-orange-400" },
  line_of_credit: { label: "Line of Credit",   color: "bg-purple-50 text-purple-700", barColor: "bg-purple-400" },
  other:          { label: "Other",            color: "bg-gray-100 text-gray-600",    barColor: "bg-gray-400" },
};

const CATEGORY_ORDER: LiabilityCategory[] = [
  "mortgage", "auto_loan", "student_loan", "personal_loan", "credit_card", "line_of_credit", "other",
];

// Map statement accountType → LiabilityCategory
const ACCT_TYPE_TO_CAT: Record<string, LiabilityCategory> = {
  mortgage: "mortgage",
  loan: "personal_loan",
  credit: "credit_card",
};

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(v);
}

function accountSlug(s: UserStatementSummary) {
  const bank = (s.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = (s.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
}

// ── unified display type ──────────────────────────────────────────────────────

interface DisplayLiability {
  id: string;
  label: string;
  subLabel?: string;
  category: LiabilityCategory;
  balance: number;
  interestRate?: number;
  statementDate?: string;
  source: "manual" | "statement";
}

// ── modal form ────────────────────────────────────────────────────────────────

interface ModalProps {
  initial?: ManualLiability | null;
  onSave: (data: Omit<ManualLiability, "id" | "updatedAt">) => Promise<void>;
  onClose: () => void;
  saving: boolean;
}

function LiabilityModal({ initial, onSave, onClose, saving }: ModalProps) {
  const [label, setLabel]         = useState(initial?.label ?? "");
  const [category, setCategory]   = useState<LiabilityCategory>(initial?.category ?? "auto_loan");
  const [balance, setBalance]     = useState(initial?.balance?.toString() ?? "");
  const [rate, setRate]           = useState(initial?.interestRate?.toString() ?? "");
  const [err, setErr]             = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const bal = parseFloat(balance);
    if (!label.trim()) { setErr("Name is required."); return; }
    if (isNaN(bal) || bal < 0) { setErr("Enter a valid balance."); return; }
    setErr(null);
    const rateNum = rate !== "" ? parseFloat(rate) : undefined;
    await onSave({ label: label.trim(), category, balance: bal, interestRate: isNaN(rateNum!) ? undefined : rateNum });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
        <div className="flex items-center justify-between border-b border-gray-100 px-6 py-4">
          <h2 className="font-semibold text-gray-900">{initial ? "Edit liability" : "Add liability"}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4 px-6 py-5">
          {err && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{err}</p>}

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Type</label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value as LiabilityCategory)}
              className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
            >
              {CATEGORY_ORDER.map((cat) => (
                <option key={cat} value={cat}>{CATEGORY_META[cat].label}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-xs font-medium text-gray-600">Name / lender</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={category === "auto_loan" ? "e.g. Honda Civic – TD Auto" : "e.g. RBC Mortgage"}
              className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Outstanding balance ($)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={balance}
                onChange={(e) => setBalance(e.target.value)}
                placeholder="0"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-600">Interest rate (%, optional)</label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={rate}
                onChange={(e) => setRate(e.target.value)}
                placeholder="e.g. 6.5"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-60"
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function LiabilitiesPage() {
  const router = useRouter();

  const [idToken, setIdToken]               = useState<string | null>(null);
  const [manualLibs, setManualLibs]         = useState<ManualLiability[]>([]);
  const [displayLibs, setDisplayLibs]       = useState<DisplayLiability[]>([]);
  const [yearMonth, setYearMonth]           = useState<string | null>(null);
  const [loading, setLoading]               = useState(true);
  const [error, setError]                   = useState<string | null>(null);

  // modal state
  const [modalOpen, setModalOpen]           = useState(false);
  const [editing, setEditing]               = useState<ManualLiability | null>(null);
  const [saving, setSaving]                 = useState(false);
  const [deletingId, setDeletingId]         = useState<string | null>(null);

  // ── data loading ────────────────────────────────────────────────────────────

  const loadData = useCallback(async (token: string) => {
    setLoading(true); setError(null);
    try {
      const [sRes, cRes, mRes] = await Promise.all([
        fetch("/api/user/statements",             { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${token}` } }),
        fetch("/api/user/liabilities",             { headers: { Authorization: `Bearer ${token}` } }),
      ]);
      const sJson = await sRes.json().catch(() => ({}));
      const cJson = cRes.ok ? await cRes.json().catch(() => ({})) : {};
      const mJson = await mRes.json().catch(() => ({}));

      setYearMonth(cJson.yearMonth ?? null);
      const manual: ManualLiability[] = mJson.liabilities ?? [];
      setManualLibs(manual);

      // Statement-derived liabilities
      const stmts: UserStatementSummary[] = (sJson.statements ?? []).filter(
        (s: UserStatementSummary) => s.status === "completed" && !s.superseded
      );
      const latestBySlug = new Map<string, UserStatementSummary>();
      for (const s of stmts) {
        const slug = accountSlug(s);
        const existing = latestBySlug.get(slug);
        if (!existing || (s.statementDate ?? s.uploadedAt) > (existing.statementDate ?? existing.uploadedAt)) {
          latestBySlug.set(slug, s);
        }
      }
      const DEBT_TYPES = new Set(["credit", "mortgage", "loan"]);
      const fromStatements: DisplayLiability[] = Array.from(latestBySlug.values())
        .filter((s) => DEBT_TYPES.has(s.accountType ?? "") || (s.netWorth ?? 0) < 0)
        .map((s) => ({
          id: `stmt-${accountSlug(s)}`,
          label: s.accountName ?? s.bankName ?? "Account",
          subLabel: s.bankName,
          category: ACCT_TYPE_TO_CAT[s.accountType ?? ""] ?? "other",
          balance: Math.abs(s.netWorth ?? 0),
          statementDate: s.statementDate,
          source: "statement" as const,
        }));

      const fromManual: DisplayLiability[] = manual.map((m) => ({
        id: m.id,
        label: m.label,
        category: m.category,
        balance: m.balance,
        interestRate: m.interestRate,
        source: "manual" as const,
      }));

      const merged = [...fromStatements, ...fromManual].sort((a, b) => b.balance - a.balance);
      setDisplayLibs(merged);
    } catch {
      setError("Failed to load liabilities");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      const token = await user.getIdToken();
      setIdToken(token);
      loadData(token);
    });
  }, [router, loadData]);

  // ── CRUD ────────────────────────────────────────────────────────────────────

  async function handleSave(data: Omit<ManualLiability, "id" | "updatedAt">) {
    if (!idToken) return;
    setSaving(true);
    try {
      if (editing) {
        await fetch(`/api/user/liabilities/${editing.id}`, {
          method: "PUT",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      } else {
        await fetch("/api/user/liabilities", {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
          body: JSON.stringify(data),
        });
      }
      setModalOpen(false);
      setEditing(null);
      await loadData(idToken);
    } catch {
      /* keep modal open on error */
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    if (!idToken || !confirm("Delete this liability?")) return;
    setDeletingId(id);
    try {
      await fetch(`/api/user/liabilities/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${idToken}` },
      });
      await loadData(idToken);
    } finally {
      setDeletingId(null);
    }
  }

  // ── derived display ─────────────────────────────────────────────────────────

  const total = displayLibs.reduce((s, l) => s + l.balance, 0);

  const monthStr = yearMonth
    ? new Date(parseInt(yearMonth.slice(0, 4)), parseInt(yearMonth.slice(5, 7)) - 1, 1)
        .toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;

  const byCategory = new Map<LiabilityCategory, DisplayLiability[]>();
  for (const l of displayLibs) {
    if (!byCategory.has(l.category)) byCategory.set(l.category, []);
    byCategory.get(l.category)!.push(l);
  }

  // ── render ──────────────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-3xl text-gray-900">Liabilities</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {total > 0 && <>{fmt(total)} total</>}
            {monthStr && <> · {monthStr}</>}
          </p>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="flex shrink-0 items-center gap-1.5 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          Add liability
        </button>
      </div>

      {error && <p className="mb-4 rounded-lg bg-red-50 px-4 py-2 text-sm text-red-600">{error}</p>}

      {/* Empty state */}
      {!error && displayLibs.length === 0 && (
        <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-12 text-center">
          <p className="text-sm text-gray-500">No liabilities yet.</p>
          <p className="mt-1 text-xs text-gray-400">
            Add manually or upload a mortgage, loan, or credit card statement.
          </p>
          <div className="mt-4 flex justify-center gap-3">
            <button
              onClick={() => { setEditing(null); setModalOpen(true); }}
              className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700"
            >
              Add manually
            </button>
            <Link href="/upload" className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">
              Upload statement
            </Link>
          </div>
        </div>
      )}

      {displayLibs.length > 0 && (
        <div className="space-y-6">
          {/* Total overview card */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Total Owed</p>
            <p className="mt-2 font-bold text-3xl text-gray-900">{fmt(total)}</p>
            <div className="mt-4 space-y-2">
              {displayLibs.map((l) => {
                const meta = CATEGORY_META[l.category];
                return (
                  <div key={l.id}>
                    <div className="flex items-center justify-between text-xs text-gray-500 mb-0.5">
                      <span className="flex items-center gap-1.5">
                        {l.label}
                        {l.source === "manual" && (
                          <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-400">manual</span>
                        )}
                      </span>
                      <span className="tabular-nums">
                        {fmt(l.balance)} · {total > 0 ? Math.round((l.balance / total) * 100) : 0}%
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div
                        className={`h-full rounded-full ${meta.barColor}`}
                        style={{ width: `${total > 0 ? Math.min((l.balance / total) * 100, 100) : 0}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Grouped by category */}
          {CATEGORY_ORDER.filter((cat) => byCategory.has(cat)).map((cat) => {
            const group = byCategory.get(cat)!;
            const groupTotal = group.reduce((s, l) => s + l.balance, 0);
            const meta = CATEGORY_META[cat];
            return (
              <div key={cat}>
                <div className="mb-2 flex items-center gap-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">{meta.label}</p>
                  <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${meta.color}`}>{fmt(groupTotal)}</span>
                </div>
                <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white shadow-sm">
                  {group.map((l) => (
                    <div key={l.id} className="flex items-center justify-between px-5 py-4">
                      <div className="min-w-0">
                        <p className="font-medium text-sm text-gray-800 truncate">
                          {l.label}
                          {l.subLabel && l.subLabel !== l.label && (
                            <span className="ml-1 font-normal text-gray-400">— {l.subLabel}</span>
                          )}
                        </p>
                        <p className="text-xs text-gray-400">
                          {l.statementDate
                            ? `as of ${new Date(l.statementDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`
                            : l.interestRate != null
                              ? `${l.interestRate}% interest rate`
                              : "manually added"}
                        </p>
                      </div>
                      <div className="ml-4 flex shrink-0 items-center gap-3">
                        <p className="font-semibold text-sm text-gray-900 tabular-nums">{fmt(l.balance)}</p>
                        {l.source === "manual" && (
                          <div className="flex items-center gap-1">
                            <button
                              onClick={() => {
                                const m = manualLibs.find((x) => x.id === l.id);
                                if (m) { setEditing(m); setModalOpen(true); }
                              }}
                              className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600"
                              title="Edit"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => handleDelete(l.id)}
                              disabled={deletingId === l.id}
                              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-40"
                              title="Delete"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                              </svg>
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modalOpen && (
        <LiabilityModal
          initial={editing}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null); }}
          saving={saving}
        />
      )}
    </div>
  );
}
