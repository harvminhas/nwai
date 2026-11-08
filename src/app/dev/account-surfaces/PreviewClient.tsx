"use client";

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { MvpTopNav } from "@/components/MvpTopNav";
import { AccountSectionFrame } from "@/app/account/components/AccountSectionFrame";
import { OverviewTab as AssetsOverviewTab } from "@/app/account/assets/components/OverviewTab";
import { TrendsTab as AssetsTrendsTab } from "@/app/account/assets/components/TrendsTab";
import { CategoriesTab as AssetsCategoriesTab } from "@/app/account/assets/components/CategoriesTab";
import { OverviewTab as DebtsOverviewTab } from "@/app/account/liabilities/components/OverviewTab";
import { TrendsTab as DebtsTrendsTab } from "@/app/account/liabilities/components/TrendsTab";
import { CategoriesTab as DebtsCategoriesTab } from "@/app/account/liabilities/components/CategoriesTab";
import {
  resolveAccountSectionTab,
  type AccountSectionTabId,
} from "@/lib/accountSectionTabs";
import {
  buildPreviewAssetsSummary,
  buildPreviewDebtsSummary,
  buildPreviewSwitcherItems,
  type PreviewMonthKind,
} from "@/lib/accountSectionPreviewFixture";
import { PreviewIsolationProvider } from "@/lib/previewIsolation";

function parseSide(raw: string | null): "assets" | "debts" {
  return raw === "debts" ? "debts" : "assets";
}

function parseMonths(raw: string | null): PreviewMonthKind {
  if (raw === "one" || raw === "empty") return raw;
  return "many";
}

export function AccountSurfacesPreview() {
  return (
    <PreviewIsolationProvider>
      <AccountSurfacesPreviewInner />
    </PreviewIsolationProvider>
  );
}

function AccountSurfacesPreviewInner() {
  const searchParams = useSearchParams();
  const side = parseSide(searchParams.get("side"));
  const months = parseMonths(searchParams.get("months"));
  const tabFromQuery = resolveAccountSectionTab(searchParams.get("tab"));
  const switcherOpen = searchParams.get("switcher") === "open";
  const [activeTab, setActiveTab] = useState<AccountSectionTabId>(tabFromQuery);
  const [overflow, setOverflow] = useState<{ sw: number; cw: number } | null>(null);

  useEffect(() => {
    setActiveTab(tabFromQuery);
  }, [tabFromQuery]);

  useEffect(() => {
    const measure = () => {
      const sw = document.documentElement.scrollWidth;
      const cw = document.documentElement.clientWidth;
      setOverflow(sw > cw + 1 ? { sw, cw } : null);
    };
    measure();
    const id = window.setTimeout(measure, 800);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener("resize", measure);
    };
  }, [side, months, activeTab, switcherOpen]);

  const assets = useMemo(() => buildPreviewAssetsSummary(months), [months]);
  const debts = useMemo(() => buildPreviewDebtsSummary(months), [months]);
  const switcherItems = useMemo(() => buildPreviewSwitcherItems(side), [side]);
  const title = side === "debts" ? "Debts" : "Assets";

  return (
    <div
      className="min-h-screen bg-gray-50"
      data-preview-side={side}
      data-preview-tab={activeTab}
      data-preview-isolation="true"
    >
      <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-900">
        Synthetic preview — production React tabs, mocked summaries. Financial mutations disabled.
        {overflow ? (
          <span className="ml-2 font-semibold text-red-700">
            HORIZONTAL OVERFLOW {overflow.sw}px vs {overflow.cw}px
          </span>
        ) : (
          <span className="ml-2 text-emerald-800">no horizontal overflow</span>
        )}
      </div>
      <MvpTopNav
        netWorthData={{
          netWorth: assets.totalAssets - debts.totalDebt,
          monthlyChange: 10_269.82,
          currency: "CAD",
        }}
      />
      <AccountSectionFrame
        title={title}
        activeTab={activeTab}
        onTabChange={setActiveTab}
        switcherItems={switcherItems}
        switcherOpen={switcherOpen}
      >
        {side === "assets" && activeTab === "overview" && <AssetsOverviewTab summary={assets} />}
        {side === "assets" && activeTab === "accounts" && <AssetsCategoriesTab summary={assets} />}
        {side === "assets" && activeTab === "trends" && <AssetsTrendsTab summary={assets} />}
        {side === "debts" && activeTab === "overview" && <DebtsOverviewTab summary={debts} />}
        {side === "debts" && activeTab === "accounts" && <DebtsCategoriesTab summary={debts} />}
        {side === "debts" && activeTab === "trends" && <DebtsTrendsTab summary={debts} />}
      </AccountSectionFrame>
    </div>
  );
}
