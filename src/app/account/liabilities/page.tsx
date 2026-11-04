"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { DebtsSummary } from "@/lib/debtsSummary";
import { OverviewTab } from "./components/OverviewTab";
import { TrendsTab } from "./components/TrendsTab";
import { CategoriesTab } from "./components/CategoriesTab";
import AccountSwitcher from "@/components/AccountSwitcher";

const TABS = [
  { id: "accounts", label: "Accounts" },
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
] as const;
type TabId = typeof TABS[number]["id"];

interface AutoMarkedAccount {
  accountSlug: string;
  accountLabel: string;
  reason: string;
  statementId: string;
}

function LiabilitiesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>("accounts");
  const [summary, setSummary] = useState<DebtsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoMarkedAccounts, setAutoMarkedAccounts] = useState<AutoMarkedAccount[]>([]);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && TABS.some(t => t.id === tabParam)) {
      setActiveTab(tabParam as TabId);
    }
  }, [searchParams]);

  const loadData = async (tok: string) => {
    try {
      const [summaryRes, statementsRes] = await Promise.all([
        fetch("/api/user/debts-summary", {
          headers: { Authorization: `Bearer ${tok}` },
        }),
        fetch("/api/user/statements", {
          headers: { Authorization: `Bearer ${tok}` },
        }),
      ]);

      if (!summaryRes.ok) {
        const data = await summaryRes.json().catch(() => ({ error: "Failed to load debts data" }));
        throw new Error(data.error || "Failed to load debts data");
      }

      const summaryData = await summaryRes.json();
      setSummary(summaryData);

      // Check for auto-marked accounts
      if (statementsRes.ok) {
        const statementsData = await statementsRes.json();
        const autoMarked: AutoMarkedAccount[] = [];
        
        for (const stmt of (statementsData.statements || [])) {
          if (stmt.payoffAutoMarked && stmt.parsedData) {
            const accountLabel = stmt.parsedData.accountName || 
              `${stmt.parsedData.bankName} ${stmt.parsedData.accountType}`;
            autoMarked.push({
              accountSlug: stmt.accountSlug,
              accountLabel,
              reason: stmt.payoffReason || "Account appears to be paid off",
              statementId: stmt.id,
            });
          }
        }
        
        setAutoMarkedAccounts(autoMarked);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load debts data");
    } finally {
      setLoading(false);
    }
  };

  const handleUndoPayoff = async (accountSlug: string, statementId: string) => {
    const { auth } = getFirebaseClient();
    const user = auth.currentUser;
    if (!user) return;

    try {
      const token = await user.getIdToken();
      
      // Reopen the account
      const statusDate = new Date().toISOString().split("T")[0];
      await fetch("/api/user/account-status", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ accountSlug, status: "open", statusDate }),
      });

      // Remove from auto-marked list
      setAutoMarkedAccounts(prev => prev.filter(a => a.accountSlug !== accountSlug));
      
      // Reload data
      await loadData(token);
    } catch (err) {
      console.error("Failed to undo payoff:", err);
      alert("Failed to undo. Please try again.");
    }
  };

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }

      setLoading(true);
      setError(null);
      const tok = await user.getIdToken();
      await loadData(tok);
    });
  }, [router]);

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tabId);
    window.history.pushState({}, "", url);
  };

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (error || !summary) {
    return (
      <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
        <p className="text-red-600">{error || "Failed to load debts data"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
      {/* Header */}
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Link href="/account/overview" className="text-sm text-gray-500 hover:text-gray-700">
              Account
            </Link>
            <span className="text-gray-400">/</span>
            <span className="text-sm font-medium text-gray-900">Debts</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Debts</h1>
        </div>
        <AccountSwitcher />
      </div>

      {/* Auto-marked Payoff Undo Banners */}
      {autoMarkedAccounts.length > 0 && (
        <div className="mb-6 space-y-3">
          {autoMarkedAccounts.map((account) => (
            <div
              key={account.accountSlug}
              className="flex items-start justify-between p-4 bg-green-50 border border-green-200 rounded-lg"
            >
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <svg className="w-5 h-5 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  <span className="font-semibold text-green-900">
                    {account.accountLabel} marked as paid off
                  </span>
                </div>
                <p className="text-sm text-green-700 ml-7">{account.reason}</p>
              </div>
              <button
                onClick={() => handleUndoPayoff(account.accountSlug, account.statementId)}
                className="px-3 py-1.5 text-sm font-medium text-green-700 hover:text-green-900 hover:bg-green-100 rounded transition-colors"
              >
                Undo
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Tabs */}
      <div className="border-b border-gray-200 mb-6">
        <nav className="-mb-px flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`pb-3 px-1 border-b-2 font-medium text-sm transition-colors ${
                activeTab === tab.id
                  ? "border-purple-600 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      <div>
        {activeTab === "overview" && <OverviewTab summary={summary} />}
        {activeTab === "trends" && <TrendsTab summary={summary} />}
        {activeTab === "accounts" && (
          <CategoriesTab summary={summary} />
        )}
      </div>
    </div>
  );
}

export default function LiabilitiesPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    }>
      <LiabilitiesPageContent />
    </Suspense>
  );
}
