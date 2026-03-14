"use client";

import { Suspense } from "react";
import { useEffect, useState, useCallback } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { ManualAsset, AssetCategory, UserStatementSummary } from "@/lib/types";

// ── constants ──────────────────────────────────────────────────────────────────

export const CATEGORY_META: Record<AssetCategory, { label: string; emoji: string; color: string; hint: string }> = {
  property:   { label: "Property",   emoji: "🏠", color: "bg-blue-50   border-blue-200   text-blue-800",  hint: "Home, land, rental property" },
  vehicle:    { label: "Vehicle",    emoji: "🚗", color: "bg-sky-50    border-sky-200    text-sky-800",   hint: "Car, motorcycle, boat" },
  retirement: { label: "Retirement", emoji: "🏦", color: "bg-green-50  border-green-200  text-green-800", hint: "Pension, 401k, IRA not linked to a statement" },
  investment: { label: "Investment", emoji: "📈", color: "bg-purple-50 border-purple-200 text-purple-800",hint: "Stocks, funds, crypto not in a statement" },
  business:   { label: "Business",   emoji: "💼", color: "bg-amber-50  border-amber-200  text-amber-800", hint: "Business equity, partnerships" },
  other:      { label: "Other",      emoji: "💎", color: "bg-gray-50   border-gray-200   text-gray-700",  hint: "Jewellery, art, collectibles, etc." },
};

const CATEGORY_ORDER: AssetCategory[] = ["property", "vehicle", "retirement", "investment", "business", "other"];

function formatCurrency(v: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 30) return `Updated ${days}d ago`;
  if (days < 365) return `Updated ${Math.floor(days / 30)}mo ago`;
  return `Updated ${Math.floor(days / 365)}y ago`;
}

// ── types ──────────────────────────────────────────────────────────────────────

type AccountGroup = { slug: string; label: string; type: string };

interface FormState {
  label: string;
  category: AssetCategory;
  value: string;
  linkedAccountSlug: string;
}

const EMPTY_FORM: FormState = { label: "", category: "property", value: "", linkedAccountSlug: "" };

// ── component ──────────────────────────────────────────────────────────────────

export function AssetsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const prefillLink = searchParams.get("link");
  const prefillCategory = searchParams.get("category") as AssetCategory | null;
  const [assets, setAssets] = useState<ManualAsset[]>([]);
  const [accounts, setAccounts] = useState<AccountGroup[]>([]);
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
      const [aRes, sRes] = await Promise.all([
        fetch("/api/user/assets", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/statements", { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      const aJson = await aRes.json().catch(() => ({}));
      const sJson = await sRes.json().catch(() => ({}));
      setAssets(aJson.assets ?? []);
      // Build account groups from statements (mortgage/loan types)
      const stmts: UserStatementSummary[] = sJson.statements ?? [];
      const seen = new Set<string>();
      const groups: AccountGroup[] = [];
      for (const s of stmts) {
        if (s.status !== "completed") continue;
        const bank = (s.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const acct = (s.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        const slug = acct !== "unknown" ? `${bank}-${acct}` : bank;
        if (seen.has(slug)) continue;
        seen.add(slug);
        groups.push({ slug, label: `${s.accountName ?? s.bankName ?? slug}${s.accountId && s.accountId !== "unknown" ? ` (${s.accountId})` : ""}`, type: s.accountType ?? "other" });
      }
      setAccounts(groups.filter((g) => ["mortgage", "loan"].includes(g.type)));
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

  // Auto-open form if coming from account detail nudge
  useEffect(() => {
    if (prefillLink && !loading && !showForm) {
      openAdd({
        category: prefillCategory ?? "property",
        linkedAccountSlug: prefillLink,
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  function openAdd(prefill?: Partial<FormState>) {
    setEditing(null);
    setForm({ ...EMPTY_FORM, ...prefill });
    setFormError(null);
    setShowForm(true);
  }

  function openEdit(asset: ManualAsset) {
    setEditing(asset);
    setForm({
      label: asset.label,
      category: asset.category,
      value: String(asset.value),
      linkedAccountSlug: asset.linkedAccountSlug ?? "",
    });
    setFormError(null);
    setShowForm(true);
  }

  async function handleSave() {
    const val = parseFloat(form.value.replace(/,/g, ""));
    if (!form.label.trim()) { setFormError("Give this asset a name"); return; }
    if (isNaN(val) || val < 0) { setFormError("Enter a valid value"); return; }
    setSaving(true); setFormError(null);
    try {
      const payload = {
        label: form.label.trim(),
        category: form.category,
        value: val,
        linkedAccountSlug: form.linkedAccountSlug || null,
      };
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
    setDeleteConfirm(null);
    load(token);
  }

  const totalManual = assets.reduce((s, a) => s + a.value, 0);

  // Group by category
  const byCategory = new Map<AssetCategory, ManualAsset[]>();
  for (const a of assets) {
    if (!byCategory.has(a.category)) byCategory.set(a.category, []);
    byCategory.get(a.category)!.push(a);
  }

  if (loading) return (
    <div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>
  );

  return (
    <div>
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">

        {/* Header */}
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="font-bold text-3xl text-gray-900">Assets</h1>
            <p className="mt-1 text-sm text-gray-500">
              Things you own that aren't in a bank statement — property, vehicles, pensions, and more.
            </p>
          </div>
          <button
            onClick={() => openAdd()}
            className="shrink-0 rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 px-5 py-2.5 font-semibold text-white shadow-sm transition hover:from-purple-700 hover:to-purple-800"
          >
            + Add asset
          </button>
        </div>

        {error && <p className="mt-4 text-red-600">{error}</p>}

        {/* Total banner */}
        {assets.length > 0 && (
          <div className="mt-6 rounded-xl bg-gradient-to-r from-purple-600 to-indigo-600 p-6 text-white shadow-md">
            <p className="text-sm font-medium text-purple-200">Total manual assets</p>
            <p className="mt-1 font-bold text-4xl">{formatCurrency(totalManual)}</p>
            <p className="mt-1 text-sm text-purple-200">{assets.length} asset{assets.length !== 1 ? "s" : ""} tracked · included in your net worth</p>
          </div>
        )}

        {/* Empty state */}
        {assets.length === 0 && !error && (
          <div className="mt-10">
            <p className="mb-6 text-sm font-medium text-gray-500 uppercase tracking-wide">What would you like to add?</p>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {CATEGORY_ORDER.map((cat) => {
                const m = CATEGORY_META[cat];
                return (
                  <button
                    key={cat}
                    onClick={() => openAdd({ category: cat })}
                    className={`rounded-xl border-2 p-4 text-left transition hover:shadow-md ${m.color}`}
                  >
                    <span className="text-3xl">{m.emoji}</span>
                    <p className="mt-2 font-semibold">{m.label}</p>
                    <p className="text-xs mt-0.5 opacity-70">{m.hint}</p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Asset list */}
        {assets.length > 0 && (
          <div className="mt-8 space-y-8">
            {CATEGORY_ORDER.filter((c) => byCategory.has(c)).map((cat) => {
              const group = byCategory.get(cat)!;
              const meta = CATEGORY_META[cat];
              return (
                <section key={cat}>
                  <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-gray-500">
                    <span>{meta.emoji}</span> {meta.label}
                    <span className="font-normal text-gray-400">·  {formatCurrency(group.reduce((s, a) => s + a.value, 0))}</span>
                  </h2>
                  <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {group.map((asset) => {
                      const linked = accounts.find((a) => a.slug === asset.linkedAccountSlug);
                      return (
                        <li key={asset.id} className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-gray-900">{asset.label}</p>
                              {linked && (
                                <p className="mt-0.5 text-xs text-purple-600">
                                  🔗 Linked to {linked.label}
                                </p>
                              )}
                              <p className="mt-0.5 text-xs text-gray-400">{timeAgo(asset.updatedAt)}</p>
                            </div>
                            <p className="shrink-0 font-bold text-gray-900">{formatCurrency(asset.value)}</p>
                          </div>
                          <div className="mt-4 flex gap-2">
                            <button
                              onClick={() => openEdit(asset)}
                              className="flex-1 rounded-lg border border-gray-200 py-1.5 text-xs font-medium text-gray-600 transition hover:bg-gray-50"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => setDeleteConfirm(asset.id)}
                              className="rounded-lg border border-red-100 px-3 py-1.5 text-xs font-medium text-red-500 transition hover:bg-red-50"
                            >
                              Delete
                            </button>
                          </div>
                        </li>
                      );
                    })}
                    {/* Quick-add in category */}
                    <li>
                      <button
                        onClick={() => openAdd({ category: cat })}
                        className="flex h-full min-h-[120px] w-full items-center justify-center rounded-xl border-2 border-dashed border-gray-200 text-sm text-gray-400 transition hover:border-purple-300 hover:text-purple-500"
                      >
                        + Add {meta.label.toLowerCase()}
                      </button>
                    </li>
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Add / Edit modal ──────────────────────────────────────────────── */}
      {showForm && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}>
          <div className="w-full max-w-md rounded-t-2xl bg-white p-6 shadow-xl sm:rounded-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="font-bold text-xl text-gray-900">{editing ? "Edit asset" : "Add asset"}</h2>
              <button onClick={() => setShowForm(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">✕</button>
            </div>

            {/* Category picker */}
            <div className="mb-4">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-wide text-gray-500">Category</label>
              <div className="grid grid-cols-3 gap-2">
                {CATEGORY_ORDER.map((cat) => {
                  const m = CATEGORY_META[cat];
                  return (
                    <button
                      key={cat}
                      onClick={() => setForm((f) => ({ ...f, category: cat }))}
                      className={`rounded-lg border-2 p-2 text-center text-xs font-medium transition ${form.category === cat ? "border-purple-500 bg-purple-50 text-purple-700" : "border-gray-200 text-gray-600 hover:border-gray-300"}`}
                    >
                      <div className="text-xl">{m.emoji}</div>
                      {m.label}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Label */}
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Name</label>
              <input
                type="text"
                value={form.label}
                onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))}
                placeholder={`e.g. ${CATEGORY_META[form.category].hint.split(",")[0]}`}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
              />
            </div>

            {/* Value */}
            <div className="mb-4">
              <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">Estimated value</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={form.value}
                  onChange={(e) => setForm((f) => ({ ...f, value: e.target.value }))}
                  placeholder="0"
                  className="w-full rounded-lg border border-gray-300 py-2 pl-7 pr-3 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                />
              </div>
            </div>

            {/* Link to account (optional) */}
            {accounts.length > 0 && (
              <div className="mb-5">
                <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
                  Link to loan / mortgage <span className="font-normal normal-case text-gray-400">(optional)</span>
                </label>
                <select
                  value={form.linkedAccountSlug}
                  onChange={(e) => setForm((f) => ({ ...f, linkedAccountSlug: e.target.value }))}
                  className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500"
                >
                  <option value="">None</option>
                  {accounts.map((a) => (
                    <option key={a.slug} value={a.slug}>{a.label}</option>
                  ))}
                </select>
                {form.linkedAccountSlug && (
                  <p className="mt-1 text-xs text-purple-600">
                    Equity = this value − outstanding balance on that account
                  </p>
                )}
              </div>
            )}

            {formError && <p className="mb-3 text-sm text-red-600">{formError}</p>}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full rounded-lg bg-gradient-to-r from-purple-600 to-purple-700 py-3 font-semibold text-white transition hover:from-purple-700 hover:to-purple-800 disabled:opacity-60"
            >
              {saving ? "Saving…" : editing ? "Save changes" : "Add asset"}
            </button>
          </div>
        </div>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────────── */}
      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl text-center">
            <p className="text-2xl mb-3">🗑️</p>
            <p className="font-semibold text-gray-900">Delete this asset?</p>
            <p className="mt-1 text-sm text-gray-500">This can&apos;t be undone. It will be removed from your net worth.</p>
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
