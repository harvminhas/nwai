"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter, useParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Cell,
} from "recharts";
import { categoryColor, CategoryPicker } from "@/app/account/spending/shared";
import { txnKey } from "@/lib/applyRules";
import type { MerchantSummary } from "@/app/api/user/spending/merchants/route";
import { formatCurrency, getCurrencySymbol } from "@/lib/currencyUtils";
import {
  MerchantForecastProvider,
  MerchantSpendCadencePill,
} from "@/components/MerchantForecastSection";
import { PROFILE_REFRESHED_EVENT, useProfileRefresh } from "@/contexts/ProfileRefreshContext";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtDec(v: number, currency = "USD") {
  return new Intl.NumberFormat("en-US", {
    style: "currency", currency,
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  }).format(v);
}
function fmtAxis(v: number, sym: string) {
  if (v >= 1_000) return `${sym}${Math.round(v / 1_000)}k`;
  return v === 0 ? `${sym}0` : `${sym}${Math.round(v)}`;
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
function fmtDateLong(iso: string) {
  return new Date(iso + "T12:00:00")
    .toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

const PEER_COLORS = ["#818cf8", "#34d399", "#fb923c", "#e879f9", "#38bdf8"];

// ── insight card ──────────────────────────────────────────────────────────────

function InsightCard({ icon, children }: { icon: "warn" | "check" | "info"; children: React.ReactNode }) {
  const cfg = {
    warn:  { bg: "bg-orange-50",  border: "border-orange-100",  ring: "bg-orange-100",  text: "text-orange-500",  d: "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" },
    check: { bg: "bg-emerald-50", border: "border-emerald-100", ring: "bg-emerald-100", text: "text-emerald-600", d: "M5 13l4 4L19 7" },
    info:  { bg: "bg-blue-50",    border: "border-blue-100",    ring: "bg-blue-100",    text: "text-blue-500",   d: "M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  }[icon];
  return (
    <div className={`flex gap-3 rounded-xl border ${cfg.border} ${cfg.bg} px-4 py-3.5`}>
      <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full ${cfg.ring} ${cfg.text}`}>
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d={cfg.d} />
        </svg>
      </span>
      <p className="text-sm text-gray-800">{children}</p>
    </div>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────

export default function MerchantDetailPage() {
  const router  = useRouter();
  const params  = useParams();
  const slug    = decodeURIComponent(params.slug as string);

  const [merchant, setMerchant]       = useState<MerchantSummary | null>(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState<string | null>(null);
  const [homeCurrency, setHomeCurrency] = useState("USD");
  const [sortField, setSortField]     = useState<"date" | "amount">("date");
  const [sortDir, setSortDir]         = useState<"asc" | "desc">("desc");
  const [selectedYm, setSelectedYm]   = useState<string | null>(null);
  const [idToken, setIdToken]         = useState<string | null>(null);
  const categoryBtnRef                = useRef<HTMLButtonElement>(null);
  const [categoryPickerOpen, setCategoryPickerOpen] = useState(false);
  const [cancelled, setCancelled]     = useState(false);
  const [cancelSaving, setCancelSaving] = useState(false);
  const [subOnlyRecord, setSubOnlyRecord] = useState<{
    name: string; amount: number; frequency: string; cancelled: boolean;
  } | null>(null);
  const { requestProfileRefresh } = useProfileRefresh();
  const [similarMerchants, setSimilarMerchants] = useState<MerchantSummary[]>([]);
  const [mergeSelected, setMergeSelected]       = useState<Set<string>>(new Set());
  const [mergingHere, setMergingHere]           = useState(false);
  const [similarExpanded, setSimilarExpanded]   = useState(false);
  // Per-transaction category picker
  const [txnPickerKey, setTxnPickerKey]         = useState<string | null>(null);
  const txnPickerBtnRefs                        = useRef<Map<string, HTMLButtonElement>>(new Map());
  const [savingTxnKey, setSavingTxnKey]         = useState<string | null>(null);
  const [categoryPeers, setCategoryPeers]       = useState<{ name: string; slug: string; total: number; currency: string }[]>([]);
  const [categoryTotal, setCategoryTotal]       = useState(0);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      setLoading(true);
      try {
        const tok = await user.getIdToken();
        setIdToken(tok);
        const res = await fetch(
          `/api/user/spending/merchants?slug=${encodeURIComponent(slug)}`,
          { headers: { Authorization: `Bearer ${tok}` }, cache: "no-store" },
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.merchant) {
          const cadenceRes = await fetch(
            `/api/user/spending/merchant-cadence?slug=${encodeURIComponent(slug)}`,
            { headers: { Authorization: `Bearer ${tok}` } },
          ).catch(() => null);
          const cadenceJson = cadenceRes ? await cadenceRes.json().catch(() => ({})) : {};
          if (cadenceJson.cadence || typeof cadenceJson.cancelled === "boolean") {
            setSubOnlyRecord({
              name: slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
              amount: 0,
              frequency: cadenceJson.cadence?.frequency ?? "monthly",
              cancelled: cadenceJson.cancelled ?? false,
            });
            setCancelled(cadenceJson.cancelled ?? false);
          } else {
            setError("No spending history found for this merchant.");
          }
          setLoading(false);
          return;
        }
        setMerchant(json.merchant ?? null);
        if (json.homeCurrency) setHomeCurrency(json.homeCurrency);
        setSimilarMerchants(json.similarMerchants ?? []);
        setCategoryPeers(json.categoryPeers ?? []);
        setCategoryTotal(json.categoryTotal ?? 0);
      } catch {
        setError("Failed to load merchant data");
      } finally {
        setLoading(false);
      }
    });
  }, [router, slug]);

  useEffect(() => {
    if (!idToken) return;
    const reloadMerchant = () => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/user/spending/merchants?slug=${encodeURIComponent(slug)}`,
            { headers: { Authorization: `Bearer ${idToken}` } },
          );
          const json = await res.json().catch(() => ({}));
          if (json.merchant) {
            setMerchant(json.merchant);
            setCategoryPeers(json.categoryPeers ?? []);
            setCategoryTotal(json.categoryTotal ?? 0);
          }
        } catch { /* ignore */ }
      })();
    };
    window.addEventListener(PROFILE_REFRESHED_EVENT, reloadMerchant);
    return () => window.removeEventListener(PROFILE_REFRESHED_EVENT, reloadMerchant);
  }, [idToken, slug]);

  useEffect(() => {
    if (!idToken) return;
    fetch(`/api/user/spending/merchant-cadence?slug=${encodeURIComponent(slug)}`, {
      headers: { Authorization: `Bearer ${idToken}` },
    })
      .then((r) => r.json())
      .then((j) => { if (typeof j.cancelled === "boolean") setCancelled(j.cancelled); })
      .catch(() => {});
  }, [idToken, slug]);

  async function handleCancelledToggle() {
    if (!idToken || cancelSaving) return;
    const next = !cancelled;
    setCancelled(next);
    setCancelSaving(true);
    try {
      await fetch("/api/user/spending/merchant-cadence", {
        method: "PATCH",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ slug, cancelled: next }),
      });
      requestProfileRefresh();
    } catch {
      setCancelled(!next);
    } finally {
      setCancelSaving(false);
    }
  }

  function toggleSort(field: "date" | "amount") {
    if (sortField === field) setSortDir((d) => (d === "desc" ? "asc" : "desc"));
    else { setSortField(field); setSortDir("desc"); }
  }

  // Must be declared before early returns so hook order is stable
  const handleTxnCategorySelect = useCallback(async (
    key: string,
    newCategory: string,
    txn: import("@/lib/types").ExpenseTransaction & { ym: string },
  ) => {
    setTxnPickerKey(null);
    if (!idToken || !txn.stmtId) return;
    setSavingTxnKey(key);
    setMerchant((m) => m ? {
      ...m,
      transactions: m.transactions.map((t) =>
        (t.stmtId === txn.stmtId && t.date === txn.date &&
          Math.round(Math.abs(t.amount) * 100) === Math.round(Math.abs(txn.amount) * 100) &&
          t.merchant === txn.merchant)
          ? { ...t, category: newCategory }
          : t,
      ),
    } : m);
    try {
      await fetch("/api/user/txn-category", {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          stmtId: txn.stmtId,
          date: txn.date,
          amount: txn.amount,
          merchant: txn.merchant,
          category: newCategory,
        }),
      });
      requestProfileRefresh();
    } catch {
      setMerchant((m) => m ? {
        ...m,
        transactions: m.transactions.map((t) =>
          (t.stmtId === txn.stmtId && t.date === txn.date &&
            Math.round(Math.abs(t.amount) * 100) === Math.round(Math.abs(txn.amount) * 100) &&
            t.merchant === txn.merchant)
            ? { ...t, category: txn.category }
            : t,
        ),
      } : m);
    } finally {
      setSavingTxnKey(null);
    }
  }, [idToken, requestProfileRefresh]);

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-purple-200 border-t-purple-600" />
      </div>
    );
  }

  if (subOnlyRecord) {
    return (
      <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 py-8">
        <Link href="/account/spending?tab=merchants" className="mb-6 inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Merchants
        </Link>
        <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-xl font-bold text-gray-900">{subOnlyRecord.name}</h1>
              <p className="mt-1 text-sm text-gray-400">Recurring · {subOnlyRecord.frequency} · No transaction history in spending data</p>
            </div>
            <span className={`shrink-0 rounded-full border px-2.5 py-1 text-xs font-medium ${subOnlyRecord.cancelled ? "border-red-200 bg-red-50 text-red-600" : "border-emerald-200 bg-emerald-50 text-emerald-700"}`}>
              {subOnlyRecord.cancelled ? "Cancelled" : "Active"}
            </span>
          </div>
          <div className="mt-6 rounded-lg border border-amber-100 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            This item appears in your <strong>Upcoming</strong> feed because it was detected as a recurring charge, but it has no individual merchant transactions to display. If you&apos;ve cancelled it, mark it as inactive below.
          </div>
          <div className="mt-6 flex items-center gap-3">
            <button
              type="button"
              onClick={async () => {
                if (!idToken || cancelSaving) return;
                const next = !cancelled;
                setCancelled(next);
                setSubOnlyRecord((r) => r ? { ...r, cancelled: next } : r);
                setCancelSaving(true);
                try {
                  await fetch("/api/user/spending/merchant-cadence", {
                    method: "PATCH",
                    headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ slug, cancelled: next }),
                  });
                  requestProfileRefresh();
                } catch {
                  setCancelled(!next);
                  setSubOnlyRecord((r) => r ? { ...r, cancelled: !next } : r);
                } finally {
                  setCancelSaving(false);
                }
              }}
              disabled={cancelSaving || !idToken}
              className={`rounded-lg border px-4 py-2 text-sm font-medium transition disabled:opacity-50 ${cancelled ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100" : "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"}`}
            >
              {cancelSaving ? "Saving…" : cancelled ? "Reactivate (show in Upcoming)" : "Mark as cancelled (hide from Upcoming)"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (error || !merchant) {
    return (
      <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 py-12 text-center">
        <p className="text-sm text-red-500">{error ?? "Merchant not found."}</p>
        <Link href="/account/spending?tab=merchants" className="mt-4 inline-block text-sm text-purple-600 hover:underline">← Back to Merchants</Link>
      </div>
    );
  }

  // ── analytics ────────────────────────────────────────────────────────────────

  const color        = categoryColor(merchant.category);
  const sym          = getCurrencySymbol(homeCurrency);
  const activeMonths = merchant.monthly.length;
  const monthlyAvg   = activeMonths > 0 ? merchant.total / activeMonths : 0;

  // Typical trip range (P25 – P75)
  const allAmounts = merchant.transactions.map((t) => Math.abs(t.amount)).sort((a, b) => a - b);
  const tripLow  = allAmounts[Math.floor(allAmounts.length * 0.25)] ?? 0;
  const tripHigh = allAmounts[Math.floor(allAmounts.length * 0.75)] ?? 0;
  const showRange = tripHigh > tripLow * 1.1 && tripLow > 0;

  // Last 30 days
  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const last30dCount = merchant.transactions.filter(
    (t) => t.date && new Date(t.date + "T12:00:00").getTime() >= thirtyDaysAgo,
  ).length;

  // Days since last visit
  const daysSince = merchant.lastDate
    ? Math.floor((Date.now() - new Date(merchant.lastDate + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const lastVisitTxn = merchant.lastDate
    ? merchant.transactions.filter((t) => t.date === merchant.lastDate).sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0] ?? null
    : null;

  // Average gap between visits (from sorted unique dates)
  const sortedDates = [...new Set(merchant.transactions.map((t) => t.date).filter(Boolean) as string[])].sort();
  let avgGap = 0;
  let maxGap = 0;
  if (sortedDates.length >= 2) {
    let totalGap = 0;
    for (let i = 1; i < sortedDates.length; i++) {
      const g = (new Date(sortedDates[i] + "T12:00:00").getTime() - new Date(sortedDates[i - 1] + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24);
      totalGap += g;
      if (Math.round(g) > maxGap) maxGap = Math.round(g);
    }
    avgGap = Math.round(totalGap / (sortedDates.length - 1));
  }
  const isLongestGap = daysSince !== null && avgGap > 0 && daysSince >= maxGap;

  // Expected next visit
  const expectedDate = merchant.lastDate && avgGap > 0
    ? new Date(new Date(merchant.lastDate + "T12:00:00").getTime() + avgGap * 24 * 60 * 60 * 1000)
    : null;
  const daysUntilNext = expectedDate
    ? Math.ceil((expectedDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    : null;
  const cadenceProgress = daysUntilNext !== null && avgGap > 0
    ? Math.max(0, Math.min(100, Math.round(((avgGap - Math.max(0, daysUntilNext)) / avgGap) * 100)))
    : 0;
  const nextVisitLabel = daysUntilNext === null ? "—"
    : daysUntilNext <= 0 ? "Today"
    : daysUntilNext <= 7 ? "This week"
    : daysUntilNext <= 14 ? "Next week"
    : `${fmtDate(expectedDate!.toISOString().slice(0, 10))}`;

  // Use payment-style vocabulary for debt / bill merchants.
  // Check both categories (may be miscategorised by AI) and merchant name
  // (catches credit cards like "CIBC Mastercard", "TD Visa", "Scotia MC" etc.)
  const PAYMENT_CAT_KEYWORDS  = ["payment", "mortgage", "insurance", "utilities", "loan"];
  const PAYMENT_NAME_KEYWORDS = ["mastercard", "visa", "amex", "mc", "credit card", "line of credit",
                                 "mortgage", "insurance", "loan", "hydro", "hydro one", "rogers", "bell ",
                                 "telus", "internet", "utility"];
  const nameLower = merchant.name.toLowerCase();
  const isPaymentMerchant =
    merchant.categories.some((c) => PAYMENT_CAT_KEYWORDS.some((kw) => c.toLowerCase().includes(kw))) ||
    PAYMENT_NAME_KEYWORDS.some((kw) => nameLower.includes(kw));
  // Physical visit merchants (dining, groceries, retail, fuel, entertainment) use "visit/trip"
  // language. Everything else (payments, subscriptions, utilities, online) uses neutral terms.
  const VISIT_CATEGORIES = ["dining", "restaurant", "groceries", "grocery", "shopping",
                            "retail", "gas", "fuel", "entertainment", "clothing", "coffee"];
  const isVisitMerchant =
    !isPaymentMerchant &&
    merchant.categories.some((c) => VISIT_CATEGORIES.some((kw) => c.toLowerCase().includes(kw)));

  const vocab = {
    visit:         isPaymentMerchant ? "payment"  : isVisitMerchant ? "visit"  : "charge",
    visits:        isPaymentMerchant ? "payments" : isVisitMerchant ? "visits" : "charges",
    trip:          isPaymentMerchant ? "payment"  : isVisitMerchant ? "trip"   : "charge",
    largeTrip:     isPaymentMerchant ? "large payment"  : isVisitMerchant ? "large trip"   : "large charge",
    largeVisits:   isPaymentMerchant ? "large payments" : isVisitMerchant ? "large visits" : "large charges",
    tripLabel:     isPaymentMerchant ? "Typical amount" : isVisitMerchant ? "Typical trip" : "Typical charge",
    tripDistTitle: isPaymentMerchant ? "Payment distribution"  : isVisitMerchant ? "Trip size distribution"  : "Charge distribution",
    lastVisit:     isPaymentMerchant ? "Last Payment"          : isVisitMerchant ? "Last Visit"              : "Last Charge",
    nextVisit:     isPaymentMerchant ? "Expected Next Payment" : isVisitMerchant ? "Expected Next Visit"     : "Expected Next Charge",
    cadence:       isPaymentMerchant ? "payment schedule"      : isVisitMerchant ? "cadence"                 : "billing cadence",
    cadenceCard:   isPaymentMerchant ? "Consistent payment schedule." : isVisitMerchant ? "Consistent visit cadence." : "Consistent billing cadence.",
  };

  // Category share + rank
  const categoryShare = categoryTotal > 0 ? Math.round((merchant.total / categoryTotal) * 100) : null;
  const allCatMerchants = [{ total: merchant.total }, ...categoryPeers].sort((a, b) => b.total - a.total);
  const merchantRank = allCatMerchants.findIndex((m) => m.total === merchant.total) + 1;

  // Stacked bar items
  const stackedItems: { name: string; total: number; color: string }[] = [
    { name: merchant.name, total: merchant.total, color },
    ...categoryPeers.map((p, i) => ({ name: p.name, total: p.total, color: PEER_COLORS[i % PEER_COLORS.length] })),
  ].sort((a, b) => b.total - a.total);
  const peersAccountedFor = stackedItems.reduce((s, x) => s + x.total, 0);
  const otherTotal = Math.max(0, categoryTotal - peersAccountedFor);
  if (otherTotal > 1) stackedItems.push({ name: "Other", total: otherTotal, color: "#e5e7eb" });

  // Outlier month
  const outlierMonth = merchant.monthly.length >= 3 && monthlyAvg > 0
    ? merchant.monthly.reduce<{ ym: string; total: number; count: number; pct: number; bigTxn?: (typeof merchant.transactions)[0] } | null>(
        (best, m) => {
          const pct = Math.round(((m.total - monthlyAvg) / monthlyAvg) * 100);
          if (pct < 25) return best;
          if (!best || pct > best.pct) {
            const bigTxn = merchant.transactions
              .filter((t) => t.ym === m.ym)
              .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
            return { ...m, pct, bigTxn };
          }
          return best;
        },
        null,
      )
    : null;

  // Annual pace vs last year
  const thisYear = new Date().getFullYear();
  const lastYearTotal = merchant.transactions
    .filter((t) => t.date?.startsWith(String(thisYear - 1)))
    .reduce((s, t) => s + Math.abs(t.amount), 0);
  const annualPace = monthlyAvg * 12;
  const annualDiff = lastYearTotal > 50 ? annualPace - lastYearTotal : null;
  const annualRounded = Math.round(annualPace / 50) * 50;
  const insightText =
    annualDiff !== null && Math.abs(annualDiff) > 50
      ? `At your current pace, you'll spend ~${formatCurrency(annualRounded, homeCurrency, undefined, true)} at ${merchant.name} this year — about ${formatCurrency(Math.abs(Math.round(annualDiff / 50) * 50), homeCurrency, undefined, true)} ${annualDiff > 0 ? "more" : "less"} than last year's run rate.`
      : annualPace > 50
      ? `At your current pace, you'll spend ~${formatCurrency(annualRounded, homeCurrency, undefined, true)} at ${merchant.name} this year.`
      : null;

  // Trip size distribution
  const tripBuckets = [
    { label: `<${sym}50`,        min: 0,   max: 50 },
    { label: `${sym}50–100`,     min: 50,  max: 100 },
    { label: `${sym}100–200`,    min: 100, max: 200 },
    { label: `${sym}200–500`,    min: 200, max: 500 },
    { label: `${sym}500+`,       min: 500, max: Infinity },
  ].map((b) => ({
    ...b,
    count: merchant.transactions.filter((t) => {
      const amt = Math.abs(t.amount);
      return amt >= b.min && amt < b.max;
    }).length,
  })).filter((b) => b.count > 0);
  const maxBucketCount = Math.max(...tripBuckets.map((b) => b.count), 1);

  // Chart data
  const chartData = merchant.monthly.map((m) => ({
    label: shortMonth(m.ym), ym: m.ym, total: m.total, count: m.count,
  }));

  // Sort + filter transactions
  const filteredTxns = selectedYm
    ? merchant.transactions.filter((t) => t.ym === selectedYm)
    : merchant.transactions;
  const sortedTxns = [...filteredTxns].sort((a, b) => {
    if (sortField === "date") {
      const cmp = (a.date ?? a.ym).localeCompare(b.date ?? b.ym);
      return sortDir === "desc" ? -cmp : cmp;
    }
    const cmp = Math.abs(a.amount) - Math.abs(b.amount);
    return sortDir === "desc" ? -cmp : cmp;
  });

  const merchantRow = merchant;

  async function handleMerchantCategorySelect(newCategory: string) {
    setCategoryPickerOpen(false);
    if (!idToken) return;
    const prevCategory = merchantRow.category;
    setMerchant((m) => (m ? { ...m, category: newCategory } : m));
    try {
      const res = await fetch("/api/user/category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant: merchantRow.name, category: newCategory }),
      });
      if (res.ok) requestProfileRefresh();
    } catch {
      setMerchant((m) => (m ? { ...m, category: prevCategory } : m));
    }
  }


  async function handleMergeSimilar() {
    if (!idToken || mergeSelected.size === 0 || !merchant) return;
    setMergingHere(true);
    try {
      const { pairKey, normaliseName } = await import("@/lib/sourceMappings");
      const aliases = similarMerchants.filter((m) => mergeSelected.has(m.slug));
      const mappings = aliases.map((alias) => ({
        pairKey:      pairKey(merchant.name, alias.name),
        type:         "expense" as const,
        canonical:    merchant.name,
        alias:        alias.name,
        confidence:   "high" as const,
        status:       "confirmed" as const,
        createdAt:    new Date().toISOString(),
        affectsCache: merchant.category !== alias.category,
      }));
      await fetch("/api/user/source-mappings", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}`, "Content-Type": "application/json" },
        body: JSON.stringify({ mappings }),
      });
      const mergedNames = new Set(aliases.map((a) => normaliseName(a.name)));
      setMergeSelected(new Set());
      if (mappings.some((m) => m.affectsCache)) requestProfileRefresh();

      // Brief pause so Firestore write propagates before we re-query
      await new Promise((r) => setTimeout(r, 600));

      // Reload merchant data so alias transactions fold into this merchant immediately.
      // cache: "no-store" prevents the browser from serving a stale cached response.
      const res = await fetch(
        `/api/user/spending/merchants?slug=${encodeURIComponent(slug)}`,
        { headers: { Authorization: `Bearer ${idToken}` }, cache: "no-store" },
      );
      const json = await res.json().catch(() => ({}));
      if (json.merchant) {
        setMerchant(json.merchant);
        setCategoryPeers(json.categoryPeers ?? []);
        setCategoryTotal(json.categoryTotal ?? 0);
      }
      // Remove any similar merchants that were just merged
      setSimilarMerchants((prev) => prev.filter((m) => !mergedNames.has(normaliseName(m.name))));
    } finally {
      setMergingHere(false);
    }
  }

  // ── render ────────────────────────────────────────────────────────────────────

  return (
    <MerchantForecastProvider slug={slug} merchantName={merchant.name} avgAmount={merchant.avgAmount} lastSeenDate={merchant.lastDate} idToken={idToken}>
      <div className="mx-auto max-w-2xl lg:max-w-5xl space-y-4 px-4 py-6">

        {/* Back nav */}
        <Link href="/account/spending?tab=merchants" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700">
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
          </svg>
          Merchants
        </Link>

        {/* ── Similar merchants — collapsible banner at top ── */}
        {similarMerchants.length > 0 && (
          <div className="overflow-hidden rounded-xl border border-amber-200 bg-amber-50/50">
            {/* Header row — always visible; div avoids nested-button hydration error */}
            <div
              role="button"
              tabIndex={0}
              onClick={() => setSimilarExpanded((v) => !v)}
              onKeyDown={(e) => e.key === "Enter" && setSimilarExpanded((v) => !v)}
              className="flex w-full cursor-pointer items-center gap-2 px-4 py-3 text-left"
            >
              <svg className="h-4 w-4 shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
              </svg>
              <p className="flex-1 text-sm font-semibold text-amber-900">
                {similarMerchants.length} similar merchant{similarMerchants.length !== 1 ? "s" : ""} found
              </p>
              {mergeSelected.size >= 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); void handleMergeSimilar(); }}
                  disabled={mergingHere}
                  className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-600 disabled:opacity-50 transition"
                >
                  {mergingHere ? "Merging…" : `Merge ${mergeSelected.size} in`}
                </button>
              )}
              <svg
                className={`h-4 w-4 shrink-0 text-amber-400 transition-transform duration-200 ${similarExpanded ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </div>

            {/* Expandable body */}
            {similarExpanded && (
              <div className="border-t border-amber-100">
                <p className="px-4 py-2 text-xs text-amber-600">
                  These may be the same place — merge them into <span className="font-semibold">{merchant.name}</span>
                </p>
                <div className="divide-y divide-amber-100/60 border-t border-amber-100/60">
                  {similarMerchants.map((m) => {
                    const isChecked = mergeSelected.has(m.slug);
                    const allTotal = m.monthly.reduce((s, mo) => s + mo.total, 0);
                    const allCount = m.monthly.reduce((s, mo) => s + mo.count, 0);
                    return (
                      <button
                        key={m.slug}
                        onClick={() => {
                          const next = new Set(mergeSelected);
                          next.has(m.slug) ? next.delete(m.slug) : next.add(m.slug);
                          setMergeSelected(next);
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition hover:bg-amber-50/60 ${isChecked ? "bg-amber-50/60" : ""}`}
                      >
                        <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition ${isChecked ? "border-amber-500 bg-amber-500" : "border-gray-300 bg-white hover:border-amber-400"}`}>
                          {isChecked && (
                            <svg className="h-2.5 w-2.5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-gray-800">{m.name}</p>
                          <p className="mt-0.5 text-xs text-gray-500">
                            {allCount} {vocab.visit}{allCount !== 1 ? "s" : ""} · {formatCurrency(allTotal, homeCurrency, m.currency, true)} total
                            {m.category && m.category !== merchant.category && (
                              <span className="ml-1.5 text-amber-600">· {m.category}</span>
                            )}
                          </p>
                        </div>
                        <p className="shrink-0 text-sm font-semibold text-gray-700 tabular-nums">
                          {formatCurrency(allTotal, homeCurrency, m.currency, true)}
                        </p>
                      </button>
                    );
                  })}
                </div>
                <div className="flex items-center justify-between border-t border-amber-100 px-4 py-2">
                  <p className="text-xs text-amber-500">
                    {mergeSelected.size === 0 ? "Select entries above to merge them here" : `${mergeSelected.size} selected`}
                  </p>
                  <button
                    onClick={() => setMergeSelected(
                      mergeSelected.size === similarMerchants.length
                        ? new Set()
                        : new Set(similarMerchants.map((m) => m.slug)),
                    )}
                    className="text-xs font-semibold text-amber-600 hover:text-amber-800 transition"
                  >
                    {mergeSelected.size === similarMerchants.length ? "Clear" : "Select all"}
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Hero ── */}
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">
            Total Spent · {merchant.name}
          </p>
          <p className="mt-0.5 text-4xl font-bold tracking-tight text-gray-900">
            {formatCurrency(merchant.total, homeCurrency, undefined, true)}
          </p>
          <p className="mt-1 text-sm text-gray-400">
            {formatCurrency(monthlyAvg, homeCurrency, undefined, true)}/mo avg · {activeMonths} active month{activeMonths !== 1 ? "s" : ""}
          </p>
          {/* Inline controls — cadence + status only; category lives on transactions */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {/* Category pills derived from transactions (read-only) */}
            {(merchant.categories ?? [merchant.category]).slice(0, 3).map((cat) => (
              <span
                key={cat}
                className="inline-flex items-center gap-1 rounded-full border border-gray-100 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-600"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: categoryColor(cat) }} />
                {cat}
              </span>
            ))}
            {(merchant.categories ?? []).length > 3 && (
              <span className="text-xs text-gray-400">+{(merchant.categories).length - 3} more</span>
            )}
            <span className="text-gray-200">·</span>
            <MerchantSpendCadencePill />
            <button
              type="button"
              onClick={handleCancelledToggle}
              disabled={cancelSaving}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition disabled:opacity-60 ${
                cancelled
                  ? "border-red-200 bg-red-50 text-red-600 hover:bg-red-100"
                  : "border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300 hover:bg-gray-100"
              }`}
            >
              <span className={`h-1.5 w-1.5 rounded-full ${cancelled ? "bg-red-400" : "bg-emerald-400"}`} />
              {cancelled ? "Cancelled" : "Active"}
            </button>
          </div>
        </div>

        {/* ── AI insight banner ── */}
        {insightText && (
          <div className="flex gap-3 rounded-xl border border-indigo-100 bg-indigo-50/70 px-4 py-3">
            <span className="mt-0.5 shrink-0 text-indigo-400">✦</span>
            <p className="text-sm text-indigo-900 leading-relaxed">{insightText}</p>
          </div>
        )}

        {/* ── Stats 3-col ── */}
        <div className="grid grid-cols-3 divide-x divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="px-4 py-3.5">
            <p className="text-[11px] text-gray-400">Transactions</p>
            <p className="mt-0.5 text-2xl font-bold text-gray-900">{merchant.count}</p>
            <p className="text-[11px] text-gray-400">{last30dCount} in last 30d</p>
          </div>
          <div className="px-4 py-3.5">
            <p className="text-[11px] text-gray-400">{vocab.tripLabel}</p>
            <p className="mt-0.5 text-base font-bold text-gray-900 tabular-nums">
              {showRange
                ? `${formatCurrency(Math.round(tripLow / 5) * 5, homeCurrency, undefined, true)}–${formatCurrency(Math.round(tripHigh / 5) * 5, homeCurrency, undefined, true)}`
                : formatCurrency(merchant.avgAmount, homeCurrency, undefined, true)}
            </p>
            <p className="text-[11px] text-gray-400">avg {fmtDec(merchant.avgAmount, homeCurrency)}</p>
          </div>
          {categoryShare !== null ? (
            <div className="px-4 py-3.5">
              <p className="text-[11px] text-gray-400">Share of {merchant.category}</p>
              <p className="mt-0.5 text-2xl font-bold text-gray-900">{categoryShare}%</p>
              <p className="text-[11px] text-gray-400">#{merchantRank} {merchant.category} merchant</p>
            </div>
          ) : (
            <div className="px-4 py-3.5">
              <p className="text-[11px] text-gray-400">Active months</p>
              <p className="mt-0.5 text-2xl font-bold text-gray-900">{activeMonths}</p>
              <p className="text-[11px] text-gray-400">first seen {fmtDate(merchant.firstDate ?? merchant.monthly[0]?.ym ?? "")}</p>
            </div>
          )}
        </div>

        {/* ── Last visit / Expected next visit ── */}
        {daysSince !== null && (
          <div className="grid grid-cols-2 divide-x divide-gray-100 overflow-hidden rounded-xl border border-gray-200 bg-white">
            <div className="px-4 py-4">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{vocab.lastVisit}</p>
              <p className="mt-1.5 text-2xl font-bold text-gray-900">
                {daysSince === 0 ? "Today" : daysSince === 1 ? "Yesterday" : `${daysSince} days ago`}
              </p>
              <p className="mt-0.5 text-xs text-gray-600">
                {fmtDate(merchant.lastDate!)}
                {lastVisitTxn ? ` · ${formatCurrency(Math.abs(lastVisitTxn.amount), homeCurrency, lastVisitTxn.currency, true)}` : ""}
              </p>
              {isLongestGap && (
                <p className="mt-1 text-[11px] text-amber-600">Your longest gap yet (typical {avgGap}d)</p>
              )}
            </div>
            {avgGap > 0 ? (
              <div className="px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">{vocab.nextVisit}</p>
                <p className="mt-1.5 text-2xl font-bold text-gray-900">{nextVisitLabel}</p>
                <p className="mt-0.5 text-xs text-gray-400">Based on {avgGap}-day {vocab.cadence}</p>
                <div className="mt-2.5 h-1.5 w-full overflow-hidden rounded-full bg-gray-100">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{ width: `${cadenceProgress}%`, backgroundColor: color }}
                  />
                </div>
              </div>
            ) : (
              <div className="px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">First Seen</p>
                <p className="mt-1.5 text-sm font-semibold text-gray-700">{fmtDateLong(merchant.firstDate ?? merchant.monthly[0]?.ym ?? "")}</p>
              </div>
            )}
          </div>
        )}

        {/* ── Share of category stacked bar ── */}
        {categoryPeers.length > 0 && categoryTotal > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="text-sm font-semibold text-gray-700">Share of {merchant.category}</p>
            <p className="mt-0.5 text-[11px] text-gray-400">
              Last {activeMonths} month{activeMonths !== 1 ? "s" : ""} · {formatCurrency(categoryTotal, homeCurrency, undefined, true)} total
            </p>
            <div className="mt-3 flex h-5 w-full overflow-hidden rounded-full">
              {stackedItems.map((item) => (
                <div
                  key={item.name}
                  style={{ width: `${(item.total / categoryTotal) * 100}%`, backgroundColor: item.color }}
                  title={`${item.name}: ${Math.round((item.total / categoryTotal) * 100)}%`}
                />
              ))}
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
              {stackedItems.map((item) => (
                <div key={item.name} className="flex items-center gap-1.5 text-xs">
                  <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: item.color }} />
                  <span className="text-gray-600">{item.name} {Math.round((item.total / categoryTotal) * 100)}%</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Monthly spending bar chart ── */}
        {chartData.length >= 2 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-semibold text-gray-700">Monthly spending</p>
                <p className="text-[11px] text-gray-400">Tap a bar to filter transactions</p>
              </div>
              {selectedYm && (
                <button
                  onClick={() => setSelectedYm(null)}
                  className="rounded-full bg-gray-100 px-3 py-1 text-xs font-medium text-gray-600 hover:bg-gray-200 transition"
                >
                  {shortMonth(selectedYm)} ✕
                </button>
              )}
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} style={{ outline: "none" }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                  <YAxis tickFormatter={(v) => fmtAxis(v, sym)} tick={{ fontSize: 11, fill: "#9ca3af" }} tickLine={false} axisLine={false} width={48} />
                  <Tooltip
                    formatter={(v) => [fmtDec(Number(v), homeCurrency), "Spent"]}
                    contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e7eb" }}
                    cursor={{ fill: "rgba(0,0,0,0.04)" }}
                  />
                  <Bar
                    dataKey="total"
                    radius={[4, 4, 0, 0]}
                    style={{ cursor: "pointer" }}
                    onClick={(data) => {
                      const ym = (data as unknown as { ym?: string })?.ym ?? null;
                      setSelectedYm((prev) => prev === ym ? null : ym);
                    }}
                  >
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.ym}
                        fill={outlierMonth?.ym === entry.ym && !selectedYm ? "#f97316" : color}
                        opacity={!selectedYm || entry.ym === selectedYm ? 1 : 0.35}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
            {outlierMonth && !selectedYm && (
              <p className="mt-2 text-xs text-gray-500">
                <span className="font-semibold text-orange-500">{shortMonth(outlierMonth.ym)}</span> was{" "}
                <span className="font-medium text-gray-700">{outlierMonth.pct}% above typical.</span>
                {outlierMonth.bigTxn && outlierMonth.bigTxn.date
                  ? ` One ${outlierMonth.pct > 50 ? "large" : "notable"} ${vocab.trip} on ${fmtDate(outlierMonth.bigTxn.date)} (${formatCurrency(Math.abs(outlierMonth.bigTxn.amount), homeCurrency, outlierMonth.bigTxn.currency, true)}) drove most of the spike.`
                  : ""}
              </p>
            )}
          </div>
        )}

        {/* ── Insight cards ── */}
        {outlierMonth && (
          <InsightCard icon="warn">
            <span className="font-semibold">{shortMonth(outlierMonth.ym)}</span> was {outlierMonth.pct}% above your typical month.
            {outlierMonth.bigTxn?.date
              ? ` One ${outlierMonth.pct > 50 ? "large" : "notable"} ${vocab.trip} on ${fmtDate(outlierMonth.bigTxn.date)} (${formatCurrency(Math.abs(outlierMonth.bigTxn.amount), homeCurrency, outlierMonth.bigTxn.currency, true)}) drove most of the spike — similar in size to your previous ${vocab.largeVisits}.`
              : ""}
          </InsightCard>
        )}
        {avgGap > 0 && merchant.count >= 5 && (
          <InsightCard icon="check">
            <span className="font-semibold">{vocab.cadenceCard}</span>{" "}
            {merchant.count} {vocab.visit}{merchant.count !== 1 ? "s" : ""} in {activeMonths} month{activeMonths !== 1 ? "s" : ""} with a typical {avgGap}-day gap — this is a predictable pattern we can use in forecasts.
          </InsightCard>
        )}
        {annualDiff !== null && Math.abs(annualDiff) > 50 && (
          <InsightCard icon="info">
            At your current pace, you&apos;ll spend{" "}
            <span className="font-semibold">~{formatCurrency(annualRounded, homeCurrency, undefined, true)}</span>{" "}
            at {merchant.name} this year — about{" "}
            <span className="font-semibold">{formatCurrency(Math.abs(Math.round(annualDiff / 50) * 50), homeCurrency, undefined, true)}</span>{" "}
            {annualDiff > 0 ? "more" : "less"} than last year&apos;s run rate.
          </InsightCard>
        )}

        {/* ── Trip size distribution ── */}
        {tripBuckets.length > 1 && (
          <div className="rounded-xl border border-gray-200 bg-white p-4">
            <p className="mb-3 text-sm font-semibold text-gray-700">
              {vocab.tripDistTitle} · {merchant.count} {vocab.visits}
            </p>
            <div className="space-y-2">
              {tripBuckets.map((b) => (
                <div key={b.label} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 text-right text-gray-500">{b.label}</span>
                  <div className="flex-1 overflow-hidden rounded-sm bg-gray-100" style={{ height: 16 }}>
                    <div
                      className="h-full rounded-sm transition-all"
                      style={{ width: `${Math.round((b.count / maxBucketCount) * 100)}%`, backgroundColor: color + "cc" }}
                    />
                  </div>
                  <span className="w-5 shrink-0 text-gray-400">{b.count}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Transaction list ── */}
        <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
          <div className="flex items-center justify-between px-5 pt-4 pb-2">
            <p className="text-sm font-semibold text-gray-700">
              {selectedYm ? `${shortMonth(selectedYm)} transactions` : "All transactions"}
              <span className="ml-1 text-xs font-normal text-gray-400">({sortedTxns.length})</span>
            </p>
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">Sort:</span>
              {(["date", "amount"] as const).map((field) => {
                const active = sortField === field;
                return (
                  <button
                    key={field}
                    onClick={() => toggleSort(field)}
                    className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-xs font-medium transition capitalize ${active ? "bg-gray-100 text-gray-700" : "text-gray-400 hover:text-gray-600"}`}
                  >
                    {field}
                    {active && (
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round"
                          d={sortDir === "desc" ? "M19 9l-7 7-7-7" : "M5 15l7-7 7 7"} />
                      </svg>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="divide-y divide-gray-100">
            {sortedTxns.map((txn, i) => {
              const isLargeTrip = outlierMonth && txn.ym === outlierMonth.ym && txn.date === outlierMonth.bigTxn?.date;
              const key = txn.stmtId ? txnKey(txn.stmtId, txn) : `fallback-${i}`;
              const isSaving = savingTxnKey === key;
              return (
                <div key={i} className="flex items-center justify-between px-5 py-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-xs text-gray-500">
                        {txn.date ? fmtDate(txn.date) : shortMonth(txn.ym)}
                      </p>
                      {txn.accountLabel && (
                        <span className="text-xs text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">{txn.accountLabel}</span>
                      )}
                      {isLargeTrip && (
                        <span className="text-[10px] font-medium text-orange-600 bg-orange-50 rounded px-1.5 py-0.5">{vocab.largeTrip}</span>
                      )}
                    </div>
                    {/* Category badge — tappable inline picker */}
                    <div className="relative mt-0.5">
                      <button
                        ref={(el) => { if (el) txnPickerBtnRefs.current.set(key, el); else txnPickerBtnRefs.current.delete(key); }}
                        type="button"
                        disabled={isSaving || !txn.stmtId}
                        onClick={() => setTxnPickerKey((prev) => prev === key ? null : key)}
                        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs transition
                          ${txn.stmtId ? "cursor-pointer hover:ring-2 hover:ring-offset-1" : "cursor-default"}
                          ${isSaving ? "opacity-50" : ""}`}
                        style={{
                          backgroundColor: categoryColor(txn.category) + "18",
                          color: categoryColor(txn.category),
                          // @ts-expect-error CSS variable
                          "--tw-ring-color": categoryColor(txn.category) + "60",
                        }}
                        title={txn.stmtId ? "Change category" : undefined}
                      >
                        {isSaving
                          ? <span className="h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
                          : <svg className="h-2.5 w-2.5 opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>}
                        <span className="capitalize">{txn.category}</span>
                      </button>
                      {txnPickerKey === key && txnPickerBtnRefs.current.get(key) && (
                        <CategoryPicker
                          anchorRef={{ current: txnPickerBtnRefs.current.get(key)! }}
                          current={txn.category}
                          onSelect={(cat) => void handleTxnCategorySelect(key, cat, txn)}
                          onClose={() => setTxnPickerKey(null)}
                        />
                      )}
                    </div>
                  </div>
                  <p className="ml-4 shrink-0 text-sm font-semibold text-gray-800 tabular-nums">
                    −{fmtDec(Math.abs(txn.amount), txn.currency ?? homeCurrency)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>



      </div>
    </MerchantForecastProvider>
  );
}
