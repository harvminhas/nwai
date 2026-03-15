"use client";

import { Suspense } from "react";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import type { ManualAsset, AssetCategory, UserStatementSummary, Insight } from "@/lib/types";

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

// Chart groups for donut
const CHART_GROUPS: { key: string; label: string; color: string; categories: AssetCategory[]; accountTypes: string[] }[] = [
  { key: "real_estate", label: "Real Estate",  color: "#6366f1", categories: ["property"],              accountTypes: [] },
  { key: "retirement",  label: "RRSP / TFSA",  color: "#22c55e", categories: ["retirement"],            accountTypes: [] },
  { key: "cash",        label: "Cash",          color: "#f59e0b", categories: [],                        accountTypes: ["checking", "savings"] },
  { key: "investments", label: "Investments",   color: "#3b82f6", categories: ["investment"],            accountTypes: ["investment"] },
  { key: "vehicles",    label: "Vehicles",      color: "#94a3b8", categories: ["vehicle"],               accountTypes: [] },
  { key: "business",    label: "Business",      color: "#f97316", categories: ["business"],              accountTypes: [] },
  { key: "other",       label: "Other",         color: "#d1d5db", categories: ["other"],                 accountTypes: [] },
];

// Liquid account types
const LIQUID_ACCOUNT_TYPES = new Set(["checking", "savings", "investment"]);
const LIQUID_ASSET_CATEGORIES = new Set<AssetCategory>(["investment"]);

// ── helpers ───────────────────────────────────────────────────────────────────

function fmt(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function fmtShort(v: number) {
  const abs = Math.abs(v);
  const sign = v < 0 ? "-" : "";
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return fmt(v);
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function accountSlug(s: UserStatementSummary) {
  const bank = (s.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = (s.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
}

// ── types ─────────────────────────────────────────────────────────────────────

type AccountGroup = { slug: string; label: string; type: string };

interface FormState {
  label: string;
  category: AssetCategory;
  value: string;
  linkedAccountSlug: string;
}

const EMPTY_FORM: FormState = { label: "", category: "property", value: "", linkedAccountSlug: "" };

// Latest statement per account (non-superseded, by date)
interface AccountBalance {
  slug: string;
  bankName: string;
  accountName: string;
  accountType: string;
  balance: number; // netWorth from latest statement
  statementDate?: string;
}

// ── sub-components ────────────────────────────────────────────────────────────

function DonutChart({ data, total }: { data: { label: string; value: number; color: string }[]; total: number }) {
  return (
    <div className="flex items-center gap-6">
      <div className="relative h-40 w-40 shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={data}
              cx="50%"
              cy="50%"
              innerRadius={44}
              outerRadius={68}
              paddingAngle={2}
              dataKey="value"
              strokeWidth={0}
            >
              {data.map((entry, i) => (
                <Cell key={i} fill={entry.color} />
              ))}
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
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillLink = searchParams.get("link");
  const prefillCategory = searchParams.get("category") as AssetCategory | null;

  const [assets, setAssets] = useState<ManualAsset[]>([]);
  const [accountBalances, setAccountBalances] = useState<AccountBalance[]>([]);
  const [accounts, setAccounts] = useState<AccountGroup[]>([]);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [yearMonth, setYearMonth] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  // Modal state
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<ManualAsset | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const load = useCallback(async (tok: string) => {
    setLoading(true); setError(null);
    try {
      const [aRes, sRes, cRes] = await Promise.all([
        fetch("/api/user/assets", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/statements", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/statements/consolidated", { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      const aJson = await aRes.json().catch(() => ({}));
      const sJson = await sRes.json().catch(() => ({}));
      const cJson = cRes.ok ? await cRes.json().catch(() => ({})) : {};

      setAssets(aJson.assets ?? []);
      setInsights(cJson.data?.insights ?? []);
      setYearMonth(cJson.yearMonth ?? null);

      // Deduplicate statements: latest non-superseded per account slug
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

      const balances: AccountBalance[] = Array.from(latestBySlug.values()).map((s) => ({
        slug: accountSlug(s),
        bankName: s.bankName ?? "Unknown",
        accountName: s.accountName ?? s.bankName ?? "Account",
        accountType: s.accountType ?? "other",
        balance: s.netWorth ?? 0,
        statementDate: s.statementDate,
      }));
      setAccountBalances(balances);

      // Loan/mortgage accounts for the asset-link dropdown
      const seen = new Set<string>();
      const groups: AccountGroup[] = [];
      for (const s of stmts) {
        if (!["mortgage", "loan"].includes(s.accountType ?? "")) continue;
        const slug = accountSlug(s);
        if (seen.has(slug)) continue;
        seen.add(slug);
        groups.push({
          slug,
          label: `${s.accountName ?? s.bankName ?? slug}${s.accountId && s.accountId !== "unknown" ? ` (${s.accountId})` : ""}`,
          type: s.accountType ?? "other",
        });
      }
      setAccounts(groups);
    } catch { setError("Failed to load"); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/account/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      load(tok);
    });
  }, [router, load]);

  useEffect(() => {
    if (prefillLink && !loading && !showForm) openAdd({ category: prefillCategory ?? "property", linkedAccountSlug: prefillLink });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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
        ? await fetch(`/api/user/assets/${editing.id}`, { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) })
        : await fetch("/api/user/assets", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(payload) });
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

  // ── derived data ─────────────────────────────────────────────────────────────

  const manualTotal = assets.reduce((s, a) => s + a.value, 0);
  const liquidAccounts = accountBalances.filter((a) => LIQUID_ACCOUNT_TYPES.has(a.accountType) && a.balance > 0);
  const liquidFromStatements = liquidAccounts.reduce((s, a) => s + a.balance, 0);
  const liquidFromManual = assets.filter((a) => LIQUID_ASSET_CATEGORIES.has(a.category)).reduce((s, a) => s + a.value, 0);
  const liquidTotal = liquidFromStatements + liquidFromManual;
  const illiquidTotal = assets.filter((a) => !LIQUID_ASSET_CATEGORIES.has(a.category)).reduce((s, a) => s + a.value, 0);
  const totalAssets = manualTotal + liquidFromStatements;

  const debts = accountBalances.filter((a) => ["mortgage", "loan", "credit"].includes(a.accountType) || a.balance < 0);
  const debtsTotal = debts.reduce((s, a) => s + Math.abs(a.balance), 0);

  // Donut chart data
  const chartRaw = CHART_GROUPS.map((g) => {
    const fromManual = assets.filter((a) => (g.categories as string[]).includes(a.category)).reduce((s, a) => s + a.value, 0);
    const fromStatements = accountBalances.filter((a) => g.accountTypes.includes(a.accountType) && a.balance > 0).reduce((s, a) => s + a.balance, 0);
    return { label: g.label, value: fromManual + fromStatements, color: g.color };
  }).filter((d) => d.value > 0);

  const liquidTags = liquidAccounts.map((a) => a.accountName.toLowerCase()).slice(0, 4);
  const illiquidTags = assets
    .filter((a) => !LIQUID_ASSET_CATEGORIES.has(a.category))
    .map((a) => CATEGORY_META[a.category].label)
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .slice(0, 4);

  const keyInsight = insights.find((i) => i.priority === "high") ?? insights[0] ?? null;

  const monthStr = yearMonth
    ? new Date(parseInt(yearMonth.slice(0, 4)), parseInt(yearMonth.slice(5, 7)) - 1, 1)
        .toLocaleDateString("en-US", { month: "short", year: "numeric" })
    : null;

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

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      <div className="space-y-5">
        {/* Liquid / Illiquid KPI cards */}
        {(liquidTotal > 0 || illiquidTotal > 0) && (
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Liquid</p>
              <p className="mt-2 font-bold text-2xl text-gray-900">{fmt(liquidTotal)}</p>
              {liquidTags.length > 0 && (
                <p className="mt-1.5 text-xs text-gray-400">{liquidTags.join(" · ")}</p>
              )}
            </div>
            <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Illiquid</p>
              <p className="mt-2 font-bold text-2xl text-gray-900">{fmt(illiquidTotal)}</p>
              {illiquidTags.length > 0 && (
                <p className="mt-1.5 text-xs text-gray-400">{illiquidTags.join(" · ")}</p>
              )}
            </div>
          </div>
        )}

        {/* Asset Breakdown donut */}
        {chartRaw.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Asset Breakdown</p>
            <DonutChart data={chartRaw} total={totalAssets} />
          </div>
        )}

        {/* Debts */}
        {debts.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <div className="mb-4 flex items-center gap-3">
              <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Debts</p>
              <span className="rounded-md bg-red-50 px-2 py-0.5 text-xs font-semibold text-red-600">
                {fmt(debtsTotal)}
              </span>
            </div>
            <div className="divide-y divide-gray-100">
              {debts.map((d) => (
                <div key={d.slug} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{d.accountName} — {d.bankName}</p>
                    <p className="text-xs text-gray-400">{d.accountType}</p>
                  </div>
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
            <p className="text-sm text-gray-700">
              {keyInsight.message}
            </p>
          </div>
        )}

        {/* Manual assets list */}
        {assets.length > 0 && (
          <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
            <p className="mb-4 text-xs font-semibold uppercase tracking-wider text-gray-400">Tracked Assets</p>
            <div className="divide-y divide-gray-100">
              {assets.map((asset) => {
                const linked = accounts.find((a) => a.slug === asset.linkedAccountSlug);
                return (
                  <div key={asset.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-800">{asset.label}</p>
                      <p className="text-xs text-gray-400">
                        {CATEGORY_META[asset.category].label}
                        {linked && <span className="text-purple-500"> · linked to {linked.label}</span>}
                        <span className="ml-1">· updated {timeAgo(asset.updatedAt)}</span>
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
        )}

        {/* Empty state */}
        {assets.length === 0 && debts.length === 0 && liquidTotal === 0 && (
          <div className="rounded-xl border border-dashed border-gray-200 bg-gray-50 p-10 text-center">
            <p className="text-sm text-gray-500">No assets tracked yet.</p>
            <p className="mt-1 text-xs text-gray-400">Add your home, car, pension, or any other asset to include it in your net worth.</p>
            <button onClick={() => openAdd()} className="mt-4 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700">
              + Add first asset
            </button>
          </div>
        )}
      </div>

      {/* ── Add / Edit modal ─────────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
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

      {/* ── Delete confirm ────────────────────────────────────────────────────── */}
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
