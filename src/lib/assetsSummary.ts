/**
 * Assets Summary — single source of truth for all assets computations.
 * 
 * Groups accounts and manual assets by type, calculates changes, identifies stale accounts.
 * Used by the Assets page and dashboard cards.
 */

import type { AccountSnapshot, AccountBalanceHistory } from "./extractTransactions";
import type { ManualAsset } from "./types";
import { convertToHomeCurrency } from "./currencyUtils";

export interface AssetAccount {
  slug: string;
  bankName: string;
  accountName?: string;
  accountType: string;
  balance: number;
  currency: string;
  statementMonth: string;
  isStale: boolean; // true if statementMonth is >45 days old
  daysOld: number;
}

export interface AssetGroup {
  type: "cash" | "investments" | "registered" | "property" | "other";
  label: string;
  total: number;
  accounts: AssetAccount[];
  manualAssets: ManualAsset[];
}

export interface AssetsSummary {
  totalAssets: number;
  currency: string;
  changeVsLastMonth: number; // positive = increase
  changeVs12Months: number;
  groups: AssetGroup[];
  monthlyHistory: Array<{
    month: string; // YYYY-MM
    monthLabel: string; // e.g. "Sep 2026"
    total: number;
    groups: Array<{
      type: string;
      total: number;
    }>;
  }>;
  staleAccounts: AssetAccount[];
}

const REGISTERED_TYPES = new Set(["rrsp", "tfsa", "fhsa", "401k", "ira", "roth_ira"]);

function accountGroup(accountType: string): AssetGroup["type"] {
  if (accountType === "checking" || accountType === "savings") return "cash";
  if (accountType === "investment") return "investments";
  if (REGISTERED_TYPES.has(accountType)) return "registered";
  return "other";
}

function groupLabel(type: AssetGroup["type"]): string {
  switch (type) {
    case "cash": return "Cash & Savings";
    case "investments": return "Investments";
    case "registered": return "Registered (RRSP/TFSA)";
    case "property": return "Property";
    case "other": return "Other Assets";
  }
}

function isStale(statementMonth: string): { stale: boolean; daysOld: number } {
  const [year, month] = statementMonth.split("-").map(Number);
  const statementDate = new Date(year, month, 5); // Statement available ~5 days after month end
  const now = new Date();
  const diffMs = now.getTime() - statementDate.getTime();
  const daysOld = Math.floor(diffMs / 86400000);
  return { stale: daysOld > 45, daysOld };
}

function formatMonthLabel(ym: string): string {
  const [year, month] = ym.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}

export function buildAssetsSummary(
  accountSnapshots: AccountSnapshot[],
  balanceHistory: AccountBalanceHistory[],
  manualAssets: ManualAsset[],
  fxRates: Record<string, number>,
  homeCurrency: string
): AssetsSummary {
  // Filter to asset accounts only (positive balance or asset types)
  const assetAccounts = accountSnapshots.filter(acc => 
    acc.balance >= 0 || acc.accountType === "investment" || REGISTERED_TYPES.has(acc.accountType)
  );

  // Build account list with staleness
  const accounts: AssetAccount[] = assetAccounts.map(acc => {
    const { stale, daysOld } = isStale(acc.statementMonth);
    return {
      slug: acc.slug,
      bankName: acc.bankName,
      accountName: acc.accountName,
      accountType: acc.accountType,
      balance: convertToHomeCurrency(acc.balance, acc.currency || homeCurrency, fxRates, homeCurrency),
      currency: homeCurrency,
      statementMonth: acc.statementMonth,
      isStale: stale,
      daysOld,
    };
  });

  // Group by type
  const groupMap = new Map<AssetGroup["type"], AssetGroup>();
  
  for (const acc of accounts) {
    const type = accountGroup(acc.accountType);
    if (!groupMap.has(type)) {
      groupMap.set(type, {
        type,
        label: groupLabel(type),
        total: 0,
        accounts: [],
        manualAssets: [],
      });
    }
    const group = groupMap.get(type)!;
    group.accounts.push(acc);
    group.total += acc.balance;
  }

  // Add manual assets to property group
  if (manualAssets.length > 0) {
    const propertyAssets = manualAssets.filter(a => a.category === "property");
    const otherAssets = manualAssets.filter(a => a.category !== "property");
    
    if (propertyAssets.length > 0) {
      if (!groupMap.has("property")) {
        groupMap.set("property", {
          type: "property",
          label: "Property",
          total: 0,
          accounts: [],
          manualAssets: [],
        });
      }
      const propGroup = groupMap.get("property")!;
      propGroup.manualAssets = propertyAssets;
      propGroup.total += propertyAssets.reduce((sum, a) => sum + a.value, 0);
    }
    
    if (otherAssets.length > 0) {
      if (!groupMap.has("other")) {
        groupMap.set("other", {
          type: "other",
          label: "Other Assets",
          total: 0,
          accounts: [],
          manualAssets: [],
        });
      }
      const otherGroup = groupMap.get("other")!;
      otherGroup.manualAssets = otherAssets;
      otherGroup.total += otherAssets.reduce((sum, a) => sum + a.value, 0);
    }
  }

  const groups = Array.from(groupMap.values());
  const totalAssets = groups.reduce((sum, g) => sum + g.total, 0);

  // Calculate changes from balance history
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  
  let lastMonthDate = new Date(now);
  lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
  const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;
  
  let year12Date = new Date(now);
  year12Date.setFullYear(year12Date.getFullYear() - 1);
  const month12Ago = `${year12Date.getFullYear()}-${String(year12Date.getMonth() + 1).padStart(2, "0")}`;

  const getTotalAtMonth = (month: string): number => {
    let total = 0;
    for (const history of balanceHistory) {
      const entry = history.entries.find(e => e.yearMonth === month);
      if (entry) {
        const acc = assetAccounts.find(a => a.slug === history.slug);
        if (acc && acc.balance >= 0) {
          total += convertToHomeCurrency(entry.balance, history.currency, fxRates, homeCurrency);
        }
      }
    }
    // Add manual assets (assume constant for now - no history tracking)
    total += manualAssets.reduce((sum, a) => sum + a.value, 0);
    return total;
  };

  const lastMonthTotal = getTotalAtMonth(lastMonth);
  const month12Total = getTotalAtMonth(month12Ago);

  const changeVsLastMonth = lastMonthTotal > 0 ? totalAssets - lastMonthTotal : 0;
  const changeVs12Months = month12Total > 0 ? totalAssets - month12Total : 0;

  // Build monthly history (last 12 months)
  const monthlyHistory: AssetsSummary["monthlyHistory"] = [];
  const allMonths = new Set<string>();
  for (const history of balanceHistory) {
    for (const entry of history.entries) {
      allMonths.add(entry.yearMonth);
    }
  }
  const sortedMonths = Array.from(allMonths).sort().reverse().slice(0, 12).reverse();

  for (const month of sortedMonths) {
    const groupTotals = new Map<string, number>();
    let monthTotal = 0;

    for (const history of balanceHistory) {
      const entry = history.entries.find(e => e.yearMonth === month);
      if (entry) {
        const acc = assetAccounts.find(a => a.slug === history.slug);
        if (acc && acc.balance >= 0) {
          const type = accountGroup(acc.accountType);
          const balance = convertToHomeCurrency(entry.balance, history.currency, fxRates, homeCurrency);
          groupTotals.set(type, (groupTotals.get(type) || 0) + balance);
          monthTotal += balance;
        }
      }
    }

    // Add manual assets to month total
    const manualTotal = manualAssets.reduce((sum, a) => sum + a.value, 0);
    monthTotal += manualTotal;
    if (manualTotal > 0) {
      groupTotals.set("property", (groupTotals.get("property") || 0) + manualTotal);
    }

    monthlyHistory.push({
      month,
      monthLabel: formatMonthLabel(month),
      total: monthTotal,
      groups: Array.from(groupTotals.entries()).map(([type, total]) => ({ type, total })),
    });
  }

  const staleAccounts = accounts.filter(a => a.isStale);

  return {
    totalAssets,
    currency: homeCurrency,
    changeVsLastMonth,
    changeVs12Months,
    groups,
    monthlyHistory,
    staleAccounts,
  };
}
