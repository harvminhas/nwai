"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { formatCurrency } from "@/lib/currencyUtils";
import AccountSwitcher from "@/components/AccountSwitcher";
import { ConfirmModal } from "@/components/ConfirmModal";
import { CategoryPicker, categoryColor } from "@/app/account/spending/shared";
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

  const [showEditModal, setShowEditModal] = useState(false);
  const [label, setLabel] = useState("");
  const [category, setCategory] = useState<AssetCategory>("other");
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null);

  // Hub links state
  type TxnWithFingerprint = ExpenseTransaction & { fingerprint: string };
  type LinkedTxn = TxnWithFingerprint & { linkAmount?: number; role: "funds" | "spend_on" | "income_from" };
  const [linkedAccounts, setLinkedAccounts] = useState<Array<{ account: DebtAccount; role: string; isLegacy?: boolean }>>([]);
  const [linkedTxns, setLinkedTxns] = useState<LinkedTxn[]>([]);
  const [showLinkAccountModal, setShowLinkAccountModal] = useState(false);
  const [showLinkTxnModal, setShowLinkTxnModal] = useState(false);
  const [availableTxns, setAvailableTxns] = useState<TxnWithFingerprint[]>([]);
  const [availableIncomeTxns, setAvailableIncomeTxns] = useState<TxnWithFingerprint[]>([]);
  const [transactionTab, setTransactionTab] = useState<"income" | "expenses">("expenses");
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  
  // Link account modal state
  const [selectedAccountSlug, setSelectedAccountSlug] = useState("");
  const [selectedAccountRole, setSelectedAccountRole] = useState<"finances" | "secures">("finances");
  const [linking, setLinking] = useState(false);

  // Link transaction modal state
  const [txnSearch, setTxnSearch] = useState("");
  const [selectedTxns, setSelectedTxns] = useState<Set<string>>(new Set());
  const [selectedTxnRole, setSelectedTxnRole] = useState<"funds" | "spend_on" | "income_from">("funds");
  const [partialAmount, setPartialAmount] = useState("");
  
  // Confirmation modal state
  const [confirmModal, setConfirmModal] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  } | null>(null);
  
  // Category picker state for transaction modal
  const [openCategoryPicker, setOpenCategoryPicker] = useState<string | null>(null);
  const categoryPickerBtnRefs = useState(() => new Map<string, HTMLButtonElement>())[0];

  const load = useCallback(async (tok: string) => {
    setLoading(true);
    setError(null);
    try {
      const [assetsRes, debtsRes, txnsRes, incomeTxnsRes] = await Promise.all([
        fetch("/api/user/assets-summary", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/debts-summary", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/spending/transactions?months=12&limit=2000", { headers: { Authorization: `Bearer ${tok}` } }),
        fetch("/api/user/income/transactions?months=12&limit=2000", { headers: { Authorization: `Bearer ${tok}` } }),
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
      }

      const debtsData = debtsRes.ok ? await debtsRes.json() : null;
      setDebts(debtsData);
      
      // Load available transactions
      const txnsData = txnsRes.ok ? await txnsRes.json() : { transactions: [] };
      setAvailableTxns(txnsData.transactions ?? []);
      
      // Load available income transactions
      const incomeTxnsData = incomeTxnsRes.ok ? await incomeTxnsRes.json() : { transactions: [] };
      setAvailableIncomeTxns(incomeTxnsData.transactions ?? []);

      // Load linked accounts and transactions for this asset
      if (found && debtsData && txnsData.transactions && incomeTxnsData.transactions) {
        await loadLinks(tok, found.id, debtsData, [...txnsData.transactions, ...incomeTxnsData.transactions]);
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
        
        const accounts = debtsData?.groups?.flatMap((g) => g.accounts) ?? [];
        let linked: Array<{ account: DebtAccount; role: string; isLegacy?: boolean }> = [];
        
        if (accountLinksRes.ok) {
          const { links } = await accountLinksRes.json();
          linked = links
            .map((link: { accountSlug: string; role: string }) => ({
              account: accounts.find((a) => a.slug === link.accountSlug),
              role: link.role,
              isLegacy: false,
            }))
            .filter((l: { account: DebtAccount | undefined }) => l.account);
        }

        // Add legacy linkedAccountSlug if not already in new links
        if (asset?.linkedAccountSlug) {
          const alreadyLinked = linked.some(({ account }) => account.slug === asset.linkedAccountSlug);
          if (!alreadyLinked) {
            const legacyAccount = accounts.find((a) => a.slug === asset.linkedAccountSlug);
            if (legacyAccount) {
              // Determine role based on account type
              const role = 
                legacyAccount.accountType === "line_of_credit" || legacyAccount.accountType === "mortgage"
                  ? "secures"
                  : "finances";
              linked.push({
                account: legacyAccount,
                role,
                isLegacy: true,
              });
            }
          }
        }
        
        setLinkedAccounts(linked);

        // Load transaction links
        const txLinksRes = await fetch(`/api/user/tx-links-for-hub?hubId=${assetId}`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        
        if (txLinksRes.ok) {
          const { links } = await txLinksRes.json();
          
          const allLinked = links
            .filter((l: { role: string }) => l.role === "funds" || l.role === "spend_on" || l.role === "income_from")
            .map((l: { fingerprint: string; role: string; amount?: number }) => {
              const txn = txnsData.find((t) => t.fingerprint === l.fingerprint);
              return txn ? { ...txn, linkAmount: l.amount, role: l.role as "funds" | "spend_on" | "income_from" } : null;
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
          linkedAccountSlug: asset.linkedAccountSlug, // Preserve legacy link
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setShowEditModal(false);
      setToast({ msg: "Saved", ok: true });
      await load(token);
    } catch {
      setToast({ msg: "Could not save", ok: false });
    } finally {
      setSaving(false);
    }
  };

  const remove = () => {
    if (!asset) return;
    setConfirmModal({
      isOpen: true,
      title: "Delete asset",
      message: `Delete ${asset.label}? This removes it from your net worth.`,
      onConfirm: async () => {
        if (!token) return;
        const res = await fetch(`/api/user/assets/${asset.id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${token}` },
        });
        setConfirmModal(null);
        if (res.ok) router.push("/account/assets?tab=accounts");
        else setToast({ msg: "Could not delete", ok: false });
      },
    });
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

  const unlinkAccount = (accountSlug: string, role: string) => {
    if (!asset) return;
    setConfirmModal({
      isOpen: true,
      title: "Remove account link",
      message: "Remove this account link?",
      onConfirm: async () => {
        if (!token) return;
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
          setConfirmModal(null);
          if (!res.ok) throw new Error("Failed to unlink");
          setToast({ msg: "Account unlinked", ok: true });
          await load(token);
        } catch {
          setConfirmModal(null);
          setToast({ msg: "Could not unlink account", ok: false });
        }
      },
    });
  };

  const linkTransaction = async () => {
    if (!token || !asset || selectedTxns.size === 0) return;
    setLinking(true);
    try {
      // Link all selected transactions
      const promises = Array.from(selectedTxns).map(async (fingerprint) => {
        const body: { fingerprint: string; hubId: string; role: string; amount?: number } = {
          fingerprint,
          hubId: asset.id,
          role: selectedTxnRole,
        };
        // Only apply partial amount if single transaction selected
        if (selectedTxns.size === 1 && selectedTxnRole === "funds" && partialAmount) {
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
      });
      
      await Promise.all(promises);
      setToast({ msg: `${selectedTxns.size} transaction${selectedTxns.size > 1 ? 's' : ''} linked`, ok: true });
      setShowLinkTxnModal(false);
      setSelectedTxns(new Set());
      setPartialAmount("");
      setTxnSearch("");
      setSelectedTxnRole("funds");
      await load(token);
    } catch {
      setToast({ msg: "Could not link transactions", ok: false });
    } finally {
      setLinking(false);
    }
  };

  const unlinkTransaction = (fingerprint: string, role: string) => {
    if (!asset) return;
    setConfirmModal({
      isOpen: true,
      title: "Remove transaction link",
      message: "Remove this transaction link?",
      onConfirm: async () => {
        if (!token) return;
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
          setConfirmModal(null);
          if (!res.ok) throw new Error("Failed to unlink");
          setToast({ msg: "Transaction unlinked", ok: true });
          await load(token);
        } catch {
          setConfirmModal(null);
          setToast({ msg: "Could not unlink transaction", ok: false });
        }
      },
    });
  };

  const handleCategoryChange = async (txFingerprint: string, merchant: string, newCategory: string) => {
    if (!token) return;
    setOpenCategoryPicker(null);
    
    // Determine if moving between income and expense
    const isMovingToIncome = newCategory.toLowerCase().startsWith("income");
    const currentTx = linkedTxns.find(tx => tx.fingerprint === txFingerprint);
    const isCurrentlyIncome = currentTx?.role === "income_from";
    
    // Optimistic update for linked transactions (displayed on page)
    setLinkedTxns((prev) => {
      if (isMovingToIncome && !isCurrentlyIncome) {
        // Moving from expense to income - change role and category
        return prev.map((tx) =>
          tx.fingerprint === txFingerprint 
            ? { 
                ...tx, 
                category: newCategory.replace(/^income\s*-\s*/i, "").trim() || "Other",
                role: "income_from" as const
              } 
            : tx
        );
      } else if (!isMovingToIncome && isCurrentlyIncome) {
        // Moving from income to expense - change role and category
        return prev.map((tx) =>
          tx.fingerprint === txFingerprint 
            ? { 
                ...tx, 
                category: newCategory,
                role: "spend_on" as const
              } 
            : tx
        );
      } else {
        // Just updating category, staying in same type
        return prev.map((tx) =>
          tx.fingerprint === txFingerprint ? { ...tx, category: newCategory } : tx
        );
      }
    });
    
    // Also update available transaction lists (for picker)
    setAvailableTxns((prev) => {
      if (isMovingToIncome) {
        return prev.filter((tx) => tx.fingerprint !== txFingerprint);
      } else {
        return prev.map((tx) =>
          tx.fingerprint === txFingerprint ? { ...tx, category: newCategory } : tx
        );
      }
    });
    
    setAvailableIncomeTxns((prev) => {
      if (isMovingToIncome) {
        const expenseTx = availableTxns.find(tx => tx.fingerprint === txFingerprint) || currentTx;
        if (expenseTx) {
          return [...prev, {
            ...expenseTx,
            category: newCategory.replace(/^income\s*-\s*/i, "").trim() || "Other",
          }];
        }
        return prev;
      } else {
        return prev.filter((tx) => tx.fingerprint !== txFingerprint);
      }
    });
    
    try {
      const res = await fetch("/api/user/category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant, category: newCategory }),
      });
      
      if (res.ok) {
        setToast({ msg: `Category updated: "${merchant}" → ${newCategory}`, ok: true });
        // If role changed, we need to update the link in the database
        if ((isMovingToIncome && !isCurrentlyIncome) || (!isMovingToIncome && isCurrentlyIncome)) {
          // Need to unlink old role and link new role
          if (asset) {
            const oldRole = isCurrentlyIncome ? "income_from" : "spend_on";
            const newRole = isMovingToIncome ? "income_from" : "spend_on";
            
            // Delete old link
            await fetch("/api/user/tx-links", {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                fingerprint: txFingerprint,
                hubId: asset.id,
                role: oldRole,
              }),
            });
            
            // Create new link
            await fetch("/api/user/tx-links", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
              body: JSON.stringify({
                fingerprint: txFingerprint,
                hubId: asset.id,
                role: newRole,
              }),
            });
          }
        }
      } else {
        setToast({ msg: "Failed to save category", ok: false });
        await load(token);
      }
    } catch {
      setToast({ msg: "Failed to save category", ok: false });
      await load(token);
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

  // Calculate total debt from all linked accounts (finances + secures, including legacy)
  const totalDebt = linkedAccounts
    .filter(({ role }) => role === "finances" || role === "secures")
    .reduce((sum, { account }) => sum + Math.abs(account.balance), 0);
  
  const equity = asset.value - totalDebt;

  const spendingTxns = linkedTxns.filter((tx) => tx.role === "spend_on");
  const fundingTxns = linkedTxns.filter((tx) => tx.role === "funds");
  const incomeTxns = linkedTxns.filter((tx) => tx.role === "income_from");

  // Spending by category for pie chart
  const spendingByCategory: Record<string, number> = {};
  spendingTxns.forEach((tx) => {
    const cat = tx.category || "Other";
    spendingByCategory[cat] = (spendingByCategory[cat] || 0) + tx.amount;
  });

  const totalSpending = Object.values(spendingByCategory).reduce((sum, amt) => sum + amt, 0);
  
  // Total income from this asset
  const totalIncome = incomeTxns.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

  return (
    <div className="mx-auto max-w-6xl px-4 pt-4 pb-8 sm:py-8 sm:px-6">
      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-50 -translate-x-1/2 flex items-center gap-3 rounded-xl px-5 py-3 shadow-lg text-sm font-medium ${toast.ok ? "bg-green-600 text-white" : "bg-red-600 text-white"}`}>
          <span>{toast.ok ? "✓" : "!"}</span>
          <span>{toast.msg}</span>
        </div>
      )}

      {/* Header */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-sm text-gray-500">
            <Link href="/account/assets?tab=accounts" className="hover:text-purple-600">Assets</Link>
            <span>/</span>
            <Link href={`/account/assets/category/${asset.category === "property" ? "property" : "other"}`} className="hover:text-purple-600">
              {asset.category === "property" ? "Property" : "Other Assets"}
            </Link>
          </div>
          <AccountSwitcher />
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-2xl font-bold text-gray-900">{asset.label}</h1>
            <button
              onClick={() => setShowEditModal(true)}
              className="text-gray-400 hover:text-gray-600 transition"
              title="Edit asset"
              aria-label="Edit asset"
            >
              <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5">
                <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
              </svg>
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-medium text-blue-700">
              {CATEGORY_LABEL[asset.category] ?? asset.category}
            </span>
            <span className="text-xs text-gray-400">•</span>
            <span className="text-xs text-gray-400">
              Updated {new Date(asset.updatedAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}
            </span>
          </div>
        </div>
      </div>

      {/* Asset Summary Cards */}
      <div className={`grid gap-4 ${totalIncome > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
        {/* Value & Equity */}
        <div className={`rounded-xl border p-5 shadow-sm ${
          linkedAccounts.length > 0
            ? equity >= 0 
              ? "border-green-200 bg-green-50" 
              : "border-red-200 bg-red-50"
            : "border-gray-200 bg-white"
        }`}>
          <p className="text-xs font-medium text-gray-500">Value</p>
          <p className="mt-2 text-2xl font-bold text-gray-900 tabular-nums">
            {formatCurrency(asset.value, currency)}
          </p>
          {linkedAccounts.length > 0 && (
            <>
              <p className="mt-3 text-xs font-medium text-gray-500">Equity</p>
              <p className={`mt-1 text-xl font-bold tabular-nums ${
                equity >= 0 ? "text-green-700" : "text-red-600"
              }`}>
                {formatCurrency(equity, currency)}
              </p>
            </>
          )}
        </div>

        {/* Income (conditional - only shown when totalIncome > 0) */}
        {totalIncome > 0 && (
          <div className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm">
            <p className="text-xs font-medium text-gray-500">Income</p>
            <p className="mt-2 text-2xl font-bold text-green-700 tabular-nums">
              {formatCurrency(totalIncome, currency)}
            </p>
          </div>
        )}

        {/* Debt Owed */}
        <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium text-gray-500">Debt owed</p>
            <button
              onClick={() => setShowLinkAccountModal(true)}
              className="text-xs text-purple-600 hover:text-purple-700 font-medium"
            >
              + Add
            </button>
          </div>
          <p className="mt-2 text-2xl font-bold text-gray-900 tabular-nums">
            {formatCurrency(totalDebt, currency)}
          </p>
          {linkedAccounts.length > 0 && (
            <div className="mt-3 space-y-2">
              {linkedAccounts.map(({ account, role, isLegacy }) => (
                <div key={account.slug} className="flex items-start justify-between gap-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-gray-700 truncate">{account.bankName}</p>
                      {isLegacy && (
                        <span className="text-gray-400 shrink-0">(auto)</span>
                      )}
                    </div>
                    {account.accountName && (
                      <p className="text-gray-400 truncate">{account.accountName}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <p className="font-medium text-gray-900 tabular-nums">
                      {formatCurrency(Math.abs(account.balance), currency)}
                    </p>
                    {!isLegacy && (
                      <button
                        onClick={() => unlinkAccount(account.slug, role)}
                        className="text-gray-400 hover:text-red-600 transition"
                        title="Remove"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Income/Expenses Tabs */}
      <div className="mt-6">
        {/* Tab Switcher */}
        <div className="mb-4 flex items-center gap-4 border-b border-gray-200">
          <button
            onClick={() => setTransactionTab("income")}
            className={`pb-2 px-1 text-sm font-medium transition ${
              transactionTab === "income"
                ? "border-b-2 border-purple-600 text-purple-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Income ({formatCurrency(totalIncome, currency)})
          </button>
          <button
            onClick={() => setTransactionTab("expenses")}
            className={`pb-2 px-1 text-sm font-medium transition ${
              transactionTab === "expenses"
                ? "border-b-2 border-purple-600 text-purple-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Expenses ({formatCurrency(totalSpending, currency)})
          </button>
        </div>

        {/* Income Tab */}
        {transactionTab === "income" && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">Linked income</h2>
              <button
                onClick={() => {
                  setSelectedTxnRole("income_from");
                  setShowLinkTxnModal(true);
                }}
                className="text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                + Add
              </button>
            </div>
            {incomeTxns.length > 0 ? (
              <div className="space-y-2">
                {(() => {
                  // Group income by merchant/source
                  const groups = incomeTxns.reduce((acc, tx) => {
                    const key = tx.merchant;
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(tx);
                    return acc;
                  }, {} as Record<string, typeof incomeTxns>);

                  return Object.entries(groups).map(([merchant, txns]) => {
                    const total = txns.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
                    const isExpanded = expandedGroups.has(merchant);

                    return (
                      <div key={merchant} className="rounded-lg border border-gray-200 bg-white">
                        <button
                          onClick={() => {
                            const newExpanded = new Set(expandedGroups);
                            if (isExpanded) {
                              newExpanded.delete(merchant);
                            } else {
                              newExpanded.add(merchant);
                            }
                            setExpandedGroups(newExpanded);
                          }}
                          className="w-full p-3 flex items-center justify-between hover:bg-gray-50 transition"
                        >
                          <div className="flex-1 text-left">
                            <p className="text-sm font-medium text-gray-900">{merchant}</p>
                            <p className="text-xs text-gray-500">{txns.length} transaction{txns.length > 1 ? 's' : ''}</p>
                          </div>
                          <div className="flex items-center gap-3">
                            <p className="text-sm font-semibold text-gray-900 tabular-nums">
                              {formatCurrency(total, currency)}
                            </p>
                            <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                          </div>
                        </button>
                        {isExpanded && (
                          <div className="border-t border-gray-200 p-3 space-y-2 bg-gray-50">
                            {txns.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).map((tx) => (
                              <div key={tx.fingerprint} className="flex items-center justify-between gap-3">
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-2 text-xs text-gray-500">
                                    <button
                                      ref={(el) => {
                                        if (el) categoryPickerBtnRefs.set(tx.fingerprint, el);
                                        else categoryPickerBtnRefs.delete(tx.fingerprint);
                                      }}
                                      onClick={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        setOpenCategoryPicker(openCategoryPicker === tx.fingerprint ? null : tx.fingerprint);
                                      }}
                                      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-gray-100 transition"
                                      style={{
                                        backgroundColor: openCategoryPicker === tx.fingerprint ? "#f3f4f6" : undefined,
                                      }}
                                    >
                                      <span
                                        className="h-1.5 w-1.5 rounded-full"
                                        style={{ backgroundColor: categoryColor(tx.category?.toLowerCase() ?? "other") }}
                                      />
                                      <span>{tx.category}</span>
                                      <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                                      </svg>
                                    </button>
                                    {openCategoryPicker === tx.fingerprint && categoryPickerBtnRefs.has(tx.fingerprint) && (
                                      <CategoryPicker
                                        anchorRef={{ current: categoryPickerBtnRefs.get(tx.fingerprint)! }}
                                        current={tx.category ?? "Other"}
                                        onSelect={(cat) => handleCategoryChange(tx.fingerprint, tx.merchant, cat)}
                                        onClose={() => setOpenCategoryPicker(null)}
                                      />
                                    )}
                                    <span>•</span>
                                    <span className="text-gray-600">
                                      {tx.date ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date"}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex items-center gap-2 shrink-0">
                                  <p className="text-xs font-medium text-gray-900 tabular-nums">
                                    {formatCurrency(Math.abs(tx.amount), currency)}
                                  </p>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      unlinkTransaction(tx.fingerprint, tx.role);
                                    }}
                                    className="text-gray-400 hover:text-red-600 transition"
                                    title="Remove"
                                  >
                                    ×
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  });
                })()}
              </div>
            ) : (
              <p className="text-sm text-gray-500">No income transactions linked.</p>
            )}
          </div>
        )}

        {/* Expenses Tab */}
        {transactionTab === "expenses" && (
          <div>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-sm font-medium text-gray-700">Linked spending</h2>
              <button
                onClick={() => {
                  setSelectedTxnRole("spend_on");
                  setShowLinkTxnModal(true);
                }}
                className="text-sm text-purple-600 hover:text-purple-700 font-medium"
              >
                + Add
              </button>
            </div>

        {spendingTxns.length > 0 ? (
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Spending list */}
            <div className="lg:col-span-2 space-y-2">
              {spendingTxns.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).map((tx) => (
                <div key={tx.fingerprint} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{tx.merchant}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                      <button
                        ref={(el) => {
                          if (el) categoryPickerBtnRefs.set(tx.fingerprint, el);
                          else categoryPickerBtnRefs.delete(tx.fingerprint);
                        }}
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setOpenCategoryPicker(openCategoryPicker === tx.fingerprint ? null : tx.fingerprint);
                        }}
                        className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 hover:bg-gray-100 transition"
                        style={{
                          backgroundColor: openCategoryPicker === tx.fingerprint ? "#f3f4f6" : undefined,
                        }}
                      >
                        <span
                          className="h-1.5 w-1.5 rounded-full"
                          style={{ backgroundColor: categoryColor(tx.category?.toLowerCase() ?? "other") }}
                        />
                        <span>{tx.category}</span>
                        <svg className="h-3 w-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {openCategoryPicker === tx.fingerprint && categoryPickerBtnRefs.has(tx.fingerprint) && (
                        <CategoryPicker
                          anchorRef={{ current: categoryPickerBtnRefs.get(tx.fingerprint)! }}
                          current={tx.category ?? "Other"}
                          onSelect={(cat) => handleCategoryChange(tx.fingerprint, tx.merchant, cat)}
                          onClose={() => setOpenCategoryPicker(null)}
                        />
                      )}
                      <span>•</span>
                      <span>{tx.accountLabel ?? "Unknown"}</span>
                      <span>•</span>
                      <span>{tx.date ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No date"}</span>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 tabular-nums">
                    {formatCurrency(tx.amount, currency)}
                  </p>
                  <button
                    onClick={() => unlinkTransaction(tx.fingerprint, tx.role)}
                    className="shrink-0 text-gray-400 hover:text-red-600 transition"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>

            {/* Pie chart */}
            <div className="rounded-lg border border-gray-200 bg-white p-4">
              <p className="text-xs font-medium text-gray-500 mb-3">By category</p>
              {totalSpending > 0 ? (
                <div>
                  <svg viewBox="0 0 100 100" className="w-full max-w-[200px] mx-auto mb-3">
                    {(() => {
                      let cumulativePercent = 0;
                      const colors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#6366f1"];
                      const entries = Object.entries(spendingByCategory);
                      
                      // Special case: single category (100%) - render full circle
                      if (entries.length === 1) {
                        return (
                          <circle
                            cx="50"
                            cy="50"
                            r="40"
                            fill={colors[0]}
                            opacity="0.8"
                          />
                        );
                      }
                      
                      // Multiple categories - render arcs
                      return entries.map(([cat, amt], i) => {
                        const percent = (amt / totalSpending) * 100;
                        const startAngle = (cumulativePercent / 100) * 360;
                        const endAngle = ((cumulativePercent + percent) / 100) * 360;
                        cumulativePercent += percent;

                        const x1 = 50 + 40 * Math.cos((Math.PI * startAngle) / 180);
                        const y1 = 50 + 40 * Math.sin((Math.PI * startAngle) / 180);
                        const x2 = 50 + 40 * Math.cos((Math.PI * endAngle) / 180);
                        const y2 = 50 + 40 * Math.sin((Math.PI * endAngle) / 180);
                        const largeArc = percent > 50 ? 1 : 0;

                        return (
                          <path
                            key={cat}
                            d={`M 50 50 L ${x1} ${y1} A 40 40 0 ${largeArc} 1 ${x2} ${y2} Z`}
                            fill={colors[i % colors.length]}
                            opacity="0.8"
                          />
                        );
                      });
                    })()}
                  </svg>
                  <div className="space-y-1.5">
                    {Object.entries(spendingByCategory)
                      .sort(([, a], [, b]) => b - a)
                      .map(([cat, amt]) => (
                        <div key={cat} className="flex items-center justify-between text-xs">
                          <span className="text-gray-600 truncate">{cat}</span>
                          <span className="font-medium text-gray-900 tabular-nums ml-2">
                            {formatCurrency(amt, currency)}
                          </span>
                        </div>
                      ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 text-center py-8">No spending yet</p>
              )}
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">No spending transactions linked.</p>
        )}

        {fundingTxns.length > 0 && (
          <div className="mt-6">
            <p className="text-xs font-medium text-gray-500 mb-2">Funding</p>
            <div className="space-y-2">
              {fundingTxns.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).map((tx) => (
                <div key={tx.fingerprint} className="flex items-center gap-3 rounded-lg border border-gray-200 bg-white p-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{tx.merchant}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
                      <span>{tx.accountLabel ?? "Unknown"}</span>
                      <span>•</span>
                      <span>{tx.date ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "No date"}</span>
                    </div>
                  </div>
                  <p className="text-sm font-semibold text-gray-900 tabular-nums">
                    {formatCurrency(tx.linkAmount ?? tx.amount, currency)}
                  </p>
                  <button
                    onClick={() => unlinkTransaction(tx.fingerprint, tx.role)}
                    className="shrink-0 text-gray-400 hover:text-red-600 transition"
                    title="Remove"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
          </div>
        )}
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowEditModal(false)}>
          <div className="max-w-md w-full rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Edit asset</h3>
            <div className="mt-4 space-y-4">
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
                  <label className="mb-1 block text-xs font-medium text-gray-500">Category</label>
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
            </div>
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4">
              <button
                onClick={remove}
                className="text-sm text-red-600 hover:text-red-700"
              >
                Delete asset
              </button>
              <div className="flex gap-2">
                <button
                  onClick={() => setShowEditModal(false)}
                  disabled={saving}
                  className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
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
          </div>
        </div>
      )}

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
      {showLinkTxnModal && (() => {
        // Select correct transaction source based on role
        const txnSource = selectedTxnRole === "income_from" ? availableIncomeTxns : availableTxns;
        
        return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowLinkTxnModal(false)}>
          <div className="max-w-3xl w-full rounded-xl bg-white p-6 shadow-xl max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Link transaction</h3>
            <p className="mt-2 text-sm text-gray-600">
              Link a transaction to this asset.
            </p>

            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-2 block text-xs font-medium text-gray-500">Type</label>
                <div className="grid grid-cols-3 gap-2">
                  <button
                    onClick={() => setSelectedTxnRole("funds")}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      selectedTxnRole === "funds"
                        ? "border-purple-400 bg-purple-50 text-purple-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    Funding
                  </button>
                  <button
                    onClick={() => setSelectedTxnRole("spend_on")}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      selectedTxnRole === "spend_on"
                        ? "border-purple-400 bg-purple-50 text-purple-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    Spending
                  </button>
                  <button
                    onClick={() => setSelectedTxnRole("income_from")}
                    className={`rounded-lg border px-3 py-2 text-sm transition ${
                      selectedTxnRole === "income_from"
                        ? "border-purple-400 bg-purple-50 text-purple-700"
                        : "border-gray-200 text-gray-600 hover:border-gray-300"
                    }`}
                  >
                    Income
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

            <div className="mt-3 flex items-center justify-between">
              {selectedTxns.size > 0 ? (
                <p className="text-sm font-medium text-purple-900">
                  {selectedTxns.size} selected
                </p>
              ) : (
                <div />
              )}
              <button
                onClick={() => {
                  const visibleTxns = txnSource
                    .filter((tx) => !txnSearch || tx.merchant?.toLowerCase().includes(txnSearch.toLowerCase()))
                    .filter((tx) => !linkedTxns.some((l) => l.fingerprint === tx.fingerprint))
                    .slice(0, 50);
                  
                  if (selectedTxns.size === visibleTxns.length && visibleTxns.length > 0) {
                    // Deselect all
                    setSelectedTxns(new Set());
                  } else {
                    // Select all visible
                    setSelectedTxns(new Set(visibleTxns.map(tx => tx.fingerprint)));
                  }
                }}
                className="text-xs text-purple-600 hover:text-purple-700 font-medium"
              >
                {(() => {
                  const visibleTxns = txnSource
                    .filter((tx) => !txnSearch || tx.merchant?.toLowerCase().includes(txnSearch.toLowerCase()))
                    .filter((tx) => !linkedTxns.some((l) => l.fingerprint === tx.fingerprint))
                    .slice(0, 50);
                  return selectedTxns.size === visibleTxns.length && visibleTxns.length > 0 ? "Deselect all" : "Select all";
                })()}
              </button>
            </div>

            {selectedTxnRole === "funds" && selectedTxns.size === 1 && (
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
                {txnSource
                  .filter((tx) => !txnSearch || tx.merchant?.toLowerCase().includes(txnSearch.toLowerCase()))
                  .filter((tx) => !linkedTxns.some((l) => l.fingerprint === tx.fingerprint))
                  .slice(0, 50)
                  .map((tx) => (
                    <label
                      key={tx.fingerprint}
                      className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition ${
                        selectedTxns.has(tx.fingerprint)
                          ? "border-purple-400 bg-purple-50"
                          : "border-gray-200 hover:border-gray-300"
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedTxns.has(tx.fingerprint)}
                        onChange={(e) => {
                          const newSet = new Set(selectedTxns);
                          if (e.target.checked) {
                            newSet.add(tx.fingerprint);
                          } else {
                            newSet.delete(tx.fingerprint);
                          }
                          setSelectedTxns(newSet);
                        }}
                        className="mt-0.5 h-4 w-4 rounded border-gray-300 text-purple-600 focus:ring-purple-500"
                      />
                      <div className="flex-1 flex items-start justify-between gap-3 min-w-0">
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
                    </label>
                  ))}
                {txnSource.filter((tx) => !txnSearch || tx.merchant?.toLowerCase().includes(txnSearch.toLowerCase())).length === 0 && (
                  <p className="text-sm text-gray-500 text-center py-8">No transactions found</p>
                )}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-2 border-t border-gray-200 pt-4">
              <button
                onClick={() => {
                  setShowLinkTxnModal(false);
                  setSelectedTxns(new Set());
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
                disabled={selectedTxns.size === 0 || linking}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition"
              >
                {linking ? "Linking..." : selectedTxns.size > 1 ? `Link ${selectedTxns.size}` : "Link"}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Confirmation Modal */}
      {confirmModal && (
        <ConfirmModal
          isOpen={confirmModal.isOpen}
          title={confirmModal.title}
          message={confirmModal.message}
          confirmLabel="Remove"
          confirmDanger={true}
          onConfirm={confirmModal.onConfirm}
          onCancel={() => setConfirmModal(null)}
        />
      )}
    </div>
  );
}