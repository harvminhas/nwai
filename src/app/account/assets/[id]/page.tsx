"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { formatCurrency } from "@/lib/currencyUtils";
import AccountSwitcher from "@/components/AccountSwitcher";
import type { ManualAsset, AssetCategory, HubLink, ExpenseTransaction, IncomeTransaction } from "@/lib/types";
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

  // Hub links state
  type TxnWithFingerprint = ExpenseTransaction & { fingerprint: string };
  const [linkedAccounts, setLinkedAccounts] = useState<Array<{ account: DebtAccount; role: string }>>([]);
  const [fundingTxns, setFundingTxns] = useState<Array<TxnWithFingerprint & { linkAmount?: number }>>([]);
  const [spendOnTxns, setSpendOnTxns] = useState<TxnWithFingerprint[]>([]);
  const [showLinkAccountModal, setShowLinkAccountModal] = useState(false);
  const [showLinkTxnModal, setShowLinkTxnModal] = useState(false);
  const [availableTxns, setAvailableTxns] = useState<TxnWithFingerprint[]>([]);
  const [txnLinkRole, setTxnLinkRole] = useState<"funds" | "spend_on">("funds");
  const [linkingTxn, setLinkingTxn] = useState<string | null>(null);

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const [assetsRes, debtsRes, txnsRes] = await Promise.all([
        fetch("/api/user/assets-summary", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/debts-summary", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/spending/transactions?limit=1000", { headers: { Authorization: `Bearer ${tok}` } }),
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
      
      // Load available transactions
      if (txnsRes.ok) {
        const txnsJson = await txnsRes.json();
        setAvailableTxns(txnsJson.transactions ?? []);
      }

      // Load linked accounts and transactions for this asset
      if (found) {
        await loadLinks(tok, found.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load asset");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadLinks = useCallback(async (tok: string, assetId: string) => {
    try {
      // Load account links
      const accountLinksRes = await fetch(`/api/user/account-links-for-hub?hubId=${assetId}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      
      if (accountLinksRes.ok) {
        const { links } = await accountLinksRes.json();
        const accounts = debts?.groups?.flatMap((g) => g.accounts) ?? [];
        const linked = links.map((link: { accountSlug: string; role: string }) => ({
          account: accounts.find((a) => a.slug === link.accountSlug),
          role: link.role,
        })).filter((l: { account: DebtAccount | undefined }) => l.account);
        setLinkedAccounts(linked);
      }

      // Load transaction links
      const txLinksRes = await fetch(`/api/user/tx-links-for-hub?hubId=${assetId}`, {
        headers: { Authorization: `Bearer ${tok}` },
      });
      
      if (txLinksRes.ok) {
        const { links } = await txLinksRes.json();
        const txns = availableTxns;
        
        const funding = links
          .filter((l: { role: string }) => l.role === "funds")
          .map((l: { fingerprint: string; amount?: number }) => {
            const txn = txns.find((t) => t.fingerprint === l.fingerprint);
            return txn ? { ...txn, linkAmount: l.amount } : null;
          })
          .filter(Boolean);
        
        const spending = links
          .filter((l: { role: string }) => l.role === "spend_on")
          .map((l: { fingerprint: string }) => txns.find((t) => t.fingerprint === l.fingerprint))
          .filter(Boolean);
        
        setFundingTxns(funding);
        setSpendOnTxns(spending);
      }
    } catch (err) {
      console.error("Failed to load links:", err);
    }
  }, [debts, availableTxns]);

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

  // Calculate total debt from all linked accounts (finances + secures)
  const totalDebt = linkedAccounts
    .filter(({ role }) => role === "finances" || role === "secures")
    .reduce((sum, { account }) => sum + Math.abs(account.balance), 0);
  
  // Legacy: also include linkedAccountSlug if set (backward compatibility)
  const legacyDebt = linkedDebt && !linkedAccounts.some(({ account }) => account.slug === linkedDebt.slug)
    ? Math.abs(linkedDebt.balance)
    : 0;
  
  const equity = asset.value - totalDebt - legacyDebt;

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
        {(linkedAccounts.length > 0 || linkedDebt) && (
          <div className={`rounded-xl border p-5 shadow-sm ${equity >= 0 ? "border-green-200 bg-green-50" : "border-red-200 bg-red-50"}`}>
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Your equity</p>
            <p className={`mt-2 text-2xl font-bold tabular-nums ${equity >= 0 ? "text-green-700" : "text-red-600"}`}>
              {formatCurrency(equity, currency)}
            </p>
            <p className="mt-1.5 text-xs text-gray-500">
              {formatCurrency(asset.value, currency)} value less {formatCurrency(totalDebt + legacyDebt, currency)} owed
            </p>
          </div>
        )}
      </div>

      {/* Financing (linked accounts) */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Financing</h2>
          <button
            onClick={() => setShowLinkAccountModal(true)}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition"
          >
            Link account
          </button>
        </div>
        {linkedAccounts.length > 0 ? (
          <div className="space-y-2">
            {linkedAccounts.map(({ account, role }) => (
              <div key={account.slug} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-4">
                <div className="flex-1">
                  <p className="font-medium text-gray-900">{account.bankName}</p>
                  {account.accountName && <p className="text-sm text-gray-600">{account.accountName}</p>}
                  <span className="mt-1 inline-block rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-700">
                    {role === "finances" ? "Financing" : "Secures"}
                  </span>
                </div>
                <div className="text-right">
                  <p className="text-lg font-bold text-gray-900 tabular-nums">{formatCurrency(Math.abs(account.balance), currency)}</p>
                  <p className="text-xs text-gray-500">
                    as of {formatMonth(account.statementMonth)}
                  </p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-5">
            <p className="text-sm text-gray-600">No linked accounts yet. Link a loan or mortgage to track equity.</p>
          </div>
        )}
      </div>

      {/* How you paid (funding transactions) */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">How you paid</h2>
          <button
            onClick={() => {
              setTxnLinkRole("funds");
              setShowLinkTxnModal(true);
            }}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition"
          >
            Link transaction
          </button>
        </div>
        {fundingTxns.length > 0 ? (
          <div className="space-y-2">
            {fundingTxns.map((tx) => (
              <div key={tx.fingerprint} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{tx.merchant}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                    <span>{tx.accountLabel ?? "Unknown account"}</span>
                    <span>•</span>
                    <span>{tx.date ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date"}</span>
                  </div>
                </div>
                <p className="text-sm font-bold text-gray-900 tabular-nums">
                  {formatCurrency(tx.linkAmount ?? tx.amount, currency)}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-5">
            <p className="text-sm text-gray-600">No funding transactions yet. Link transactions to show purchase history.</p>
          </div>
        )}
      </div>

      {/* Related spending */}
      <div className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-400">Related spending</h2>
          <button
            onClick={() => {
              setTxnLinkRole("spend_on");
              setShowLinkTxnModal(true);
            }}
            className="rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-purple-700 transition"
          >
            Link transaction
          </button>
        </div>
        {spendOnTxns.length > 0 ? (
          <div className="space-y-2">
            {spendOnTxns.map((tx) => (
              <div key={tx.fingerprint} className="flex items-center justify-between rounded-xl border border-gray-200 bg-white p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{tx.merchant}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                    <span>{tx.category}</span>
                    <span>•</span>
                    <span>{tx.date ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date"}</span>
                  </div>
                </div>
                <p className="text-sm font-bold text-gray-900 tabular-nums">{formatCurrency(tx.amount, currency)}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border-2 border-dashed border-gray-200 bg-gray-50/60 p-5">
            <p className="text-sm text-gray-600">No related spending yet. Link transactions for insurance, gas, repairs, etc.</p>
          </div>
        )}
      </div>

      {/* Edit panel */}
      <div className="mt-6 rounded-xl border border-gray-200 bg-white p-5">
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

      {/* Link Account Modal (placeholder - simplified for P1) */}
      {showLinkAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-w-md w-full rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Link Account</h3>
            <p className="mt-2 text-sm text-gray-600">Select an account and role to link to this asset.</p>
            <div className="mt-4 space-y-3">
              <p className="text-xs text-gray-500">Coming soon: account selection interface</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowLinkAccountModal(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link Transaction Modal (placeholder - simplified for P1) */}
      {showLinkTxnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="max-w-md w-full rounded-xl bg-white p-6 shadow-xl">
            <h3 className="text-lg font-bold text-gray-900">Link Transaction</h3>
            <p className="mt-2 text-sm text-gray-600">
              Select a transaction to link as {txnLinkRole === "funds" ? "funding" : "related spending"}.
            </p>
            <div className="mt-4 space-y-3">
              <p className="text-xs text-gray-500">Coming soon: transaction selection interface</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => setShowLinkTxnModal(false)}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}