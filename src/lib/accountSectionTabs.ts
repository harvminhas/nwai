/**
 * Shared Assets / Debts page tabs.
 *
 * User-facing Debts navigation (label "Debts") is `/account/liabilities`, not `/account/debts`.
 * Main nav (MvpTopNav / Sidebar / TopNav / dashboard cards) uses that href with no `?tab=`.
 *
 * Intent (t598u):
 * - No query / unknown query (e.g. insights `?tab=payoff`) → Overview
 * - Explicit `?tab=accounts` (account-detail breadcrumbs) → Accounts
 * - Explicit `?tab=overview` / `?tab=trends` / `?tab=performance` / `?tab=what-changed` → that tab
 */
export const ACCOUNT_SECTION_TABS = [
  { id: "overview", label: "Overview" },
  { id: "accounts", label: "Accounts" },
  { id: "trends", label: "Trends" },
  { id: "performance", label: "Performance" },
  { id: "what-changed", label: "What changed" },
] as const;

export type AccountSectionTabId = (typeof ACCOUNT_SECTION_TABS)[number]["id"];

export const DEFAULT_ACCOUNT_SECTION_TAB: AccountSectionTabId = "overview";

export function resolveAccountSectionTab(
  tabParam: string | null | undefined
): AccountSectionTabId {
  if (tabParam && ACCOUNT_SECTION_TABS.some((t) => t.id === tabParam)) {
    return tabParam as AccountSectionTabId;
  }
  return DEFAULT_ACCOUNT_SECTION_TAB;
}
