"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { SpendingSummary } from "@/lib/spendingSummary";
import { ReviewList } from "@/components/ReviewList";
import { OverviewTab } from "./components/OverviewTab";
import { TrendsTab } from "./components/TrendsTab";
import { WhereItGoesTab } from "./components/WhereItGoesTab";
import { ByMerchantTab } from "./components/ByMerchantTab";
import { SubscriptionsTab } from "./components/SubscriptionsTab";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "where", label: "Where it goes" },
  { id: "merchants", label: "By merchant" },
  { id: "subscriptions", label: "Subscriptions" },
] as const;
type TabId = typeof TABS[number]["id"];

function SpendingPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [summary, setSummary] = useState<SpendingSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const tabParam = searchParams.get("tab");
    if (tabParam && TABS.some(t => t.id === tabParam)) {
      setActiveTab(tabParam as TabId);
    }
  }, [searchParams]);

  const loadData = async (tok: string) => {
    try {
      const res = await fetch("/api/user/spending-summary", {
        headers: { Authorization: `Bearer ${tok}` },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to load spending data" }));
        throw new Error(data.error || "Failed to load spending data");
      }

      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load spending data");
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
      setToken(tok);
      await loadData(tok);
    });
  }, [router]);

  const handleTabChange = (tabId: TabId) => {
    setActiveTab(tabId);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", tabId);
    window.history.pushState({}, "", url);
  };

  const handleReviewComplete = async () => {
    if (token) {
      await loadData(token);
    }
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
        <p className="text-red-600">{error || "Failed to load spending data"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8">
      <div className="mb-6">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/account" className="text-neutral-500 hover:text-neutral-700 transition-colors">
            ←
          </Link>
          <h1 className="text-2xl font-semibold text-neutral-900">Spending</h1>
        </div>
      </div>

      <div className="mb-6">
        <div className="border-b border-neutral-200">
          <div className="flex gap-6">
            {TABS.map(tab => (
              <button
                key={tab.id}
                onClick={() => handleTabChange(tab.id)}
                className={`pb-3 px-1 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? "border-purple-600 text-purple-600"
                    : "border-transparent text-neutral-600 hover:text-neutral-900 hover:border-neutral-300"
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div>
        {activeTab === "overview" && <OverviewTab summary={summary} token={token} />}
        {activeTab === "trends" && <TrendsTab summary={summary} />}
        {activeTab === "where" && <WhereItGoesTab summary={summary} />}
        {activeTab === "merchants" && <ByMerchantTab summary={summary} />}
        {activeTab === "subscriptions" && <SubscriptionsTab token={token} />}
      </div>
    </div>
  );
}

export default function SpendingPage() {
  return (
    <Suspense fallback={<div className="flex min-h-[50vh] items-center justify-center">
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
    </div>}>
      <SpendingPageContent />
    </Suspense>
  );
}
