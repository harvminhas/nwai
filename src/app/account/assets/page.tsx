"use client";

import { Suspense } from "react";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import Link from "next/link";
import type { ManualAsset, AssetCategory, UserStatementSummary, Insight } from "@/lib/types";
import type { BalanceSnapshot } from "@/app/api/user/balance-snapshots/route";

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

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}
function fmtShort(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `${sign}$${Math.round(abs / 1_000)}k`;
  return fmt(v);
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
function accountSlug(s: UserStatementSummary) {
  const bank = (s.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = (s.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
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

// ── types ─────────────────────────────────────────────────────────────────────

type AccountGroup = { slug: string; label: string; type: string };
interface FormState { label: string; category: AssetCategory; value: string; linkedAccountSlug: string; }
const EMPTY_FORM: FormState = { label: "", category: "property", value: "", linkedAccountSlug: "" };

interface AccountBalance {
  slug: string; bankName: string; accountName: string; accountType: string;
  balance: number; statementDate?: string; fromSnapshot?: boolean;
}

// ── donut chart ───────────────────────────────────────────────────────────────

function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
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
              formatter={(value) => [typeof value === "number" ? fmtShort(value) : String(value)]}
              contentStyle={{ borderRadius: "8px", border: "1px solid #e5e7eb", fontSize: "12px" }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-base font-bold text-gray-900">{fmtShort(total)}</span>
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
                <span className="font-medium text-gray-800">{fmtShort(d.value)}</span>
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

  const [assets, setAssets]                   = useState<ManualAsset[]>([]);
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([]);
  const [accounts, setAccounts]               = useState<AccountGroup[]>([]);
  const [insights, setInsights]               = useState<Insight[]>([]);
  const [yearMonth, setYearMonth]             = useState<string | null>(null);
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
  const [snapshots,       setSnapshots]       = useState<BalanceSnapshot[]>([]);
  const [snapshotTarget,  setSnapshotTarget]  = useState<AccountBalance | null>(null);
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
      const [aRes, sRes, cRes, snapRes] = await Promise.all([
        fetch("/api/user/assets",                 { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/statements",             { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/statements/consolidated",{ headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/balance-snapshots",      { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      const aJson    = await aRes.json().catch(() => ({}));
      const sJson    = await sRes.json().catch(() => ({}));
      const cJson    = cRes.ok ? await cRes.json().catch(() => ({})) : {};
      const snapJson = snapRes.ok ? await snapRes.json().catch(() => ({})) : {};

      setAssets(aJson.assets ?? []);
      setInsights(cJson.data?.insights ?? []);
      setYearMonth(cJson.yearMonth ?? null);

      const snaps: BalanceSnapshot[] = snapJson.snapshots ?? [];
      setSnapshots(snaps);

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
      // Build initial balances from statements
      const balances: AccountBalance[] = Array.from(latestBySlug.values()).map((s) => ({
        slug: accountSlug(s), bankName: s.bankName ?? "Unknown",
        accountName: s.accountName ?? s.bankName ?? "Account",
        accountType: s.accountType ?? "other", balance: s.netWorth ?? 0,
        statementDate: s.statementDate,
      }));
      // Apply snapshot overrides: if a snapshot is newer, use its balance + date
      const latestSnapBySlug = new Map<string, BalanceSnapshot>();
      for (const snap of snaps) {
        const cur = latestSnapBySlug.get(snap.accountSlug);
        if (!cur || snap.yearMonth > cur.yearMonth) latestSnapBySlug.set(snap.accountSlug, snap);
      }
      for (const b of balances) {
        const snap = latestSnapBySlug.get(b.slug);
        if (snap && (!b.statementDate || snap.yearMonth > b.statementDate.slice(0, 7))) {
          b.balance       = snap.balance;
          b.statementDate = snap.yearMonth + "-01"; // treat as 1st of month
          b.fromSnapshot  = true;
        }
      }
      setAccountBalances(balances);

      const seen = new Set<string>();
      const groups: AccountGroup[] = [];
      for (const s of stmts) {
        if (!["mortgage", "loan"].includes(s.accountType ?? "")) continue;
        const slug = accountSlug(s);
        if (seen.has(slug)) continue;
        seen.add(slug);
        groups.push({
          slug, type: s.accountType ?? "other",
          label: `${s.accountName ?? s.bankName ?? slug}${s.accountId && s.accountId !== "unknown" ? ` (${s.accountId})` : ""}`,
        });
      }
      setAccounts(groups);
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
  function openSnapshot(account: AccountBalance) {
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
          accountName: snapshotTarget.accountName,
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

  const manualTotal       = assets.reduce((s, a) => s + a.value, 0);
  const liquidAccounts    = accountBalances.filter((a) => LIQUID_ACCOUNT_TYPES.has(a.accountType) && a.balance > 0);
  const liquidFromStatements = liquidAccounts.reduce((s, a) => s + a.balance, 0);
  const liquidFromManual  = assets.filter((a) => LIQUID_ASSET_CATEGORIES.has(a.category)).reduce((s, a) => s + a.value, 0);
  const liquidTotal       = liquidFromStatements + liquidFromManual;
  const illiquidTotal     = assets.filter((a) => !LIQUID_ASSET_CATEGORIES.has(a.category)).reduce((s, a) => s + a.value, 0);
  const totalAssets       = manualTotal + liquidFromStatements;
  const debts             = accountBalances.filter((a) => ["mortgage", "loan", "credit"].includes(a.accountType) || a.balance < 0);
  const debtsTotal        = debts.reduce((s, a) => s + Math.abs(a.balance), 0);

  const chartRaw = CHART_GROUPS.map((g) => {
    const fromManual     = assets.filter((a) => (g.categories as string[]).includes(a.category)).reduce((s, a) => s + a.value, 0);
    const fromStatements = accountBalances.filter((a) => g.accountTypes.includes(a.accountType) && a.balance > 0).reduce((s, a) => s + a.balance, 0);
    return { label: g.label, value: fromManual + fromStatements, color: g.color };
  }).filter((d) => d.value > 0);

  const liquidTags   = liquidAccounts.map((a) => a.accountName.toLowerCase()).slice(0, 4);
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
  const allAccounts = accountBalances.filter((a) => !DEBT_TYPES.has(a.accountType));

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  const isEmpty = assets.length === 0 && debts.length === 0 && liquidTotal === 0;

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6">

      {/* Header */}
      <div className="mb-1 flex items-start justify-between gap-4">
        <div>
          <h1 className="font-bold text-3xl text-gray-900">Assets &amp; net worth</h1>
          <p className="mt-0.5 text-sm text-gray-400">
            {totalAssets > 0 && <>{fmt(totalAssets)} total</>}
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
              {/* Liquid / Illiquid KPI cards */}
              {(liquidTotal > 0 || illiquidTotal > 0) && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Liquid</p>
                    <p className="mt-2 font-bold text-2xl text-gray-900">{fmt(liquidTotal)}</p>
                    {liquidTags.length > 0 && <p className="mt-1.5 text-xs text-gray-400">{liquidTags.join(" · ")}</p>}
                  </div>
                  <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Illiquid</p>
                    <p className="mt-2 font-bold text-2xl text-gray-900">{fmt(illiquidTotal)}</p>
                    {illiquidTags.length > 0 && <p className="mt-1.5 text-xs text-gray-400">{illiquidTags.join(" · ")}</p>}
                  </div>
                </div>
              )}

              {/* Asset breakdown donut */}
              {chartRaw.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Asset Breakdown</p>
                  <DonutChart data={chartRaw} total={totalAssets} />
                </div>
              )}

              {/* Debts summary */}
              {debts.length > 0 && (
                <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                  <div className="mb-3 flex items-center gap-3">
                    <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Debts</p>
                    <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">{fmt(debtsTotal)}</span>
                    <Link href="/account/liabilities" className="ml-auto text-xs font-medium text-purple-600 hover:underline">
                      View liabilities →
                    </Link>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {debts.slice(0, 3).map((d) => (
                      <div key={d.slug} className="flex items-center justify-between py-2.5">
                        <p className="text-sm text-gray-700">{d.accountName} — {d.bankName}</p>
                        <p className="text-sm font-semibold text-gray-800">{fmt(Math.abs(d.balance))}</p>
                      </div>
                    ))}
                  </div>
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
                    const isDebt = a.balance < 0 || ["mortgage", "loan", "credit"].includes(a.accountType);
                    const displayBalance = isDebt ? Math.abs(a.balance) : a.balance;
                    return (
                      <Link
                        key={a.slug}
                        href={`/account/accounts/${a.slug}`}
                        className="flex items-center justify-between px-5 py-4 hover:bg-gray-50 transition group"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 group-hover:text-purple-600 transition-colors truncate">
                            {a.accountName}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">
                            {a.bankName}
                            {a.accountType && <span className="ml-1.5 capitalize text-gray-300">· {a.accountType}</span>}
                            {(() => {
                              const ym = a.statementDate?.slice(0, 7);
                              const days = daysSinceYearMonth(ym);
                              const { text, cls } = freshnessLabel(days);
                              return text ? (
                                <span className={`ml-1.5 ${cls}`} title={ym ? `Data as of ${ym}` : undefined}>
                                  {freshnessGlyph(days)}as of {new Date((ym ?? "") + "-01T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })} · {text}
                                  {a.fromSnapshot && <span className="ml-1 italic text-gray-400">(manual)</span>}
                                </span>
                              ) : ym ? (
                                <span className="ml-1.5 text-gray-400">
                                  as of {new Date(ym + "-01T12:00:00").toLocaleDateString("en-US", { month: "short", year: "numeric" })}
                                  {a.fromSnapshot && <span className="ml-1 italic">(manual)</span>}
                                </span>
                              ) : null;
                            })()}
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`font-semibold text-sm ${isDebt ? "text-red-600" : "text-gray-900"}`}>
                            {isDebt ? "−" : ""}{fmt(displayBalance)}
                          </span>
                          <button
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); openSnapshot(a); }}
                            title="Update balance"
                            className="rounded-md border border-gray-200 bg-white px-2 py-1 text-xs text-gray-500 opacity-0 group-hover:opacity-100 hover:border-purple-300 hover:text-purple-600 transition"
                          >
                            Update
                          </button>
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
                        <span className="ml-auto text-sm font-semibold text-gray-700">{fmt(catTotal)}</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        {catAssets.map((asset) => {
                          const linked = accounts.find((a) => a.slug === asset.linkedAccountSlug);
                          return (
                            <div key={asset.id} className="flex items-center justify-between gap-3 px-5 py-3.5">
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-800">{asset.label}</p>
                                <p className="text-xs text-gray-400">
                                  {linked && <span className="text-purple-500">linked to {linked.label} · </span>}
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
            {accounts.length > 0 && (
              <div className="mb-5">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Link to loan / mortgage <span className="font-normal normal-case text-gray-400">(optional)</span>
                </label>
                <select value={form.linkedAccountSlug} onChange={(e) => setForm((f) => ({ ...f, linkedAccountSlug: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500">
                  <option value="">None</option>
                  {accounts.map((a) => <option key={a.slug} value={a.slug}>{a.label}</option>)}
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
