"use client";

import { Suspense } from "react";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  AreaChart, Area, XAxis, YAxis, CartesianGrid,
} from "recharts";
import Link from "next/link";
import type { ManualAsset, AssetCategory, Insight } from "@/lib/types";
import type { AccountSnapshot } from "@/lib/extractTransactions";
import type { AccountBalanceHistory } from "@/lib/financialProfile";
import { fmt, getCurrencySymbol, formatCurrency } from "@/lib/currencyUtils";

// ── constants ─────────────────────────────────────────────────────────────────

export const CATEGORY_META: Record<AssetCategory, { label: string; emoji: string; color: string; hint: string }> = {
  property:   { label: "Property",   emoji: "🏠", color: "bg-blue-50   border-blue-200   text-blue-800",  hint: "Home, land, rental property" },
  vehicle:    { label: "Vehicle",    emoji: "🚗", color: "bg-sky-50    border-sky-200    text-sky-800",   hint: "Car, motorcycle, boat" },
  retirement: { label: "Retirement", emoji: "🏦", color: "bg-green-50  border-green-200  text-green-800", hint: "Pension, 401k, IRA not linked to a statement" },
  investment: { label: "Investment", emoji: "📈", color: "bg-purple-50 border-purple-200 text-purple-800", hint: "Stocks, funds, crypto not in a statement" },
  business:   { label: "Business",   emoji: "💼", color: "bg-amber-50  border-amber-200  text-amber-800", hint: "Business equity, partnerships" },
  other:      { label: "Other",      emoji: "💎", color: "bg-gray-50   border-gray-200   text-gray-700",  hint: "Jewellery, art, collectibles, etc." },
};

const CATEGORY_ORDER: AssetCategory[] = ["property", "vehicle", "retirement", "investment", "business", "other"];

const CHART_GROUPS: { key: string; label: string; color: string; categories: AssetCategory[]; accountTypes: string[] }[] = [
  { key: "real_estate", label: "Real Estate",  color: "#6366f1", categories: ["property"],   accountTypes: [] },
  { key: "retirement",  label: "RRSP / TFSA",  color: "#22c55e", categories: ["retirement"], accountTypes: [] },
  { key: "cash",        label: "Cash",          color: "#f59e0b", categories: [],             accountTypes: ["checking", "savings"] },
  { key: "investments", label: "Investments",   color: "#3b82f6", categories: ["investment"], accountTypes: ["investment"] },
  { key: "vehicles",    label: "Vehicles",      color: "#94a3b8", categories: ["vehicle"],    accountTypes: [] },
  { key: "business",    label: "Business",      color: "#f97316", categories: ["business"],   accountTypes: [] },
  { key: "other",       label: "Other",         color: "#d1d5db", categories: ["other"],      accountTypes: [] },
];

const LIQUID_ACCOUNT_TYPES    = new Set(["checking", "savings", "investment"]);
const LIQUID_ASSET_CATEGORIES = new Set<AssetCategory>(["investment"]);

// ── tabs ──────────────────────────────────────────────────────────────────────

const TABS = [
  { id: "overview",  label: "Overview" },
  { id: "accounts",  label: "Accounts" },
  { id: "tracked",   label: "Tracked Assets" },
] as const;
type TabId = typeof TABS[number]["id"];

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtShort(v: number, currency?: string) {
  const sym = getCurrencySymbol(currency);
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}${sym}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}${sym}${Math.round(abs / 1_000)}k`;
  return fmt(v, currency);
}
function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30)  return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}
// Freshness: days since a YYYY-MM string (treated as 1st of that month)
function daysSinceYearMonth(ym?: string): number | null {
  if (!ym) return null;
  const d = new Date(ym + "-01T12:00:00");
  if (isNaN(d.getTime())) return null;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}
function freshnessLabel(days: number | null): { text: string; cls: string } {
  if (days === null) return { text: "", cls: "" };
  const mo = Math.floor(days / 30);
  const label = mo === 0 ? `${days}d ago` : mo === 1 ? "1 mo ago" : `${mo} mo ago`;
  if (days < 35)  return { text: label, cls: "text-gray-400" };
  if (days < 65)  return { text: label, cls: "text-amber-500 font-medium" };
  return             { text: label, cls: "text-red-500 font-medium" };
}
function freshnessGlyph(days: number | null): string {
  if (days === null || days < 35) return "";
  if (days < 65) return "⚠ ";
  return "⚠ ";
}

// ── per-account monthly history ───────────────────────────────────────────────

interface AssetAccountMonthly {
  slug: string;
  label: string;
  accountType: string;
  color: string;
  months: { ym: string; balance: number }[];
  currentBalance: number;
  prevBalance: number | null;
  delta: number | null; // positive = grew (good), negative = shrunk
}

function Sparkline({ values, good }: { values: number[]; good: "up" | "down" }) {
  if (values.length < 2) return null;
  const W = 64, H = 24, PAD = 2;
  const min = Math.min(...values), max = Math.max(...values);
  const range = max - min || 1;
  const xs = values.map((_, i) => PAD + (i / (values.length - 1)) * (W - PAD * 2));
  const ys = values.map((v) => H - PAD - ((v - min) / range) * (H - PAD * 2));
  const pts = xs.map((x, i) => `${x},${ys[i]}`).join(" ");
  const first = values[0], last = values[values.length - 1];
  const trending = good === "up" ? last >= first : last <= first;
  const strokeColor = trending ? "#16a34a" : "#dc2626";
  return (
    <svg width={W} height={H} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={strokeColor} strokeWidth={1.5}
        strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={2.5} fill={strokeColor} />
    </svg>
  );
}

// ── types ─────────────────────────────────────────────────────────────────────

interface FormState { label: string; category: AssetCategory; value: string; linkedAccountSlug: string; }
const EMPTY_FORM: FormState = { label: "", category: "property", value: "", linkedAccountSlug: "" };

// ── donut chart ───────────────────────────────────────────────────────────────

function DonutChart({ data, total, homeCurrency = "USD" }: { data: { label: string; value: number; color: string }[]; total: number; homeCurrency?: string }) {
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={44} outerRadius={68}
              paddingAngle={2} dataKey="value" strokeWidth={0}>
              {data.map((entry, i) => <Cell key={i} fill={entry.color} />)}
            </Pie>
            <Tooltip
              formatter={(value) => [typeof value === "number" ? formatCurrency(value, homeCurrency, undefined, true) : String(value)]}
              contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "12px" }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-bold text-gray-900">{formatCurrency(total, homeCurrency, undefined, true)}</span>
          <span className="text-xs text-gray-400">assets</span>
        </div>
      </div>
      <div className="flex-1 space-y-2">
        {data.map((d) => {
          const pct = total > 0 ? Math.round((d.value / total) * 100) : 0;
          return (
            <div key={d.label} className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: d.color }} />
                <span className="truncate text-sm text-gray-700">{d.label}</span>
              </div>
              <div className="flex items-center gap-2 shrink-0 text-sm">
                <span className="font-medium text-gray-800">{formatCurrency(d.value, homeCurrency, undefined, true)}</span>
                <span className="w-8 text-right text-xs text-gray-400">{pct}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── main component ────────────────────────────────────────────────────────────

export function AssetsPage() {
  const router       = useRouter();
  const pathname     = usePathname();
  const searchParams = useSearchParams();
  const prefillLink  = searchParams.get("link");
  const prefillCategory = searchParams.get("category") as AssetCategory | null;

  const [activeTab, setActiveTab] = useState<TabId>(() => {
    const t = searchParams.get("tab");
    return TABS.some((tb) => tb.id === t) ? (t as TabId) : "overview";
  });

  const [assets, setAssets]                       = useState<ManualAsset[]>([]);
  const [currencyOverrides, setCurrencyOverrides]   = useState<Record<string, string>>({});
  const [fxRates, setFxRates]                       = useState<Record<string, number>>({});
  const [homeCurrency, setHomeCurrency]             = useState<string>("USD");
  // Single pipeline: account data comes from the financial profile cache via consolidated API
  const [accountSnapshots, setAccountSnapshots]     = useState<AccountSnapshot[]>([]);
  const [accountBalanceHistory, setAccountBalanceHistory] = useState<AccountBalanceHistory[]>([]);
  const [insights, setInsights]               = useState<Insight[]>([]);
  const [yearMonth, setYearMonth]             = useState<string | null>(null);
  const [assetHistory, setAssetHistory]       = useState<{ ym: string; label: string; total: number; debt: number }[]>([]);
  const [accountMonthly, setAccountMonthly]   = useState<AssetAccountMonthly[]>([]);
  const [selectedAssetYm, setSelectedAssetYm] = useState<string | null>(null);
  const [loading, setLoading]                 = useState(true);
  const [error, setError]                     = useState<string | null>(null);
  const [token, setToken]                     = useState<string | null>(null);

  const [showForm, setShowForm]         = useState(false);
  const [editing, setEditing]           = useState<ManualAsset | null>(null);
  const [form, setForm]                 = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving]             = useState(false);
  const [formError, setFormError]       = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // Balance snapshot (manual balance update) state
  const [snapshotTarget,  setSnapshotTarget]  = useState<AccountSnapshot | null>(null);
  const [snapshotBalance, setSnapshotBalance] = useState("");
  const [snapshotMonth,   setSnapshotMonth]   = useState("");
  const [snapshotNote,    setSnapshotNote]    = useState("");
  const [snapshotSaving,  setSnapshotSaving]  = useState(false);
  const [snapshotError,   setSnapshotError]   = useState<string | null>(null);

  function switchTab(id: TabId) {
    setActiveTab(id);
    const p = new URLSearchParams(searchParams.toString());
    p.set("tab", id);
    router.replace(`${pathname}?${p.toString()}`, { scroll: false });
  }

  const load = useCallback(async (tok: string) => {
    setLoading(true); setError(null);
    try {
      // Single pipeline: all account data flows through the financial profile cache.
      // Only /api/user/assets (manual assets) and /api/user/account-currencies are
      // fetched separately because they are user-edited, not statement-derived.
      const [aRes, cRes, currRes] = await Promise.all([
        fetch("/api/user/assets",                  { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/account-currencies",      { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      const aJson    = await aRes.json().catch(() => ({}));
      const cJson    = cRes.ok ? await cRes.json().catch(() => ({})) : {};
      const currJson = currRes.ok ? await currRes.json().catch(() => ({})) : {};

      setCurrencyOverrides(currJson.overrides ?? {});
      setFxRates(cJson.fxRates ?? {});
      setHomeCurrency(cJson.homeCurrency ?? "USD");
      setAssets(aJson.assets ?? []);
      setInsights(cJson.data?.insights ?? []);
      setYearMonth(cJson.yearMonth ?? null);

      // Account data — from the financial profile cache (already has balance-snapshot
      // overrides, currency overrides, and FX metadata applied server-side)
      setAccountSnapshots(cJson.accountSnapshots ?? []);
      setAccountBalanceHistory(cJson.accountBalanceHistory ?? []);

      // Asset growth chart: carry-forward from accountBalanceHistory (includes synthetic
      // backfill months) + manual assets each month — mirrors liabilities debt chart logic.
      const ASSET_TYPES = new Set(["checking", "savings", "investment", "other"]);
      const DEBT_TYPES_SET = new Set(["credit", "mortgage", "loan"]);
      const balHist = (cJson.accountBalanceHistory as AccountBalanceHistory[] ?? []);
      const assetBalHist = balHist.filter((h) => ASSET_TYPES.has(h.accountType));
      const debtBalHistForHist = balHist.filter(
        (h) => DEBT_TYPES_SET.has(h.accountType) || h.entries.some((e) => e.balance < 0),
      );
      const monthSet = new Set<string>(
        assetBalHist.flatMap((h) => h.entries.map((e) => e.yearMonth)),
      );
      for (const row of cJson.history ?? []) {
        if (row.yearMonth) monthSet.add(row.yearMonth);
      }
      const allAssetMonths = Array.from(monthSet).sort();
      const manualAssetsTotal = (aJson.assets ?? []).reduce(
        (s: number, ma: ManualAsset) => s + (ma.value ?? 0),
        0,
      );
      const histFxRates: Record<string, number> = cJson.fxRates ?? {};
      const histHomeCurrency: string = cJson.homeCurrency ?? "USD";
      function toHistHome(amount: number, ccy?: string): number {
        if (!ccy || ccy.toUpperCase() === histHomeCurrency.toUpperCase()) return amount;
        const rate = histFxRates[ccy.toUpperCase()];
        return rate != null ? amount * rate : amount;
      }

      const hist = allAssetMonths
        .map((ym) => {
          let stmtAssets = 0;
          for (const acct of assetBalHist) {
            const pts = acct.entries.filter((e) => e.yearMonth <= ym);
            if (pts.length > 0) stmtAssets += toHistHome(Math.max(0, pts[pts.length - 1].balance), acct.currency);
          }
          let debtSide = 0;
          for (const acct of debtBalHistForHist) {
            const pts = acct.entries.filter((e) => e.yearMonth <= ym);
            if (pts.length > 0) debtSide += toHistHome(Math.abs(pts[pts.length - 1].balance), acct.currency);
          }
          const [y, m] = ym.split("-");
          const label = new Date(parseInt(y), parseInt(m) - 1, 1)
            .toLocaleDateString("en-US", { month: "short", year: "2-digit" });
          return {
            ym,
            label,
            total: stmtAssets + manualAssetsTotal,
            debt: debtSide,
          };
        })
        .filter((h) => h.total > 0);
      setAssetHistory(hist);

      // Build per-account monthly series from the cache's accountBalanceHistory
      const GROUP_COLORS: Record<string, string> = {
        checking: "#f59e0b", savings: "#f59e0b", investment: "#3b82f6", other: "#94a3b8",
      };
      const acctMonthly: AssetAccountMonthly[] = (cJson.accountBalanceHistory as AccountBalanceHistory[] ?? [])
        .filter((h) => ASSET_TYPES.has(h.accountType))
        .map((h) => {
          const sorted = h.entries; // already sorted ascending from the server
          const cur  = sorted.at(-1)?.balance ?? 0;
          const prev = sorted.length >= 2 ? sorted[sorted.length - 2].balance : null;
          return {
            slug: h.slug, label: h.label, accountType: h.accountType,
            color: GROUP_COLORS[h.accountType] ?? "#94a3b8",
            months: sorted.map((e) => ({ ym: e.yearMonth, balance: e.balance })),
            currentBalance: cur, prevBalance: prev,
            delta: prev !== null ? cur - prev : null,
          };
        });
      setAccountMonthly(acctMonthly);
    } catch { setError("Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      load(tok);
    });
  }, [router, load]);

  useEffect(() => {
    if (prefillLink && !loading && !showForm) openAdd({ category: prefillCategory ?? "property", linkedAccountSlug: prefillLink });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  // ── Balance snapshot handlers ────────────────────────────────────────────
  function openSnapshot(account: AccountSnapshot) {
    const now = new Date();
    const ym = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0");
    setSnapshotTarget(account);
    setSnapshotBalance(String(Math.abs(account.balance)));
    setSnapshotMonth(ym);
    setSnapshotNote("");
    setSnapshotError(null);
  }
  async function handleSaveSnapshot() {
    if (!snapshotTarget || !token) return;
    const val = parseFloat(snapshotBalance.replace(/,/g, ""));
    if (isNaN(val)) { setSnapshotError("Enter a valid balance"); return; }
    if (!snapshotMonth) { setSnapshotError("Select a month"); return; }
    setSnapshotSaving(true); setSnapshotError(null);
    try {
      const isDebt = ["credit", "mortgage", "loan"].includes(snapshotTarget.accountType);
      const balance = isDebt ? -Math.abs(val) : Math.abs(val);
      const res = await fetch("/api/user/balance-snapshots", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          accountSlug: snapshotTarget.slug,
          accountName: snapshotTarget.accountName ?? snapshotTarget.bankName,
          accountType: snapshotTarget.accountType,
          balance,
          yearMonth: snapshotMonth,
          note: snapshotNote || undefined,
        }),
      });
      if (!res.ok) { setSnapshotError("Failed to save. Please try again."); return; }
      setSnapshotTarget(null);
      load(token);
    } finally { setSnapshotSaving(false); }
  }

  function openAdd(prefill?: Partial<FormState>) {
    setEditing(null); setForm({ ...EMPTY_FORM, ...prefill }); setFormError(null); setShowForm(true);
  }
  function openEdit(asset: ManualAsset) {
    setEditing(asset);
    setForm({ label: asset.label, category: asset.category, value: String(asset.value), linkedAccountSlug: asset.linkedAccountSlug ?? "" });
    setFormError(null); setShowForm(true);
  }
  async function handleSave() {
    const val = parseFloat(form.value.replace(/,/g, ""));
    if (!form.label.trim()) { setFormError("Give this asset a name"); return; }
    if (isNaN(val) || val < 0) { setFormError("Enter a valid value"); return; }
    setSaving(true); setFormError(null);
    try {
      const payload = { label: form.label.trim(), category: form.category, value: val, linkedAccountSlug: form.linkedAccountSlug || null };
      const res = editing
        ? await fetch(`/api/user/assets/${editing.id}`, { method: "PUT",  headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/user/assets",               { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      if (!res.ok) { const j = await res.json().catch(() => ({})); setFormError(j.error || "Save failed"); return; }
      setShowForm(false);
      if (token) load(token);
    } catch { setFormError("Save failed"); }
    finally { setSaving(false); }
  }
  async function handleDelete(id: string) {
    if (!token) return;
    await fetch(`/api/user/assets/${id}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setDeleteConfirm(null); load(token);
  }

  // ── derived data ──────────────────────────────────────────────────────────

  // Convert a balance from an account's native currency to the user's home currency.
  // Uses fxRates from the financial profile cache — same rates used by getNetWorth().
  function toHome(amount: number, currency?: string): number {
    if (!currency || currency.toUpperCase() === homeCurrency) return amount;
    const rate = fxRates[currency.toUpperCase()];
    return rate ? amount * rate : amount;
  }

  const manualTotal          = assets.reduce((s, a) => s + a.value, 0);
  const liquidSnapshots      = accountSnapshots.filter((a) => LIQUID_ACCOUNT_TYPES.has(a.accountType ?? "") && a.balance > 0);
  const liquidFromStatements = liquidSnapshots.reduce((s, a) => s + toHome(a.balance, a.currency), 0);
  const liquidFromManual     = assets.filter((a) => LIQUID_ASSET_CATEGORIES.has(a.category)).reduce((s, a) => s + a.value, 0);
  const liquidTotal          = liquidFromStatements + liquidFromManual;
  const illiquidTotal        = assets.filter((a) => !LIQUID_ASSET_CATEGORIES.has(a.category)).reduce((s, a) => s + a.value, 0);
  const totalAssets          = manualTotal + liquidFromStatements;
  const debts                = accountSnapshots.filter((a) => ["mortgage", "loan", "credit"].includes(a.accountType ?? "") || a.balance < 0);

  const chartRaw = CHART_GROUPS.map((g) => {
    const fromManual     = assets.filter((a) => (g.categories as string[]).includes(a.category)).reduce((s, a) => s + a.value, 0);
    const fromStatements = accountSnapshots.filter((a) => g.accountTypes.includes(a.accountType ?? "") && a.balance > 0).reduce((s, a) => s + toHome(a.balance, a.currency), 0);
    return { label: g.label, value: fromManual + fromStatements, color: g.color };
  }).filter((d) => d.value > 0);

  // Growth deltas from history
  const firstHist    = assetHistory[0];
  const latestHist   = assetHistory.length >= 1 ? assetHistory[assetHistory.length - 1] : null;
  const growthTotal  = firstHist && latestHist ? latestHist.total - firstHist.total : null;
  const growthPct    = firstHist && latestHist && firstHist.total > 0
    ? ((latestHist.total - firstHist.total) / firstHist.total) * 100 : null;

  // Selected month breakdown (for chart click)
  const selAssetIdx  = selectedAssetYm ? assetHistory.findIndex((p) => p.ym === selectedAssetYm) : -1;
  const selAssetPt   = selAssetIdx >= 0 ? assetHistory[selAssetIdx] : null;
  const prevAssetPtYm = selAssetIdx > 0 ? assetHistory[selAssetIdx - 1].ym : null;
  const latestBalanceAtOrBefore = (a: AssetAccountMonthly, ym: string) => {
    const pts = a.months.filter((m) => m.ym <= ym);
    return pts.length > 0 ? pts[pts.length - 1].balance : null;
  };
  const selAssetRows = accountMonthly
    .map((a) => {
      const bal     = selectedAssetYm ? latestBalanceAtOrBefore(a, selectedAssetYm) : null;
      const prevBal = prevAssetPtYm   ? latestBalanceAtOrBefore(a, prevAssetPtYm)   : null;
      const delta   = bal !== null && prevBal !== null ? bal - prevBal : null;
      return { ...a, balanceThisMonth: bal, delta };
    })
    .filter((r) => r.balanceThisMonth !== null)
    .sort((a, b) => (b.balanceThisMonth ?? 0) - (a.balanceThisMonth ?? 0));

  const liquidTags   = liquidSnapshots.map((a) => (a.accountName ?? a.bankName ?? "").toLowerCase()).slice(0, 4);
  const illiquidTags = assets
    .filter((a) => !LIQUID_ASSET_CATEGORIES.has(a.category))
    .map((a) => CATEGORY_META[a.category].label)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 4);
  const keyInsight = insights.find((i) => i.priority === "high") ?? insights[0] ?? null;
  const monthStr   = yearMonth
    ? new Date(parseInt(yearMonth.slice(0, 4)), parseInt(yearMonth.slice(5, 7)) - 1, 1)
        .toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;

  // All accounts (liquid + debt) for Accounts tab
  // Accounts tab shows only asset-type accounts; debts live on the Liabilities page
  const DEBT_TYPES = new Set(["credit", "mortgage", "loan"]);
  const allAccounts = accountSnapshots.filter((a) => !DEBT_TYPES.has(a.accountType ?? ""));

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  // Show the page whenever there is any tracked data — even a zero-balance upload counts
  const isEmpty = assets.length === 0 && debts.length === 0 && liquidTotal === 0 && allAccounts.length === 0;

  return (
    <div className="mx-auto max-w-2xl lg:max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">

      {/* Header */}
      <div className="mb-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-3xl text-gray-900">Assets</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {totalAssets > 0 && <>{formatCurrency(totalAssets, homeCurrency, undefined, true)} total</>}
            {monthStr && <> · {monthStr}</>}
          </p>
        </div>
        <button
          onClick={() => openAdd()}
          className="shrink-0 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
        >
          + Add asset
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {isEmpty && !error ? (
        <div className="mt-6 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
          <p className="text-sm text-gray-500">No assets tracked yet.</p>
          <p className="mt-1 text-xs text-gray-400">Add your home, car, pension, or any other asset to include it in your net worth.</p>
          <button onClick={() => openAdd()} className="mt-4 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700">
            + Add first asset
          </button>
        </div>
      ) : (
        <>
          {/* Tab bar */}
          <div className="mt-5 mb-6 flex border-b border-gray-200">
            {TABS.map((tab) => (
              <button key={tab.id} onClick={() => switchTab(tab.id)}
                className={`relative mr-6 pb-3 text-sm font-medium transition-colors ${
                  activeTab === tab.id
                    ? "text-gray-900 after:absolute after:bottom-0 after:left-0 after:right-0 after:h-0.5 after:rounded-full after:bg-gray-900 after:content-['']"
                    : "text-gray-400 hover:text-gray-600"
                }`}>
                {tab.label}
                {tab.id === "accounts" && allAccounts.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {allAccounts.length}
                  </span>
                )}
                {tab.id === "tracked" && assets.length > 0 && (
                  <span className="ml-1.5 rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-500">
                    {assets.length}
                  </span>
                )}
              </button>
            ))}
          </div>

          {/* ── Overview tab ──────────────────────────────────────────────── */}
          {activeTab === "overview" && (
            <div className="space-y-5">
              {/* Total assets header */}
              {totalAssets > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="text-[10px] font-semibold uppercase tracking-widest text-gray-400">Total Assets</p>
                  <div className="mt-1 flex items-center gap-3 flex-wrap">
                    <p className="font-bold text-3xl text-gray-900 break-all leading-tight">{formatCurrency(totalAssets, homeCurrency, undefined, true)}</p>
                  </div>
                  {Object.keys(fxRates).length > 0 && (
                    <p className="mt-1 text-[10px] text-gray-400">
                      {Object.entries(fxRates)
                        .map(([ccy, rate]) => `1 ${ccy} = ${rate.toFixed(4)} ${homeCurrency}`)
                        .join(" · ")}
                    </p>
                  )}
                </div>
              )}

              {/* Asset Growth chart */}
              {assetHistory.length >= 2 && (
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-4 flex items-start justify-between gap-4">
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Asset Growth</p>
                      {growthTotal !== null && growthPct !== null && (
                        <p className={`mt-1 text-sm font-semibold ${growthTotal >= 0 ? "text-green-600" : "text-red-500"}`}>
                          {growthTotal >= 0 ? "+" : ""}{formatCurrency(growthTotal, homeCurrency, undefined, true)}
                          <span className="ml-1.5 font-normal text-gray-400 text-xs">
                            ({growthPct >= 0 ? "+" : ""}{growthPct.toFixed(1)}%) over {assetHistory.length} months
                          </span>
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="mb-2 text-xs text-gray-400">Click a point to see per-account breakdown</p>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={assetHistory} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                        <defs>
                          <linearGradient id="assetGrad" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="5%"  stopColor="#7c3aed" stopOpacity={0.15} />
                            <stop offset="95%" stopColor="#7c3aed" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#9ca3af" }} tickLine={false} axisLine={false} />
                        <YAxis
                          tickFormatter={(v) => formatCurrency(v, homeCurrency, undefined, true)}
                          tick={{ fontSize: 10, fill: "#9ca3af" }}
                          tickLine={false} axisLine={false} width={48}
                        />
                        <Tooltip
                          formatter={(v) => [typeof v === "number" ? formatCurrency(v, homeCurrency, undefined, true) : v, "Total assets"]}
                          labelStyle={{ fontSize: 12, color: "#6b7280" }}
                          contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: 12 }}
                        />
                        <Area
                          type="monotone" dataKey="total"
                          stroke="#7c3aed" strokeWidth={2}
                          fill="url(#assetGrad)"
                          dot={(props) => {
                            const { cx, cy, payload } = props as { cx: number; cy: number; payload: { ym: string } };
                            const selected = payload.ym === selectedAssetYm;
                            return (
                              <circle
                                key={payload.ym}
                                cx={cx} cy={cy}
                                r={selected ? 7 : 5}
                                fill={selected ? "#7c3aed" : "#fff"}
                                stroke="#7c3aed"
                                strokeWidth={selected ? 2 : 1.5}
                                style={{ cursor: "pointer", outline: "none" }}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSelectedAssetYm((prev) => prev === payload.ym ? null : payload.ym);
                                }}
                              />
                            );
                          }}
                          activeDot={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Month breakdown panel */}
                  {selAssetPt && (
                    <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50/40 p-4">
                      <div className="mb-3 flex items-center justify-between">
                        <div>
                          <p className="text-sm font-semibold text-gray-800">{selAssetPt.label}</p>
                          <p className="text-xs text-gray-400">
                            Total assets: <span className="font-medium text-gray-700">{formatCurrency(selAssetPt.total, homeCurrency, undefined, true)}</span>
                            {prevAssetPtYm && (() => {
                              const prevTotal = assetHistory.find((p) => p.ym === prevAssetPtYm)?.total ?? null;
                              if (prevTotal === null) return null;
                              const diff = selAssetPt.total - prevTotal;
                              return (
                                <span className={`ml-2 font-semibold ${diff >= 0 ? "text-green-600" : "text-red-500"}`}>
                                  {diff >= 0 ? "↑ " : "↓ "}{formatCurrency(Math.abs(diff), homeCurrency, undefined, true)} vs prior chart month
                                </span>
                              );
                            })()}
                          </p>
                        </div>
                        <button
                          onClick={() => setSelectedAssetYm(null)}
                          className="rounded-full p-1 text-gray-400 hover:bg-purple-100 hover:text-gray-600"
                          aria-label="Close"
                        >
                          <svg className="h-4 w-4" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2">
                            <path d="M4 4l8 8M12 4l-8 8" />
                          </svg>
                        </button>
                      </div>
                      <div className="space-y-2">
                        {selAssetRows.map((r) => {
                          const grew = r.delta !== null && r.delta > 0;
                          const shrank = r.delta !== null && r.delta < 0;
                          return (
                            <div key={r.slug} className="flex items-center gap-3 rounded-lg bg-white px-3 py-2 shadow-sm">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: r.color }} />
                              <div className="flex-1 min-w-0">
                                <p className="truncate text-sm font-medium text-gray-800">{r.label}</p>
                                <p className="text-xs text-gray-400 capitalize">{r.accountType}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="text-sm font-semibold tabular-nums text-gray-800">{fmt(r.balanceThisMonth!, currencyOverrides[r.slug])}</p>
                                {r.delta !== null ? (
                                  <p className={`text-xs font-medium tabular-nums ${grew ? "text-green-600" : shrank ? "text-red-500" : "text-gray-400"}`}>
                                    {grew ? "↑ " : shrank ? "↓ " : ""}{r.delta === 0 ? "no change" : formatCurrency(Math.abs(r.delta), homeCurrency, currencyOverrides[r.slug], false)}
                                  </p>
                                ) : r.balanceThisMonth != null && prevAssetPtYm ? (
                                  <p className="text-xs font-medium tabular-nums text-green-600">
                                    ↑ {formatCurrency(Math.abs(r.balanceThisMonth), homeCurrency, currencyOverrides[r.slug], false)}{" "}
                                    <span className="font-normal text-gray-400">(new this month)</span>
                                  </p>
                                ) : (
                                  <p className="text-xs text-gray-400">new</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* KPI cards — Cash / Investments / Property / Other */}
              {totalAssets > 0 && (() => {
                const cashVal       = chartRaw.find((g) => g.label === "Cash")?.value ?? 0;
                const investVal     = (chartRaw.find((g) => g.label === "Investments")?.value ?? 0)
                                    + (chartRaw.find((g) => g.label === "RRSP / TFSA")?.value ?? 0);
                const propertyVal   = chartRaw.find((g) => g.label === "Real Estate")?.value ?? 0;
                const otherVal      = (chartRaw.find((g) => g.label === "Vehicles")?.value ?? 0)
                                    + (chartRaw.find((g) => g.label === "Business")?.value ?? 0)
                                    + (chartRaw.find((g) => g.label === "Other")?.value ?? 0);
                const cashAccts     = liquidSnapshots.length;
                const investAccts   = accountSnapshots.filter((a) => a.accountType === "investment" && a.balance > 0).length
                                    + assets.filter((a) => a.category === "investment" || a.category === "retirement").length;
                const propertyItems = assets.filter((a) => a.category === "property").length;
                const otherItems    = assets.filter((a) => ["vehicle", "business", "other"].includes(a.category)).length;
                return (
                  <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-amber-400" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Cash</p>
                      </div>
                      <p className="font-bold text-xl text-gray-900 break-all leading-tight">{cashVal > 0 ? formatCurrency(cashVal, homeCurrency, undefined, true) : "—"}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {cashVal > 0 ? `${cashAccts} account${cashAccts !== 1 ? "s" : ""} · ${totalAssets > 0 ? ((cashVal / totalAssets) * 100).toFixed(0) : 0}%` : "none"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-blue-400" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Investments</p>
                      </div>
                      <p className="font-bold text-xl text-gray-900 break-all leading-tight">{investVal > 0 ? formatCurrency(investVal, homeCurrency, undefined, true) : "—"}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {investVal > 0 ? `${investAccts} item${investAccts !== 1 ? "s" : ""} · ${totalAssets > 0 ? ((investVal / totalAssets) * 100).toFixed(0) : 0}%` : "none"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-indigo-400" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Property</p>
                      </div>
                      <p className="font-bold text-xl text-gray-900 break-all leading-tight">{propertyVal > 0 ? formatCurrency(propertyVal, homeCurrency, undefined, true) : "—"}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {propertyVal > 0 ? `${propertyItems} item${propertyItems !== 1 ? "s" : ""} · ${totalAssets > 0 ? ((propertyVal / totalAssets) * 100).toFixed(0) : 0}%` : "none"}
                      </p>
                    </div>
                    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="h-2.5 w-2.5 rounded-full shrink-0 bg-gray-400" />
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Other</p>
                      </div>
                      <p className="font-bold text-xl text-gray-900 break-all leading-tight">{otherVal > 0 ? formatCurrency(otherVal, homeCurrency, undefined, true) : "—"}</p>
                      <p className="mt-1 text-xs text-gray-400">
                        {otherVal > 0 ? `${otherItems} item${otherItems !== 1 ? "s" : ""} · ${totalAssets > 0 ? ((otherVal / totalAssets) * 100).toFixed(0) : 0}%` : "none"}
                      </p>
                    </div>
                  </div>
                );
              })()}

              {/* What changed this month */}
              {accountMonthly.some((a) => a.delta !== null) && (() => {
                const changed = accountMonthly
                  .filter((a) => a.delta !== null && Math.abs(a.delta!) > 0)
                  .sort((a, b) => Math.abs(b.delta!) - Math.abs(a.delta!));
                const netChange = changed.reduce((s, a) => s + toHome(a.delta!, currencyOverrides[a.slug]), 0);
                if (changed.length === 0) return null;
                return (
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">What changed this month</p>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${netChange >= 0 ? "bg-green-50 text-green-700" : "bg-red-50 text-red-600"}`}>
                        {netChange >= 0 ? "▲ " : "▼ "}{formatCurrency(Math.abs(netChange), homeCurrency, undefined, true)} net
                      </span>
                    </div>
                    <div className="space-y-2">
                      {changed.map((a) => {
                        const grew = (a.delta ?? 0) >= 0;
                        return (
                          <div key={a.slug} className="flex items-center gap-3">
                            <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                            <span className="flex-1 truncate text-sm text-gray-700">{a.label}</span>
                            <span className={`text-sm font-semibold tabular-nums ${grew ? "text-green-600" : "text-red-500"}`}>
                              {grew ? "▲ " : "▼ "}{formatCurrency(Math.abs(a.delta!), homeCurrency, currencyOverrides[a.slug], false)}
                            </span>
                            <span className="w-20 text-right text-xs text-gray-400 tabular-nums">{fmt(a.currentBalance, currencyOverrides[a.slug])}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* By account with sparklines */}
              {accountMonthly.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">By account</p>
                  </div>
                  <div className="divide-y divide-gray-50">
                    {[...accountMonthly].sort((a, b) => b.currentBalance - a.currentBalance).map((a) => {
                      const grew = (a.delta ?? 0) >= 0;
                      const sparkVals = a.months.map((m) => m.balance);
                      return (
                        <div key={a.slug} className="flex items-center gap-3 px-5 py-3">
                          <span className="h-2 w-2 rounded-full shrink-0" style={{ backgroundColor: a.color }} />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium text-gray-800 truncate">{a.label}</p>
                            <p className="text-xs text-gray-400 capitalize">{a.accountType}</p>
                          </div>
                          <div className="shrink-0">
                            <Sparkline values={sparkVals} good="up" />
                          </div>
                          <div className="shrink-0 text-right w-28">
                            <p className="text-sm font-semibold text-gray-800 tabular-nums">{fmt(a.currentBalance, currencyOverrides[a.slug])}</p>
                            {a.delta !== null && Math.abs(a.delta) > 0 && (
                              <p className={`text-xs font-medium tabular-nums ${grew ? "text-green-600" : "text-red-500"}`}>
                                {grew ? "▲ " : "▼ "}{formatCurrency(Math.abs(a.delta), homeCurrency, currencyOverrides[a.slug], false)} MoM
                              </p>
                            )}
                            {(a.delta === null || Math.abs(a.delta) === 0) && (
                              <p className="text-xs text-gray-400">unchanged</p>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Asset breakdown donut */}
              {chartRaw.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Asset Breakdown</p>
                  <DonutChart data={chartRaw} total={totalAssets} homeCurrency={homeCurrency} />
                </div>
              )}


              {/* Key insight */}
              {keyInsight && (
                <div className="flex items-start gap-3 rounded-xl border border-gray-100 bg-gray-50 p-4">
                  <span className="mt-0.5 text-gray-400">↗</span>
                  <p className="text-sm text-gray-700">{keyInsight.message}</p>
                </div>
              )}
            </div>
          )}

          {/* ── Accounts tab ──────────────────────────────────────────────── */}
          {activeTab === "accounts" && (
            <div className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
              {allAccounts.length === 0 ? (
                <p className="px-5 py-10 text-center text-sm text-gray-400">
                  No accounts yet. Upload a statement to get started.
                </p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {allAccounts.map((a) => {
                    const isDebt = a.balance < 0 || ["mortgage", "loan", "credit"].includes(a.accountType ?? "");
                    const displayBalance = isDebt ? Math.abs(a.balance) : a.balance;
                    return (
                      <Link
                        key={a.slug}
                        href={`/account/accounts/${a.slug}`}
                        className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition group"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 group-hover:text-purple-600 transition-colors truncate">
                            {a.accountName ?? a.bankName}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {a.bankName}
                            {a.accountType && <span className="ml-1.5 capitalize text-gray-300">· {a.accountType}</span>}
                            {(() => {
                              const ym = a.statementMonth;
                              const days = daysSinceYearMonth(ym);
                              const { text, cls } = freshnessLabel(days);
                              return text ? (
                                <span className={`ml-1.5 ${cls}`} title={ym ? `Data as of ${ym}` : undefined}>
                                  {freshnessGlyph(days)}as of {new Date((ym ?? "") + "-01T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })} · {text}
                                </span>
                              ) : ym ? (
                                <span className="ml-1.5 text-gray-400">
                                  as of {new Date(ym + "-01T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                                </span>
                              ) : null;
                            })()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`font-semibold text-sm ${isDebt ? "text-red-600" : "text-gray-900"}`}>
                            {isDebt ? "−" : ""}{fmt(displayBalance, a.currency)}
                          </span>
                          {/* Update balance button hidden — functionality needs rework */}
                          <svg className="h-4 w-4 text-gray-300 group-hover:text-purple-400 transition-colors"
                            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
                          </svg>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Tracked Assets tab ────────────────────────────────────────── */}
          {activeTab === "tracked" && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-gray-500">Manually tracked assets not linked to a bank statement.</p>
                <button onClick={() => openAdd()}
                  className="shrink-0 rounded-lg border border-purple-200 bg-purple-50 px-3 py-1.5 text-xs font-semibold text-purple-600 hover:bg-purple-100 transition">
                  + Add
                </button>
              </div>

              {assets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
                  <p className="text-sm text-gray-500">No tracked assets yet.</p>
                  <p className="mt-1 text-xs text-gray-400">Add your home, car, pension, or any other asset.</p>
                  <button onClick={() => openAdd()} className="mt-4 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700">
                    + Add first asset
                  </button>
                </div>
              ) : (
                /* Group by category */
                CATEGORY_ORDER.filter((cat) => assets.some((a) => a.category === cat)).map((cat) => {
                  const catAssets = assets.filter((a) => a.category === cat);
                  const m = CATEGORY_META[cat];
                  const catTotal = catAssets.reduce((s, a) => s + a.value, 0);
                  return (
                    <div key={cat} className="rounded-xl border border-gray-200 bg-white shadow-sm overflow-hidden">
                      <div className="flex items-center gap-2 px-5 pt-4 pb-2">
                        <span className="text-base">{m.emoji}</span>
                        <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">{m.label}</p>
                        <span className="ml-auto text-sm font-semibold text-gray-700">{formatCurrency(catTotal, homeCurrency, undefined, true)}</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {catAssets.map((asset) => {
                          const linked = accountSnapshots.find((a) => a.slug === asset.linkedAccountSlug);
                          return (
                            <div key={asset.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-800">{asset.label}</p>
                                <p className="text-xs text-gray-400">
                                  {linked && <span className="text-purple-500">linked to {linked.accountName ?? linked.bankName} · </span>}
                                  updated {timeAgo(asset.updatedAt)}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-2">
                                <span className="font-semibold text-sm text-gray-900">{fmt(asset.value)}</span>
                                <button onClick={() => openEdit(asset)} className="text-xs text-gray-400 hover:text-gray-700 px-1">Edit</button>
                                <button onClick={() => setDeleteConfirm(asset.id)} className="text-xs text-red-400 hover:text-red-600 px-1">✕</button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}

      {/* ── Add / Edit modal ─────────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-bold text-xl text-gray-900">{editing ? "Edit asset" : "Add asset"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>
            <div className="mb-4">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">Category</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORY_ORDER.map((cat) => {
                  const m = CATEGORY_META[cat];
                  return (
                    <button key={cat} onClick={() => setForm((f) => ({ ...f, category: cat }))}
                      className={`rounded-lg border-2 p-2 text-center text-xs font-medium transition ${form.category === cat ? "border-purple-500 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}>
                      <div className="text-xl">{m.emoji}</div>{m.label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Name</label>
              <input type="text" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder={`e.g. ${CATEGORY_META[form.category].hint.split(",")[0]}`}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500" />
            </div>
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Estimated value</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input type="text" inputMode="numeric" value={form.value} onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder="0"
                  className="w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500" />
              </div>
            </div>
            {accountSnapshots.some((a) => ["mortgage", "loan"].includes(a.accountType ?? "")) && (
              <div className="mb-5">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Link to loan / mortgage <span className="font-normal normal-case text-gray-400">(optional)</span>
                </label>
                <select value={form.linkedAccountSlug} onChange={(e) => setForm((f) => ({ ...f, linkedAccountSlug: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500">
                  <option value="">None</option>
                  {accountSnapshots.filter((a) => ["mortgage", "loan"].includes(a.accountType ?? "")).map((a) => (
                    <option key={a.slug} value={a.slug}>{a.accountName ?? a.bankName}</option>
                  ))}
                </select>
                {form.linkedAccountSlug && <p className="mt-1 text-xs text-purple-600">Equity = this value − outstanding balance on that account</p>}
              </div>
            )}
            {formError && <p className="mb-3 text-sm text-red-600">{formError}</p>}
            <button onClick={handleSave} disabled={saving}
              className="w-full rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 py-3 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800 disabled:opacity-60">
              {saving ? "Saving…" : editing ? "Save changes" : "Add asset"}
            </button>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl text-center">
            <p className="font-semibold text-gray-900">Delete this asset?</p>
            <p className="mt-1 text-sm text-gray-500">This can&apos;t be undone.</p>
            <div className="mt-5 flex gap-3">
              <button onClick={() => setDeleteConfirm(null)} className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleDelete(deleteConfirm)} className="flex-1 rounded-lg bg-red-500 py-2 text-sm font-semibold text-white hover:bg-red-600">Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* ── Update balance modal ───────────────────────────────────────────── */}
      {snapshotTarget && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h3 className="font-semibold text-gray-900">Update balance</h3>
                <p className="text-sm text-gray-500 mt-0.5">{snapshotTarget.accountName}</p>
              </div>
              <button onClick={() => setSnapshotTarget(null)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
            </div>

            {/* Source-of-truth note */}
            <div className="mb-4 rounded-lg bg-blue-50 border border-blue-100 px-3 py-2.5 text-xs text-blue-700">
              <strong>This won&apos;t overwrite your statement data.</strong> It adds a manual balance entry for the month you select. Your next uploaded statement will automatically take over.
            </div>

            {/* Balance field */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">
                Current balance {["credit","mortgage","loan"].includes(snapshotTarget.accountType) ? "(enter what you owe)" : ""}
              </label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm">$</span>
                <input
                  type="number" min="0" step="0.01"
                  value={snapshotBalance}
                  onChange={(e) => setSnapshotBalance(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 pl-7 pr-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
                  placeholder="0.00"
                  autoFocus
                />
              </div>
            </div>

            {/* Month picker */}
            <div className="mb-3">
              <label className="block text-xs font-medium text-gray-600 mb-1">As of month</label>
              <input
                type="month"
                value={snapshotMonth}
                onChange={(e) => setSnapshotMonth(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>

            {/* Note (optional) */}
            <div className="mb-4">
              <label className="block text-xs font-medium text-gray-600 mb-1">Note <span className="font-normal text-gray-400">(optional)</span></label>
              <input
                type="text"
                value={snapshotNote}
                onChange={(e) => setSnapshotNote(e.target.value)}
                placeholder="e.g. Checked online banking today"
                className="w-full rounded-lg border border-gray-200 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-purple-300"
              />
            </div>

            {snapshotError && <p className="mb-3 text-sm text-red-600">{snapshotError}</p>}

            <div className="flex gap-3">
              <button
                onClick={() => setSnapshotTarget(null)}
                className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-medium text-gray-600 hover:bg-gray-50 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveSnapshot}
                disabled={snapshotSaving}
                className="flex-1 rounded-lg bg-purple-600 py-2.5 text-sm font-semibold text-white hover:bg-purple-700 transition disabled:opacity-50"
              >
                {snapshotSaving ? "Saving…" : "Save balance"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default function AssetsPageWrapper() {
  return (
    <Suspense>
      <AssetsPage />
    </Suspense>
  );
}
