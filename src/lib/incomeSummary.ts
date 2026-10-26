/**
 * Unified Income Data Layer — single source of truth for all income computations.
 * 
 * Used by:
 * - Income page (Overview, Trends, Sources tabs)
 * - Income [source] detail page
 * - Dashboard income card/drawer
 * 
 * Handles:
 * - Source clustering (±15% amount clustering for generic names)
 * - Transfer detection (using INCOME_TRANSFER_RE)
 * - One-off detection
 * - Last 3 complete months logic (excluding current month)
 * - Frequency and reliability scoring
 */

import type { IncomeTxnRecord, AccountSnapshot } from "./extractTransactions";
import { INCOME_TRANSFER_RE } from "./spendingMetrics";
import { GENERIC_SOURCE_NAMES, scoreSource, detectFrequency, type Frequency, type Reliability } from "./incomeEngine";
import type { IncomeCategory } from "./incomeEngine";

export interface IncomeTransaction {
  source: string;
  amount: number;
  date: string;
  category?: string;
  accountLabel?: string;
  accountSlug?: string;
}

export interface IncomeSource {
  /** Display name (may include amount suffix for clustered generics) */
  description: string;
  /** Original source name (before clustering) */
  canonicalName: string;
  /** Total across all transactions in this source */
  total: number;
  /** Transaction count */
  count: number;
  /** All transactions for this source */
  transactions: IncomeTransaction[];
  /** Detected or user-overridden frequency */
  frequency: Frequency;
  /** Reliability score */
  reliability: Reliability;
  reliabilityScore: number;
  /** Category (user-set or AI-assigned) */
  category: IncomeCategory;
  /** True if this source is likely a transfer */
  isTransfer: boolean;
  /** True if this source appears to be a one-off */
  isOneOff: boolean;
  /** Average amount per transaction */
  avgAmount: number;
  /** Monthly equivalent (adjusts for frequency) */
  monthlyEquivalent: number;
}

export interface MonthlyIncomeSummary {
  /** YYYY-MM */
  yearMonth: string;
  /** Total income (all sources) */
  total: number;
  /** Regular income (excluding one-offs) */
  regular: number;
  /** One-off income */
  oneOff: number;
  /** Per-source breakdown */
  sources: { source: string; amount: number; isOneOff: boolean }[];
}

export interface IncomeComparison {
  /** Current period amount */
  current: number;
  /** Previous period amount (same window, shifted back) */
  previous: number;
  /** Percentage change */
  changePercent: number;
  /** Absolute change */
  changeAmount: number;
}

export interface WhatChanged {
  /** Source that's late or missing */
  lateMissing?: { source: string; expectedBy: string; amount: number };
  /** New source that appeared */
  newSource?: { source: string; firstDate: string; amount: number };
  /** Source with notable change */
  notableChange?: { source: string; oldAmount: number; newAmount: number; changePercent: number };
}

export interface IncomeSummary {
  /** Current month (in progress, may be partial) */
  currentMonth: string;
  /** Current month income so far */
  currentMonthTotal: number;
  /** Current month regular only */
  currentMonthRegular: number;
  /** Current month one-off only */
  currentMonthOneOff: number;
  
  /** Last 3 complete months */
  last3Months: string[];
  /** Average per month (regular only, last 3 complete months) */
  typicalMonthly: number;
  /** Total across last 3 complete months */
  last3MonthsTotal: number;
  
  /** All available months (sorted ascending) */
  allMonths: string[];
  /** Monthly breakdown for all months */
  monthlyHistory: MonthlyIncomeSummary[];
  
  /** All sources (sorted by total descending) */
  sources: IncomeSource[];
  /** Sources that are likely transfers */
  transferSources: IncomeSource[];
  /** Sources that are one-offs */
  oneOffSources: IncomeSource[];
  /** Regular recurring sources */
  regularSources: IncomeSource[];
  
  /** Year-over-year comparison (if available) */
  yoy?: IncomeComparison;
  
  /** What changed detection */
  whatChanged: WhatChanged;
  
  /** Currency */
  currency: string;
  
  /** Total tracked months */
  totalMonthsTracked: number;
}

/** Helper to get current month in YYYY-MM format */
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Helper to get last N complete months (excluding current) */
function getLastCompleteMonths(allMonths: string[], n: number): string[] {
  const current = getCurrentMonth();
  const complete = allMonths.filter(m => m < current);
  return complete.slice(-n);
}

/** Detect if a source name is generic (triggers amount clustering) */
function isGenericSourceName(name: string): boolean {
  const normalized = name.trim().toLowerCase();
  return GENERIC_SOURCE_NAMES.some(g => normalized === g);
}

/** Detect if a source is likely a transfer */
function isLikelyTransfer(source: string, transactions: IncomeTransaction[]): boolean {
  if (INCOME_TRANSFER_RE.test(source)) return true;
  if (transactions.length > 0 && transactions.every(t => t.category === "Transfer" || t.category === "Transfer In")) {
    return true;
  }
  return false;
}

/** Cluster transactions by amount (±15% tolerance) for generic source names */
function clusterByAmount(
  source: string,
  transactions: IncomeTransaction[],
  currency: string
): { description: string; transactions: IncomeTransaction[] }[] {
  if (!isGenericSourceName(source) || transactions.length <= 1) {
    return [{ description: source, transactions }];
  }

  const sorted = [...transactions].sort((a, b) => b.amount - a.amount);
  const clusters: { representative: number; txns: IncomeTransaction[] }[] = [];

  for (const txn of sorted) {
    const match = clusters.find(
      c => Math.abs(c.representative - txn.amount) / Math.max(c.representative, 1) <= 0.15
    );
    if (match) {
      match.txns.push(txn);
    } else {
      clusters.push({ representative: txn.amount, txns: [txn] });
    }
  }

  const result: { description: string; transactions: IncomeTransaction[] }[] = [];
  const miscTxns: IncomeTransaction[] = [];

  for (const cluster of clusters) {
    const avg = cluster.txns.reduce((s, t) => s + t.amount, 0) / cluster.txns.length;
    if (avg >= 200 && cluster.txns.length >= 2) {
      const avgRounded = Math.round(avg);
      const symbol = currency === "USD" ? "$" : currency === "CAD" ? "CA$" : currency;
      result.push({
        description: `${source} — ${symbol}${avgRounded.toLocaleString()}`,
        transactions: cluster.txns
      });
    } else {
      miscTxns.push(...cluster.txns);
    }
  }

  if (miscTxns.length > 0) {
    result.push({ description: source, transactions: miscTxns });
  }

  // If we only have one cluster and it's the misc bucket, return unclustered
  if (result.length === 1 && miscTxns.length > 0) {
    return [{ description: source, transactions }];
  }

  return result.length > 0 ? result : [{ description: source, transactions }];
}

/** Detect if a source is a one-off (appears in only 1 month) */
function isOneOff(
  source: string,
  transactions: IncomeTransaction[],
  totalMonthsTracked: number
): boolean {
  const uniqueMonths = new Set(transactions.map(t => t.date.slice(0, 7)));
  if (uniqueMonths.size === 1 && totalMonthsTracked >= 3) {
    return true;
  }
  
  // Check for one-time keywords
  const lower = source.toLowerCase();
  const ONE_TIME_KEYWORDS = [
    "cra", "gst", "hst", "refund", "rebate", "tax return", "ccb", "canada child",
    "oas", "cerb", "ei benefit", "ei payment", "stimulus", "benefit payment", "bonus"
  ];
  return ONE_TIME_KEYWORDS.some(k => lower.includes(k));
}

/** Compute monthly equivalent based on frequency */
function computeMonthlyEquivalent(avgAmount: number, frequency: Frequency): number {
  const multipliers: Record<Frequency, number> = {
    weekly: 4.33,
    "bi-weekly": 2.17,
    monthly: 1,
    quarterly: 1 / 3,
    "semi-annual": 1 / 6,
    irregular: 1
  };
  return avgAmount * (multipliers[frequency] || 1);
}

/**
 * Build income summary from transactions.
 * This is the single source of truth for all income data in the app.
 */
export function buildIncomeSummary(
  incomeTxns: IncomeTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  currency: string = "USD"
): IncomeSummary {
  const currentMonth = getCurrentMonth();
  
  // Convert to simpler transaction format
  const transactions: IncomeTransaction[] = incomeTxns.map(t => ({
    source: t.source || "Unknown",
    amount: t.amount,
    date: t.date,
    category: (t.category as IncomeCategory) || "Other",
    accountLabel: accountSnapshots.find(a => a.slug === t.accountSlug)?.accountName || t.accountSlug,
    accountSlug: t.accountSlug
  }));

  // Group by source
  const sourceMap = new Map<string, IncomeTransaction[]>();
  for (const txn of transactions) {
    const existing = sourceMap.get(txn.source) || [];
    existing.push(txn);
    sourceMap.set(txn.source, existing);
  }

  // Build source summaries with clustering
  const allSources: IncomeSource[] = [];
  for (const [sourceName, sourceTxns] of sourceMap) {
    // Apply amount clustering for generic names
    const clusters = clusterByAmount(sourceName, sourceTxns, currency);
    
    for (const cluster of clusters) {
      const total = cluster.transactions.reduce((s, t) => s + t.amount, 0);
      const count = cluster.transactions.length;
      const avgAmount = total / count;
      
      // Detect frequency and reliability
      const dates = cluster.transactions.map(t => t.date).filter(Boolean);
      const freqResult = detectFrequency(dates);
      
      // Build month history for scoring
      const monthMap = new Map<string, { amount: number; transactions: IncomeTransaction[] }>();
      for (const txn of cluster.transactions) {
        const ym = txn.date.slice(0, 7);
        const existing = monthMap.get(ym) || { amount: 0, transactions: [] };
        existing.amount += txn.amount;
        existing.transactions.push(txn);
        monthMap.set(ym, existing);
      }
      const monthHistory = Array.from(monthMap.entries())
        .map(([ym, data]) => ({ yearMonth: ym, amount: data.amount, transactions: data.transactions }))
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
      
      // Score reliability
      const allMonths = Array.from(new Set(transactions.map(t => t.date.slice(0, 7)))).sort();
      const reliabilityResult = scoreSource(cluster.description, monthHistory, allMonths.length, freqResult);
      
      // Detect transfers and one-offs
      const isTransfer = isLikelyTransfer(cluster.description, cluster.transactions);
      const isOneOffSource = isOneOff(cluster.description, cluster.transactions, allMonths.length);
      
      // Get category (prefer most common category in transactions)
      const categories = cluster.transactions.map(t => t.category).filter(Boolean);
      const categoryCount = new Map<string, number>();
      for (const cat of categories) {
        categoryCount.set(cat!, (categoryCount.get(cat!) || 0) + 1);
      }
      const mostCommonCategory = Array.from(categoryCount.entries())
        .sort((a, b) => b[1] - a[1])[0]?.[0] as IncomeCategory || "Other";
      
      allSources.push({
        description: cluster.description,
        canonicalName: sourceName,
        total,
        count,
        transactions: cluster.transactions,
        frequency: freqResult.frequency,
        reliability: reliabilityResult.reliability,
        reliabilityScore: reliabilityResult.score,
        category: mostCommonCategory,
        isTransfer,
        isOneOff: isOneOffSource,
        avgAmount,
        monthlyEquivalent: computeMonthlyEquivalent(avgAmount, freqResult.frequency)
      });
    }
  }

  // Sort sources by total descending
  allSources.sort((a, b) => b.total - a.total);
  
  // Categorize sources
  const transferSources = allSources.filter(s => s.isTransfer);
  const oneOffSources = allSources.filter(s => s.isOneOff && !s.isTransfer);
  const regularSources = allSources.filter(s => !s.isOneOff && !s.isTransfer);

  // Build monthly history
  const allMonths = Array.from(new Set(transactions.map(t => t.date.slice(0, 7)))).sort();
  const monthlyHistory: MonthlyIncomeSummary[] = allMonths.map(ym => {
    const monthTxns = transactions.filter(t => t.date.startsWith(ym));
    const monthSources = allSources.filter(s => 
      s.transactions.some(t => t.date.startsWith(ym))
    );
    
    const total = monthTxns.reduce((s, t) => s + t.amount, 0);
    const oneOffTotal = monthSources
      .filter(s => s.isOneOff)
      .flatMap(s => s.transactions.filter(t => t.date.startsWith(ym)))
      .reduce((s, t) => s + t.amount, 0);
    const regularTotal = total - oneOffTotal;
    
    return {
      yearMonth: ym,
      total,
      regular: regularTotal,
      oneOff: oneOffTotal,
      sources: monthSources.map(s => ({
        source: s.description,
        amount: s.transactions.filter(t => t.date.startsWith(ym)).reduce((sum, t) => sum + t.amount, 0),
        isOneOff: s.isOneOff
      }))
    };
  });

  // Compute last 3 complete months
  const last3Months = getLastCompleteMonths(allMonths, 3);
  const last3MonthsData = monthlyHistory.filter(m => last3Months.includes(m.yearMonth));
  const last3MonthsRegularTotal = last3MonthsData.reduce((s, m) => s + m.regular, 0);
  const typicalMonthly = last3Months.length > 0 
    ? Math.round(last3MonthsRegularTotal / last3Months.length)
    : 0;
  const last3MonthsTotal = last3MonthsData.reduce((s, m) => s + m.total, 0);

  // Current month totals
  const currentMonthData = monthlyHistory.find(m => m.yearMonth === currentMonth);
  const currentMonthTotal = currentMonthData?.total || 0;
  const currentMonthRegular = currentMonthData?.regular || 0;
  const currentMonthOneOff = currentMonthData?.oneOff || 0;

  // Year-over-year comparison
  let yoy: IncomeComparison | undefined;
  if (last3Months.length === 3) {
    const startMonth = last3Months[0];
    const [year, month] = startMonth.split("-");
    const prevYear = String(parseInt(year) - 1);
    const prevYearMonths = [
      `${prevYear}-${month}`,
      `${prevYear}-${String(parseInt(month) + 1).padStart(2, "0")}`,
      `${prevYear}-${String(parseInt(month) + 2).padStart(2, "0")}`
    ];
    const prevYearData = monthlyHistory.filter(m => prevYearMonths.includes(m.yearMonth));
    if (prevYearData.length === 3) {
      const prevTotal = prevYearData.reduce((s, m) => s + m.regular, 0);
      const currentTotal = last3MonthsRegularTotal;
      yoy = {
        current: currentTotal,
        previous: prevTotal,
        changeAmount: currentTotal - prevTotal,
        changePercent: prevTotal > 0 ? ((currentTotal - prevTotal) / prevTotal) * 100 : 0
      };
    }
  }

  // What changed detection
  const whatChanged: WhatChanged = {};
  
  // Detect missing/late regular sources
  for (const source of regularSources) {
    const lastTxn = source.transactions.sort((a, b) => b.date.localeCompare(a.date))[0];
    if (!lastTxn) continue;
    
    const daysSinceLastDeposit = Math.floor(
      (Date.now() - new Date(lastTxn.date + "T12:00:00").getTime()) / (1000 * 60 * 60 * 24)
    );
    
    const expectedGapDays = source.frequency === "weekly" ? 7
      : source.frequency === "bi-weekly" ? 14
      : source.frequency === "monthly" ? 30
      : source.frequency === "quarterly" ? 90
      : 30;
    
    if (daysSinceLastDeposit > expectedGapDays * 1.5 && source.total > typicalMonthly * 0.15) {
      const expectedDate = new Date(new Date(lastTxn.date).getTime() + expectedGapDays * 24 * 60 * 60 * 1000);
      whatChanged.lateMissing = {
        source: source.description,
        expectedBy: expectedDate.toISOString().slice(0, 10),
        amount: source.avgAmount
      };
      break;
    }
  }
  
  // Detect new sources (appeared in last complete month)
  if (last3Months.length > 0) {
    const lastCompleteMonth = last3Months[last3Months.length - 1];
    for (const source of regularSources) {
      const sourceMonths = Array.from(new Set(source.transactions.map(t => t.date.slice(0, 7)))).sort();
      if (sourceMonths.length === 1 && sourceMonths[0] === lastCompleteMonth && source.total > 100) {
        const firstTxn = source.transactions.sort((a, b) => a.date.localeCompare(b.date))[0];
        whatChanged.newSource = {
          source: source.description,
          firstDate: firstTxn.date,
          amount: source.total
        };
        break;
      }
    }
  }
  
  // Detect notable changes (>20% change in source amount)
  if (last3Months.length === 3) {
    for (const source of regularSources) {
      const last3Txns = source.transactions.filter(t => last3Months.includes(t.date.slice(0, 7)));
      const prev3Months = getLastCompleteMonths(allMonths, 6).slice(0, 3);
      const prev3Txns = source.transactions.filter(t => prev3Months.includes(t.date.slice(0, 7)));
      
      if (last3Txns.length > 0 && prev3Txns.length > 0) {
        const recentAvg = last3Txns.reduce((s, t) => s + t.amount, 0) / last3Txns.length;
        const prevAvg = prev3Txns.reduce((s, t) => s + t.amount, 0) / prev3Txns.length;
        const changePct = ((recentAvg - prevAvg) / prevAvg) * 100;
        
        if (Math.abs(changePct) > 20 && source.total > typicalMonthly * 0.15) {
          whatChanged.notableChange = {
            source: source.description,
            oldAmount: prevAvg,
            newAmount: recentAvg,
            changePercent: changePct
          };
          break;
        }
      }
    }
  }

  return {
    currentMonth,
    currentMonthTotal,
    currentMonthRegular,
    currentMonthOneOff,
    last3Months,
    typicalMonthly,
    last3MonthsTotal,
    allMonths,
    monthlyHistory,
    sources: allSources,
    transferSources,
    oneOffSources,
    regularSources,
    yoy,
    whatChanged,
    currency,
    totalMonthsTracked: allMonths.length
  };
}
