"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { formatCurrency } from "@/lib/currencyUtils";
import AccountSwitcher from "@/components/AccountSwitcher";
import type { ManualAsset, AssetCategory } from "@/lib/types";
import type { DebtsSummary, DebtAccount } from "@/lib/debtsSummary";

const CATEGORY_LABEL: Record<AssetCategory, string> = {
  property: "Property",
  vehicle: "Vehicle",
  retirement: "Retirement",
  investment: "Investment",
  business: "Business",
  other: "Other",
};

function formatMonth(ym: string): string {
  const [y, m] = ym.split("-");
  if (!m) return ym;
  return new Date(parseInt(y, 10), parseInt(m, 10) - 1, 1)
    .toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

interface AssetSummaryShape {
  totalAssets: number;
  currency: string;
  groups: Array<{ manualAssets: ManualAsset[] }>;
}

export default function ManualAssetPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const id = params.id;

  const [token, setToken] = useState<string | null>(null);
  const [asset, setAsset] = useState<ManualAsset | null>(null);
  const [currency, setCurrency] = useState("USD");
  const [debts, setDebts] = useState<DebtsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<AssetCategory>("other");
  const [value, setValue] = useState("");
  const [linkedSlug, setLinkedSlug] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const [assetsRes, debtsRes] = await Promise.all([
        fetch("/api/user/assets-summary", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/debts-summary", { headers: { Authorization: `Bearer ${tok}` } }),
      ]);
      if (!assetsRes.ok) throw new Error("Failed to load assets");
      const assetsJson: AssetSummaryShape = await assetsRes.json();
      const all = (assetsJson.groups ?? []).flatMap((g) => g.manualAssets ?? []);
      const found = all.find((a) => a.id === id) ?? null;
      setAsset(found);
      setCurrency(assetsJson.currency ?? "USD");
      if (found) {
        setLabel(found.label);
        setCategory(found.category);
        setValue(String(found.value));
        setLinkedSlug(found.linkedAccountSlug ?? "");
      }
      if (debtsRes.ok) setDebts(await debtsRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load asset");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) { router.push("/login"); return; }
      const tok = await user.getIdToken();
      setToken(tok);
      await load(tok);
    });
  }, [router, load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const debtAccounts: DebtAccount[] = useMemo(
    () => debts?.groups?.flatMap((g) => g.accounts) ?? [],
    [debts]
  );

  const linkedDebt = useMemo(
    () => debtAccounts.find((a) => a.slug === asset?.linkedAccountSlug) ?? null,
    [debtAccounts, asset]
  );

  const payoff = useMemo(
    () => debts?.payoffEstimates?.find((e) => e.accountSlug === linkedDebt?.slug) ?? null,
    [debts, linkedDebt]
  );

  const save = async () => {
    if (!token || !asset) return;
    const num = Number(value.replace(/[^0-9.-]/g, ""));
    if (!label.trim() || Number.isNaN(num)) {
      setToast({ msg: "Add a name and a value", ok: false });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/user/assets/${asset.id}`, {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          label: label.trim(),
          category,
          value: num,
          linkedAccountSlug: linkedSlug || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setEditing(false);
      setToast({ msg: "Saved", ok: true });
      await load(token);
    } catch {
      setToast({ msg: "Could not save", ok: false });
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!token || !asset) return;
    if (!confirm(`Delete ${asset.label}? This removes it from your net worth.`)) return;
    const res = await fetch(`/api/user/assets/${asset.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) router.push("/account/assets?tab=accounts");
    else setToast({ msg: "Could not delete", ok: false });
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !asset) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
        <Link href="/account/assets?tab=accounts" className="text-sm text-gray-500 hover:text-purple-600">Assets</Link>
        <p className="mt-4 text-red-600">{error ?? "This asset no longer exists."}</p>
      </div>
    );
  }

  const debtBalance = linkedDebt ? Math.abs(linkedDebt.balance) : 0;
  const equity = asset.value - debtBalance;

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg text-sm font-medium ${toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          <span>{toast.ok ? "OK" : "!"}</span>
          <span>{toast.msg}</span>
        </div>
      )}

      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <Link href="/account/assets?tab=accounts" className="hover:text-purple-600">Assets</Link>
          <span>/</span>
          <Link href={`/account/assets/category/${asset.category === "property" ? "property" : "other"}`} className="hover:text-purple-600">
            {asset.category === "property" ? "Property" : "Other Assets"}
          </Link>
          <span>/</span>
          <span className="font-medium text-gray-700">{asset.label}</span>
        </div>
        <AccountSwitcher />
      </div>

      <div className="mb-1 flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
          {CATEGORY_LABEL[asset.category] ?? asset.category}
        </span>
        <span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-500">
          Manual asset
        </span>
      </div>
      <h1 className="text-2xl font-bold text-gray-900">{asset.label}</h1>

      {/* Value + equity */}
      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Value</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 tabular-nums">
            {formatCurrency(asset.value, currency)}
          </p>
          <p className="mt-1.5 text-xs text-gray-400">
            Updated {new Date(asset.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </p>
        </div>
        {linkedDebt && (
          <div className={`rounded-xl border p-5 shadow-sm ${equity >= 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Your equity</p>
            <p className={`mt-2 text-2xl font-bold tabular-nums ${equity >= 0 ? "text-green-700" : "text-red-600"}`}>
              {formatCurrency(equity, currency)}
            </p>
            <p className="mt-1.5 text-xs text-gray-500">
              {formatCurrency(asset.value, currency)} value less {formatCurrency(debtBalance, currency)} owed
            </p>
          </div>
        )}
      </div>

      <div className="mt-6 grid items-start gap-6 lg:grid-cols-2">
      {/* Linked loan */}
      <div>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">Linked loan</h2>
        {linkedDebt ? (
          <Link
            href={`/account/accounts/${linkedDebt.slug}`}
            className="block rounded-xl border border-purple-200 bg-purple-50 p-5 hover:bg-purple-100 transition"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold text-gray-900">{linkedDebt.bankName}</p>
                {linkedDebt.accountName && <p className="text-sm text-gray-600">{linkedDebt.accountName}</p>}
                <div className="mt-2 flex flex-wrap gap-4 text-xs text-gray-500">
                  {linkedDebt.interestRate !== null && <span>{linkedDebt.interestRate.toFixed(2)}% APR</span>}
                  {linkedDebt.monthlyPayment !== null && <span>{formatCurrency(linkedDebt.monthlyPayment, currency)}/mo</span>}
                  {payoff?.payoffDate && <span className="text-green-600">Payoff {formatMonth(payoff.payoffDate)}</span>}
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(debtBalance, currency)}</p>
                <p className="text-xs text-purple-600">Open account</p>
              </div>
            </div>
          </Link>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-5">
            <p className="text-sm text-gray-600">
              {debtAccounts.length > 0
                ? "Link a loan or mortgage to see your equity here."
                : "No loan accounts yet. Upload a mortgage or loan statement and it will appear here."}
            </p>
            <button
              onClick={() => setEditing(true)}
              className="mt-3 rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
            >
              Edit asset
            </button>
          </div>
        )}
      </div>

      {/* Edit */}
      <div className="rounded-xl border border-gray-200 bg-white p-5">
        {!editing ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-gray-900">Asset details</p>
              <p className="text-xs text-gray-500">
                {asset.label} is counted in your net worth under {CATEGORY_LABEL[asset.category] ?? asset.category}.
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <button
                onClick={remove}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-400 hover:border-red-300 hover:text-red-600 transition"
              >
                Delete
              </button>
              <button
                onClick={() => setEditing(true)}
                className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-600 hover:border-purple-300 hover:text-purple-600 transition"
              >
                Edit
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Name</label>
              <input
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
              />
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Type</label>
                <select
                  value={category}
                  onChange={(e) => setCategory(e.target.value as AssetCategory)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                >
                  {(Object.keys(CATEGORY_LABEL) as AssetCategory[]).map((c) => (
                    <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Value ({currency})</label>
                <input
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="decimal"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums focus:border-purple-400 focus:outline-none"
                />
              </div>
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">Linked loan (optional)</label>
              <select
                value={linkedSlug}
                onChange={(e) => setLinkedSlug(e.target.value)}
                className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
              >
                <option value="">Not linked</option>
                {debtAccounts.map((a) => (
                  <option key={a.slug} value={a.slug}>
                    {a.bankName}{a.accountName ? ` — ${a.accountName}` : ""} ({formatCurrency(Math.abs(a.balance), currency)})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center justify-end gap-2 pt-1">
              <button
                onClick={() => setEditing(false)}
                disabled={saving}
                className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 hover:text-gray-700 disabled:opacity-40"
              >
                Cancel
              </button>
              <button
                onClick={save}
                disabled={saving}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition"
              >
                {saving ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}