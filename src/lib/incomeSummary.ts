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
import { getLastCompleteMonth, getCurrentMonth } from "./monthAnchor";

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
  /** Total income (regular + bonus, excluding not_income) */
  total: number;
  /** Regular income */
  regular: number;
  /** One-off income (for backwards compatibility - same as bonus now) */
  oneOff: number;
  /** Bonus income (unusual deposits classified as bonus or unreviewed) */
  bonus: number;
  /** Per-source breakdown */
  sources: { source: string; amount: number; isOneOff: boolean; isBonus?: boolean }[];
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
  /** Current month bonus only */
  currentMonthBonus: number;
  
  /** Last 3 complete months */
  last3Months: string[];
  /** Average per month (regular + bonus, excluding not_income), last 3 complete months */
  typicalMonthly: number;
  /** Total across last 3 complete months (regular + bonus) */
  last3MonthsTotal: number;
  /** Bonus total across last 3 complete months */
  last3MonthsBonus: number;
  
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
  /** Transactions classified as bonus */
  bonusTransactions: IncomeTransaction[];
  /** Unusual deposits needing review (unusual_amount: counted by default, large_refund: excluded by default) */
  unreviewedDeposits: Array<{
    txId: string;
    source: string;
    date: string;
    amount: number;
    usualAmount?: number;
    reason?: "unusual_amount" | "large_refund";
  }>;
  
  /** Year-over-year comparison (if available) */
  yoy?: IncomeComparison;
  
  /** What changed detection */
  whatChanged: WhatChanged;
  
  /** Currency */
  currency: string;
  
  /** Total tracked months */
  totalMonthsTracked: number;
}

/** Helper to get last N complete months (excluding current, anchored to last complete month) */
function getLastCompleteMonths(allMonths: string[], n: number): string[] {
  const lastComplete = getLastCompleteMonth();
  const complete = allMonths.filter(m => m <= lastComplete);
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
  
  // Single-occurrence sources must never be "regular" if we have enough history
  // Need at least 3 months of data to confidently say something is one-off
  if (uniqueMonths.size === 1 && totalMonthsTracked >= 3) {
    return true;
  }
  
  // If it appears in multiple months, it's recurring - don't mark as one-off
  // even if it contains keywords like "CRA" (could be recurring CRA payments)
  if (uniqueMonths.size >= 2) {
    return false;
  }
  
  // Check for one-time keywords (only for single-month sources with enough history)
  if (totalMonthsTracked >= 3) {
    const lower = source.toLowerCase();
    const ONE_TIME_KEYWORDS = [
      "cra", "gst", "hst", "refund", "rebate", "tax return", "ccb", "canada child",
      "oas", "cerb", "ei benefit", "ei payment", "stimulus", "benefit payment", "bonus"
    ];
    return ONE_TIME_KEYWORDS.some(k => lower.includes(k));
  }
  
  return false;
}

/**
 * Detect outlier transactions within a recurring source (bonuses, one-time payments).
 * Returns a set of transaction identifiers (date+amount) that are one-offs.
 * 
 * Rule: A deposit more than 1.5x (or >40% off) the source's median is a one-off.
 */
function detectWithinSourceOneOffs(
  transactions: IncomeTransaction[]
): Set<string> {
  const result = new Set<string>();
  
  if (transactions.length <= 2) {
    // Not enough data to detect outliers
    return result;
  }
  
  // Calculate median amount
  const amounts = transactions.map(t => t.amount).sort((a, b) => a - b);
  const mid = Math.floor(amounts.length / 2);
  const median = amounts.length % 2 !== 0
    ? amounts[mid]
    : (amounts[mid - 1] + amounts[mid]) / 2;
  
  if (median === 0) {
    return result;
  }
  
  // Mark transactions that are >1.5x median or >40% different
  for (const txn of transactions) {
    const ratio = txn.amount / median;
    const diffPct = Math.abs((txn.amount - median) / median);
    
    if (ratio > 1.5 || diffPct > 0.4) {
      // Use date+amount as unique identifier
      result.add(`${txn.date}:${txn.amount}`);
    }
  }
  
  return result;
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
 * 
 * @param incomeDepositReviews - Map of transaction ID → classification for unusual deposits
 *                                 Classifications: "regular_income", "bonus", "not_income"
 *                                 Default behavior: unreviewed deposits COUNT as income (bonus)
 */
export function buildIncomeSummary(
  incomeTxns: IncomeTxnRecord[],
  accountSnapshots: AccountSnapshot[],
  currency: string = "USD",
  incomeDepositReviews: Map<string, string> = new Map()
): IncomeSummary {
  const currentMonth = getCurrentMonth();
  
  // Helper: Generate stable transaction ID for review matching
  const getTxId = (txn: IncomeTransaction): string => {
    return `${txn.date}:${txn.source}:${txn.amount}:${txn.accountSlug || 'unknown'}`;
  };
  
  // Convert to simpler transaction format with IDs
  const transactions: (IncomeTransaction & { txId: string })[] = incomeTxns.map(t => ({
    source: t.source || "Unknown",
    amount: t.amount,
    date: t.date,
    category: (t.category as IncomeCategory) || "Other",
    accountLabel: accountSnapshots.find(a => a.slug === t.accountSlug)?.accountName || t.accountSlug,
    accountSlug: t.accountSlug,
    txId: `${t.date}:${t.source || 'Unknown'}:${t.amount}:${t.accountSlug || 'unknown'}`
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
      
      // Detect transfers and source-level one-offs
      const isTransfer = isLikelyTransfer(cluster.description, cluster.transactions);
      const isOneOffSource = isOneOff(cluster.description, cluster.transactions, allMonths.length);
      
      // Detect within-source one-offs (bonuses, irregular large deposits)
      const withinSourceOneOffs = detectWithinSourceOneOffs(cluster.transactions);
      
      // Split transactions into regular and one-off
      const regularTransactions = cluster.transactions.filter(
        t => !withinSourceOneOffs.has(`${t.date}:${t.amount}`)
      );
      const oneOffTransactions = cluster.transactions.filter(
        t => withinSourceOneOffs.has(`${t.date}:${t.amount}`)
      );
      
      // Calculate amounts for regular transactions only
      const regularTotal = regularTransactions.reduce((s, t) => s + t.amount, 0);
      const regularAvgAmount = regularTransactions.length > 0 
        ? regularTotal / regularTransactions.length 
        : avgAmount;
      
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
        avgAmount: regularAvgAmount,
        monthlyEquivalent: computeMonthlyEquivalent(regularAvgAmount, freqResult.frequency)
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
  
  // Track bonus transactions and unreviewed deposits
  const bonusTransactions: IncomeTransaction[] = [];
  const unreviewedDeposits: Array<{ txId: string; source: string; date: string; amount: number; usualAmount?: number; reason?: "unusual_amount" | "large_refund" }> = [];
  
  const monthlyHistory: MonthlyIncomeSummary[] = allMonths.map(ym => {
    const monthTxns = transactions.filter(t => t.date.startsWith(ym));
    
    // Split into regular, bonus, and excluded at the transaction level
    let regularTotal = 0;
    let bonusTotal = 0;
    
    for (const source of allSources) {
      const sourceTxnsThisMonth = source.transactions.filter(t => t.date.startsWith(ym));
      
      // Skip transfers entirely - they should not be in month totals
      if (source.isTransfer) {
        continue;
      }
      
      // Only check for unusual deposits in REGULAR income sources (not transfers, not one-offs)
      const shouldCheckForUnusual = !source.isTransfer && !source.isOneOff;
      const withinSourceOneOffs = shouldCheckForUnusual ? detectWithinSourceOneOffs(source.transactions) : new Set<string>();
      
      for (const txn of sourceTxnsThisMonth) {
        const txnKey = `${txn.date}:${txn.amount}`;
        const txnWithId = transactions.find(t => 
          t.date === txn.date && 
          t.source === txn.source && 
          t.amount === txn.amount &&
          t.accountSlug === txn.accountSlug
        );
        const txId = txnWithId?.txId || '';
        const classification = incomeDepositReviews.get(txId);
        
        // Check if this is a large refund that needs review
        const sourceLower = txn.source.toLowerCase();
        const isRefund = sourceLower.includes('refund') || sourceLower.includes('rebate') || sourceLower.includes('reversal');
        
        // Calculate source's typical amount for threshold comparison (only for multi-transaction sources)
        const sourceMedianAmount = (() => {
          const amounts = source.transactions.map(t => t.amount).sort((a, b) => a - b);
          if (amounts.length < 2) return 0; // Need multiple transactions to establish "typical"
          const mid = Math.floor(amounts.length / 2);
          return amounts.length % 2 !== 0 ? amounts[mid] : (amounts[mid - 1] + amounts[mid]) / 2;
        })();
        
        // Large refund: >$1K OR (>50% of source's typical AND source has established pattern)
        const isLargeRefund = isRefund && (txn.amount > 1000 || (sourceMedianAmount > 0 && txn.amount > sourceMedianAmount * 0.5));
        
        // Only flag as unusual if from a regular source AND detected as outlier
        const isUnusual = shouldCheckForUnusual && withinSourceOneOffs.has(txnKey);
        
        // Large refunds need review (default: NOT counted)
        if (isLargeRefund && !classification) {
          // Unreviewed large refund - add to review list, exclude from totals
          if (!unreviewedDeposits.some(d => d.txId === txId)) {
            unreviewedDeposits.push({
              txId,
              source: txn.source,
              date: txn.date,
              amount: txn.amount,
              reason: 'large_refund'
            });
          }
          // Don't count in totals until reviewed (opposite of unusual deposits)
          continue;
        }
        
        if (isUnusual || isLargeRefund) {
          // Unusual deposit or large refund - check classification
          if (classification === 'not_income') {
            // Exclude completely
            continue;
          } else if (classification === 'regular_income') {
            // User marked as regular - treat as normal income
            regularTotal += txn.amount;
          } else if (classification === 'bonus') {
            // User marked as bonus - count and tag
            bonusTotal += txn.amount;
            if (txnWithId) bonusTransactions.push(txnWithId);
          } else {
            // Unreviewed unusual deposit (NOT refund) - count as income (needs review)
            if (!isLargeRefund) {
              bonusTotal += txn.amount;
              
              // Add to unreviewed list (once per transaction, not per month)
              if (!unreviewedDeposits.some(d => d.txId === txId)) {
                // Calculate usual amount (median of other transactions from this source)
                const otherAmounts = source.transactions
                  .filter(t => !withinSourceOneOffs.has(`${t.date}:${t.amount}`))
                  .map(t => t.amount)
                  .sort((a, b) => a - b);
                const usualAmount = otherAmounts.length > 0
                  ? otherAmounts[Math.floor(otherAmounts.length / 2)]
                  : undefined;
                  
                unreviewedDeposits.push({
                  txId,
                  source: txn.source,
                  date: txn.date,
                  amount: txn.amount,
                  usualAmount,
                  reason: 'unusual_amount'
                });
              }
            }
          }
        } else {
          // Normal transaction - add to regular total
          regularTotal += txn.amount;
        }
      }
    }
    
    const total = regularTotal + bonusTotal;
    
    return {
      yearMonth: ym,
      total,
      regular: regularTotal,
      oneOff: bonusTotal, // For backwards compatibility
      bonus: bonusTotal,
      sources: allSources
        .filter(s => s.transactions.some(t => t.date.startsWith(ym)))
        .map(s => {
          const sourceTxnsThisMonth = s.transactions.filter(t => t.date.startsWith(ym));
          const shouldCheckForUnusual = !s.isTransfer && !s.isOneOff;
          const withinSourceOneOffs = shouldCheckForUnusual ? detectWithinSourceOneOffs(s.transactions) : new Set<string>();
          const amount = sourceTxnsThisMonth.reduce((sum, t) => sum + t.amount, 0);
          const hasOneOff = shouldCheckForUnusual && sourceTxnsThisMonth.some(t => withinSourceOneOffs.has(`${t.date}:${t.amount}`));
          
          // Check if any transactions are bonus (only for regular sources)
          const hasBonus = shouldCheckForUnusual && sourceTxnsThisMonth.some(t => {
            const txnWithId = transactions.find(tx => 
              tx.date === t.date && 
              tx.source === t.source && 
              tx.amount === t.amount &&
              tx.accountSlug === t.accountSlug
            );
            const txId = txnWithId?.txId || '';
            return incomeDepositReviews.get(txId) === 'bonus' || 
                   (withinSourceOneOffs.has(`${t.date}:${t.amount}`) && !incomeDepositReviews.has(txId));
          });
          
          return {
            source: s.description,
            amount,
            isOneOff: s.isOneOff || hasOneOff,
            isBonus: hasBonus
          };
        })
    };
  });

  // Compute last 3 complete months (regular + bonus)
  const last3Months = getLastCompleteMonths(allMonths, 3);
  const last3MonthsData = monthlyHistory.filter(m => last3Months.includes(m.yearMonth));
  const last3MonthsRegularTotal = last3MonthsData.reduce((s, m) => s + m.regular, 0);
  const last3MonthsBonusTotal = last3MonthsData.reduce((s, m) => s + m.bonus, 0);
  const last3MonthsTotal = last3MonthsRegularTotal + last3MonthsBonusTotal;
  const typicalMonthly = last3Months.length > 0 
    ? Math.round(last3MonthsTotal / last3Months.length)
    : 0;

  // Current month totals (including bonus)
  const currentMonthData = monthlyHistory.find(m => m.yearMonth === currentMonth);
  const currentMonthTotal = currentMonthData?.total || 0;
  const currentMonthRegular = currentMonthData?.regular || 0;
  const currentMonthOneOff = currentMonthData?.oneOff || 0;
  const currentMonthBonus = currentMonthData?.bonus || 0;

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
    currentMonthBonus,
    last3Months,
    typicalMonthly,
    last3MonthsTotal,
    last3MonthsBonus: last3MonthsBonusTotal,
    allMonths,
    monthlyHistory,
    sources: allSources,
    transferSources,
    oneOffSources,
    regularSources,
    bonusTransactions,
    unreviewedDeposits,
    yoy,
    whatChanged,
    currency,
    totalMonthsTracked: allMonths.length
  };
}
