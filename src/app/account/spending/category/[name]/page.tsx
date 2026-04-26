"use client";

import { useEffect, useState, useRef, useCallback, useMemo } from "react";
import Link from "next/link";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  ResponsiveContainer, BarChart, Bar, Cell, XAxis, YAxis,
  CartesianGrid, Tooltip, ReferenceLine,
} from "recharts";
import { merchantSlug } from "@/lib/applyRules";
import {
  categoryColor, CategoryPicker, RecurringIcon,
  type CashFrequency,
  getParentCategory,
} from "@/app/account/spending/shared";
import { fmt, getCurrencySymbol, formatCurrency } from "@/lib/currencyUtils";
import { PROFILE_REFRESHED_EVENT, useProfileRefresh } from "@/contexts/ProfileRefreshContext";
import { PARENTS_WITH_SUBTYPES } from "@/lib/categoryTaxonomy";

// ─── helpers ──────────────────────────────────────────────────────────────────

function fmtDec(v: number, originalCurrency?: string, homeCurrency = "USD") {
  const cur = originalCurrency ?? homeCurrency;
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency: cur,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}

function fmtAxis(v: number) {
  const sym = getCurrencySymbol();
  if (v >= 1000) return `${sym}${Math.round(v / 1000)}k`;
  return v === 0 ? `${sym}0` : fmt(v);
}

function shortMonth(ym: string) {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y), parseInt(m) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function fmtDate(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function subtypeToSlug(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

const FREQ_OPTIONS: { value: CashFrequency; label: string }[] = [
  { value: "weekly",    label: "Weekly" },
  { value: "biweekly",  label: "Bi-weekly" },
  { value: "monthly",   label: "Monthly" },
  { value: "quarterly", label: "Quarterly" },
  { value: "annual",    label: "Annual" },
];

// ─── types ────────────────────────────────────────────────────────────────────

interface ExpenseTxn {
  merchant: string;
  amount: number;
  category: string;
  accountLabel?: string;
  date?: string;
  isCashCommitment?: boolean;
  currency?: string;
}

interface CashCommitmentItem {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  category: string;
  startDate?: string;
  createdAt: string;
}

interface Subscription {
  name: string;
  amount: number;
  frequency: string;
}

function commitmentAmountForMonth(entry: CashCommitmentItem, yearMonth: string): number {
  if (entry.frequency === "once") return 0;
  const floor = entry.startDate?.slice(0, 7) ?? entry.createdAt?.slice(0, 7);
  if (floor && yearMonth < floor) return 0;
  const multipliers: Record<string, number> = {
    weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, annual: 1 / 12,
  };
  return entry.amount * (multipliers[entry.frequency] ?? 0);
}

// ─── sparkline ────────────────────────────────────────────────────────────────

function Sparkline({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) return null;
  const max = Math.max(...data, 1);
  const W = 56; const H = 22;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * W;
    const y = H - (v / max) * (H - 4) - 1;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg width={W} height={H} className="shrink-0 opacity-70">
      <polyline points={pts} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// ─── MerchantDrawer ───────────────────────────────────────────────────────────

interface DrawerTxn {
  date?: string;
  ym: string;
  amount: number;
  currency?: string;
  category: string;
  accountLabel?: string;
}

interface DrawerMerchant {
  name: string;
  displayName?: string;
  total: number;
  count: number;
  avgAmount: number;
  category: string;
  currency?: string;
  lastDate?: string;
  monthly: { ym: string; total: number; count: number }[];
  transactions: DrawerTxn[];
}

function MerchantDrawer({
  slug,
  token,
  homeCurrency,
  isOpen,
  onClose,
}: {
  slug: string | null;
  token: string | null;
  homeCurrency: string;
  isOpen: boolean;
  onClose: () => void;
}) {
  const [merchant, setMerchant] = useState<DrawerMerchant | null>(null);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [selectedYm, setSelectedYm] = useState<string | null>(null);

  useEffect(() => {
    if (!slug || !token || !isOpen) return;
    setLoading(true); setError(null); setMerchant(null); setSelectedYm(null);
    fetch(`/api/user/spending/merchants?slug=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    })
      .then((r) => r.json().catch(() => ({})))
      .then((json) => {
        if (json.merchant) setMerchant(json.merchant);
        else setError("No data found for this merchant.");
      })
      .catch(() => setError("Failed to load merchant data."))
      .finally(() => setLoading(false));
  }, [slug, token, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  const color        = merchant ? categoryColor(merchant.category) : "#a855f7";
  const displayedName = merchant?.displayName ?? merchant?.name ?? (slug ?? "");
  const monthlyAvg   = merchant && merchant.monthly.length > 0
    ? merchant.total / merchant.monthly.length : 0;

  const chartData = merchant?.monthly.map((m) => ({
    label: shortMonth(m.ym), ym: m.ym, total: m.total,
  })) ?? [];

  const filteredTxns = selectedYm
    ? (merchant?.transactions ?? []).filter((t) => t.ym === selectedYm)
    : [...(merchant?.transactions ?? [])].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

  return (
    <>
      {/* Backdrop */}
      <div
        className={`fixed inset-0 z-40 bg-black/30 transition-opacity duration-300 ${isOpen ? "opacity-100" : "opacity-0 pointer-events-none"}`}
        onClick={onClose}
      />

      {/* Panel */}
      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col bg-white shadow-2xl transition-transform duration-300 ${isOpen ? "translate-x-0" : "translate-x-full"}`}
      >
        {/* Header */}
        <div className="flex items-start gap-3 border-b border-gray-100 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
              <h2 className="truncate text-base font-bold text-gray-900">{displayedName}</h2>
            </div>
            {merchant && (
              <p className="mt-0.5 text-xs text-gray-400">
                {formatCurrency(merchant.total, homeCurrency, merchant.currency, true)} total
                <span className="mx-1">·</span>
                {formatCurrency(Math.round(monthlyAvg), homeCurrency, undefined, true)}/mo avg
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            className="shrink-0 rounded-lg p-1 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
          {loading && (
            <div className="flex items-center justify-center py-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
            </div>
          )}
          {error && <p className="text-sm text-red-500">{error}</p>}

          {merchant && !loading && (
            <>
              {/* Stats */}
              <div className="grid grid-cols-3 divide-x divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="px-3 py-3 text-center">
                  <p className="text-[11px] text-gray-400">Transactions</p>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">{merchant.count}</p>
                </div>
                <div className="px-3 py-3 text-center">
                  <p className="text-[11px] text-gray-400">Avg amount</p>
                  <p className="mt-0.5 text-sm font-bold text-gray-900 tabular-nums">
                    {formatCurrency(merchant.avgAmount, homeCurrency, merchant.currency, true)}
                  </p>
                </div>
                <div className="px-3 py-3 text-center">
                  <p className="text-[11px] text-gray-400">Active months</p>
                  <p className="mt-0.5 text-xl font-bold text-gray-900">{merchant.monthly.length}</p>
                </div>
              </div>

              {/* Monthly trend */}
              {chartData.length >= 1 && (
                <div className="rounded-xl border border-gray-200 bg-white p-4">
                  <div className="mb-2 flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly spending</p>
                    {selectedYm && (
                      <button
                        onClick={() => setSelectedYm(null)}
                        className="text-xs font-medium text-purple-600 hover:underline"
                      >
                        {shortMonth(selectedYm)} ✕
                      </button>
                    )}
                  </div>
                  <div className="h-28">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={chartData} margin={{ top: 2, right: 4, left: 0, bottom: 0 }} style={{ outline: "none" }} tabIndex={-1}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                        <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={40} />
                        <Tooltip
                          formatter={(v) => [formatCurrency(Number(v), homeCurrency, merchant.currency, true), "Spent"]}
                          contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                          cursor={{ fill: "rgba(0,0,0,0.04)" }}
                        />
                        <Bar
                          dataKey="total"
                          radius={[3, 3, 0, 0]}
                          activeBar={false}
                          style={{ cursor: "pointer" }}
                          onClick={(data) => {
                            const ym = (data as unknown as { ym?: string })?.ym ?? null;
                            setSelectedYm((prev) => prev === ym ? null : ym);
                          }}
                        >
                          {chartData.map((entry) => (
                            <Cell
                              key={entry.ym}
                              fill={color}
                              opacity={!selectedYm || entry.ym === selectedYm ? 1 : 0.35}
                            />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {/* Transactions */}
              <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                    {selectedYm ? `${shortMonth(selectedYm)} transactions` : "All transactions"}
                  </p>
                  <span className="text-xs text-gray-400">{filteredTxns.length}</span>
                </div>
                <div className="divide-y divide-gray-100">
                  {filteredTxns.map((txn, i) => (
                    <div key={i} className="flex items-center justify-between px-4 py-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs text-gray-500">
                            {txn.date ? fmtDate(txn.date) : shortMonth(txn.ym)}
                          </span>
                          {txn.accountLabel && (
                            <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{txn.accountLabel}</span>
                          )}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5">
                          <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(txn.category) }} />
                          <span className="text-xs text-gray-400">{txn.category}</span>
                        </div>
                      </div>
                      <p className="ml-3 shrink-0 text-sm font-semibold text-gray-800 tabular-nums">
                        −{fmtDec(Math.abs(txn.amount), txn.currency ?? homeCurrency)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer — link to full merchant page */}
        {slug && (
          <div className="border-t border-gray-100 p-4">
            <Link
              href={`/account/spending/merchant/${encodeURIComponent(slug)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-200 bg-gray-50 py-2.5 text-sm font-medium text-gray-500 transition hover:border-purple-200 hover:bg-purple-50 hover:text-purple-700"
            >
              <svg className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Open full merchant page
            </Link>
          </div>
        )}
      </div>
    </>
  );
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function SpendingCategoryPage() {
  const router       = useRouter();
  const params       = useParams();
  const searchParams = useSearchParams();
  const rawName      = decodeURIComponent(params.name as string);
  const categoryName = rawName.replace(/\b\w/g, (c) => c.toUpperCase());
  const monthParam   = searchParams.get("month") ?? null;
  const subtypeParam = searchParams.get("subtype") ?? null;

  const isParentCategory = PARENTS_WITH_SUBTYPES.has(rawName.toLowerCase());

  // ── shared state ────────────────────────────────────────────────────────────
  const [token, setToken]                       = useState<string | null>(null);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState<string | null>(null);
  const [toast, setToast]                       = useState<string | null>(null);
  const [homeCurrency, setHomeCurrency]         = useState("USD");
  const [recurringRules, setRecurringRules]     = useState<Map<string, Subscription>>(new Map());
  const [cashCommitments, setCashCommitments]   = useState<CashCommitmentItem[]>([]);
  const [pendingRecurring, setPendingRecurring] = useState<{ txn: ExpenseTxn; anchor: HTMLElement } | null>(null);
  const [pendingFreq, setPendingFreq]           = useState<CashFrequency>("monthly");

  // ── accordion state (parent categories) ─────────────────────────────────────
  const [allMonthsData, setAllMonthsData] = useState<Map<string, ExpenseTxn[]>>(new Map());
  const [sortedMonths, setSortedMonths]   = useState<string[]>([]);
  const [openSubtype, setOpenSubtype]     = useState<string | null>(null);
  const [subtypeMonths, setSubtypeMonths] = useState<Map<string, string>>(new Map());
  const didAutoOpen                       = useRef(false);
  const accordionRefs                     = useRef<Map<string, HTMLDivElement>>(new Map());

  // ── leaf state ──────────────────────────────────────────────────────────────
  const [transactions, setTransactions]     = useState<ExpenseTxn[]>([]);
  const [categoryTotal, setCategoryTotal]   = useState(0);
  const [monthTotal, setMonthTotal]         = useState(0);
  const [yearMonth, setYearMonth]           = useState<string | null>(null);
  const [monthlyHistory, setMonthlyHistory] = useState<{ label: string; amount: number; ym: string }[]>([]);

  // ── picker refs ─────────────────────────────────────────────────────────────
  const [openPicker, setOpenPicker] = useState<string | null>(null);
  const btnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  // ── merchant drawer ─────────────────────────────────────────────────────────
  const [drawerSlug, setDrawerSlug]   = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen]   = useState(false);

  function openDrawer(slug: string) {
    setDrawerSlug(slug);
    requestAnimationFrame(() => requestAnimationFrame(() => setDrawerOpen(true)));
  }
  function closeDrawer() {
    setDrawerOpen(false);
    setTimeout(() => setDrawerSlug(null), 300);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const { requestProfileRefresh } = useProfileRefresh();

  // ── load: parent category (all months) ──────────────────────────────────────

  const loadAccordionPage = useCallback(async (tok: string, name: string) => {
    setLoading(true); setError(null);
    try {
      const [consolidatedRes, recurringRes] = await Promise.all([
        fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/recurring-rules",         { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      const json  = await consolidatedRes.json().catch(() => ({}));
      const rJson = recurringRes.ok ? await recurringRes.json().catch(() => ({})) : {};

      if (!consolidatedRes.ok) { setError(json.error ?? "Failed to load"); return; }
      if (json.homeCurrency) setHomeCurrency(json.homeCurrency);

      const allCommitments: CashCommitmentItem[] = json.cashCommitmentItems ?? [];
      setCashCommitments(allCommitments);

      const rMap = new Map<string, Subscription>();
      for (const r of (rJson.rules ?? [])) {
        rMap.set(r.slug as string, { name: r.merchant, amount: r.amount, frequency: r.frequency });
      }
      setRecurringRules(rMap);

      const lowerName = name.toLowerCase();
      const matchesCat = (cat: string | undefined) =>
        !!cat && (cat.toLowerCase() === lowerName || getParentCategory(cat).toLowerCase() === lowerName);

      const history: { yearMonth: string }[] = json.history ?? [];
      const currentYm: string | null = json.yearMonth ?? null;
      const historyYms = history.map((h) => h.yearMonth).filter(Boolean);
      const allYms = [...new Set([...historyYms, ...(currentYm ? [currentYm] : [])])].sort().slice(-12);
      setSortedMonths(allYms);

      const buildTxns = (rawTxns: ExpenseTxn[], ym: string): ExpenseTxn[] => {
        const catTxns = rawTxns
          .filter((t) => matchesCat(t.category))
          .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
        const cashTxns = allCommitments
          .filter((c) => matchesCat(c.category) && commitmentAmountForMonth(c, ym) > 0)
          .map((c) => ({
            merchant: c.name,
            amount: commitmentAmountForMonth(c, ym),
            category: c.category,
            isCashCommitment: true,
          }));
        return [...catTxns, ...cashTxns];
      };

      const dataMap = new Map<string, ExpenseTxn[]>();
      if (currentYm) {
        const rawTxns: ExpenseTxn[] = json.data?.expenses?.transactions ?? [];
        dataMap.set(currentYm, buildTxns(rawTxns, currentYm));
      }

      const otherYms = allYms.filter((ym) => ym !== currentYm);
      await Promise.all(otherYms.map(async (ym) => {
        const r = await fetch(`/api/user/statements/consolidated?month=${ym}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          dataMap.set(ym, buildTxns(j.data?.expenses?.transactions ?? [], ym));
        }
      }));

      setAllMonthsData(dataMap);
    } catch { setError("Failed to load category data"); }
    finally   { setLoading(false); }
  }, []);

  // ── load: leaf category ──────────────────────────────────────────────────────

  const loadLeafPage = useCallback(async (tok: string, name: string, month: string | null) => {
    setLoading(true); setError(null);
    let autoRedirected = false;
    try {
      const url = month
        ? `/api/user/statements/consolidated?month=${month}`
        : "/api/user/statements/consolidated";
      const [consolidatedRes, recurringRes] = await Promise.all([
        fetch(url,                             { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/recurring-rules",     { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      const json  = await consolidatedRes.json().catch(() => ({}));
      const rJson = recurringRes.ok ? await recurringRes.json().catch(() => ({})) : {};

      if (!consolidatedRes.ok) { setError(json.error ?? "Failed to load"); return; }
      if (json.homeCurrency) setHomeCurrency(json.homeCurrency);

      const allCommitments: CashCommitmentItem[] = json.cashCommitmentItems ?? [];
      setCashCommitments(allCommitments);

      const rMap = new Map<string, Subscription>();
      for (const r of (rJson.rules ?? [])) {
        rMap.set(r.slug as string, { name: r.merchant, amount: r.amount, frequency: r.frequency });
      }
      setRecurringRules(rMap);

      const ym = json.yearMonth ?? null;
      setYearMonth(ym);

      const lowerName = name.toLowerCase();
      const matchesCat = (cat: string | undefined) =>
        !!cat && (cat.toLowerCase() === lowerName || getParentCategory(cat).toLowerCase() === lowerName);

      const allTxns: ExpenseTxn[] = json.data?.expenses?.transactions ?? [];
      const catTxns = allTxns
        .filter((t) => matchesCat(t.category))
        .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));

      const matchingCommitments: ExpenseTxn[] = ym
        ? allCommitments
            .filter((c) => matchesCat(c.category) && commitmentAmountForMonth(c, ym) > 0)
            .map((c) => ({
              merchant: c.name,
              amount: commitmentAmountForMonth(c, ym),
              category: c.category,
              isCashCommitment: true,
            }))
        : [];

      const allCatTxns = [...catTxns, ...matchingCommitments];
      setTransactions(allCatTxns);
      const catTotal = allCatTxns.reduce((s, t) => s + t.amount, 0);
      setCategoryTotal(catTotal);
      setMonthTotal((json.data?.expenses?.total ?? 0) + matchingCommitments.reduce((s, t) => s + t.amount, 0));

      const history: { yearMonth: string }[] = json.history ?? [];
      const pastMonths = history
        .filter((h) => h.yearMonth !== ym)
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth))
        .slice(-5);

      const monthData: { label: string; amount: number; ym: string }[] = [];
      await Promise.all(pastMonths.map(async (h) => {
        const r = await fetch(`/api/user/statements/consolidated?month=${h.yearMonth}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        const j = await r.json().catch(() => ({}));
        if (r.ok) {
          const txns: ExpenseTxn[] = j.data?.expenses?.transactions ?? [];
          const stmtAmt = txns.filter((t) => matchesCat(t.category)).reduce((s, t) => s + t.amount, 0);
          const cashAmt = allCommitments
            .filter((c) => matchesCat(c.category))
            .reduce((s, c) => s + commitmentAmountForMonth(c, h.yearMonth), 0);
          monthData.push({ label: shortMonth(h.yearMonth), amount: stmtAmt + cashAmt, ym: h.yearMonth });
        }
      }));
      monthData.push({ label: shortMonth(ym ?? ""), amount: catTotal, ym: ym ?? "" });
      monthData.sort((a, b) => a.ym.localeCompare(b.ym));
      setMonthlyHistory(monthData);

      if (!month && catTotal === 0) {
        const bestMonth = [...monthData].sort((a, b) => b.ym.localeCompare(a.ym)).find((m) => m.amount > 0);
        if (bestMonth) {
          autoRedirected = true;
          loadLeafPage(tok, name, bestMonth.ym);
          return;
        }
      }
    } catch { setError("Failed to load category data"); }
    finally   { if (!autoRedirected) setLoading(false); }
  }, []);

  // ── auth + initial load ──────────────────────────────────────────────────────

  const loadAccordionRef = useRef(loadAccordionPage);
  loadAccordionRef.current = loadAccordionPage;
  const loadLeafRef = useRef(loadLeafPage);
  loadLeafRef.current = loadLeafPage;

  useEffect(() => {
    if (!token) return;
    const handler = () => {
      if (isParentCategory) loadAccordionRef.current(token, rawName);
      else loadLeafRef.current(token, rawName, monthParam);
    };
    window.addEventListener(PROFILE_REFRESHED_EVENT, handler);
    return () => window.removeEventListener(PROFILE_REFRESHED_EVENT, handler);
  }, [token, rawName, monthParam, isParentCategory]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      if (isParentCategory) loadAccordionPage(tok, rawName);
      else loadLeafPage(tok, rawName, monthParam);
    });
  }, [router, rawName, monthParam, isParentCategory, loadAccordionPage, loadLeafPage]);

  // ── auto-open from URL ?subtype= param ──────────────────────────────────────

  useEffect(() => {
    if (!subtypeParam || allMonthsData.size === 0 || didAutoOpen.current) return;
    for (const txns of allMonthsData.values()) {
      for (const txn of txns) {
        if (subtypeToSlug(txn.category ?? "") === subtypeParam) {
          didAutoOpen.current = true;
          setOpenSubtype(txn.category);
          return;
        }
      }
    }
  }, [subtypeParam, allMonthsData]);

  // ── handlers ────────────────────────────────────────────────────────────────

  async function handleCategoryChange(txn: ExpenseTxn, newCategory: string) {
    setOpenPicker(null);
    setAllMonthsData((prev) => {
      const next = new Map<string, ExpenseTxn[]>();
      for (const [ym, txns] of prev) {
        next.set(ym, txns.map((t) => t.merchant === txn.merchant ? { ...t, category: newCategory } : t));
      }
      return next;
    });
    setTransactions((prev) => prev.map((t) => t.merchant === txn.merchant ? { ...t, category: newCategory } : t));
    try {
      const res = await fetch("/api/user/category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: txn.merchant, category: newCategory }),
      });
      if (res.ok) { setToast(`Rule saved: "${txn.merchant}" → ${newCategory}`); requestProfileRefresh(); }
      else setToast("Failed to save rule");
    } catch { setToast("Failed to save rule"); }
  }

  function handleRecurringToggle(txn: ExpenseTxn, anchorEl: HTMLElement) {
    if (!token) return;
    const slug = merchantSlug(txn.merchant);
    if (recurringRules.has(slug)) {
      setRecurringRules((prev) => { const next = new Map(prev); next.delete(slug); return next; });
      fetch(`/api/user/recurring-rules?slug=${encodeURIComponent(slug)}`, {
        method: "DELETE", headers: { Authorization: `Bearer ${token}` },
      }).catch(() => {});
      setToast(`"${txn.merchant}" unmarked as recurring`);
    } else {
      setPendingFreq("monthly");
      setPendingRecurring({ txn, anchor: anchorEl });
    }
  }

  async function confirmRecurring() {
    if (!token || !pendingRecurring) return;
    const { txn } = pendingRecurring;
    const slug = merchantSlug(txn.merchant);
    setRecurringRules((prev) => {
      const next = new Map(prev);
      next.set(slug, { name: txn.merchant, amount: txn.amount, frequency: pendingFreq });
      return next;
    });
    setPendingRecurring(null);
    try {
      await fetch("/api/user/recurring-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: txn.merchant, amount: txn.amount, frequency: pendingFreq, category: txn.category }),
      });
      setToast(`"${txn.merchant}" marked as recurring (${pendingFreq})`);
    } catch { setToast("Failed to save"); }
  }

  useEffect(() => {
    if (!openSubtype) return;
    const el = accordionRefs.current.get(openSubtype);
    if (!el) return;
    const timer = setTimeout(() => el.scrollIntoView({ behavior: "smooth", block: "nearest" }), 80);
    return () => clearTimeout(timer);
  }, [openSubtype]);

  function toggleSubtype(name: string) {
    if (openSubtype === name) { setOpenSubtype(null); return; }
    setOpenSubtype(name);
    if (!subtypeMonths.has(name)) {
      const latestYm = [...sortedMonths].reverse().find((ym) => {
        return (allMonthsData.get(ym) ?? []).some(
          (t) => (t.category ?? "").toLowerCase() === name.toLowerCase()
        );
      });
      if (latestYm) setSubtypeMonths((prev) => new Map(prev).set(name, latestYm));
    }
  }

  // ── derived: subtype list ────────────────────────────────────────────────────

  interface SubtypeData {
    name: string;
    color: string;
    total: number;
    avg: number;
    txnCount: number;
    merchantCount: number;
    momChange: number | null;
    monthHistory: { ym: string; label: string; amount: number }[];
    sparklineAmounts: number[];
    defaultMonth: string | null;
  }

  const subtypeDataList = useMemo((): SubtypeData[] => {
    if (allMonthsData.size === 0) return [];
    const groupMap = new Map<string, Map<string, ExpenseTxn[]>>();
    for (const [ym, txns] of allMonthsData) {
      for (const txn of txns) {
        const cat = txn.category ?? rawName;
        if (!groupMap.has(cat)) groupMap.set(cat, new Map());
        const monthMap = groupMap.get(cat)!;
        if (!monthMap.has(ym)) monthMap.set(ym, []);
        monthMap.get(ym)!.push(txn);
      }
    }
    const result: SubtypeData[] = [];
    for (const [catName, monthMap] of groupMap) {
      let total = 0;
      const monthHistory = sortedMonths.map((ym) => {
        const amt = (monthMap.get(ym) ?? []).reduce((s, t) => s + t.amount, 0);
        total += amt;
        return { ym, label: shortMonth(ym), amount: amt };
      });
      const nonZero = monthHistory.filter((m) => m.amount > 0);
      const avg = nonZero.length > 0 ? total / nonZero.length : 0;
      const allTxns = sortedMonths.flatMap((ym) => monthMap.get(ym) ?? []);
      const merchants = new Set(allTxns.filter((t) => !t.isCashCommitment).map((t) => t.merchant));
      const sortedNonZero = [...nonZero].sort((a, b) => b.ym.localeCompare(a.ym));
      const momChange = sortedNonZero.length >= 2
        ? ((sortedNonZero[0].amount - sortedNonZero[1].amount) / sortedNonZero[1].amount) * 100
        : null;
      result.push({
        name: catName,
        color: categoryColor(catName.toLowerCase()),
        total,
        avg,
        txnCount: allTxns.length,
        merchantCount: merchants.size,
        momChange,
        monthHistory,
        sparklineAmounts: monthHistory.map((m) => m.amount),
        defaultMonth: sortedNonZero[0]?.ym ?? null,
      });
    }
    return result.sort((a, b) => b.total - a.total);
  }, [allMonthsData, sortedMonths, rawName]);

  const parentTotal    = useMemo(() => subtypeDataList.reduce((s, st) => s + st.total, 0), [subtypeDataList]);
  const parentTxnCount = useMemo(() => subtypeDataList.reduce((s, st) => s + st.txnCount, 0), [subtypeDataList]);
  const nonZeroMonthCount = useMemo(
    () => sortedMonths.filter((ym) => (allMonthsData.get(ym) ?? []).length > 0).length,
    [sortedMonths, allMonthsData]
  );
  const parentAvg = nonZeroMonthCount > 0 ? parentTotal / nonZeroMonthCount : 0;

  // ── derived: leaf category ────────────────────────────────────────────────────

  const pctOfTotal = monthTotal > 0 ? Math.round((categoryTotal / monthTotal) * 100) : 0;
  const leafAvg = monthlyHistory.length > 0
    ? Math.round(
        monthlyHistory.filter((m) => m.amount > 0).reduce((s, m) => s + m.amount, 0) /
        Math.max(monthlyHistory.filter((m) => m.amount > 0).length, 1)
      )
    : 0;
  const merchantTotals = new Map<string, number>();
  for (const t of transactions) {
    merchantTotals.set(t.merchant, (merchantTotals.get(t.merchant) ?? 0) + t.amount);
  }
  const topMerchants = Array.from(merchantTotals.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
  const color = categoryColor(rawName);

  // ── shared transaction row renderer ──────────────────────────────────────────

  function renderTxnRow(txn: ExpenseTxn, pickerKey: string) {
    const slug       = merchantSlug(txn.merchant);
    const isManualSub = recurringRules.has(slug);
    const txnColor   = categoryColor(txn.category?.toLowerCase() ?? "other");
    return (
      <div key={pickerKey} className="flex items-center justify-between px-5 py-3.5">
        <div className="min-w-0 flex-1">
          {txn.isCashCommitment ? (
            <span className="block truncate text-sm font-medium text-gray-800">{txn.merchant}</span>
          ) : (
            <button
              onClick={() => openDrawer(merchantSlug(txn.merchant))}
              className="block truncate text-left text-sm font-medium text-gray-800 hover:text-purple-600 hover:underline w-full"
            >
              {txn.merchant}
            </button>
          )}
          <div className="mt-1 flex items-center gap-2 flex-wrap">
            {txn.isCashCommitment && (
              <span className="text-xs font-medium text-amber-600 bg-amber-50 rounded px-1.5 py-0.5">Cash</span>
            )}
            {txn.date && <span className="text-xs text-gray-400">{fmtDate(txn.date)}</span>}
            {txn.accountLabel && (
              <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{txn.accountLabel}</span>
            )}
            {!txn.isCashCommitment && (
              <>
                <button
                  ref={(el) => { if (el) btnRefs.current.set(pickerKey, el); else btnRefs.current.delete(pickerKey); }}
                  onClick={() => setOpenPicker(openPicker === pickerKey ? null : pickerKey)}
                  className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5 text-xs font-medium text-gray-600 transition hover:border-purple-300 hover:bg-purple-50 hover:text-purple-700"
                >
                  <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: txnColor }} />
                  {txn.category}
                  <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openPicker === pickerKey && btnRefs.current.has(pickerKey) && (
                  <CategoryPicker
                    anchorRef={{ current: btnRefs.current.get(pickerKey)! }}
                    current={txn.category}
                    onSelect={(cat) => handleCategoryChange(txn, cat)}
                    onClose={() => setOpenPicker(null)}
                  />
                )}
              </>
            )}
            {!txn.isCashCommitment && (
              <button
                onClick={(e) => handleRecurringToggle(txn, e.currentTarget)}
                title={isManualSub ? "Remove from recurring" : "Mark as recurring"}
                className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium transition ${
                  isManualSub
                    ? "border-purple-200 bg-purple-50 text-purple-600"
                    : "border-gray-200 bg-gray-50 text-gray-400 hover:border-purple-200 hover:bg-purple-50 hover:text-purple-500"
                }`}
              >
                <RecurringIcon active={isManualSub} />
                {isManualSub ? (recurringRules.get(slug)?.frequency ?? "recurring") : "↻"}
              </button>
            )}
          </div>
        </div>
        <p className="ml-4 shrink-0 text-sm font-medium text-gray-700 tabular-nums">
          −{fmtDec(Math.abs(txn.amount), txn.currency, homeCurrency)}
        </p>
      </div>
    );
  }

  // ── frequency picker popover (shared) ────────────────────────────────────────

  function FrequencyPickerPopover() {
    if (!pendingRecurring) return null;
    const rect = pendingRecurring.anchor.getBoundingClientRect();
    return (
      <>
        <div className="fixed inset-0 z-40" onClick={() => setPendingRecurring(null)} />
        <div
          className="fixed z-50 w-56 rounded-xl border border-gray-200 bg-white shadow-lg"
          style={{ top: rect.bottom + 6, left: Math.min(rect.left, window.innerWidth - 232) }}
        >
          <div className="border-b border-gray-100 px-3 py-2.5">
            <p className="text-xs font-semibold text-gray-700 truncate">{pendingRecurring.txn.merchant}</p>
            <p className="text-[11px] text-gray-400 mt-0.5">How often does this recur?</p>
          </div>
          <div className="p-1.5 space-y-0.5">
            {FREQ_OPTIONS.map(({ value, label }) => (
              <button key={value} onClick={() => setPendingFreq(value)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm transition ${
                  pendingFreq === value ? "bg-purple-50 text-purple-700 font-medium" : "text-gray-700 hover:bg-gray-50"
                }`}
              >
                {label}
                {pendingFreq === value && (
                  <svg className="h-3.5 w-3.5 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
              </button>
            ))}
          </div>
          <div className="border-t border-gray-100 p-2">
            <button onClick={confirmRecurring}
              className="w-full rounded-lg bg-purple-600 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition">
              Mark as recurring
            </button>
          </div>
        </div>
      </>
    );
  }

  // ── loading / error ──────────────────────────────────────────────────────────

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );
  if (error) return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8">
      <p className="text-red-600">{error}</p>
    </div>
  );

  const backHref = monthParam ? `/account/spending?month=${monthParam}` : "/account/spending";
  const backLink = (
    <Link href={backHref} className="mb-5 inline-flex items-center gap-1.5 text-sm text-gray-400 hover:text-gray-700 transition">
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      Spending
    </Link>
  );

  // ── PARENT CATEGORY: accordion render ────────────────────────────────────────

  if (isParentCategory) {
    return (
      <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
        {backLink}

        {/* Header */}
        <div className="mb-6 flex items-center gap-3">
          <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <div>
            <h1 className="text-3xl font-bold text-gray-900">{categoryName}</h1>
            <p className="mt-0.5 text-sm text-gray-400">
              {sortedMonths.length > 0 ? `${sortedMonths.length} mo` : "All time"}
              {subtypeDataList.length > 0 && ` · ${subtypeDataList.length} ${subtypeDataList.length === 1 ? "type" : "types"}`}
            </p>
          </div>
        </div>

        {/* Parent KPI strip */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          {[
            {
              label: `${sortedMonths.length > 0 ? `${sortedMonths.length} MO` : ""} TOTAL`,
              value: formatCurrency(parentTotal, homeCurrency, undefined, true),
            },
            {
              label: "MONTHLY AVG",
              value: parentAvg > 0 ? formatCurrency(Math.round(parentAvg), homeCurrency, undefined, true) : "—",
            },
            {
              label: "TRANSACTIONS",
              value: parentTxnCount.toString(),
            },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
              <p className="text-xs text-gray-400 uppercase tracking-wide truncate">{label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Accordion */}
        <div className="space-y-2">
          {subtypeDataList.map((st) => {
            const isOpen     = openSubtype === st.name;
            const selectedYm = subtypeMonths.get(st.name) ?? st.defaultMonth;
            const visibleTxns = selectedYm
              ? (allMonthsData.get(selectedYm) ?? []).filter(
                  (t) => (t.category ?? "").toLowerCase() === st.name.toLowerCase()
                )
              : [];

            const merchantMap = new Map<string, number>();
            for (const t of visibleTxns) {
              merchantMap.set(t.merchant, (merchantMap.get(t.merchant) ?? 0) + t.amount);
            }
            const stTopMerchants = Array.from(merchantMap.entries()).sort((a, b) => b[1] - a[1]).slice(0, 5);
            const visibleTotal   = visibleTxns.reduce((s, t) => s + t.amount, 0);
            const hasChart       = st.monthHistory.some((m) => m.amount > 0);

            return (
              <div
                key={st.name}
                ref={(el) => { if (el) accordionRefs.current.set(st.name, el); else accordionRefs.current.delete(st.name); }}
                className={`rounded-xl border bg-white overflow-hidden transition-all duration-200 ${
                  isOpen
                    ? "border-purple-300 shadow-lg ring-1 ring-purple-100"
                    : openSubtype !== null
                      ? "border-gray-200 shadow-sm opacity-50"
                      : "border-gray-200 shadow-sm"
                }`}
              >

                {/* Collapsed row */}
                <button
                  className={`w-full flex items-center gap-3 px-5 py-4 text-left transition focus:outline-none ${
                    isOpen ? "bg-purple-50 hover:bg-purple-50" : "hover:bg-gray-50"
                  }`}
                  onClick={() => toggleSubtype(st.name)}
                >
                  <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: st.color }} />
                  <span className={`flex-1 min-w-0 text-sm font-semibold truncate ${isOpen ? "text-purple-700" : "text-gray-800"}`}>{st.name}</span>
                  <Sparkline data={st.sparklineAmounts} color={st.color} />
                  <div className="text-right shrink-0 min-w-[72px]">
                    <p className="text-sm font-semibold text-gray-900 tabular-nums">
                      {formatCurrency(st.total, homeCurrency, undefined, true)}
                    </p>
                    {st.momChange !== null && (
                      <p className={`text-xs tabular-nums ${st.momChange > 0 ? "text-red-500" : "text-green-600"}`}>
                        {st.momChange > 0 ? "↑" : "↓"}{Math.abs(Math.round(st.momChange))}%
                      </p>
                    )}
                  </div>
                  <svg
                    className={`h-4 w-4 text-gray-400 shrink-0 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {/* Expanded panel */}
                {isOpen && (
                  <div className="border-t border-gray-100">

                    {/* KPI strip */}
                    <div className="grid grid-cols-3 divide-x divide-gray-100 py-3">
                      {[
                        { label: "MONTHLY AVG", value: st.avg > 0 ? formatCurrency(Math.round(st.avg), homeCurrency, undefined, true) : "—" },
                        { label: "TRANSACTIONS", value: st.txnCount.toString() },
                        { label: "MERCHANTS",    value: st.merchantCount.toString() },
                      ].map(({ label, value }) => (
                        <div key={label} className="text-center px-3">
                          <p className="text-xs text-gray-400 uppercase tracking-wide">{label}</p>
                          <p className="mt-0.5 text-sm font-bold text-gray-800">{value}</p>
                        </div>
                      ))}
                    </div>

                    {/* Trend chart */}
                    {hasChart && (
                      <div className="px-4 pb-3">
                        <div className="h-32">
                          <ResponsiveContainer width="100%" height="100%">
                            <BarChart
                              data={st.monthHistory}
                              margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
                              style={{ outline: "none" }}
                              tabIndex={-1}
                            >
                              <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                              <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={44} />
                              <Tooltip
                                formatter={(v) => [typeof v === "number" ? formatCurrency(v, homeCurrency, undefined, true) : String(v), st.name]}
                                contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "12px" }}
                                labelStyle={{ fontWeight: 600, color: "#111827" }}
                                cursor={{ fill: "rgba(0,0,0,0.04)" }}
                              />
                              <Bar
                                dataKey="amount"
                                radius={[3, 3, 0, 0]}
                                maxBarSize={40}
                                activeBar={false}
                                style={{ cursor: "pointer" }}
                                onClick={(data) => {
                                  const ym = (data as unknown as { ym?: string })?.ym;
                                  if (!ym) return;
                                  setSubtypeMonths((prev) => new Map(prev).set(st.name, ym));
                                }}
                              >
                                {st.monthHistory.map((entry) => (
                                  <Cell
                                    key={entry.ym}
                                    fill={st.color}
                                    opacity={entry.ym === selectedYm ? 1 : 0.35}
                                  />
                                ))}
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                        {selectedYm && (
                          <p className="mt-1 text-center text-xs text-gray-400">
                            {shortMonth(selectedYm)}
                            <span className="mx-1.5">·</span>
                            {formatCurrency(visibleTotal, homeCurrency, undefined, true)}
                            <span className="mx-1.5">·</span>
                            tap a bar to switch month
                          </p>
                        )}
                      </div>
                    )}

                    {/* Top merchants */}
                    {stTopMerchants.length > 0 && (
                      <div className="px-5 pb-4">
                        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-400">Top merchants</p>
                        <div className="space-y-2">
                          {stTopMerchants.map(([merchant, amount]) => {
                            const pct = visibleTotal > 0 ? (amount / visibleTotal) * 100 : 0;
                            return (
                              <div key={merchant}>
                                <div className="flex items-center justify-between text-sm mb-0.5">
                                  <button
                                    onClick={() => openDrawer(merchantSlug(merchant))}
                                    className="font-medium text-gray-700 truncate text-left hover:text-purple-600 hover:underline transition-colors"
                                  >
                                    {merchant}
                                  </button>
                                  <span className="tabular-nums text-gray-500 shrink-0 ml-2">
                                    {formatCurrency(amount, homeCurrency, undefined, true)}
                                  </span>
                                </div>
                                <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                                  <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: st.color }} />
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* Transactions */}
                    {visibleTxns.length > 0 && (
                      <div className="border-t border-gray-100">
                        <div className="flex items-center justify-between px-5 pt-3 pb-1">
                          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Transactions</p>
                          <span className="text-xs text-gray-400">{visibleTxns.length}</span>
                        </div>
                        <p className="px-5 pb-3 text-xs text-gray-400">
                          Tap the category pill to recategorise · tap ↻ to mark as recurring
                        </p>
                        <div className="divide-y divide-gray-100">
                          {visibleTxns.map((txn, i) =>
                            renderTxnRow(txn, `${st.name}:${selectedYm ?? "all"}:${i}`)
                          )}
                        </div>
                      </div>
                    )}

                    {visibleTxns.length === 0 && selectedYm && (
                      <div className="px-5 py-6 text-center">
                        <p className="text-sm text-gray-400">No transactions in {shortMonth(selectedYm)}</p>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {subtypeDataList.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
              <p className="text-sm text-gray-500">No transactions in {categoryName} yet.</p>
            </div>
          )}
        </div>

        <FrequencyPickerPopover />
        {toast && (
          <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
            {toast}
          </div>
        )}
        <MerchantDrawer
          slug={drawerSlug}
          token={token}
          homeCurrency={homeCurrency}
          isOpen={drawerOpen}
          onClose={closeDrawer}
        />
      </div>
    );
  }

  // ── LEAF CATEGORY: simple render ──────────────────────────────────────────────

  return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      {backLink}

      {/* Header */}
      <div className="mb-6 flex items-center gap-3">
        <span className="h-3.5 w-3.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div>
          <h1 className="text-3xl font-bold text-gray-900">{categoryName}</h1>
          {yearMonth && (
            <p className="mt-0.5 text-sm text-gray-400">
              {formatCurrency(categoryTotal, homeCurrency, undefined, true)} · {pctOfTotal}% of total
              {" · "}
              {new Date(parseInt(yearMonth.slice(0, 4)), parseInt(yearMonth.slice(5, 7)) - 1, 1)
                .toLocaleDateString("en-US", { month: "long", year: "numeric" })}
            </p>
          )}
        </div>
      </div>

      <div className="space-y-4">

        {/* KPI strip */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: yearMonth
                ? new Date(parseInt(yearMonth.slice(0, 4)), parseInt(yearMonth.slice(5, 7)) - 1, 1)
                    .toLocaleDateString("en-US", { month: "short", year: "numeric" })
                : "This month",
              value: formatCurrency(categoryTotal, homeCurrency, undefined, true),
            },
            { label: "Monthly avg",   value: leafAvg > 0 ? formatCurrency(leafAvg, homeCurrency, undefined, true) : "—" },
            { label: "% of spending", value: `${pctOfTotal}%` },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm text-center">
              <p className="text-xs text-gray-400">{label}</p>
              <p className="mt-1 text-lg font-bold text-gray-900">{value}</p>
            </div>
          ))}
        </div>

        {/* Monthly trend chart */}
        {monthlyHistory.filter((m) => m.amount > 0).length >= 2 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-gray-400">Monthly trend</p>
            <p className="mb-4 text-[11px] text-gray-400">Tap a bar to view that month</p>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart
                  data={monthlyHistory}
                  margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                  style={{ outline: "none" }}
                  tabIndex={-1}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={fmtAxis} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    formatter={(v) => [typeof v === "number" ? formatCurrency(v, homeCurrency, undefined, true) : String(v), categoryName]}
                    contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "13px" }}
                    labelStyle={{ fontWeight: 600, color: "#111827" }}
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  />
                  {leafAvg > 0 && (
                    <ReferenceLine y={leafAvg} stroke="#d1d5db" strokeDasharray="4 4"
                      label={{ value: "avg", position: "insideTopRight", fontSize: 10, fill: "#9ca3af" }} />
                  )}
                  <Bar
                    dataKey="amount"
                    radius={[4, 4, 0, 0]}
                    maxBarSize={48}
                    activeBar={false}
                    style={{ cursor: "pointer" }}
                    onClick={(data) => {
                      const ym = (data as unknown as { ym?: string })?.ym;
                      if (ym) router.push(`/account/spending/category/${encodeURIComponent(rawName)}?month=${ym}`);
                    }}
                  >
                    {monthlyHistory.map((entry) => (
                      <Cell
                        key={entry.ym}
                        fill={color}
                        opacity={entry.ym === (monthParam ?? yearMonth) ? 1 : 0.45}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Top merchants */}
        {topMerchants.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-gray-400">Top merchants this month</p>
            <div className="space-y-2.5">
              {topMerchants.map(([merchant, amount]) => {
                const pct = categoryTotal > 0 ? (amount / categoryTotal) * 100 : 0;
                return (
                  <div key={merchant}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <button
                        onClick={() => openDrawer(merchantSlug(merchant))}
                        className="font-medium text-gray-700 truncate text-left hover:text-purple-600 hover:underline transition-colors"
                      >
                        {merchant}
                      </button>
                      <span className="tabular-nums text-gray-500 shrink-0 ml-2">
                        {formatCurrency(amount, homeCurrency, undefined, true)}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Transactions */}
        {transactions.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
            <div className="flex items-center justify-between px-5 pt-5 pb-1">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Transactions</p>
              <span className="text-xs text-gray-400">{transactions.length} total</span>
            </div>
            <p className="px-5 pt-1 pb-3 text-xs text-gray-400">
              Tap the category pill to recategorise · tap ↻ to mark as recurring
            </p>
            <div className="divide-y divide-gray-100">
              {transactions.map((txn, i) => renderTxnRow(txn, `leaf:${i}`))}
            </div>
          </div>
        )}

        {transactions.length === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
            <p className="text-sm text-gray-500">No transactions in {categoryName} this month.</p>
          </div>
        )}
      </div>

      <FrequencyPickerPopover />
      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 rounded-full bg-gray-900 px-4 py-2 text-sm text-white shadow-lg">
          {toast}
        </div>
      )}
      <MerchantDrawer
        slug={drawerSlug}
        token={token}
        homeCurrency={homeCurrency}
        isOpen={drawerOpen}
        onClose={closeDrawer}
      />
    </div>
  );
}
