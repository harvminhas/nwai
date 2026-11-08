"use client";

import { useEffect, useState, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { AssetsSummary } from "@/lib/assetsSummary";
import { OverviewTab } from "./components/OverviewTab";
import { TrendsTab } from "./components/TrendsTab";
import { CategoriesTab } from "./components/CategoriesTab";
import { AccountSectionFrame } from "@/app/account/components/AccountSectionFrame";
import {
  ACCOUNT_SECTION_TABS,
  resolveAccountSectionTab,
  type AccountSectionTabId,
} from "@/lib/accountSectionTabs";

const TABS = ACCOUNT_SECTION_TABS;
type TabId = AccountSectionTabId;

function AssetsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>(() => resolveAccountSectionTab(null));
  const [summary, setSummary] = useState<AssetsSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    // Only apply when the query names a real tab. Bare `/account/assets` stays Overview.
    // Do not reset on missing param: handleTabChange uses pushState, not Next searchParams.
    if (tabParam && TABS.some(t => t.id === tabParam)) {
      setActiveTab(tabParam as TabId);
    }
  }, [searchParams]);

  const loadData = async (tok: string) => {
    try {
      const res = await fetch("/api/user/assets-summary", {
        headers: { Authorization: `Bearer ${tok}` },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to load assets data" }));
        throw new Error(data.error || "Failed to load assets data");
      }

      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load assets data");
    } finally {
      setLoading(false);
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
        <p className="text-red-600">{error || "Failed to load assets data"}</p>
      </div>
    );
  }

  return (
    <AccountSectionFrame title="Assets" activeTab={activeTab} onTabChange={handleTabChange}>
      {activeTab === "overview" && <OverviewTab summary={summary} />}
      {activeTab === "trends" && <TrendsTab summary={summary} />}
      {activeTab === "accounts" && <CategoriesTab summary={summary} />}
    </AccountSectionFrame>
  );
}

export default function AssetsPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    }>
      <AssetsPageContent />
    </Suspense>
  );
}
