"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { formatCurrency, formatCurrencyWithCents } from "@/lib/currencyUtils";
import AccountSwitcher from "@/components/AccountSwitcher";
import { ConfirmModal } from "@/components/ConfirmModal";
import { CategoryPicker, categoryColor } from "@/app/account/spending/shared";
import { triggerProfileRefetch } from "@/lib/profileRefetch";
import { useProfileRefresh } from "@/contexts/ProfileRefreshContext";
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
  const [startDate, setStartDate] = useState("");
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
  const [expandedExpenseCategories, setExpandedExpenseCategories] = useState<Set<string>>(new Set());
  const [expenseYearFilter, setExpenseYearFilter] = useState<string>("all");
  const [expenseSearch, setExpenseSearch] = useState("");
  const [highlightedTxns, setHighlightedTxns] = useState<Set<string>>(new Set());
  
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
  
  // Main tab state
  const [mainTab, setMainTab] = useState<"overview" | "history" | "projections">("overview");
  
  // History tab state
  const [showAddValuationModal, setShowAddValuationModal] = useState(false);
  const [newValuationValue, setNewValuationValue] = useState("");
  const [newValuationDate, setNewValuationDate] = useState("");
  const [addingValuation, setAddingValuation] = useState(false);
  
  // Projections tab state
  const [annualGrowthRate, setAnnualGrowthRate] = useState<string>("");
  const [projectionYears, setProjectionYears] = useState(5);
  
  const { requestProfileRefresh } = useProfileRefresh();

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
        setStartDate(found.startDate || "");
        setAnnualGrowthRate(found.annualGrowthRate !== undefined && found.annualGrowthRate !== null ? String(found.annualGrowthRate) : "");
        
        // Initialize newValuationDate to today (America/New_York)
        const now = new Date();
        const formatter = new Intl.DateTimeFormat('en-US', {
          timeZone: 'America/New_York',
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
        });
        const parts = formatter.formatToParts(now);
        const year = parts.find(p => p.type === 'year')?.value ?? '';
        const month = parts.find(p => p.type === 'month')?.value ?? '';
        const day = parts.find(p => p.type === 'day')?.value ?? '';
        setNewValuationDate(`${year}-${month}-${day}`);
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
          startDate: startDate === "" ? null : startDate, // Explicit null to clear
          annualGrowthRate: annualGrowthRate === "" ? null : Number(annualGrowthRate),
          linkedAccountSlug: asset.linkedAccountSlug, // Preserve legacy link
        }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setShowEditModal(false);
      setToast({ msg: "Saved", ok: true });
      // Server invalidated cache; trigger refetch so header/detail update
      triggerProfileRefetch();
      await load(token);
    } catch {
      setToast({ msg: "Could not save", ok: false });
    } finally {
      setSaving(false);
    }
  };

  const addValuation = async () => {
    if (!token || !asset) return;
    const valueCents = Math.round(Number(newValuationValue.replace(/[^0-9.-]/g, "")) * 100);
    if (Number.isNaN(valueCents) || valueCents < 0) {
      setToast({ msg: "Enter a valid value", ok: false });
      return;
    }
    if (!newValuationDate) {
      setToast({ msg: "Enter a date", ok: false });
      return;
    }
    
    setAddingValuation(true);
    try {
      const res = await fetch(`/api/user/assets/${asset.id}/valuations`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          valueCents,
          effectiveDate: newValuationDate,
        }),
      });
      if (!res.ok) throw new Error("Failed to add valuation");
      setShowAddValuationModal(false);
      setNewValuationValue("");
      setToast({ msg: "Valuation added", ok: true });
      triggerProfileRefetch();
      await load(token);
    } catch {
      setToast({ msg: "Could not add valuation", ok: false });
    } finally {
      setAddingValuation(false);
    }
  };

  const deleteValuation = (valuationId: string, effectiveDate: string) => {
    if (!asset) return;
    setConfirmModal({
      isOpen: true,
      title: "Delete valuation",
      message: `Delete valuation from ${new Date(effectiveDate).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}? This will recalculate net worth for affected months.`,
      onConfirm: async () => {
        if (!token) return;
        try {
          const res = await fetch(
            `/api/user/assets/${asset.id}/valuations?valuationId=${valuationId}`,
            {
              method: "DELETE",
              headers: { Authorization: `Bearer ${token}` },
            }
          );
          setConfirmModal(null);
          if (!res.ok) {
            const err = await res.json();
            setToast({ msg: err.error || "Could not delete valuation", ok: false });
          } else {
            setToast({ msg: "Valuation deleted", ok: true });
            triggerProfileRefetch();
            await load(token);
          }
        } catch {
          setConfirmModal(null);
          setToast({ msg: "Could not delete valuation", ok: false });
        }
      },
    });
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
        if (res.ok) {
          // Server invalidated cache; trigger refetch so header/detail update
          triggerProfileRefetch();
          router.push("/account/assets?tab=accounts");
        } else {
          setToast({ msg: "Could not delete", ok: false });
        }
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
    
    // Get transactions to link
    const txSource = selectedTxnRole === "income_from" ? availableIncomeTxns : availableTxns;
    const txnsToLink = Array.from(selectedTxns)
      .map(fp => txSource.find(tx => tx.fingerprint === fp))
      .filter((tx): tx is typeof txSource[0] => tx !== undefined)
      .map(tx => ({
        ...tx,
        role: selectedTxnRole as "funds" | "spend_on" | "income_from",
        linkAmount: selectedTxns.size === 1 && selectedTxnRole === "funds" && partialAmount 
          ? Number(partialAmount.replace(/[^0-9.-]/g, ""))
          : undefined,
      }));
    
    // Optimistically add to linkedTxns
    setLinkedTxns(prev => [...prev, ...txnsToLink]);
    
    // Switch to appropriate tab
    if (selectedTxnRole === "income_from") {
      setTransactionTab("income");
      // Expand income groups for newly added merchants
      const newMerchants = new Set(txnsToLink.map(tx => tx.merchant));
      setExpandedGroups(prev => new Set([...prev, ...newMerchants]));
    } else if (selectedTxnRole === "spend_on") {
      setTransactionTab("expenses");
      // Expand expense categories for newly added categories
      const newCategories = new Set(txnsToLink.map(tx => tx.category || "Other"));
      setExpandedExpenseCategories(prev => new Set([...prev, ...newCategories]));
    }
    
    // Highlight newly added transactions
    const newFingerprints = new Set(txnsToLink.map(tx => tx.fingerprint));
    setHighlightedTxns(newFingerprints);
    setTimeout(() => setHighlightedTxns(new Set()), 2000);
    
    // Close modal and reset
    setShowLinkTxnModal(false);
    setSelectedTxns(new Set());
    setPartialAmount("");
    setTxnSearch("");
    setSelectedTxnRole("funds");
    
    try {
      // Persist links
      const promises = Array.from(selectedTxns).map(async (fingerprint) => {
        const tx = txnsToLink.find(t => t.fingerprint === fingerprint);
        const body: { fingerprint: string; hubId: string; role: string; amount?: number } = {
          fingerprint,
          hubId: asset.id,
          role: selectedTxnRole,
        };
        if (tx?.linkAmount !== undefined) {
          body.amount = tx.linkAmount;
        }
        const res = await fetch("/api/user/tx-links", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) throw new Error("Failed to link transaction");
      });
      
      await Promise.all(promises);
      setToast({ msg: `${txnsToLink.length} transaction${txnsToLink.length > 1 ? 's' : ''} linked`, ok: true });
    } catch {
      setToast({ msg: "Could not link transactions", ok: false });
      // Revert optimistic update by reloading
      await load(token);
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
    
    // Optimistic update - just category, no role changes
    setLinkedTxns((prev) =>
      prev.map((tx) =>
        tx.fingerprint === txFingerprint ? { ...tx, category: newCategory } : tx
      )
    );
    
    try {
      const res = await fetch("/api/user/category-rules", {
        method: "PUT",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ merchant, category: newCategory }),
      });
      
      if (res.ok) {
        setToast({ msg: `Rule saved: "${merchant}" → ${newCategory}`, ok: true });
        requestProfileRefresh();
      } else {
        setToast({ msg: "Failed to save rule", ok: false });
      }
    } catch {
      setToast({ msg: "Failed to save rule", ok: false });
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
          </div>
          <AccountSwitcher />
        </div>

        <div>
          <div className="flex items-center gap-2 mb-2">
            <h1 className="text-2xl font-bold text-gray-900">{asset.label}</h1>
            <button
              onClick={() => {
                setLabel(asset.label);
                setCategory(asset.category);
                setValue(String(asset.value));
                setStartDate(asset.startDate || "");
                setAnnualGrowthRate(asset.annualGrowthRate !== undefined && asset.annualGrowthRate !== null ? String(asset.annualGrowthRate) : "");
                setShowEditModal(true);
              }}
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

      {/* Main Tabs */}
      <div className="mt-6">
        <div className="mb-6 flex items-center gap-6 border-b border-gray-200">
          <button
            onClick={() => setMainTab("overview")}
            className={`pb-3 px-1 text-base font-semibold transition ${
              mainTab === "overview"
                ? "border-b-2 border-purple-600 text-purple-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setMainTab("history")}
            className={`pb-3 px-1 text-base font-semibold transition ${
              mainTab === "history"
                ? "border-b-2 border-purple-600 text-purple-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            History
          </button>
          <button
            onClick={() => setMainTab("projections")}
            className={`pb-3 px-1 text-base font-semibold transition ${
              mainTab === "projections"
                ? "border-b-2 border-purple-600 text-purple-600"
                : "text-gray-500 hover:text-gray-700"
            }`}
          >
            Projections
          </button>
        </div>

        {/* Overview Tab */}
        {mainTab === "overview" && (
          <div>
            {/* Income/Expenses Sub-Tabs */}
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
                              <div 
                                key={tx.fingerprint} 
                                className={`flex items-center justify-between gap-3 rounded-lg p-2 -m-2 transition-all duration-500 ${
                                  highlightedTxns.has(tx.fingerprint)
                                    ? 'bg-purple-50 shadow-sm ring-2 ring-purple-300'
                                    : ''
                                }`}
                              >
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
                                    {formatCurrencyWithCents(Math.abs(tx.amount), currency)}
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
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <h2 className="text-sm font-medium text-gray-700">Linked spending</h2>
              <div className="flex-1" />
              {spendingTxns.length > 0 && (
                <>
                  <input
                    type="text"
                    value={expenseSearch}
                    onChange={(e) => setExpenseSearch(e.target.value)}
                    placeholder="Search..."
                    className="w-32 rounded border border-gray-200 px-2 py-1 text-xs focus:border-purple-300 focus:outline-none"
                  />
                  <select
                    value={expenseYearFilter}
                    onChange={(e) => setExpenseYearFilter(e.target.value)}
                    className="rounded border border-gray-200 px-2 py-1 text-xs focus:border-purple-300 focus:outline-none"
                  >
                    <option value="all">All time</option>
                    {(() => {
                      const years = new Set(
                        spendingTxns
                          .map(tx => tx.date ? new Date(tx.date).getFullYear() : null)
                          .filter((y): y is number => y !== null)
                      );
                      return Array.from(years).sort((a, b) => b - a).map(year => (
                        <option key={year} value={year}>{year}</option>
                      ));
                    })()}
                  </select>
                </>
              )}
              <button
                onClick={() => {
                  setSelectedTxnRole("spend_on");
                  setShowLinkTxnModal(true);
                }}
                className="text-xs text-purple-600 hover:text-purple-700 font-medium"
              >
                + Add
              </button>
            </div>

        {spendingTxns.length > 0 && (
          <div>
            {(() => {
              // Filter transactions (used by both list and chart)
              const filtered = spendingTxns.filter(tx => {
                const matchesSearch = !expenseSearch || 
                  tx.merchant?.toLowerCase().includes(expenseSearch.toLowerCase()) ||
                  tx.category?.toLowerCase().includes(expenseSearch.toLowerCase());
                const matchesYear = expenseYearFilter === "all" || 
                  (tx.date && new Date(tx.date).getFullYear() === Number(expenseYearFilter));
                return matchesSearch && matchesYear;
              });

              // Compute filtered totals for chart
              const filteredByCategory: Record<string, number> = {};
              filtered.forEach((tx) => {
                const cat = tx.category || "Other";
                filteredByCategory[cat] = (filteredByCategory[cat] || 0) + tx.amount;
              });
              const filteredTotal = Object.values(filteredByCategory).reduce((sum, amt) => sum + amt, 0);

              // Group by category for list
              const byCategory = filtered.reduce((acc, tx) => {
                const cat = tx.category || "Other";
                if (!acc[cat]) acc[cat] = [];
                acc[cat].push(tx);
                return acc;
              }, {} as Record<string, typeof spendingTxns>);

              const sortedCategories = Object.entries(byCategory)
                .sort(([, aTxns], [, bTxns]) => {
                  const aTotal = aTxns.reduce((sum, tx) => sum + tx.amount, 0);
                  const bTotal = bTxns.reduce((sum, tx) => sum + tx.amount, 0);
                  return bTotal - aTotal;
                });

              if (sortedCategories.length === 0) {
                return <p className="text-sm text-gray-500 text-center py-8">No transactions found</p>;
              }

              return (
                <div className="grid gap-6 lg:grid-cols-3">
                  {/* Spending by category (grouped) */}
                  <div className="lg:col-span-2 space-y-2">
                    {sortedCategories.map(([category, txns]) => {
                    const total = txns.reduce((sum, tx) => sum + tx.amount, 0);
                    const isExpanded = expandedExpenseCategories.has(category);

                    return (
                      <div key={category} className="rounded-lg border border-gray-200 bg-white overflow-hidden">
                        <button
                          onClick={() => {
                            const newExpanded = new Set(expandedExpenseCategories);
                            if (isExpanded) {
                              newExpanded.delete(category);
                            } else {
                              newExpanded.add(category);
                            }
                            setExpandedExpenseCategories(newExpanded);
                          }}
                          className="w-full p-4 flex items-center justify-between hover:bg-gray-50 transition"
                        >
                          <div className="flex items-center gap-3 flex-1 min-w-0">
                            <span
                              className="h-3 w-3 shrink-0 rounded-full"
                              style={{ backgroundColor: categoryColor(category.toLowerCase()) }}
                            />
                            <div className="flex-1 text-left min-w-0">
                              <p className="text-sm font-semibold text-gray-900">{category}</p>
                              <p className="text-xs text-gray-500">{txns.length} transaction{txns.length > 1 ? 's' : ''}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3 shrink-0">
                            <p className="text-sm font-bold text-gray-900 tabular-nums">
                              {formatCurrency(total, currency)}
                            </p>
                            <span className="text-gray-400">{isExpanded ? '▼' : '▶'}</span>
                          </div>
                        </button>
                        
                        {isExpanded && (
                          <div className="border-t border-gray-200 bg-gray-50/60 p-3 space-y-2">
                            {txns.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "")).map((tx) => (
                              <div 
                                key={tx.fingerprint} 
                                className={`flex items-center gap-3 rounded-lg bg-white border p-3 transition-all duration-500 ${
                                  highlightedTxns.has(tx.fingerprint)
                                    ? 'border-purple-400 bg-purple-50 shadow-sm'
                                    : 'border-gray-100'
                                }`}
                              >
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
                                    <span>{tx.date ? new Date(tx.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "No date"}</span>
                                  </div>
                                </div>
                                <p className="text-sm font-semibold text-gray-900 tabular-nums shrink-0">
                                  {formatCurrencyWithCents(tx.amount, currency)}
                                </p>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    unlinkTransaction(tx.fingerprint, tx.role);
                                  }}
                                  className="shrink-0 text-gray-400 hover:text-red-600 transition"
                                  title="Remove"
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>

                  {/* Pie chart - uses filtered data */}
                  <div className="rounded-lg border border-gray-200 bg-white p-4">
                    <p className="text-xs font-medium text-gray-500 mb-3">By category</p>
                    {filteredTotal > 0 ? (
                      <div>
                        <svg viewBox="0 0 100 100" className="w-full max-w-[200px] mx-auto mb-3">
                          {(() => {
                            let cumulativePercent = 0;
                            const colors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#6366f1"];
                            const entries = Object.entries(filteredByCategory);
                      
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
                              const percent = (amt / filteredTotal) * 100;
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
                          {Object.entries(filteredByCategory)
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
                      <p className="text-xs text-gray-400 text-center py-8">No matches</p>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
        
        {spendingTxns.length === 0 && (
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
                    {formatCurrencyWithCents(tx.linkAmount ?? tx.amount, currency)}
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
        )}

        {/* History Tab */}
        {mainTab === "history" && (
          <div>
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Valuation History</h2>
                <p className="text-sm text-gray-500 mt-1">Track how the value of this asset has changed over time</p>
              </div>
              <button
                onClick={() => setShowAddValuationModal(true)}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
              >
                + Add Valuation
              </button>
            </div>

            {asset.valuations && asset.valuations.length > 0 ? (
              <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Value</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {[...asset.valuations]
                      .sort((a, b) => {
                        // Sort by date descending, then by createdAt descending for same-day
                        const dateCmp = b.effectiveDate.localeCompare(a.effectiveDate);
                        if (dateCmp !== 0) return dateCmp;
                        return b.createdAt.localeCompare(a.createdAt);
                      })
                      .map((val) => (
                        <tr key={val.id} className="hover:bg-gray-50 transition">
                          <td className="px-4 py-3 text-sm text-gray-900">
                            {new Date(val.effectiveDate).toLocaleDateString("en-US", {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900 tabular-nums text-right">
                            {formatCurrencyWithCents(val.valueCents / 100, currency)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <button
                              onClick={() => deleteValuation(val.id, val.effectiveDate)}
                              className="text-red-600 hover:text-red-700 text-sm font-medium transition"
                            >
                              Delete
                            </button>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
                <p className="text-sm text-gray-500 mb-4">No valuation history yet. Add your first entry to start tracking changes.</p>
                <button
                  onClick={() => setShowAddValuationModal(true)}
                  className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
                >
                  Add First Valuation
                </button>
              </div>
            )}

            <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <div className="flex gap-3">
                <svg className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-900">
                  <p className="font-medium mb-1">How valuation history works</p>
                  <ul className="text-blue-800 space-y-1 list-disc list-inside">
                    <li>Each month uses the most recent valuation as of that month's end</li>
                    <li>You can backdate valuations to correct historical values</li>
                    <li>Deleting a valuation recalculates affected months using the previous value</li>
                    <li>Cannot delete the only valuation (edit the value instead)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Projections Tab */}
        {mainTab === "projections" && (
          <div>
            <div className="mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Asset Projections</h2>
              <p className="text-sm text-gray-500 mt-1">Estimate future value based on annual growth or depreciation</p>
            </div>

            {/* Projection Settings */}
            <div className="rounded-xl border border-gray-200 bg-white p-5 mb-6">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Projection Settings</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Annual Growth/Depreciation Rate (%)
                  </label>
                  <input
                    type="number"
                    value={annualGrowthRate}
                    onChange={(e) => setAnnualGrowthRate(e.target.value)}
                    onBlur={async () => {
                      if (!token || !asset) return;
                      // Save rate when user changes it
                      const rate = annualGrowthRate === "" ? null : Number(annualGrowthRate);
                      try {
                        const res = await fetch(`/api/user/assets/${asset.id}`, {
                          method: "PUT",
                          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
                          body: JSON.stringify({
                            label: asset.label,
                            category: asset.category,
                            value: asset.value,
                            startDate: asset.startDate,
                            linkedAccountSlug: asset.linkedAccountSlug,
                            annualGrowthRate: rate,
                          }),
                        });
                        if (res.ok) {
                          await load(token);
                        }
                      } catch {
                        // Silent fail - non-critical
                      }
                    }}
                    placeholder="0"
                    step="0.1"
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                  />
                  <p className="text-xs text-gray-500 mt-1">
                    Positive for appreciation, negative for depreciation
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-2">
                    Projection Horizon (years)
                  </label>
                  <select
                    value={projectionYears}
                    onChange={(e) => setProjectionYears(Number(e.target.value))}
                    className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                  >
                    <option value="3">3 years</option>
                    <option value="5">5 years</option>
                    <option value="10">10 years</option>
                    <option value="15">15 years</option>
                    <option value="20">20 years</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Projection Chart/Table */}
            {annualGrowthRate && annualGrowthRate !== "0" ? (
              <>
                {/* Chart */}
                <div className="rounded-xl border border-gray-200 bg-white p-6 mb-6">
                  <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-3 mb-4">
                    <div className="flex items-center gap-2 text-sm font-medium text-amber-900">
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>ESTIMATES ONLY - Not included in actual net worth</span>
                    </div>
                  </div>
                  
                  <h3 className="text-sm font-semibold text-gray-900 mb-4">Projected Value Over Time</h3>
                  
                  {(() => {
                    const rate = Number(annualGrowthRate) / 100;
                    const currentYear = new Date().getFullYear();
                    
                    // Generate data points (current + projections)
                    const dataPoints = [
                      { year: currentYear, value: asset.value, label: 'Current' }
                    ];
                    for (let i = 1; i <= projectionYears; i++) {
                      dataPoints.push({
                        year: currentYear + i,
                        value: asset.value * Math.pow(1 + rate, i),
                        label: String(currentYear + i)
                      });
                    }
                    
                    // Chart dimensions
                    const width = 800;
                    const height = 300;
                    const padding = { top: 20, right: 20, bottom: 40, left: 60 };
                    const chartWidth = width - padding.left - padding.right;
                    const chartHeight = height - padding.top - padding.bottom;
                    
                    // Scales
                    const minValue = Math.min(...dataPoints.map(d => d.value));
                    const maxValue = Math.max(...dataPoints.map(d => d.value));
                    const valueRange = maxValue - minValue;
                    const yMin = minValue - valueRange * 0.1;
                    const yMax = maxValue + valueRange * 0.1;
                    
                    const xScale = (index: number) => padding.left + (index / (dataPoints.length - 1)) * chartWidth;
                    const yScale = (value: number) => padding.top + chartHeight - ((value - yMin) / (yMax - yMin)) * chartHeight;
                    
                    // Generate path
                    const pathData = dataPoints
                      .map((d, i) => `${i === 0 ? 'M' : 'L'} ${xScale(i)} ${yScale(d.value)}`)
                      .join(' ');
                    
                    // Y-axis ticks
                    const yTicks = 5;
                    const yTickValues = Array.from({ length: yTicks }, (_, i) => 
                      yMin + (i / (yTicks - 1)) * (yMax - yMin)
                    );
                    
                    return (
                      <div className="w-full overflow-x-auto">
                        <svg 
                          viewBox={`0 0 ${width} ${height}`} 
                          className="w-full h-auto"
                          style={{ minWidth: '600px', maxHeight: '300px' }}
                        >
                          {/* Y-axis grid lines and labels */}
                          {yTickValues.map((tickValue, i) => {
                            const y = yScale(tickValue);
                            return (
                              <g key={i}>
                                <line
                                  x1={padding.left}
                                  y1={y}
                                  x2={width - padding.right}
                                  y2={y}
                                  stroke="#e5e7eb"
                                  strokeWidth="1"
                                />
                                <text
                                  x={padding.left - 10}
                                  y={y}
                                  textAnchor="end"
                                  alignmentBaseline="middle"
                                  className="text-xs fill-gray-500"
                                  style={{ fontSize: '10px' }}
                                >
                                  {formatCurrency(tickValue, currency)}
                                </text>
                              </g>
                            );
                          })}
                          
                          {/* X-axis labels */}
                          {dataPoints.map((d, i) => (
                            <text
                              key={i}
                              x={xScale(i)}
                              y={height - padding.bottom + 20}
                              textAnchor="middle"
                              className="text-xs fill-gray-700"
                              style={{ fontSize: '10px' }}
                            >
                              {d.label}
                            </text>
                          ))}
                          
                          {/* Line path */}
                          <path
                            d={pathData}
                            fill="none"
                            stroke={rate >= 0 ? "#10b981" : "#ef4444"}
                            strokeWidth="3"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                          
                          {/* Data points */}
                          {dataPoints.map((d, i) => (
                            <g key={i}>
                              <circle
                                cx={xScale(i)}
                                cy={yScale(d.value)}
                                r="5"
                                fill={i === 0 ? "#8b5cf6" : (rate >= 0 ? "#10b981" : "#ef4444")}
                                stroke="white"
                                strokeWidth="2"
                              />
                              {/* Value label on hover */}
                              <title>{`${d.year}: ${formatCurrency(d.value, currency)}`}</title>
                            </g>
                          ))}
                        </svg>
                      </div>
                    );
                  })()}
                </div>
                
                {/* Table */}
                <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
                  <div className="bg-gray-50 border-b border-gray-200 px-4 py-3">
                    <h3 className="text-sm font-semibold text-gray-900">Detailed Projections</h3>
                  </div>
                  <table className="w-full">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Year</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Projected Value</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Change from Current</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {Array.from({ length: projectionYears }, (_, i) => {
                      const year = new Date().getFullYear() + i + 1;
                      const rate = Number(annualGrowthRate) / 100;
                      const projectedValue = asset.value * Math.pow(1 + rate, i + 1);
                      const change = projectedValue - asset.value;
                      const changePercent = ((change / asset.value) * 100);

                      return (
                        <tr key={year} className={i === 0 ? "bg-purple-50" : ""}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">{year}</td>
                          <td className="px-4 py-3 text-sm font-semibold text-gray-900 tabular-nums text-right">
                            {formatCurrency(projectedValue, currency)}
                          </td>
                          <td className="px-4 py-3 text-sm tabular-nums text-right">
                            <span className={change >= 0 ? "text-green-600" : "text-red-600"}>
                              {change >= 0 ? "+" : ""}{formatCurrency(change, currency)}
                              {" "}({change >= 0 ? "+" : ""}{changePercent.toFixed(1)}%)
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              </>
            ) : (
              <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
                <p className="text-sm text-gray-500">Enter a growth or depreciation rate above to see projections</p>
              </div>
            )}

            <div className="mt-6 rounded-lg border border-blue-100 bg-blue-50 p-4">
              <div className="flex gap-3">
                <svg className="h-5 w-5 text-blue-600 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="text-sm text-blue-900">
                  <p className="font-medium mb-1">About projections</p>
                  <ul className="text-blue-800 space-y-1 list-disc list-inside">
                    <li>Projections use compound annual growth from your current value</li>
                    <li>These are estimates only and do NOT affect your actual recorded net worth</li>
                    <li>Changing the rate does not add a valuation entry</li>
                    <li>Use positive rates for appreciation (e.g., 5 for 5% annual growth)</li>
                    <li>Use negative rates for depreciation (e.g., -10 for 10% annual decline)</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Add Valuation Modal */}
      {showAddValuationModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowAddValuationModal(false)}>
          <div className="max-w-md w-full rounded-xl bg-white p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-bold text-gray-900">Add Valuation</h3>
            <p className="mt-2 text-sm text-gray-600">Record the value of this asset on a specific date</p>
            <div className="mt-4 space-y-4">
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Value ({currency})</label>
                <input
                  value={newValuationValue}
                  onChange={(e) => setNewValuationValue(e.target.value)}
                  inputMode="decimal"
                  placeholder={String(asset?.value ?? "")}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm tabular-nums focus:border-purple-400 focus:outline-none"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Effective Date</label>
                <input
                  type="date"
                  value={newValuationDate}
                  onChange={(e) => setNewValuationDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Defaults to today. You can backdate to correct historical values.
                </p>
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowAddValuationModal(false);
                  setNewValuationValue("");
                }}
                disabled={addingValuation}
                className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900"
              >
                Cancel
              </button>
              <button
                onClick={addValuation}
                disabled={addingValuation}
                className="rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 disabled:opacity-40 transition"
              >
                {addingValuation ? "Adding..." : "Add Valuation"}
              </button>
            </div>
          </div>
        </div>
      )}

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
              <div>
                <label className="mb-1 block text-xs font-medium text-gray-500">Start Date</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:border-purple-400 focus:outline-none"
                />
                <p className="text-xs text-gray-500 mt-1">
                  {!startDate 
                    ? "Set date to include from that month onward (leave empty for all months)"
                    : "Asset included from this month onward"}
                </p>
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
                  const txnSource = selectedTxnRole === "income_from" ? availableIncomeTxns : availableTxns;
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
                  const txnSource = selectedTxnRole === "income_from" ? availableIncomeTxns : availableTxns;
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
                {(selectedTxnRole === "income_from" ? availableIncomeTxns : availableTxns)
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
                          {formatCurrencyWithCents(tx.amount, currency)}
                        </p>
                      </div>
                    </label>
                  ))}
                {(selectedTxnRole === "income_from" ? availableIncomeTxns : availableTxns).filter((tx) => !txnSearch || tx.merchant?.toLowerCase().includes(txnSearch.toLowerCase())).length === 0 && (
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
      )}

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