"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import NetWorthChart from "@/components/NetWorthChart";
import SubscriptionsCard from "@/components/SubscriptionsCard";
import InsightsSection from "@/components/InsightsSection";
import type { ParsedStatementData, ManualAsset, InvestmentHolding, Subscription, ExpenseTransaction, IncomeTransaction } from "@/lib/types";
import { buildAccountSlug, getAccountSlug } from "@/lib/accountSlug";
import CsvImportPanel from "@/components/CsvImportPanel";
import type { PaymentFrequency } from "@/app/api/user/account-rates/route";
import { CategoryPicker, categoryColor } from "@/app/account/spending/shared";
import { useProfileRefresh } from "@/contexts/ProfileRefreshContext";
import CashflowHeatmap from "@/components/CashflowHeatmap";
import AccountSwitcher from "@/components/AccountSwitcher";
import { debtGroup } from "@/lib/debtsSummary";
import { accountGroup } from "@/lib/assetsSummary";
import { formatLastTransactionDate } from "@/lib/formatLastTransactionDate";
import { MerchantDrawer, useMerchantDrawer } from "@/app/account/spending/MerchantDrawer";
import { merchantSlug } from "@/lib/applyRules";

// ── constants ─────────────────────────────────────────────────────────────────

const PAYMENT_FREQ_OPTIONS: { value: PaymentFrequency; label: string; perYear: number }[] = [
  { value: "weekly",       label: "Weekly",       perYear: 52 },
  { value: "biweekly",     label: "Bi-weekly",    perYear: 26 },
  { value: "semi-monthly", label: "Semi-monthly", perYear: 24 },
  { value: "monthly",      label: "Monthly",      perYear: 12 },
];

const DEBT_GROUP_LABEL: Record<string, string> = {
  mortgage: "Mortgage",
  credit_card: "Credit Cards",
  loc: "Line of Credit",
  other: "Other Loans",
};

const ASSET_GROUP_LABEL: Record<string, string> = {
  cash: "Cash",
  investments: "Investments",
  registered: "Registered",
  property: "Property",
  other: "Other Assets",
};
const TYPE_LABEL: Record<string, string> = {
  checking: "Checking", savings: "Savings", credit: "Credit Card",
  mortgage: "Mortgage", investment: "Investment", loan: "Loan", other: "Other",
};
const TYPE_COLOR: Record<string, string> = {
  checking: "bg-blue-100 text-blue-700", savings: "bg-green-100 text-green-700",
  credit: "bg-orange-100 text-orange-700", mortgage: "bg-red-100 text-red-700",
  investment: "bg-purple-100 text-purple-700", loan: "bg-yellow-100 text-yellow-700",
  other: "bg-gray-100 text-gray-600",
};
const DEBT_TYPES = new Set(["mortgage", "loan", "credit"]);

// ── helpers ───────────────────────────────────────────────────────────────────

function monthLabel(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleDateString("en-US", { month: "long", year: "numeric" });
}
function shortMonth(yearMonth: string): string {
  const [y, m] = yearMonth.split("-");
  if (!m) return yearMonth;
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}
import { fmt, getCurrencySymbol, CURRENCY_SYMBOL } from "@/lib/currencyUtils";
function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
/** Derive the accountKey (used by account-rates API) from parsedData. */
function toAccountKey(parsed: ParsedStatementData): string {
  return getAccountSlug(parsed);
}

// ── types ─────────────────────────────────────────────────────────────────────

interface StatementHistoryEntry {
  yearMonth: string;
  netWorth: number;
  uploadedAt: string;
  statementId: string;
  isCarryForward: boolean;
  interestRate: number | null;
  source?: "pdf" | "csv";
  isManualSnapshot?: boolean;
  snapshotId?: string;
  note?: string;
}

interface RateHistoryEntry {
  rate: number;
  source: "user" | "ai";
  changedAt: string;
  note: string | null;
}

// ── Holdings card (investment accounts) ──────────────────────────────────────

const HOLDING_TYPE_LABEL: Record<string, string> = {
  stock:       "Stock",
  etf:         "ETF",
  mutual_fund: "Mutual Fund",
  bond:        "Bond",
  gic:         "GIC",
  cash:        "Cash",
  other:       "Other",
};
const HOLDING_TYPE_COLOR: Record<string, string> = {
  stock:       "bg-blue-100 text-blue-700",
  etf:         "bg-indigo-100 text-indigo-700",
  mutual_fund: "bg-purple-100 text-purple-700",
  bond:        "bg-green-100 text-green-700",
  gic:         "bg-teal-100 text-teal-700",
  cash:        "bg-gray-100 text-gray-500",
  other:       "bg-gray-100 text-gray-500",
};

function HoldingsCard({ holdings, totalValue }: { holdings: InvestmentHolding[]; totalValue: number }) {
  const [expanded, setExpanded] = useState(false);
  const PREVIEW = 6;
  const sorted  = [...holdings].sort((a, b) => b.value - a.value);
  const visible = expanded ? sorted : sorted.slice(0, PREVIEW);
  const hasMore = sorted.length > PREVIEW;

  const fmt$ = (n: number) =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: "USD",
      minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

  // Aggregate by type for the mini summary bar
  const byType = holdings.reduce<Record<string, number>>((acc, h) => {
    acc[h.type] = (acc[h.type] ?? 0) + h.value;
    return acc;
  }, {});
  const typeOrder: string[] = ["stock", "etf", "mutual_fund", "bond", "gic", "cash", "other"];
  const barSegments = typeOrder
    .filter((t) => byType[t])
    .map((t) => ({ type: t, value: byType[t], pct: totalValue > 0 ? (byType[t] / totalValue) * 100 : 0 }));

  return (
    <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
      <div className="px-5 pt-4 pb-3 border-b border-gray-100">
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Holdings</p>

        {/* Stacked composition bar */}
        {barSegments.length > 0 && (
          <div className="mb-3">
            <div className="flex h-2.5 w-full rounded-full overflow-hidden gap-px">
              {barSegments.map((seg) => (
                <div
                  key={seg.type}
                  style={{ width: `${seg.pct}%` }}
                  className={`h-full ${HOLDING_TYPE_COLOR[seg.type]?.split(" ")[0] ?? "bg-gray-200"}`}
                  title={`${HOLDING_TYPE_LABEL[seg.type]}: ${fmt$(seg.value)} (${seg.pct.toFixed(1)}%)`}
                />
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
              {barSegments.map((seg) => (
                <span key={seg.type} className="flex items-center gap-1 text-[11px] text-gray-500">
                  <span className={`h-2 w-2 rounded-sm inline-block ${HOLDING_TYPE_COLOR[seg.type]?.split(" ")[0] ?? "bg-gray-200"}`} />
                  {HOLDING_TYPE_LABEL[seg.type]} {seg.pct.toFixed(0)}%
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Holdings list */}
      <div className="divide-y divide-gray-50">
        {visible.map((h, i) => {
          const pct = h.percentOfPortfolio ?? (totalValue > 0 ? (h.value / totalValue) * 100 : 0);
          return (
            <div key={i} className="flex items-center gap-3 px-5 py-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-gray-900 truncate">{h.name}</p>
                  {h.symbol && (
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-mono font-semibold text-gray-600">
                      {h.symbol}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${HOLDING_TYPE_COLOR[h.type] ?? HOLDING_TYPE_COLOR.other}`}>
                    {HOLDING_TYPE_LABEL[h.type] ?? h.type}
                  </span>
                  {h.units !== undefined && (
                    <span className="text-xs text-gray-400">{h.units.toLocaleString()} units</span>
                  )}
                </div>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-sm font-semibold tabular-nums text-gray-900">{fmt$(h.value)}</p>
                <p className="text-[11px] text-gray-400 mt-0.5">{pct.toFixed(1)}%</p>
              </div>
            </div>
          );
        })}
      </div>

      {hasMore && (
        <button
          onClick={() => setExpanded((v) => !v)}
          className="w-full border-t border-gray-100 px-5 py-2.5 text-xs font-medium text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition text-center"
        >
          {expanded ? "Show less ↑" : `Show all ${sorted.length} holdings ↓`}
        </button>
      )}
    </div>
  );
}

// ── APR inline editor ────────────────────────────────────────────────────────

interface AprEditorProps {
  accountKey: string;
  currentRate: number | null;
  extractedRate: number | null;
  token: string;
  onSaved: (rate: number | null) => void;
}
function AprEditor({ accountKey, currentRate, extractedRate, token, onSaved }: AprEditorProps) {
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(currentRate !== null ? String(currentRate) : "");
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Keep local value in sync if parent rate changes (e.g. after reload)
  useEffect(() => {
    if (!editing) setValue(currentRate !== null ? String(currentRate) : "");
  }, [currentRate, editing]);

  useEffect(() => {
    if (editing) setTimeout(() => inputRef.current?.focus(), 50);
  }, [editing]);

  async function save() {
    const parsed = parseFloat(value.replace(/[^0-9.]/g, ""));
    if (value.trim() !== "" && (isNaN(parsed) || parsed <= 0 || parsed > 100)) {
      setErr("Enter a rate between 0.01 and 100"); return;
    }
    setSaving(true); setErr(null);
    const rate = value.trim() === "" ? null : parsed;
    try {
      const res = await fetch("/api/user/account-rates", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountKey, rate }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? "Save failed");
      }
      onSaved(rate);
      setEditing(false);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save");
    } finally { setSaving(false); }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative">
          <input
            ref={inputRef}
            type="text" inputMode="decimal"
            value={value} onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") setEditing(false); }}
            placeholder={extractedRate !== null ? String(extractedRate) : "e.g. 3.9"}
            className="w-24 rounded-lg border border-purple-300 px-2.5 py-1.5 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
          />
          <span className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
        </div>
        <button onClick={save} disabled={saving}
          className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 disabled:opacity-50">
          {saving ? "Saving…" : "Save"}
        </button>
        <button onClick={() => { setEditing(false); setErr(null); }}
          className="text-xs text-gray-400 hover:text-gray-600">Cancel</button>
        {err && <p className="w-full text-xs text-red-500">{err}</p>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <span className="text-2xl font-bold text-gray-900">
        {currentRate !== null ? `${currentRate}%` : "—"}
      </span>
      <button onClick={() => setEditing(true)}
        className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-500 hover:border-purple-300 hover:text-purple-600 transition">
        Edit
      </button>
    </div>
  );
}

// ── FlowSections — collapsible Outflow + Incoming ──────────────────────────

function FlowSections({
  outflowRows,
  outflowTotal,
  incomeRows,
  incomeTotal,
  currency,
  catColor,
  hasOutflow,
  hasIncoming,
  collapsedRows,
  subscriptions,
  expenseTransactions,
  incomeTransactions,
  onMerchantClick,
}: {
  outflowRows: { name: string; amount: number; pct: number }[];
  outflowTotal: number;
  incomeRows: { label: string; amount: number }[];
  incomeTotal: number;
  currency?: string;
  catColor: (name: string) => string;
  hasOutflow: boolean;
  hasIncoming: boolean;
  collapsedRows: number;
  subscriptions: Subscription[];
  expenseTransactions?: ExpenseTransaction[];
  incomeTransactions?: IncomeTransaction[];
  onMerchantClick: (merchant: string) => void;
}) {
  const [outflowExpanded, setOutflowExpanded] = useState(false);
  const [incomingExpanded, setIncomingExpanded] = useState(false);
  const [expandedCategories, setExpandedCategories] = useState<Set<string>>(new Set());

  const visibleOutflow = outflowExpanded ? outflowRows : outflowRows.slice(0, collapsedRows);
  const hiddenOutflow = outflowRows.length - collapsedRows;

  const visibleIncome = incomingExpanded ? incomeRows : incomeRows.slice(0, collapsedRows);
  const hiddenIncome = incomeRows.length - collapsedRows;

  // Group expense transactions by category
  const txnsByCategory = useMemo(() => {
    if (!expenseTransactions) return new Map<string, ExpenseTransaction[]>();
    const map = new Map<string, ExpenseTransaction[]>();
    for (const txn of expenseTransactions) {
      const cat = txn.category || "Other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(txn);
    }
    // Sort transactions within each category by date (newest first)
    map.forEach((txns) => {
      txns.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      });
    });
    return map;
  }, [expenseTransactions]);

  // Group income transactions by source
  const txnsBySource = useMemo(() => {
    if (!incomeTransactions) return new Map<string, IncomeTransaction[]>();
    const map = new Map<string, IncomeTransaction[]>();
    // Use the same normalization logic as incomeRows
    const DEPOSIT_RE = [
      /e[-\s]?transfer/i, /\bdeposit\b/i, /\bGC\s/i, /\bCRA\b/i,
      /\bCANADA\b/i, /\bGST\b/i, /\bOAS\b/i, /\bCPP\b/i,
      /\bEI\b/i, /\bCERB\b/i, /\bINTERACT?\b/i,
    ];
    const normalizeIncLabel = (d: string) => {
      if (!d.trim()) return "Cash / Deposit";
      if (DEPOSIT_RE.some((re) => re.test(d))) return "Cash / Deposit";
      return d.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
    };
    
    for (const txn of incomeTransactions) {
      const src = normalizeIncLabel(txn.source);
      if (!map.has(src)) map.set(src, []);
      map.get(src)!.push(txn);
    }
    // Sort transactions within each source by date (newest first)
    map.forEach((txns) => {
      txns.sort((a, b) => {
        if (!a.date && !b.date) return 0;
        if (!a.date) return 1;
        if (!b.date) return -1;
        return b.date.localeCompare(a.date);
      });
    });
    return map;
  }, [incomeTransactions]);

  const toggleCategory = (name: string) => {
    const newExpanded = new Set(expandedCategories);
    if (newExpanded.has(name)) {
      newExpanded.delete(name);
    } else {
      newExpanded.add(name);
    }
    setExpandedCategories(newExpanded);
  };

  return (
    <div className={`mt-4 grid items-start gap-3 ${hasOutflow && hasIncoming ? "sm:grid-cols-2" : ""}`}>

      {/* ── Outflow ───────────────────────────────────────────────────── */}
      {hasOutflow && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Outflow</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums">{fmt(outflowTotal, currency)}</p>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {visibleOutflow.map((cat) => {
              const categoryTxns = txnsByCategory.get(cat.name) ?? [];
              const isExpanded = expandedCategories.has(cat.name);
              const hasTxns = categoryTxns.length > 0;
              
              return (
                <div key={cat.name}>
                  <div 
                    className={`flex items-center gap-3 px-5 py-3 ${hasTxns ? "cursor-pointer hover:bg-gray-50/80" : ""}`}
                    onClick={() => hasTxns && toggleCategory(cat.name)}
                  >
                    <div className="w-1.5 h-1.5 rounded-full shrink-0 mt-0.5">
                      <span className={`block w-1.5 h-1.5 rounded-full ${catColor(cat.name)}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-baseline gap-2 mb-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-sm text-gray-700 truncate">{cat.name}</span>
                          {hasTxns && (
                            <span className="shrink-0 text-[10px] text-gray-400">
                              {categoryTxns.length} {isExpanded ? "↑" : "→"}
                            </span>
                          )}
                        </div>
                        <span className="text-sm font-semibold text-gray-900 tabular-nums shrink-0">
                          {fmt(cat.amount, currency)}
                          <span className="ml-1.5 text-[11px] font-normal text-gray-400">{cat.pct}%</span>
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                        <div className={`h-full rounded-full ${catColor(cat.name)}`} style={{ width: `${Math.min(cat.pct, 100)}%` }} />
                      </div>
                    </div>
                  </div>
                  
                  {/* Expanded transactions */}
                  {isExpanded && hasTxns && (
                    <div className="bg-gray-50/60 px-5 py-2 space-y-1.5 border-t border-gray-100">
                      {categoryTxns.map((txn, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 text-xs py-1.5 px-3 bg-white rounded border border-gray-100">
                          <div className="flex-1 min-w-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onMerchantClick(txn.merchant);
                              }}
                              className="text-left text-gray-900 font-medium truncate hover:text-purple-600 transition"
                            >
                              {txn.merchant}
                            </button>
                            {txn.date && (
                              <p className="text-gray-400 text-[10px] mt-0.5">{fmtDate(txn.date)}</p>
                            )}
                          </div>
                          <span className="text-gray-900 font-semibold tabular-nums shrink-0">
                            {fmt(txn.amount, currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {outflowRows.length > collapsedRows && (
            <button
              onClick={() => setOutflowExpanded(!outflowExpanded)}
              className="w-full px-5 py-3 text-xs font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 transition border-t border-gray-100 text-left"
            >
              {outflowExpanded
                ? "Show less"
                : `+ ${hiddenOutflow} more categor${hiddenOutflow === 1 ? "y" : "ies"}`}
            </button>
          )}
        </div>
      )}

      {/* ── Incoming ──────────────────────────────────────────────────── */}
      {hasIncoming && (
        <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400">Incoming</p>
              <p className="text-xl font-bold text-gray-900 tabular-nums">{fmt(incomeTotal, currency)}</p>
            </div>
          </div>
          <div className="divide-y divide-gray-50">
            {visibleIncome.map((src) => {
              const sourceTxns = txnsBySource.get(src.label) ?? [];
              const isExpanded = expandedCategories.has(src.label);
              const hasTxns = sourceTxns.length > 0;
              
              return (
                <div key={src.label}>
                  <div 
                    className={`flex items-center justify-between px-5 py-3 ${hasTxns ? "cursor-pointer hover:bg-gray-50/80" : ""}`}
                    onClick={() => hasTxns && toggleCategory(src.label)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="block w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                      <span className="text-sm text-gray-700 truncate">{src.label}</span>
                      {hasTxns && (
                        <span className="shrink-0 text-[10px] text-gray-400">
                          {sourceTxns.length} {isExpanded ? "↑" : "→"}
                        </span>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-gray-900 tabular-nums shrink-0 ml-4">
                      {fmt(src.amount, currency)}
                    </span>
                  </div>
                  
                  {/* Expanded transactions */}
                  {isExpanded && hasTxns && (
                    <div className="bg-green-50/30 px-5 py-2 space-y-1.5 border-t border-gray-100">
                      {sourceTxns.map((txn, i) => (
                        <div key={i} className="flex items-center justify-between gap-3 text-xs py-1.5 px-3 bg-white rounded border border-green-100">
                          <div className="flex-1 min-w-0">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onMerchantClick(txn.source);
                              }}
                              className="text-left text-gray-900 font-medium truncate hover:text-purple-600 transition"
                            >
                              {txn.source}
                            </button>
                            {txn.date && (
                              <p className="text-gray-400 text-[10px] mt-0.5">{fmtDate(txn.date)}</p>
                            )}
                          </div>
                          <span className="text-green-700 font-semibold tabular-nums shrink-0">
                            +{fmt(txn.amount, currency)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {incomeRows.length > collapsedRows && (
            <button
              onClick={() => setIncomingExpanded(!incomingExpanded)}
              className="w-full px-5 py-3 text-xs font-medium text-purple-600 hover:text-purple-700 hover:bg-purple-50 transition border-t border-gray-100 text-left"
            >
              {incomingExpanded
                ? "Show less"
                : `+ ${hiddenIncome} more source${hiddenIncome === 1 ? "" : "s"}`}
            </button>
          )}
        </div>
      )}

      {/* ── Subscriptions ─────────────────────────────────────────────── */}
      {subscriptions.length > 0 && (
        <div className={hasOutflow && hasIncoming ? "sm:col-span-2" : ""}>
          <SubscriptionsCard 
            subscriptions={subscriptions}
            onMerchantClick={onMerchantClick}
          />
        </div>
      )}
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export default function AccountDetailPage() {
  const router = useRouter();
  const params = useParams<{ slug: string }>();
  const slug = params.slug;
  const searchParams = useSearchParams();

  const [data, setData]                   = useState<ParsedStatementData | null>(null);
  const [previousMonth, setPreviousMonth] = useState<{ netWorth: number; assets: number; debts: number } | null>(null);
  const [lastTransactionDate, setLastTransactionDate] = useState<string | undefined>(undefined);
  const [yearMonth, setYearMonth]         = useState<string | null>(null);
  const [history, setHistory]             = useState<{ yearMonth: string; netWorth: number; expensesTotal?: number; isEstimate?: boolean }[]>([]);
  const [manualAssets, setManualAssets]   = useState<ManualAsset[]>([]);
  const [stmtHistory, setStmtHistory]     = useState<StatementHistoryEntry[]>([]);
  const [baselineMonth, setBaselineMonth] = useState<string | null>(null);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState<string | null>(null);
  const [statementCount, setStatementCount] = useState(0);
  const [idToken, setIdToken]             = useState<string | null>(null);
  const [deletingId, setDeletingId]       = useState<string | null>(null);
  const [reparsingId, setReparsingId]     = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "transactions" | "history">("overview");
  
  // Merchant drawer state
  const { drawerSlug, drawerOpen, openDrawer, closeDrawer } = useMerchantDrawer();
  const [drawerMerchantName, setDrawerMerchantName] = useState<string | null>(null);
  
  const handleOpenMerchantDrawer = (merchantName: string) => {
    setDrawerMerchantName(merchantName);
    openDrawer(merchantSlug(merchantName));
  };

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t === "overview" || t === "transactions" || t === "history") {
      setActiveTab(t);
    }
  }, [searchParams]);

  /** For statement detail "back" link when opened from this account page. */
  const statementDetailReturnQs = useMemo(
    () => `returnTo=${encodeURIComponent(`/account/accounts/${slug}?tab=${activeTab}`)}`,
    [slug, activeTab],
  );

  // Transactions section state
  const [txMonth, setTxMonth]         = useState<string | null>(null);
  const [txData, setTxData]           = useState<ParsedStatementData["expenses"] | null>(null);
  const [txIncomeData, setTxIncomeData] = useState<ParsedStatementData["income"] | null>(null);
  const [txSubTab, setTxSubTab]       = useState<"expenses" | "income">("expenses");
  const [txPayments, setTxPayments]   = useState<number>(0);
  const [txLoading, setTxLoading]     = useState(false);
  const [openPicker, setOpenPicker]   = useState<number | null>(null);
  const pickerBtnRefs                 = useRef<Map<number, HTMLButtonElement>>(new Map());

  // APR / frequency state
  const [effectiveRate, setEffectiveRate]       = useState<number | null>(null);
  const [extractedRate, setExtractedRate]       = useState<number | null>(null);
  const [accountKey, setAccountKey]             = useState<string>("");
  const [rateHistory, setRateHistory]           = useState<RateHistoryEntry[]>([]);
  const [showRateHistory, setShowRateHistory]     = useState(false);
  const [showAllStatements, setShowAllStatements] = useState(false);
  const [paymentFrequency, setPaymentFrequency] = useState<PaymentFrequency>("monthly");
  const [savingFreq, setSavingFreq]             = useState(false);

  // FX rates from the financial profile cache (currency → homeCurrency rate)
  const [fxRates, setFxRates] = useState<Record<string, number>>({});
  const [homeCurrency, setHomeCurrency] = useState<string>("USD");

  // Cash flow heatmap data
  const [cashflowDays, setCashflowDays] = useState<import("@/app/api/user/spending/account-cashflow/route").DayStat[] | null>(null);
  const [cashflowMonth, setCashflowMonth] = useState<string>("");

  // Currency override modal state
  const [showCurrencyModal, setShowCurrencyModal] = useState(false);
  const [selectedCurrency, setSelectedCurrency]   = useState<string>("CAD");
  const [savingCurrency, setSavingCurrency]       = useState(false);

  // Balance snapshot state
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const [uploadingPdf, setUploadingPdf] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  /** Inline delete confirmation for History tab (same pattern as Manage uploads). */
  const [historyDeleteConfirmId, setHistoryDeleteConfirmId] = useState<string | null>(null);

  const loadCashflow = useCallback((token: string, month: string) => {
    const qs = `account=${encodeURIComponent(slug)}${month ? `&month=${encodeURIComponent(month)}` : ""}`;
    fetch(`/api/user/spending/account-cashflow?${qs}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(cf => { if (cf?.days) { setCashflowDays(cf.days); setCashflowMonth(cf.month ?? month); } })
      .catch(() => { /* silent */ });
  }, [slug]);

  const loadAccountData = useCallback(async (token: string) => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(
        `/api/user/statements/consolidated?account=${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok) { setError(json.error || "Failed to load account"); return; }
      setData(json.data ?? null);
      setStatementCount(json.count ?? 0);
      setPreviousMonth(json.previousMonth ?? null);
      setYearMonth(json.yearMonth ?? null);
      setManualAssets(Array.isArray(json.manualAssets) ? json.manualAssets : []);
      setTxMonth(json.yearMonth ?? null);
      setTxData((json.data as ParsedStatementData | null)?.expenses ?? null);
      setTxIncomeData((json.data as ParsedStatementData | null)?.income ?? null);
      setTxPayments(json.paymentsMade ?? 0);
      setLastTransactionDate(json.lastTransactionDate);

      const acctHistory: StatementHistoryEntry[] = json.accountStatementHistory?.[slug] ?? [];
      setStmtHistory(acctHistory);

      // The API now returns this account's own latest statement month, so the transactions
      // and the header always agree. Only fall back to the newest real month when the API
      // handed back a month this account has no real statement for (carry-forward only).
      const realForAccount = acctHistory
        .filter(e => !e.isCarryForward && !e.isManualSnapshot)
        .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
      const apiMonthHasReal = realForAccount.some(e => e.yearMonth === json.yearMonth);
      if (!apiMonthHasReal && realForAccount.length > 0) {
        const latestReal = realForAccount[0].yearMonth;
        setTxMonth(latestReal);
        loadCashflow(token, latestReal);
        // Reload that month so the balance, KPI cards and transaction list all match.
        setTxLoading(true);
        try {
          const mres = await fetch(
            `/api/user/statements/consolidated?account=${encodeURIComponent(slug)}&month=${encodeURIComponent(latestReal)}`,
            { headers: { Authorization: `Bearer ${token}` } }
          );
          const mjson = await mres.json().catch(() => ({}));
          if (mres.ok && mjson.data) {
            setData(mjson.data as ParsedStatementData);
            if (mjson.previousMonth !== undefined) setPreviousMonth(mjson.previousMonth);
            if (mjson.yearMonth) setYearMonth(mjson.yearMonth);
            setTxData((mjson.data as ParsedStatementData | null)?.expenses ?? null);
            setTxIncomeData((mjson.data as ParsedStatementData | null)?.income ?? null);
            setTxPayments(mjson.paymentsMade ?? 0);
          }
        } finally { setTxLoading(false); }
      } else if (json.yearMonth) {
        setTxMonth(json.yearMonth);
        loadCashflow(token, json.yearMonth);
      }

      const monthMap = new Map<string, { yearMonth: string; netWorth: number; isEstimate: boolean; priority: number }>();
      for (const e of acctHistory) {
        const isBackfill = e.note === "Estimated (backfilled)";
        // Priority: carry-forward=0 (worst), backfill/snapshot=1, real upload=2 (best)
        const priority = e.isCarryForward ? 0 : (isBackfill || e.isManualSnapshot) ? 1 : 2;
        const existing = monthMap.get(e.yearMonth);
        if (!existing || priority > existing.priority) {
          monthMap.set(e.yearMonth, {
            yearMonth: e.yearMonth,
            netWorth: e.netWorth,
            isEstimate: e.isCarryForward || isBackfill,
            priority,
          });
        }
      }
      const chartHistory = Array.from(monthMap.values())
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
        .map(({ yearMonth, netWorth, isEstimate }) => ({ yearMonth, netWorth, isEstimate }));
      setHistory(chartHistory);

      setFxRates(typeof json.fxRates === "object" && json.fxRates !== null ? json.fxRates : {});
      if (json.homeCurrency) setHomeCurrency(json.homeCurrency);

      const saved = localStorage.getItem(`baseline-${slug}`);
      if (saved) setBaselineMonth(saved);

      // Load APR for this account.
      // The URL slug IS the accountKey (both built with buildAccountSlug), so we
      // can always use it — even when parsedData.bankName is missing.
      const parsed = json.data as ParsedStatementData | null;
      const key = parsed?.bankName
        ? toAccountKey(parsed)
        : slug; // fall back to URL slug which equals the accountKey
      setAccountKey(key);

      const ratesRes = await fetch("/api/user/account-rates", { headers: { Authorization: `Bearer ${token}` } });
      const ratesJson = await ratesRes.json().catch(() => ({}));
      const entry = (ratesJson.rates ?? []).find(
        (r: { accountKey: string }) => r.accountKey === key
      );
      if (entry) {
        setEffectiveRate(entry.effectiveRate ?? null);
        setExtractedRate(entry.extractedRate ?? null);
        if (entry.paymentFrequency) setPaymentFrequency(entry.paymentFrequency as PaymentFrequency);
      } else {
        const fromStmt = typeof parsed?.interestRate === "number" ? parsed.interestRate : null;
        setExtractedRate(fromStmt);
        setEffectiveRate(fromStmt);
      }

      const histRes = await fetch(
        `/api/user/account-rates/history?accountKey=${encodeURIComponent(key)}`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      const histJson = await histRes.json().catch(() => ({}));
      setRateHistory(histJson.history ?? []);

    } catch { setError("Failed to load account"); }
    finally { setLoading(false); }
  }, [slug]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const token = await user.getIdToken();
      setIdToken(token);
      await loadAccountData(token);
    });
  }, [router, slug, loadAccountData]);

  async function handleViewFile(statementId: string) {
    if (!idToken) return;
    try {
      const res = await fetch(`/api/user/statements/${statementId}/file`, {
        headers: { Authorization: `Bearer ${idToken}` },
      });
      if (!res.ok) { alert("Could not load the original document."); return; }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      window.open(url, "_blank", "noopener");
      // revoke after a short delay to allow the new tab to load
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      alert("Could not load the original document.");
    }
  }

  async function handleDelete(statementId: string) {
    if (!idToken) return;
    setDeletingId(statementId);
    try {
      await fetch(`/api/user/statements/${statementId}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${idToken}` },
      });
      const res = await fetch(
        `/api/user/statements/consolidated?account=${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      const json = await res.json().catch(() => ({}));
      setData(json.data ?? null);
      setStatementCount(json.count ?? 0);
      const acctHistory: StatementHistoryEntry[] = json.accountStatementHistory?.[slug] ?? [];
      setStmtHistory(acctHistory);
      setHistory((Array.isArray(json.history) ? json.history : []).map(
        (h: { yearMonth: string; netWorth: number; expensesTotal?: number; isEstimate?: boolean }) => ({
          ...h,
          isEstimate: h.isEstimate ??
            (acctHistory.find((e) => e.yearMonth === h.yearMonth)?.isCarryForward ?? false),
        })
      ));
    } finally {
      setDeletingId(null);
      setHistoryDeleteConfirmId(null);
    }
  }

  function showToast(msg: string, ok: boolean) {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 4000);
  }

  const { requestProfileRefresh } = useProfileRefresh();

  // ── transaction recategorization ──────────────────────────────────────────

  async function handleCategoryChange(txnIndex: number, newCategory: string) {
    const txn = txns[txnIndex];
    if (!txn || !idToken) return;
    setOpenPicker(null);
    // Optimistic update
    setTxData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        transactions: (prev.transactions ?? []).map((t, i) =>
          i === txnIndex ? { ...t, category: newCategory } : t
        ),
      };
    });
    try {
      const res = await fetch("/api/user/category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: txn.merchant, category: newCategory }),
      });
      if (res.ok) {
        showToast(`Rule saved: "${txn.merchant}" → ${newCategory}`, true);
        requestProfileRefresh();
      } else {
        showToast("Failed to save rule", false);
      }
    } catch {
      showToast("Failed to save rule", false);
    }
  }

  async function handleReparse(statementId: string) {
    if (!idToken || reparsingId !== null) return;  // block if any parse already running
    setReparsingId(statementId);
    try {
      const res = await fetch("/api/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ statementId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        showToast(j.error || "Re-parse failed", false);
        return;
      }
      const newSlug: string | undefined = j.accountSlug;
      if (newSlug && newSlug !== slug) {
        router.push(`/account/accounts/${encodeURIComponent(newSlug)}`);
      } else {
        showToast("Re-parsed successfully — categories updated", true);
        if (idToken) loadAccountData(idToken);
      }
    } finally {
      setReparsingId(null);
    }
  }

  async function handleTxMonthSelect(ym: string) {
    if (!idToken || ym === txMonth) return;
    setTxMonth(ym);
    setTxLoading(true);
    try {
      const res = await fetch(
        `/api/user/statements/consolidated?account=${encodeURIComponent(slug)}&month=${ym}`,
        { headers: { Authorization: `Bearer ${idToken}` } }
      );
      const json = await res.json().catch(() => ({}));
      // Update all account state so KPI cards, equity, sub-accounts etc. reflect the selected month
      if (json.data) setData(json.data as ParsedStatementData);
      if (json.previousMonth !== undefined) setPreviousMonth(json.previousMonth);
      if (json.yearMonth) setYearMonth(json.yearMonth);
      setTxData((json.data as ParsedStatementData | null)?.expenses ?? null);
      setTxIncomeData((json.data as ParsedStatementData | null)?.income ?? null);
      setTxPayments(json.paymentsMade ?? 0);
      // Refresh heatmap for the newly selected month
      loadCashflow(idToken, ym);
    } finally {
      setTxLoading(false);
    }
  }

  async function handleFrequencyChange(freq: PaymentFrequency) {
    if (!idToken || !accountKey) return;
    setPaymentFrequency(freq);
    setSavingFreq(true);
    try {
      await fetch("/api/user/account-rates", {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountKey, paymentFrequency: freq }),
      });
    } finally { setSavingFreq(false); }
  }

  function handleSetBaseline(ym: string) {
    const newBaseline = baselineMonth === ym ? null : ym;
    setBaselineMonth(newBaseline);
    if (newBaseline) localStorage.setItem(`baseline-${slug}`, newBaseline);
    else localStorage.removeItem(`baseline-${slug}`);
  }


  async function saveCurrency(newCurrency: string) {
    if (!idToken) return;
    setSavingCurrency(true);
    try {
      const res = await fetch("/api/user/account-currencies", {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ accountSlug: slug, currency: newCurrency }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setShowCurrencyModal(false);
      showToast(`Currency set to ${newCurrency}. Rebuilding profile…`, true);
      await loadAccountData(idToken);
    } catch {
      showToast("Failed to save currency", false);
    } finally {
      setSavingCurrency(false);
    }
  }

  async function handlePdfUpload(file: File) {
    if (!idToken) return;
    setUploadingPdf(true);
    setUploadError(null);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const uploadRes = await fetch("/api/upload", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body: formData,
      });
      
      const uploadData = await uploadRes.json();
      if (!uploadRes.ok) {
        setUploadError(uploadData.error || "Upload failed");
        return;
      }
      
      const statementId = uploadData.id;
      if (!statementId) {
        setUploadError("Upload succeeded but no statement ID returned");
        return;
      }
      
      showToast("Statement uploaded, parsing...", true);
      
      // Trigger parse
      const parseRes = await fetch("/api/parse", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ statementId }),
      });
      
      const parseData = await parseRes.json();
      if (!parseRes.ok) {
        setUploadError(parseData.error || "Parse failed");
        return;
      }
      
      showToast("Statement parsed successfully!", true);
      await loadAccountData(idToken);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadingPdf(false);
    }
  }

  // Merge AI rate history from stmtHistory with user rate history
  const combinedRateHistory: (RateHistoryEntry & { label: string })[] = [
    // User manual changes
    ...rateHistory.map((r) => ({
      ...r,
      label: r.note ?? "User override",
    })),
    // AI extracted from each real statement
    ...stmtHistory
      .filter((e) => !e.isCarryForward && e.interestRate !== null)
      .map((e) => ({
        rate: e.interestRate!,
        source: "ai" as const,
        changedAt: e.uploadedAt || `${e.yearMonth}-01T00:00:00.000Z`,
        note: `Extracted from ${shortMonth(e.yearMonth)} statement`,
        label: shortMonth(e.yearMonth),
      })),
  ].sort((a, b) => b.changedAt.localeCompare(a.changedAt));

  const rawFilteredHistory = baselineMonth
    ? history.filter((h) => h.yearMonth >= baselineMonth)
    : history;

  const filteredHistory = rawFilteredHistory;

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error || !data || !yearMonth) return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <p className="text-gray-800">{error || "No data for this account."}</p>
        <Link href="/account/accounts" className="mt-4 inline-block text-purple-600 hover:underline">Back to accounts</Link>
      </div>
    </div>
  );

  const accountType      = data.accountType ?? "other";
  const isDebtAccount    = DEBT_TYPES.has(accountType);
  const isInvestment     = accountType === "investment";
  const currency         = (data as ParsedStatementData & { currency?: string }).currency ?? homeCurrency;
  const isForeignCurrency = currency.toUpperCase() !== homeCurrency.toUpperCase();
  const rawBalance       = data.netWorth ?? 0;
  // Live FX rate: account native currency → home currency (e.g. CAD→USD for a US-home user with a CAD account)
  const fxRate           = isForeignCurrency ? fxRates[currency.toUpperCase()] : undefined;
  const homeEquivalent   = fxRate != null ? rawBalance * fxRate : null;
  const hasActualIncome    = (data.income?.total ?? 0) > 0;
  const hasActualExpenses  = (data.expenses?.total ?? 0) > 0;
  const hasActualSubs      = (data.subscriptions?.length ?? 0) > 0;

  // Show Income card only when there is real income data
  const hasIncome = !isInvestment && hasActualIncome;
  // Show Expenses card only when there are real expense transactions
  // Investment accounts contain fund transactions the parser surfaces as "expenses" — exclude entirely.
  const hasSpending = !isInvestment && (hasActualExpenses || hasActualSubs);
  // Savings Rate is only meaningful on a checking account with both income and expenses

  // "Spent this month" = all expense transactions on this account, matching ExpensesCard below.
  const spentThisMonth = data.expenses?.total ?? 0;
  const spentThisMonthCount = data.expenses?.transactions?.length ?? 0;
  const linkedAssets      = manualAssets.filter((a) => a.linkedAccountSlug === slug);
  const linkedAssetsTotal = linkedAssets.reduce((s, a) => s + a.value, 0);
  // When sub-accounts exist, sum their balances as the authoritative total —
  // the AI-computed top-level netWorth can diverge from the sub-account sum.
  const subAccountsSum = data.subAccounts && data.subAccounts.length > 0
    ? data.subAccounts.reduce((s, a) => s + (a.balance ?? 0), 0)
    : null;
  // Use data.debts (raw debt balance, never inflated by linked assets) rather than
  // Math.abs(data.netWorth) which becomes the equity value once an asset is linked.
  const outstandingDebt = subAccountsSum ?? data.debts ?? Math.abs(data.netWorth ?? 0);

  const correctedHistory = filteredHistory;
  const equity            = linkedAssetsTotal - outstandingDebt;
  // previousMonth.debts is already a positive number — no Math.abs needed.
  const prevDebt          = previousMonth ? (previousMonth.debts ?? Math.abs(previousMonth.netWorth)) : null;
  const paidDown          = prevDebt !== null ? prevDebt - outstandingDebt : null;
  const carryForwardCount = stmtHistory.filter((e) => e.isCarryForward).length;
  const backfillCount     = stmtHistory.filter((e) => e.note === "Estimated (backfilled)").length;

  const freqConfig = PAYMENT_FREQ_OPTIONS.find((f) => f.value === paymentFrequency) ?? PAYMENT_FREQ_OPTIONS[3];
  const perPaymentInterest = effectiveRate !== null && outstandingDebt > 0
    ? (outstandingDebt * effectiveRate) / 100 / freqConfig.perYear
    : null;

  // Months with real uploaded statements — used for pills + transaction tab
  const realMonths = stmtHistory
    .filter((e) => !e.isCarryForward && !e.isManualSnapshot)
    .sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  const txns = txData?.transactions ?? [];
  const incomeTxns = txIncomeData?.transactions ?? [];

  // Calculate missing statement months (gaps in coverage)
  const missingMonths: string[] = [];
  if (realMonths.length > 1) {
    const sortedAsc = [...realMonths].sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    for (let i = 0; i < sortedAsc.length - 1; i++) {
      const current = sortedAsc[i].yearMonth;
      const next = sortedAsc[i + 1].yearMonth;
      let [y, m] = current.split("-").map(Number);
      while (true) {
        m++;
        if (m > 12) { m = 1; y++; }
        const candidate = `${y}-${String(m).padStart(2, "0")}`;
        if (candidate >= next) break;
        missingMonths.push(candidate);
      }
    }
  }

  // Balance headline for the top-left of the chart - the same pattern as Spending.
  // Uses this account's own month history, not the profile-wide previous month.
  const headerYm = txMonth ?? yearMonth;
  const headerPoint = headerYm ? [...history].reverse().find((h) => h.yearMonth === headerYm) : null;
  const headerBalance = isDebtAccount
    ? Math.abs(headerPoint?.netWorth ?? data.netWorth ?? 0)
    : (headerPoint?.netWorth ?? data.netWorth ?? 0);
  const prevPoint = headerYm ? [...history].reverse().find((h) => h.yearMonth < headerYm) : null;
  const prevBalance = prevPoint ? (isDebtAccount ? Math.abs(prevPoint.netWorth) : prevPoint.netWorth) : null;
  const headerDelta = prevBalance !== null ? headerBalance - prevBalance : null;
  const headerDeltaGood = headerDelta !== null ? (isDebtAccount ? headerDelta < 0 : headerDelta > 0) : null;
  const prevLabel = prevPoint ? shortMonth(prevPoint.yearMonth) : "previous month";

  const formattedLastTxDate = formatLastTransactionDate(lastTransactionDate);

  const balanceHeader = (
    <div className="mb-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-widest text-gray-400 mb-1">
            {isDebtAccount ? "Outstanding balance" : isInvestment ? "Portfolio value" : "Balance"}
          </p>
          <div className="flex flex-wrap items-baseline gap-2">
            <p className="text-3xl font-bold text-gray-900 tabular-nums tracking-tight break-all">{fmt(headerBalance, currency)}</p>
            {headerYm && <span className="text-xs text-gray-500">{monthLabel(headerYm)}</span>}
          </div>
          {headerDelta === null ? (
            <p className="mt-1 text-xs text-gray-400">First month tracked</p>
          ) : headerDelta === 0 ? (
            <p className="mt-1 text-xs text-gray-400">No change vs {prevLabel}</p>
          ) : (
            <p className={`mt-1 text-xs font-medium ${headerDeltaGood ? "text-green-600" : "text-red-500"}`}>
              {headerDelta > 0 ? "\u2191" : "\u2193"} {fmt(Math.abs(headerDelta), currency)} vs {prevLabel}
              {isDebtAccount ? (headerDelta < 0 ? " (paid down)" : " (more debt)") : ""}
            </p>
          )}
          {formattedLastTxDate && (
            <p className="mt-1 text-xs text-gray-400">{formattedLastTxDate}</p>
          )}
          {isForeignCurrency && homeEquivalent != null && fxRate != null && (
            <p className="mt-1 text-[10px] text-gray-400">1 {currency} = {fxRate.toFixed(4)} {homeCurrency}</p>
          )}
        </div>
        {!isInvestment && (hasActualIncome || hasActualExpenses) && (
          <div className="flex shrink-0 gap-6 text-right">
            {hasActualIncome && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">In</p>
                <p className="mt-0.5 text-sm font-bold text-green-600 tabular-nums">{fmt(data.income?.total ?? 0, currency)}</p>
              </div>
            )}
            {hasActualExpenses && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400">Out</p>
                <p className="mt-0.5 text-sm font-bold text-red-500 tabular-nums">{fmt(spentThisMonth, currency)}</p>
                {spentThisMonthCount > 0 && <p className="text-[10px] text-gray-400">{spentThisMonthCount} transactions</p>}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Toast notification */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg text-sm font-medium transition-all ${
          toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"
        }`}>
          <span>{toast.ok ? "✓" : "✕"}</span>
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Breadcrumb */}
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href={isDebtAccount ? "/account/liabilities?tab=accounts" : "/account/assets?tab=accounts"} className="hover:text-purple-600">
            {isDebtAccount ? "Debts" : "Assets"}
          </Link>
          <span>/</span>
          <Link href={isDebtAccount ? `/account/liabilities/category/${debtGroup(accountType, data.accountName)}` : `/account/assets/category/${accountGroup(accountType, data.accountName)}`} className="hover:text-purple-600">
            {isDebtAccount
              ? DEBT_GROUP_LABEL[debtGroup(accountType, data.accountName)]
              : ASSET_GROUP_LABEL[accountGroup(accountType, data.accountName)]}
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">{data.accountName ?? data.bankName ?? slug}</span>
        </div>
        <AccountSwitcher />
      </div>

      {/* Account header */}
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${TYPE_COLOR[accountType] ?? TYPE_COLOR.other}`}>
          {TYPE_LABEL[accountType] ?? accountType}
        </span>
        {data.bankName && <span className="text-sm text-gray-500">{data.bankName}</span>}
        {data.accountId && data.accountId !== "unknown" && <span className="text-sm text-gray-400">{data.accountId}</span>}
        {/* Currency badge — always shown, clickable to change */}
        <button
          onClick={() => { setSelectedCurrency(currency); setShowCurrencyModal(true); }}
          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold transition hover:ring-2 hover:ring-offset-1 ${
            isForeignCurrency
              ? "bg-amber-100 text-amber-700 hover:ring-amber-300"
              : "bg-gray-100 text-gray-500 hover:ring-gray-300"
          }`}
          title="Change account currency"
        >
          {currency}
        </button>
      </div>

      {/* Foreign currency banner */}
      {isForeignCurrency && (
        <div className="mt-3 mb-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
          <svg className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="text-xs text-amber-800 space-y-0.5">
            {fxRate && homeEquivalent !== null ? (
              <>
                <p>
                  Balance {fmt(rawBalance, currency)} = <strong>{fmt(homeEquivalent, homeCurrency)}</strong>{" "}
                  <span className="text-amber-600">(1 {currency} = {fxRate.toFixed(4)} {homeCurrency}, refreshed daily)</span>
                </p>
                <p className="text-amber-700">Your net worth already includes this account converted to {homeCurrency}.</p>
              </>
            ) : (
              <p>
                Balances are in <strong>{currency}</strong>. Net worth will be converted to CAD.
              </p>
            )}
          </div>
        </div>
      )}

      {/* Currency change modal */}
      {showCurrencyModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <h2 className="text-base font-semibold text-gray-900 mb-1">Set account currency</h2>
            <p className="text-sm text-gray-500 mb-4">
              Choose the currency this account is denominated in. Balances will be converted to CAD for net worth calculations using a daily exchange rate.
            </p>
            <div className="grid grid-cols-3 gap-2 mb-5">
              {["CAD", "USD", "EUR", "GBP", "AUD", "CHF"].map((c) => (
                <button
                  key={c}
                  onClick={() => setSelectedCurrency(c)}
                  className={`rounded-lg border py-2 text-sm font-semibold transition ${
                    selectedCurrency === c
                      ? "border-purple-500 bg-purple-50 text-purple-700"
                      : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  {c}
                </button>
              ))}
            </div>
            {selectedCurrency !== currency && (
              <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                Changing currency will rebuild your financial profile. Net worth and history will update within a few seconds.
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCurrencyModal(false)}
                className="rounded-lg border border-gray-200 px-4 py-2 text-sm text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => saveCurrency(selectedCurrency)}
                disabled={savingCurrency || selectedCurrency === currency}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition flex items-center gap-2"
              >
                {savingCurrency && <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-white border-t-transparent" />}
                {savingCurrency ? "Saving…" : "Confirm"}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Balance headline + the one line chart on this page, same pattern as Spending */}
      <div className="mt-4">
        {correctedHistory.length >= 2 ? (
          <NetWorthChart
            history={correctedHistory}
            isDebt={isDebtAccount}
            currency={currency}
            onPointSelect={handleTxMonthSelect}
            header={balanceHeader}
            showMonthDetail={false}
          />
        ) : (
          <div className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm sm:p-6">{balanceHeader}</div>
        )}
      </div>


      {/* Slim upload + missing months row */}
      {(missingMonths.length > 0 || true) && (
        <div className="mt-5 mb-3 flex items-center justify-between gap-3 text-xs">
          {missingMonths.length > 0 ? (
            <p className="text-amber-700">
              <span className="font-medium">Missing:</span> {missingMonths.slice(0, 3).map((ym) => shortMonth(ym)).join(", ")}
              {missingMonths.length > 3 && ` +${missingMonths.length - 3}`}
            </p>
          ) : <span />}
          <label className="cursor-pointer">
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              disabled={uploadingPdf}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handlePdfUpload(file);
                e.target.value = "";
              }}
            />
            <span className={`inline-block rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              uploadingPdf
                ? "border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed"
                : "border-gray-200 text-gray-600 hover:border-gray-300 hover:bg-gray-50"
            }`}>
              {uploadingPdf ? "Uploading..." : "+ Upload statement"}
            </span>
          </label>
        </div>
      )}

      {/* Tab bar */}
      <div className="mb-6 flex border-b border-gray-200">
        {([
          { id: "overview",     label: "Overview" },
          { id: "transactions", label: "Transactions", count: txns.length + incomeTxns.length },
          { id: "history",      label: "History", count: stmtHistory.length },
        ] as { id: string; label: string; count?: number }[]).map((tab) => (
          <button key={tab.id} onClick={() => setActiveTab(tab.id as "overview" | "transactions" | "history")}
            className={`relative mr-5 pb-3 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? "text-gray-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-gray-900 after:content-['']"
                : "text-gray-400 hover:text-gray-600"
            }`}>
            {tab.label}
            {tab.count !== undefined && tab.count > 0 && (
              <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">{tab.count}</span>
            )}
          </button>
        ))}
      </div>

      {activeTab === "overview" && <>

      {/* ── KPI cards ─────────────────────────────────────────────────────────── */}

      {/* Backfill estimated history banner */}
      {backfillCount > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <div className="flex-1 min-w-0 text-sm">
            <p className="font-medium text-blue-900">
              {backfillCount} month{backfillCount !== 1 ? "s" : ""} of estimated history
            </p>
            <p className="mt-0.5 text-blue-700">
              Shown as a dashed line on the chart. Based on the balance from your first uploaded statement.{" "}
              <Link href="/upload" className="font-medium underline hover:text-blue-900">
                Upload older statements
              </Link>{" "}
              to make it accurate.
            </p>
          </div>
        </div>
      )}

      {/* Upload error */}
      {uploadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
          {uploadError}
        </div>
      )}

      {/* Incomplete months banner */}
      {carryForwardCount > 0 && (
        <div className="mb-6 flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
          <svg className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
          <div className="text-sm">
            <p className="font-medium text-amber-800">{carryForwardCount} month{carryForwardCount !== 1 ? "s" : ""} estimated</p>
            <p className="mt-0.5 text-amber-700">
              Months marked <span className="font-medium">~estimated</span> use the most recent uploaded balance.
            </p>
          </div>
        </div>
      )}

      {/* ── Equity card for mortgage/loan ───────────────────────────────────── */}
      {isDebtAccount && linkedAssets.length > 0 && (
        <div className="mb-6 rounded-xl border border-purple-200 bg-purple-50 p-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-purple-500 mb-3">Equity breakdown</p>
          <div className="grid gap-3 sm:grid-cols-3">
            {linkedAssets.map((a) => (
              <div key={a.id} className="rounded-lg bg-white p-3 shadow-sm">
                <p className="text-xs text-gray-500 truncate">{a.label}</p>
                <p className="font-bold text-gray-900">{fmt(a.value, homeCurrency)}</p>
                <Link href={`/account/assets/${a.id}`} className="text-xs text-purple-500 hover:underline">Open</Link>
              </div>
            ))}
            <div className="rounded-lg bg-white p-3 shadow-sm">
              <p className="text-xs text-gray-500">Outstanding balance</p>
              <p className="font-bold text-red-600">−{fmt(outstandingDebt, currency)}</p>
            </div>
            <div className={`rounded-lg p-3 shadow-sm ${equity >= 0 ? "bg-green-50" : "bg-red-50"}`}>
              <p className="text-xs text-gray-500">Your equity</p>
              <p className={`font-bold text-lg ${equity >= 0 ? "text-green-700" : "text-red-600"}`}>{fmt(equity, homeCurrency)}</p>
            </div>
          </div>
        </div>
      )}


      {/* ── KPI cards ────────────────────────────────────────────────────────── */}
      {isDebtAccount ? (
        /* Debt-specific KPIs: Outstanding Balance | Paid Down | Interest Rate */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
          {/* Payments Made / Paid Down */}
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
              {txPayments > 0 ? "Payments Made" : paidDown !== null && paidDown > 0 ? "Principal Paid" : "Balance Change"}
            </p>
            <p className="mt-2 font-bold text-xl text-gray-900 break-all leading-tight md:text-2xl">
              {txPayments > 0
                ? fmt(txPayments, currency)
                : paidDown !== null
                  ? fmt(Math.abs(paidDown), currency)
                  : (data.expenses?.total ? fmt(data.expenses.total, currency) : "—")}
            </p>
            <p className="mt-1.5 text-xs text-gray-400">
              {txPayments > 0
                ? "total paid this period"
                : paidDown !== null && paidDown > 0
                  ? "principal reduction"
                  : "vs previous statement"}
            </p>
          </div>

          {/* Interest Rate — compact card with history popover */}
          {(isDebtAccount || accountType === "savings" || accountType === "investment") && idToken && accountKey && (
            <div className="relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <div className="flex items-start justify-between gap-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                  {isDebtAccount ? "Interest Rate (APR)" : "Return Rate (APY)"}
                </p>
                {combinedRateHistory.length > 0 && (
                  <button
                    onClick={() => setShowRateHistory((v) => !v)}
                    className="shrink-0 rounded-md border border-gray-200 px-1.5 py-0.5 text-[10px] text-gray-400 hover:border-purple-300 hover:text-purple-600 transition"
                  >
                    History
                  </button>
                )}
              </div>
              <AprEditor
                accountKey={accountKey}
                currentRate={effectiveRate}
                extractedRate={extractedRate}
                token={idToken}
                onSaved={(rate) => {
                  setEffectiveRate(rate ?? extractedRate);
                  fetch(`/api/user/account-rates/history?accountKey=${encodeURIComponent(accountKey)}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                  })
                    .then((r) => r.json())
                    .then((j) => setRateHistory(j.history ?? []))
                    .catch(() => {});
                }}
              />
              {perPaymentInterest !== null ? (
                <p className="mt-1.5 text-xs text-gray-400">≈ {fmt(perPaymentInterest, currency)} interest/{freqConfig.label.toLowerCase()}</p>
              ) : (
                <p className="mt-1.5 text-xs text-gray-400">
                  {effectiveRate !== null ? "User-set" : extractedRate !== null ? "From statement" : "Not set"}
                </p>
              )}

              {/* History popover */}
              {showRateHistory && combinedRateHistory.length > 0 && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setShowRateHistory(false)} />
                  <div className="absolute right-0 top-full mt-1 z-20 w-72 rounded-xl border border-gray-200 bg-white shadow-lg p-4">
                    <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Rate history</p>
                    <div className="space-y-2">
                      {combinedRateHistory.map((entry, i) => {
                        const prev = combinedRateHistory[i + 1];
                        const change = prev ? entry.rate - prev.rate : null;
                        return (
                          <div key={i} className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className={`h-1.5 w-1.5 shrink-0 rounded-full ${entry.source === "user" ? "bg-purple-400" : "bg-teal-400"}`} />
                              <span className="text-xs text-gray-500 truncate">
                                {entry.source === "user" ? "User override" : entry.note ?? "From statement"}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 shrink-0">
                              {change !== null && change !== 0 && (
                                <span className={`text-[10px] font-medium ${change > 0 ? "text-red-500" : "text-green-600"}`}>
                                  {change > 0 ? "↑" : "↓"}{Math.abs(change).toFixed(2)}%
                                </span>
                              )}
                              <span className="text-xs font-semibold text-gray-900">{entry.rate}%</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    <p className="mt-2 text-[10px] text-gray-400 flex items-center gap-3">
                      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-teal-400 inline-block" /> From statement</span>
                      <span className="flex items-center gap-1"><span className="h-1.5 w-1.5 rounded-full bg-purple-400 inline-block" /> User override</span>
                    </p>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      ) : isInvestment ? (
        /* Investment KPIs: contributions and return rate - value now lives on the chart */
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 mb-6">
          {/* Contributions this period (income = contributions/transfers in) */}
          {(data.income?.total ?? 0) > 0 && (
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Contributions</p>
              <p className="mt-2 font-bold text-xl text-gray-900 break-all leading-tight md:text-2xl">{fmt(data.income?.total ?? 0, currency)}</p>
              <p className="mt-1.5 text-xs text-gray-400">deposits &amp; transfers in</p>
            </div>
          )}

          {/* Return Rate (APY) */}
          {idToken && accountKey && (
            <div className="relative rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Return Rate (APY)</p>
              <AprEditor
                accountKey={accountKey}
                currentRate={effectiveRate}
                extractedRate={extractedRate}
                token={idToken}
                onSaved={(rate) => {
                  setEffectiveRate(rate ?? extractedRate);
                  fetch(`/api/user/account-rates/history?accountKey=${encodeURIComponent(accountKey)}`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                  })
                    .then((r) => r.json())
                    .then((j) => setRateHistory(j.history ?? []))
                    .catch(() => {});
                }}
              />
              <p className="mt-1.5 text-xs text-gray-400">
                {effectiveRate !== null ? "User-set" : extractedRate !== null ? "From statement" : "Not set"}
              </p>
            </div>
          )}
        </div>
      ) : null}

      {/* ── Payment frequency strip (debt accounts only) ─────────────────── */}
      {isDebtAccount && (
        <div className="mb-6 flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold uppercase tracking-wider text-gray-400 shrink-0">Payment frequency</span>
          <div className="flex gap-1.5 flex-wrap">
            {PAYMENT_FREQ_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => handleFrequencyChange(opt.value)}
                disabled={savingFreq}
                className={`rounded-full px-3 py-1 text-xs font-medium transition disabled:opacity-50 ${
                  paymentFrequency === opt.value
                    ? "bg-purple-600 text-white"
                    : "border border-gray-200 text-gray-500 hover:border-purple-300 hover:text-purple-600"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          {savingFreq && <span className="text-xs text-gray-400">Saving…</span>}
        </div>
      )}

      {/* Sub-account breakdown (e.g. HELOC revolving + mortgage term portions) */}
      {isDebtAccount && data.subAccounts && data.subAccounts.length > 0 && (
        <div className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
          <p className="px-5 pt-4 pb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Breakdown</p>
          <div className="divide-y divide-gray-100">
            {data.subAccounts.map((sub) => (
              <div key={sub.id} className="flex items-center justify-between px-5 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800">{sub.label}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    <span className="capitalize">{sub.type}</span>
                    {sub.apr != null ? ` · ${sub.apr}% APR` : ""}
                    {sub.maturityDate ? ` · matures ${new Date(sub.maturityDate + "T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}` : ""}
                  </p>
                </div>
                <div className="ml-4 text-right shrink-0">
                  <p className="text-sm font-semibold text-gray-900 tabular-nums">{fmt(sub.balance, currency)}</p>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {outstandingDebt > 0 ? `${Math.round((sub.balance / outstandingDebt) * 100)}% of total` : ""}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Investment holdings breakdown ────────────────────────────────── */}
      {isInvestment && (data.holdings ?? []).length > 0 && (
        <HoldingsCard holdings={data.holdings!} totalValue={data.netWorth ?? 0} />
      )}


      {/* ── Cash flow heatmap — checking/savings accounts ── */}
      {!isInvestment && !isDebtAccount && cashflowDays && (
        <div className="mt-4">
          <CashflowHeatmap days={cashflowDays} month={cashflowMonth} currency={currency} />
        </div>
      )}

      {/* ── Outflow + Incoming collapsible sections ─────────────────────── */}
      {(hasIncome || hasSpending || hasActualSubs) && (() => {
        const COLLAPSED_ROWS = 4;

        // ── Outflow helpers ────────────────────────────────────────────────
        const CAT_COLORS: Record<string, string> = {
          housing: "bg-blue-500", dining: "bg-orange-400", groceries: "bg-green-500",
          shopping: "bg-purple-500", transportation: "bg-yellow-500",
          entertainment: "bg-pink-500", subscriptions: "bg-indigo-500",
          healthcare: "bg-teal-500", fees: "bg-orange-400",
          debt: "bg-red-400", "installment servicing": "bg-red-300", "card servicing": "bg-red-600",
          "debt payments": "bg-red-400", "investments & savings": "bg-emerald-500",
          transfers: "bg-cyan-500", "transfers & payments": "bg-cyan-500",
          "cash & atm": "bg-red-400", other: "bg-gray-400",
        };
        const catColor = (name: string) => CAT_COLORS[name.toLowerCase()] ?? "bg-purple-500";

        const rawCats = data.expenses?.categories ?? [];
        const catByKey = new Map<string, { name: string; amount: number }>();
        for (const c of rawCats) {
          const k = c.name.trim().toUpperCase() || "OTHER";
          const ex = catByKey.get(k);
          if (ex) ex.amount += c.amount;
          else catByKey.set(k, { name: c.name.trim() || "Other", amount: c.amount });
        }
        const expTotal = data.expenses?.total ?? 0;
        const outflowRows = Array.from(catByKey.values())
          .sort((a, b) => b.amount - a.amount)
          .map((r) => ({ ...r, pct: expTotal > 0 ? Math.round((r.amount / expTotal) * 100) : 0 }));

        // ── Incoming helpers ───────────────────────────────────────────────
        const DEPOSIT_RE = [
          /e[-\s]?transfer/i, /\bdeposit\b/i, /\bGC\s/i, /\bCRA\b/i,
          /\bCANADA\b/i, /\bGST\b/i, /\bOAS\b/i, /\bCPP\b/i,
          /\bEI\b/i, /\bCERB\b/i, /\bINTERACT?\b/i,
        ];
        const normalizeIncLabel = (d: string) => {
          if (!d.trim()) return "Cash / Deposit";
          if (DEPOSIT_RE.some((re) => re.test(d))) return "Cash / Deposit";
          return d.replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
        };
        const srcByKey = new Map<string, { label: string; amount: number }>();
        for (const s of data.income?.sources ?? []) {
          const lbl = normalizeIncLabel(s.description);
          const ex = srcByKey.get(lbl);
          if (ex) ex.amount += s.amount;
          else srcByKey.set(lbl, { label: lbl, amount: s.amount });
        }
        const incomeRows = Array.from(srcByKey.values()).sort((a, b) => b.amount - a.amount);

        return (
          <FlowSections
            outflowRows={outflowRows}
            outflowTotal={expTotal}
            incomeRows={incomeRows}
            incomeTotal={data.income?.total ?? 0}
            currency={currency}
            catColor={catColor}
            hasOutflow={hasSpending}
            hasIncoming={hasIncome}
            collapsedRows={COLLAPSED_ROWS}
            subscriptions={hasActualSubs ? (data.subscriptions ?? []) : []}
            expenseTransactions={data.expenses?.transactions}
            incomeTransactions={data.income?.transactions}
            onMerchantClick={handleOpenMerchantDrawer}
          />
        );
      })()}

      <InsightsSection insights={data.insights ?? []} />

      </> /* end overview tab */}

      {/* ── HISTORY TAB ──────────────────────────────────────────────────── */}
      {activeTab === "history" && (
        <div className="space-y-4">

          <div className="flex items-center justify-between gap-3 flex-wrap">
            {stmtHistory.length > 0 && (
              <p className="text-sm text-gray-500">{stmtHistory.length} entr{stmtHistory.length !== 1 ? "ies" : "y"}</p>
            )}
            {baselineMonth && (
              <button onClick={() => handleSetBaseline(baselineMonth)} className="text-xs text-purple-600 hover:underline">
                Clear baseline
              </button>
            )}
          </div>
          {baselineMonth && (
            <p className="text-xs text-gray-400">
              Trend starts from <span className="font-medium text-gray-600">{shortMonth(baselineMonth)}</span>.
            </p>
          )}
          {stmtHistory.length > 0 ? (<>
          <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Month</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">Balance</th>
                  {isDebtAccount && (
                    <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400">APR</th>
                  )}
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Source</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-gray-400">Baseline</th>
                  <th className="px-4 py-3 text-right text-xs font-semibold uppercase tracking-wide text-gray-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {[...stmtHistory].reverse().map((entry) => {
                  const isBaseline    = baselineMonth === entry.yearMonth;
                  const beforeBaseline = baselineMonth != null && entry.yearMonth < baselineMonth;
                  // Determine if APR changed from previous row
                  const allReal = [...stmtHistory].filter((e) => !e.isCarryForward && !e.isManualSnapshot);
                  const prevReal = allReal[allReal.findIndex((e) => e.yearMonth === entry.yearMonth) + 1];
                  const rateChanged = entry.interestRate !== null && prevReal?.interestRate !== null &&
                    entry.interestRate !== prevReal?.interestRate;
                  const canOpenStmt =
                    !entry.isCarryForward && !!entry.statementId && !entry.isManualSnapshot;
                  const isStmtDeleteConfirm = historyDeleteConfirmId === entry.statementId;
                  return (
                    <tr
                      key={entry.isManualSnapshot ? `snap-${entry.snapshotId}` : entry.yearMonth}
                      onClick={
                        canOpenStmt
                          ? (e) => {
                              const t = e.target as HTMLElement;
                              if (t.closest("button, a")) return;
                              router.push(`/account/statements/${entry.statementId}?${statementDetailReturnQs}`);
                            }
                          : undefined
                      }
                      className={`transition ${beforeBaseline ? "opacity-40" : ""} ${entry.isManualSnapshot ? "bg-purple-50/30" : ""} ${reparsingId === entry.statementId ? "bg-yellow-50 opacity-60" : ""} ${canOpenStmt ? "cursor-pointer hover:bg-gray-50/80 group" : ""}`}
                    >
                      <td className="px-4 py-3 font-medium text-gray-800">{shortMonth(entry.yearMonth)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-900">
                        <span className={entry.isCarryForward ? "text-gray-400" : ""}>
                          {fmt(entry.netWorth, currency)}
                        </span>
                      </td>
                      {isDebtAccount && (
                        <td className="px-4 py-3 text-right">
                          {entry.interestRate !== null ? (
                            <span className={`text-sm tabular-nums ${rateChanged ? "font-semibold text-amber-600" : "text-gray-700"}`}>
                              {entry.interestRate}%
                              {rateChanged && <span className="ml-1 text-xs">↑</span>}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-300">—</span>
                          )}
                        </td>
                      )}
                      <td className="px-4 py-3">
                        {entry.isManualSnapshot ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-600">
                            ✎ manual
                          </span>
                        ) : entry.note === "Estimated (backfilled)" ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-xs font-medium text-blue-600">
                            ⟵ backfilled
                          </span>
                        ) : entry.isCarryForward ? (
                          <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-600">
                            ~ estimated
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-600">
                            ✓ uploaded
                          </span>
                        )}
                        {entry.note && entry.note !== "Estimated (backfilled)" && (
                          <span className="ml-1.5 text-xs text-gray-400 italic" title={entry.note}>"{entry.note}"</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {!entry.isManualSnapshot && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleSetBaseline(entry.yearMonth);
                            }}
                            className={`rounded-full px-2 py-0.5 text-xs font-medium transition ${
                              isBaseline ? "bg-purple-100 text-purple-700" : "text-gray-300 hover:bg-gray-100 hover:text-gray-500"
                            }`}
                          >
                            {isBaseline ? "● baseline" : "set baseline"}
                          </button>
                        )}
                      </td>
                      <td
                        className="px-4 py-3 text-right"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {!entry.isManualSnapshot && !entry.isCarryForward && entry.statementId ? (
                          <div className="flex items-center justify-end gap-1">
                            <div
                              className={`flex items-center gap-1 transition-opacity ${
                                isStmtDeleteConfirm ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                              }`}
                            >
                              {entry.source !== "csv" ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => handleViewFile(entry.statementId)}
                                    className="rounded px-2 py-0.5 text-xs font-medium text-purple-600 hover:bg-purple-50"
                                    title="Open original uploaded document"
                                  >
                                    View
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleReparse(entry.statementId)}
                                    disabled={reparsingId !== null || deletingId === entry.statementId}
                                    className="rounded px-2 py-0.5 text-xs font-medium text-blue-600 hover:bg-blue-50 disabled:opacity-40"
                                    title={
                                      reparsingId !== null && reparsingId !== entry.statementId
                                        ? "Another statement is being parsed — please wait"
                                        : "Re-extract data from the original PDF with latest AI logic"
                                    }
                                  >
                                    {reparsingId === entry.statementId
                                      ? "Parsing…"
                                      : "Re-parse"}
                                  </button>
                                </>
                              ) : (
                                <span className="text-[10px] rounded-full bg-teal-50 border border-teal-200 px-2 py-0.5 text-teal-600 font-medium">
                                  CSV
                                </span>
                              )}
                            </div>
                            {isStmtDeleteConfirm ? (
                              <div className="flex items-center gap-1.5">
                                <span className="text-xs text-gray-500">Remove?</span>
                                <button
                                  type="button"
                                  onClick={() => handleDelete(entry.statementId)}
                                  disabled={deletingId === entry.statementId || reparsingId === entry.statementId}
                                  className="rounded px-2 py-0.5 text-xs font-semibold bg-red-600 text-white hover:bg-red-700 disabled:opacity-50 transition"
                                >
                                  {deletingId === entry.statementId ? "…" : "Yes"}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setHistoryDeleteConfirmId(null)}
                                  className="text-xs text-gray-400 hover:text-gray-600"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setHistoryDeleteConfirmId(entry.statementId)}
                                className={`rounded p-1 text-gray-300 hover:text-red-400 hover:bg-red-50 transition ${isStmtDeleteConfirm ? "" : "opacity-0 group-hover:opacity-100"}`}
                                title="Remove"
                              >
                                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                              </button>
                            )}
                            <Link
                              href={`/account/statements/${entry.statementId}?${statementDetailReturnQs}`}
                              onClick={(e) => e.stopPropagation()}
                              className="shrink-0 rounded p-1 text-gray-300 hover:text-gray-500 transition"
                              title="Open statement"
                              aria-label="Open statement"
                            >
                              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                              </svg>
                            </Link>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-400">
            <span className="font-medium text-gray-500">Set baseline</span> to exclude older months from the trend chart.
          </p>
          </>) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-8 text-center">
            <p className="font-medium text-gray-900">No history yet</p>
            <p className="mt-1 text-sm text-gray-500">
              Import a CSV to backfill this account before the monthly PDF arrives, or record a balance by hand.
            </p>
          </div>
          )}
        </div>
      )}

      {/* ── TRANSACTIONS TAB ──────────────────────────────────────────────── */}
      {activeTab === "transactions" && (
        <div>
          {isInvestment && (
            <div className="mb-4 rounded-lg border border-blue-100 bg-blue-50 px-4 py-2.5">
              <p className="text-xs text-blue-700">
                <span className="font-semibold">Portfolio activity</span> — these are fund transactions (buys, sells, dividends, transfers), not personal expenses.
              </p>
            </div>
          )}
          {txPayments > 0 && (
            <div className="mb-4 rounded-lg bg-emerald-50 border border-emerald-100 px-4 py-2.5 flex items-center justify-between">
              <span className="text-xs font-medium text-emerald-800">Payments received</span>
              <span className="text-sm font-semibold text-emerald-900">{fmt(txPayments, currency)}</span>
            </div>
          )}

          {/* Expenses / Income sub-tabs — only shown when there are income transactions */}
          {incomeTxns.length > 0 && (
            <div className="mb-4 flex gap-1 rounded-lg bg-gray-100 p-1">
              <button
                onClick={() => setTxSubTab("expenses")}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  txSubTab === "expenses"
                    ? "bg-white text-gray-900 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Expenses{txns.length > 0 ? ` (${txns.length})` : ""}
              </button>
              <button
                onClick={() => setTxSubTab("income")}
                className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                  txSubTab === "income"
                    ? "bg-white text-emerald-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Income{incomeTxns.length > 0 ? ` (${incomeTxns.length})` : ""}
              </button>
            </div>
          )}

          {txLoading ? (
            <div className="flex items-center justify-center py-16">
              <div className="h-6 w-6 animate-spin rounded-full border-2 border-purple-600 border-t-transparent" />
            </div>
          ) : txSubTab === "income" ? (
            /* ── Income transactions list ──────────────────────────────────── */
            incomeTxns.length === 0 ? (
              <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-12 text-center">
                <p className="text-sm text-gray-400">No income recorded for {txMonth ? shortMonth(txMonth) : "this month"}.</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
                <div className="divide-y divide-emerald-50">
                  {incomeTxns.map((txn, i) => (
                    <div key={i} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <button
                          onClick={() => handleOpenMerchantDrawer(txn.source)}
                          className="truncate text-sm font-medium text-gray-900 hover:text-purple-600 transition text-left"
                        >
                          {txn.source}
                        </button>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          {txn.date && <span className="text-xs text-gray-400">{fmtDate(txn.date)}</span>}
                          {txn.category && (
                            <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700">{txn.category}</span>
                          )}
                        </div>
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-emerald-700">+{fmt(txn.amount, currency)}</p>
                    </div>
                  ))}
                </div>
                <div className="border-t border-emerald-100 bg-emerald-50 px-4 py-2.5 flex items-center justify-between">
                  <span className="text-xs text-emerald-600">{incomeTxns.length} transaction{incomeTxns.length !== 1 ? "s" : ""}</span>
                  <span className="text-xs font-semibold text-emerald-800">+{fmt(txIncomeData?.total ?? 0, currency)} total</span>
                </div>
              </div>
            )
          ) : txns.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 py-12 text-center">
              <p className="text-sm text-gray-400">No transactions for {txMonth ? shortMonth(txMonth) : "this month"}.</p>
              <p className="mt-1 text-xs text-gray-400">Upload a statement or select a different month above.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
              <div className="divide-y divide-gray-100">
                {txns.map((txn, i) => (
                  <div key={i} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <button
                        onClick={() => handleOpenMerchantDrawer(txn.merchant)}
                        className="truncate text-sm font-medium text-gray-900 hover:text-purple-600 transition text-left"
                      >
                        {txn.merchant}
                      </button>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {txn.date && <span className="text-xs text-gray-400">{fmtDate(txn.date)}</span>}
                        {txn.category && !isInvestment && (
                          <>
                            <button
                              ref={(el) => { if (el) pickerBtnRefs.current.set(i, el); else pickerBtnRefs.current.delete(i); }}
                              onClick={() => setOpenPicker(openPicker === i ? null : i)}
                              className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-[10px] font-medium text-gray-600 transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
                            >
                              <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(txn.category) }} />
                              {txn.category}
                              <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                              </svg>
                            </button>
                            {openPicker === i && pickerBtnRefs.current.has(i) && (
                              <CategoryPicker
                                anchorRef={{ current: pickerBtnRefs.current.get(i)! }}
                                current={txn.category}
                                onSelect={(cat) => handleCategoryChange(i, cat)}
                                onClose={() => setOpenPicker(null)}
                              />
                            )}
                          </>
                        )}
                        {txn.category && isInvestment && (
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-medium text-gray-500">{txn.category}</span>
                        )}
                        {txn.recurring && <span className="rounded-full bg-teal-50 px-2 py-0.5 text-[10px] font-medium text-teal-600">↻ {txn.recurring}</span>}
                      </div>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">{fmt(txn.amount, currency)}</p>
                  </div>
                ))}
              </div>
              <div className="border-t border-gray-100 bg-gray-50 px-4 py-2.5 flex items-center justify-between">
                <span className="text-xs text-gray-400">{txns.length} transaction{txns.length !== 1 ? "s" : ""}</span>
                <span className="text-xs font-semibold text-gray-700">{fmt(txData?.total ?? 0, currency)} total</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Merchant drawer */}
      <MerchantDrawer
        slug={drawerSlug}
        token={idToken}
        homeCurrency={homeCurrency}
        isOpen={drawerOpen}
        onClose={closeDrawer}
        fallbackDisplayName={drawerMerchantName ?? undefined}
      />

    </div>
  );
}
