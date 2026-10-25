/**
 * Question Templates — map common questions to data queries.
 *
 * Each template matches question patterns and returns a formatted answer
 * computed from the user's FinancialProfileCache.
 *
 * Architecture: Start with templates for common questions; structure allows
 * adding Claude-powered open-ended Q&A later without changing the interface.
 */

import type { FinancialProfileCache } from "./financialProfile";
import { getCategoryBucket, BUCKET_METADATA } from "./moneyCoachBuckets";
import { isCoreExcluded } from "./spendingMetrics";
import { fmt } from "./currencyUtils";

export interface QuestionTemplate {
  /** Question patterns that trigger this template */
  patterns: string[];
  /** Display label for suggested questions */
  label: string;
  /** Handler that generates the answer from profile data */
  handler: (profile: FinancialProfileCache) => string;
}

/**
 * Format currency with k/M suffix.
 */
function fmtShort(amount: number, currency: string): string {
  const abs = Math.abs(amount);
  if (abs >= 1_000_000) {
    return `${currency === "CAD" ? "C" : ""}$${(abs / 1_000_000).toFixed(1)}M`;
  }
  if (abs >= 1_000) {
    return `${currency === "CAD" ? "C" : ""}$${Math.round(abs / 1_000)}k`;
  }
  return fmt(amount, currency);
}

/**
 * Compute median of positive values.
 */
function median(values: number[]): number {
  const filtered = values.filter(v => v > 0);
  if (filtered.length === 0) return 0;
  const sorted = [...filtered].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * All question templates.
 */
export const QUESTION_TEMPLATES: QuestionTemplate[] = [
  {
    patterns: [
      "where is my money going",
      "spending breakdown",
      "top categories",
      "what am i spending on",
      "biggest expenses",
    ],
    label: "Where is my money going?",
    handler: (profile) => {
      const { expenseTxns, homeCurrency } = profile;
      
      // Group by category
      const byCategory = new Map<string, number>();
      for (const txn of expenseTxns) {
        if (isCoreExcluded(txn.category)) continue;
        const current = byCategory.get(txn.category) || 0;
        byCategory.set(txn.category, current + Math.abs(txn.amount));
      }
      
      // Get top 3
      const sorted = Array.from(byCategory.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3);
      
      if (sorted.length === 0) {
        return "You don't have enough transaction data yet. Upload more statements to see your spending breakdown.";
      }
      
      const total = Array.from(byCategory.values()).reduce((sum, v) => sum + v, 0);
      const top3Pct = sorted.reduce((sum, [, amt]) => sum + amt, 0) / total * 100;
      
      const lines = sorted.map(([cat, amt]) => `**${cat}** (${fmt(amt, homeCurrency)})`);
      
      return `Your top spending categories are: ${lines.join(", ")}. Together, they account for ${Math.round(top3Pct)}% of your total spending.`;
    },
  },
  
  {
    patterns: [
      "am i saving enough",
      "savings rate",
      "how much am i saving",
      "should i save more",
    ],
    label: "Am I saving enough?",
    handler: (profile) => {
      const { monthlyHistory, homeCurrency } = profile;
      
      if (monthlyHistory.length === 0) {
        return "Upload statements to see your savings rate.";
      }
      
      // Compute savings rate from monthly history
      const rates = monthlyHistory
        .filter(h => h.incomeTotal > 0)
        .map(h => {
          const spending = h.coreExpensesTotal;
          const income = h.incomeTotal;
          return (income - spending) / income;
        });
      
      if (rates.length === 0) {
        return "Not enough income data to calculate your savings rate.";
      }
      
      const avgRate = rates.reduce((sum, r) => sum + r, 0) / rates.length;
      const ratePct = Math.round(avgRate * 100);
      
      const latest = monthlyHistory[monthlyHistory.length - 1];
      const monthlySavings = latest.incomeTotal - latest.coreExpensesTotal;
      
      if (ratePct >= 20) {
        return `You're saving **${ratePct}%** of your income (about ${fmt(monthlySavings, homeCurrency)}/month). That's above the recommended 15-20% — great job!`;
      }
      
      if (ratePct >= 15) {
        return `You're saving **${ratePct}%** of your income (about ${fmt(monthlySavings, homeCurrency)}/month). You're right on track with the 15-20% guideline.`;
      }
      
      if (ratePct >= 10) {
        const target = 0.15;
        const gap = latest.incomeTotal * target - monthlySavings;
        return `You're saving **${ratePct}%** of your income (about ${fmt(monthlySavings, homeCurrency)}/month). Financial advisors recommend 15-20%. To hit 15%, you'd need to save an extra ${fmt(gap, homeCurrency)}/month.`;
      }
      
      if (ratePct > 0) {
        const target = 0.15;
        const gap = latest.incomeTotal * target - monthlySavings;
        return `You're saving **${ratePct}%** of your income (about ${fmt(monthlySavings, homeCurrency)}/month). That's below the recommended 15-20%. Look for ways to cut spending — even saving an extra ${fmt(gap, homeCurrency)}/month would get you to 15%.`;
      }
      
      return `Your spending is currently exceeding your income. Focus on cutting discretionary expenses to avoid going further into debt.`;
    },
  },
  
  {
    patterns: [
      "what subscriptions",
      "recurring charges",
      "subscriptions i'm paying",
      "monthly subscriptions",
    ],
    label: "What subscriptions am I paying for?",
    handler: (profile) => {
      const { expenseTxns, homeCurrency } = profile;
      
      // Get subscription category transactions
      const subscriptions = expenseTxns.filter(t => t.category === "Subscriptions");
      
      if (subscriptions.length === 0) {
        return "I haven't detected any subscriptions yet. Upload more statements or manually categorize recurring charges as 'Subscriptions'.";
      }
      
      // Group by merchant
      const byMerchant = new Map<string, { count: number; total: number }>();
      for (const txn of subscriptions) {
        const merchant = txn.merchant || "Unknown";
        const current = byMerchant.get(merchant) || { count: 0, total: 0 };
        byMerchant.set(merchant, {
          count: current.count + 1,
          total: current.total + Math.abs(txn.amount),
        });
      }
      
      // Sort by total amount
      const sorted = Array.from(byMerchant.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .slice(0, 10);
      
      const totalPerMonth = sorted.reduce((sum, [, data]) => {
        // Estimate monthly by dividing by number of months in history
        const months = Math.max(1, profile.monthlyHistory.length);
        return sum + data.total / months;
      }, 0);
      
      const topList = sorted.slice(0, 5).map(([merchant, data]) => {
        const perMonth = data.total / Math.max(1, profile.monthlyHistory.length);
        return `**${merchant}** (~${fmt(perMonth, homeCurrency)}/mo)`;
      }).join(", ");
      
      return `I found ${sorted.length} recurring subscriptions totaling about ${fmt(totalPerMonth, homeCurrency)}/month: ${topList}${sorted.length > 5 ? `, and ${sorted.length - 5} more` : ""}.`;
    },
  },
  
  {
    patterns: [
      "how does my spending compare",
      "vs last month",
      "spending trend",
      "spending more or less",
    ],
    label: "How does my spending compare to last month?",
    handler: (profile) => {
      const { monthlyHistory, homeCurrency } = profile;
      
      if (monthlyHistory.length < 2) {
        return "Upload at least 2 months of statements to compare spending trends.";
      }
      
      const latest = monthlyHistory[monthlyHistory.length - 1];
      const previous = monthlyHistory[monthlyHistory.length - 2];
      
      const diff = latest.coreExpensesTotal - previous.coreExpensesTotal;
      const diffPct = previous.coreExpensesTotal > 0 
        ? Math.round((diff / previous.coreExpensesTotal) * 100)
        : 0;
      
      const latestMonth = new Date(latest.yearMonth + "-01").toLocaleDateString("en-US", { month: "long" });
      const prevMonth = new Date(previous.yearMonth + "-01").toLocaleDateString("en-US", { month: "long" });
      
      if (Math.abs(diffPct) < 5) {
        return `Your spending in ${latestMonth} was **${fmt(latest.coreExpensesTotal, homeCurrency)}**, about the same as ${prevMonth}'s **${fmt(previous.coreExpensesTotal, homeCurrency)}**. Your spending is stable.`;
      }
      
      if (diff > 0) {
        return `You spent **${fmt(Math.abs(diff), homeCurrency)} more** in ${latestMonth} (${fmt(latest.coreExpensesTotal, homeCurrency)}) than in ${prevMonth} (${fmt(previous.coreExpensesTotal, homeCurrency)}) — up ${diffPct}%. Look at your top categories to see what drove the increase.`;
      }
      
      return `You spent **${fmt(Math.abs(diff), homeCurrency)} less** in ${latestMonth} (${fmt(latest.coreExpensesTotal, homeCurrency)}) than in ${prevMonth} (${fmt(previous.coreExpensesTotal, homeCurrency)}) — down ${Math.abs(diffPct)}%. Great job cutting back!`;
    },
  },
  
  {
    patterns: [
      "biggest expense",
      "what's my largest expense",
      "most expensive category",
    ],
    label: "What's my biggest expense category?",
    handler: (profile) => {
      const { expenseTxns, homeCurrency, monthlyHistory } = profile;
      
      if (expenseTxns.length === 0) {
        return "Upload statements to see your expense breakdown.";
      }
      
      // Group by category
      const byCategory = new Map<string, number>();
      for (const txn of expenseTxns) {
        if (isCoreExcluded(txn.category)) continue;
        const current = byCategory.get(txn.category) || 0;
        byCategory.set(txn.category, current + Math.abs(txn.amount));
      }
      
      const sorted = Array.from(byCategory.entries())
        .sort((a, b) => b[1] - a[1]);
      
      if (sorted.length === 0) {
        return "No expense data available yet.";
      }
      
      const [topCategory, topAmount] = sorted[0];
      const total = sorted.reduce((sum, [, amt]) => sum + amt, 0);
      const pct = Math.round((topAmount / total) * 100);
      
      // Estimate monthly average
      const months = Math.max(1, monthlyHistory.length);
      const perMonth = topAmount / months;
      
      return `**${topCategory}** is your biggest expense at ${fmt(topAmount, homeCurrency)} total (about ${fmt(perMonth, homeCurrency)}/month), accounting for ${pct}% of your spending.`;
    },
  },
];

/**
 * Match a question to a template and return the answer.
 * Returns null if no template matches.
 */
export function answerQuestion(question: string, profile: FinancialProfileCache): string | null {
  const normalized = question.toLowerCase().trim();
  
  for (const template of QUESTION_TEMPLATES) {
    for (const pattern of template.patterns) {
      if (normalized.includes(pattern)) {
        return template.handler(profile);
      }
    }
  }
  
  return null;
}

/**
 * Get suggested questions for the UI.
 */
export function getSuggestedQuestions(): string[] {
  return QUESTION_TEMPLATES.map(t => t.label);
}
