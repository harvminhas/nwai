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
  type LinkedTxn = TxnWithFingerprint & { linkAmount?: number; role: "funds" | "spend_on" };
  const [linkedAccounts, setLinkedAccounts] = useState<Array<{ account: DebtAccount; role: string }>>([]);
  const [linkedTxns, setLinkedTxns] = useState<LinkedTxn[]>([]);
  const [showLinkAccountModal, setShowLinkAccountModal] = useState(false);
  const [showLinkTxnModal, setShowLinkTxnModal] = useState(false);
  const [availableTxns, setAvailableTxns] = useState<TxnWithFingerprint[]>([]);
  
  // Link account modal state
  const [selectedAccountSlug, setSelectedAccountSlug] = useState("");
  const [selectedAccountRole, setSelectedAccountRole] = useState<"finances" | "secures">("finances");
  const [linking, setLinking] = useState(false);

  // Link transaction modal state
  const [txnSearch, setTxnSearch] = useState("");
  const [selectedTxn, setSelectedTxn] = useState<string | null>(null);
  const [selectedTxnRole, setSelectedTxnRole] = useState<"funds" | "spend_on">("funds");
  const [partialAmount, setPartialAmount] = useState("");

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const [assetsRes, debtsRes, txnsRes] = await Promise.all([
        fetch("/api/user/assets-summary", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/debts-summary", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/spending/transactions?months=12&limit=2000", { headers: { Authorization: `Bearer ${tok}` } }),
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

      const debtsData = debtsRes.ok ? await debtsRes.json() : null;
      setDebts(debtsData);
      
      // Load available transactions
      const txnsData = txnsRes.ok ? await txnsRes.json() : { transactions: [] };
      setAvailableTxns(txnsData.transactions ?? []);

      // Load linked accounts and transactions for this asset
      if (found && debtsData && txnsData.transactions) {
        await loadLinks(tok, found.id, debtsData, txnsData.transactions);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load asset");
    } finally {
      setLoading(false);
    }
  }, [id]);

  const loadLinks = useCallback(
    async (tok: string, assetId: string, debtsData: DebtsSummary, txnsData: TxnWithFingerprint[]) => {
      try {
        // Load account links
        const accountLinksRes = await fetch(`/api/user/account-links-for-hub?hubId=${assetId}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        
        if (accountLinksRes.ok) {
          const { links } = await accountLinksRes.json();
          const accounts = debtsData?.groups?.flatMap((g) => g.accounts) ?? [];
          const linked = links
            .map((link: { accountSlug: string; role: string }) => ({
              account: accounts.find((a) => a.slug === link.accountSlug),
              role: link.role,
            }))
            .filter((l: { account: DebtAccount | undefined }) => l.account);
          setLinkedAccounts(linked);
        }

        // Load transaction links
        const txLinksRes = await fetch(`/api/user/tx-links-for-hub?hubId=${assetId}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        
        if (txLinksRes.ok) {
          const { links } = await txLinksRes.json();
          
          const allLinked = links
            .filter((l: { role: string }) => l.role === "funds" || l.role === "spend_on")
            .map((l: { fingerprint: string; role: string; amount?: number }) => {
              const txn = txnsData.find((t) => t.fingerprint === l.fingerprint);
              return txn ? { ...txn, linkAmount: l.amount, role: l.role as "funds" | "spend_on" } : null;
            })
            .filter(Boolean);
          
          setLinkedTxns(allLinked);
        }
      } catch (err) {
        console.error("Failed to load links:", err);
      }
    },
    []
  );

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

  const linkAccount = async () => {
    if (!token || !asset || !selectedAccountSlug) return;
    setLinking(true);
    try {
      const res = await fetch("/api/user/account-links", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          accountSlug: selectedAccountSlug,
          hubId: asset.id,
          role: selectedAccountRole,
        }),
      });
      if (!res.ok) throw new Error("Failed to link account");
      setToast({ msg: "Account linked", ok: true });
      setShowLinkAccountModal(false);
      setSelectedAccountSlug("");
      await load(token);
    } catch {
      setToast({ msg: "Could not link account", ok: false });
    } finally {
      setLinking(false);
    }
  };

  const unlinkAccount = async (accountSlug: string, role: string) => {
    if (!token || !asset) return;
    if (!confirm("Remove this account link?")) return;
    try {
      const res = await fetch("/api/user/account-links", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          accountSlug,
          hubId: asset.id,
          role,
        }),
      });
      if (!res.ok) throw new Error("Failed to unlink");
      setToast({ msg: "Account unlinked", ok: true });
      await load(token);
    } catch {
      setToast({ msg: "Could not unlink account", ok: false });
    }
  };

  const linkTransaction = async () => {
    if (!token || !asset || !selectedTxn) return;
    setLinking(true);
    try {
      const body: { fingerprint: string; hubId: string; role: string; amount?: number } = {
        fingerprint: selectedTxn,
        hubId: asset.id,
        role: selectedTxnRole,
      };
      if (selectedTxnRole === "funds" && partialAmount) {
        const amt = Number(partialAmount.replace(/[^0-9.-]/g, ""));
        if (!isNaN(amt) && amt > 0) {
          body.amount = amt;
        }
      }
      const res = await fetch("/api/user/tx-links", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to link transaction");
      setToast({ msg: "Transaction linked", ok: true });
      setShowLinkTxnModal(false);
      setSelectedTxn(null);
      setPartialAmount("");
      setTxnSearch("");
      setSelectedTxnRole("funds");
      await load(token);
    } catch {
      setToast({ msg: "Could not link transaction", ok: false });
    } finally {
      setLinking(false);
    }
  };

  const unlinkTransaction = async (fingerprint: string, role: string) => {
    if (!token || !asset) return;
    if (!confirm("Remove this transaction link?")) return;
    try {
      const res = await fetch("/api/user/tx-links", {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          fingerprint,
          hubId: asset.id,
          role,
        }),
      });
      if (!res.ok) throw new Error("Failed to unlink");
      setToast({ msg: "Transaction unlinked", ok: true });
      await load(token);
    } catch {
      setToast({ msg: "Could not unlink transaction", ok: false });
    }
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

      {/* Financing */}
      {linkedAccounts.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-gray-500">Financing</h2>
          <div className="space-y-2">
            {linkedAccounts.map(({ account, role }) => (
              <div key={account.slug} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{account.bankName}</p>
                  {account.accountName && <p className="text-xs text-gray-600">{account.accountName}</p>}
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-gray-900 tabular-nums">{formatCurrency(Math.abs(account.balance), currency)}</p>
                  <p className="text-xs text-gray-400">
                    {formatMonth(account.statementMonth)}
                  </p>
                </div>
                <button
                  onClick={() => unlinkAccount(account.slug, role)}
                  className="shrink-0 text-xs text-gray-400 hover:text-red-600 transition"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowLinkAccountModal(true)}
            className="mt-2 text-xs text-purple-600 hover:text-purple-700"
          >
            + Link account
          </button>
        </div>
      )}
      
      {linkedAccounts.length === 0 && (
        <div className="mt-6">
          <button
            onClick={() => setShowLinkAccountModal(true)}
            className="text-sm text-purple-600 hover:text-purple-700"
          >
            + Link financing account
          </button>
        </div>
      )}

      {/* Linked transactions */}
      {linkedTxns.length > 0 && (
        <div className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-gray-500">Linked transactions</h2>
          <div className="space-y-2">
            {linkedTxns.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).map((tx) => (
              <div key={tx.fingerprint} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-gray-900 truncate">{tx.merchant}</p>
                    <span className="shrink-0 text-xs text-gray-400">
                      {tx.role === "funds" ? "Funding" : "Spending"}
                    </span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                    <span>{tx.accountLabel ?? "Unknown"}</span>
                    <span>•</span>
                    <span>{tx.date ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date"}</span>
                  </div>
                </div>
                <p className="text-sm font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(tx.linkAmount ?? tx.amount, currency)}
                </p>
                <button
                  onClick={() => unlinkTransaction(tx.fingerprint, tx.role)}
                  className="shrink-0 text-xs text-gray-400 hover:text-red-600 transition"
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={() => setShowLinkTxnModal(true)}
            className="mt-2 text-xs text-purple-600 hover:text-purple-700"
          >
            + Link transaction
          </button>
        </div>
      )}
      
      {linkedTxns.length === 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowLinkTxnModal(true)}
            className="text-sm text-purple-600 hover:text-purple-700"
          >
            + Link transaction
          </button>
        </div>
      )}

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

      {/* Link Account Modal */}
      {showLinkAccountModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowLinkAccountModal(false)}>
          <div className="max-w-lg w-full rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Link account</h3>
            <p className="mt-2 text-sm text-gray-600">Link a debt account that finances this asset.</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-500">Account</label>
                <select
                  value={selectedAccountSlug}
                  onChange={(e) => setSelectedAccountSlug(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                >
                  <option value="">Select an account</option>
                  {debtAccounts
                    .filter((a) => !linkedAccounts.some(({ account }) => account.slug === a.slug))
                    .map((a) => (
                      <option key={a.slug} value={a.slug}>
                        {a.bankName}{a.accountName ? ` — ${a.accountName}` : ""} ({formatCurrency(Math.abs(a.balance), currency)})
                      </option>
                    ))}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-500">Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedAccountRole("finances")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                      selectedAccountRole === "finances"
                        ? "border-purple-400 bg-purple-50 text-purple-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    Financing
                  </button>
                  <button
                    onClick={() => setSelectedAccountRole("secures")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                      selectedAccountRole === "secures"
                        ? "border-purple-400 bg-purple-50 text-purple-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    Secures
                  </button>
                </div>
                <p className="mt-2 text-xs text-gray-400">
                  {selectedAccountRole === "finances" 
                    ? "General loan or mortgage that finances this asset"
                    : "HELOC or line of credit secured by this asset"
                  }
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowLinkAccountModal(false);
                  setSelectedAccountSlug("");
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={linkAccount}
                disabled={!selectedAccountSlug || linking}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition"
              >
                {linking ? "Linking..." : "Link"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Link Transaction Modal */}
      {showLinkTxnModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowLinkTxnModal(false)}>
          <div className="max-w-3xl w-full rounded-xl bg-white p-6 shadow-xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Link transaction</h3>
            <p className="mt-2 text-sm text-gray-600">
              Link a transaction to this asset.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-500">Type</label>
                <div className="flex gap-2">
                  <button
                    onClick={() => setSelectedTxnRole("funds")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                      selectedTxnRole === "funds"
                        ? "border-purple-400 bg-purple-50 text-purple-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    Funding
                  </button>
                  <button
                    onClick={() => setSelectedTxnRole("spend_on")}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm transition ${
                      selectedTxnRole === "spend_on"
                        ? "border-purple-400 bg-purple-50 text-purple-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    Spending
                  </button>
                </div>
              </div>

              <div>
                <input
                  type="text"
                  value={txnSearch}
                  onChange={(e) => setTxnSearch(e.target.value)}
                  placeholder="Search by merchant..."
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                />
              </div>
            </div>

            {selectedTxnRole === "funds" && selectedTxn && (
              <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Partial amount (optional)
                </label>
                <input
                  type="text"
                  value={partialAmount}
                  onChange={(e) => setPartialAmount(e.target.value)}
                  placeholder="Leave blank for full amount"
                  inputMode="decimal"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                />
                <p className="mt-1 text-xs text-gray-400">
                  If you only used part of this transaction to fund this asset
                </p>
              </div>
            )}

            <div className="mt-4 flex-1 overflow-y-auto">
              <div className="space-y-2">
                {availableTxns
                  .filter((tx) => !txnSearch || tx.merchant?.toLowerCase().includes(txnSearch.toLowerCase()))
                  .filter((tx) => !linkedTxns.some((l) => l.fingerprint === tx.fingerprint))
                  .slice(0, 50)
                  .map((tx) => (
                    <button
                      key={tx.fingerprint}
                      onClick={() => setSelectedTxn(tx.fingerprint)}
                      className={`w-full text-left rounded-lg border p-3 transition ${
                        selectedTxn === tx.fingerprint
                          ? "border-purple-400 bg-purple-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-gray-900 truncate">{tx.merchant}</p>
                          <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                            <span>{tx.accountLabel ?? "Unknown"}</span>
                            <span>•</span>
                            <span>{tx.category}</span>
                            <span>•</span>
                            <span>{tx.date ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date"}</span>
                          </div>
                        </div>
                        <p className="text-sm font-semibold text-gray-900 tabular-nums">
                          {formatCurrency(tx.amount, currency)}
                        </p>
                      </div>
                    </button>
                  ))}
                {availableTxns.filter((tx) => !txnSearch || tx.merchant?.toLowerCase().includes(txnSearch.toLowerCase())).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">No transactions found</p>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-gray-200 pt-4">
              <button
                onClick={() => {
                  setShowLinkTxnModal(false);
                  setSelectedTxn(null);
                  setPartialAmount("");
                  setTxnSearch("");
                  setSelectedTxnRole("funds");
                }}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={linkTransaction}
                disabled={!selectedTxn || linking}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition"
              >
                {linking ? "Linking..." : "Link"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}