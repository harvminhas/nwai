"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import AccountSwitcher, { type AccountSwitcherItem } from "@/components/AccountSwitcher";
import {
  ACCOUNT_SECTION_TABS,
  type AccountSectionTabId,
} from "@/lib/accountSectionTabs";
import {
  ACCOUNT_PAGE_HEADER,
  ACCOUNT_PAGE_SHELL,
  ACCOUNT_PAGE_TABS_NAV,
  accountPageTabClass,
} from "@/lib/accountSectionLayout";

interface AccountSectionFrameProps {
  title: string;
  activeTab: AccountSectionTabId;
  onTabChange: (tabId: AccountSectionTabId) => void;
  extraHeader?: ReactNode;
  children: ReactNode;
  switcherItems?: AccountSwitcherItem[];
  switcherOpen?: boolean;
}

/**
 * Shared Assets / Debts page chrome: breadcrumb, title, account switcher, tabs.
 * Phone layout is mobile-first; `lg:` restores the accepted >=1024 desktop look.
 */
export function AccountSectionFrame({
  title,
  activeTab,
  onTabChange,
  extraHeader,
  children,
  switcherItems,
  switcherOpen,
}: AccountSectionFrameProps) {
  return (
    <div className={ACCOUNT_PAGE_SHELL}>
      <div className={ACCOUNT_PAGE_HEADER}>
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <Link href="/account/overview" className="text-sm text-gray-500 hover:text-gray-700">
              Account
            </Link>
            <span className="text-gray-400">/</span>
            <span className="text-sm font-medium text-gray-900">{title}</span>
          </div>
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
        </div>
        <div className="shrink-0">
          <AccountSwitcher previewItems={switcherItems} previewOpen={switcherOpen} />
        </div>
      </div>

      {extraHeader}

      <div className="mb-6 border-b border-gray-200">
        <nav className={ACCOUNT_PAGE_TABS_NAV} aria-label="Account section">
          {ACCOUNT_SECTION_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              className={accountPageTabClass(activeTab === tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-w-0">{children}</div>
    </div>
  );
}
