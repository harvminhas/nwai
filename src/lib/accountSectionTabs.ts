/**
 * Shared Assets / Debts page tabs.
 *
 * User-facing Debts navigation (label "Debts") is `/account/liabilities`, not `/account/debts`.
 * Main nav (MvpTopNav / Sidebar / TopNav / dashboard cards) uses that href with no `?tab=`.
 *
 * Intent:
 * - No query / unknown query (e.g. insights `?tab=payoff`) → Trends
 * - Explicit `?tab=accounts` (account-detail breadcrumbs) → Accounts
 * - Explicit `?tab=overview` / `?tab=trends` → that tab
 */
export const ACCOUNT_SECTION_TABS = [
  { id: "trends", label: "Trends" },
  { id: "accounts", label: "Accounts" },
  { id: "overview", label: "Overview" },
] as const;

export type AccountSectionTabId = (typeof ACCOUNT_SECTION_TABS)[number]["id"];

export const DEFAULT_ACCOUNT_SECTION_TAB: AccountSectionTabId = "trends";

export function resolveAccountSectionTab(
  tabParam: string | null | undefined
): AccountSectionTabId {
  if (tabParam && ACCOUNT_SECTION_TABS.some((t) => t.id === tabParam)) {
    return tabParam as AccountSectionTabId;
  }
  return DEFAULT_ACCOUNT_SECTION_TAB;
}
