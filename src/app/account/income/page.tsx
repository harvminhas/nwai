"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { IncomeSummary } from "@/lib/incomeSummary";
import { ReviewList } from "@/components/ReviewList";
import { OverviewTab } from "./components/OverviewTab";
import { TrendsTab } from "./components/TrendsTab";
import { SourcesTab } from "./components/SourcesTab";

const TABS = [
  { id: "overview", label: "Overview" },
  { id: "trends", label: "Trends" },
  { id: "sources", label: "Sources" },
] as const;
type TabId = typeof TABS[number]["id"];

function IncomePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [summary, setSummary] = useState<IncomeSummary | null>(null);
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
      const res = await fetch("/api/user/income-summary", {
        headers: { Authorization: `Bearer ${tok}` },
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: "Failed to load income data" }));
        throw new Error(data.error || "Failed to load income data");
      }

      const data = await res.json();
      setSummary(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load income data");
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
        <p className="text-red-600">{error || "Failed to load income data"}</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-12 sm:py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gray-900">Income</h1>
        <p className="text-sm text-gray-500">
          Track income sources, trends, and reliability
        </p>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex gap-6">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => handleTabChange(tab.id)}
              className={`pb-3 px-1 border-b-2 font-medium text-sm transition ${
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

      {/* Tab content */}
      <div>
        {activeTab === "overview" && (
          <div className="space-y-6">
            <OverviewTab summary={summary} onReviewComplete={handleReviewComplete} />
            
            {/* Review cards */}
            <ReviewList
              token={token}
              reviewType="income_classification"
              onReviewComplete={handleReviewComplete}
            />
          </div>
        )}

        {activeTab === "trends" && <TrendsTab summary={summary} />}

        {activeTab === "sources" && (
          <SourcesTab summary={summary} token={token} onUpdate={handleReviewComplete} />
        )}
      </div>

      {/* Footer link to detailed view */}
      {activeTab !== "sources" && summary.regularSources.length > 0 && (
        <div className="text-center pt-4">
          <Link
            href="/account/income?tab=sources"
            className="text-sm text-purple-600 hover:text-purple-700 font-medium"
          >
            View all sources →
          </Link>
        </div>
      )}
    </div>
  );
}

export default function IncomePage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    }>
      <IncomePageContent />
    </Suspense>
  );
}
