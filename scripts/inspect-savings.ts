#!/usr/bin/env node
/**
 * Read-only savings calculation inspector.
 * 
 * Usage: npx tsx --env-file=.env.local scripts/inspect-savings.ts <uid>
 * 
 * Loads real profile data and shows:
 * - computeMonthlySavings broken into components
 * - computeAssetGains
 * - Average savings
 * - Comparison with current card logic (income - spending)
 * 
 * Writes nothing except possibly rebuilding stale cache.
 */

import * as admin from "firebase-admin";
import { getFinancialProfile } from "../src/lib/financialProfile";
import { computeMonthlySavings, computeAssetGains, computeAverageSavings } from "../src/lib/savingsCalculations";
import { getMoneyCoachIncome } from "../src/lib/incomeMetrics";
import { isCoreExcluded } from "../src/lib/spendingMetrics";
import type { ExpenseTxnRecord, AccountSnapshot } from "../src/lib/extractTransactions";

// Parse CLI args first
const args = process.argv.slice(2);
if (args.length === 0) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/inspect-savings.ts <uid>");
  process.exit(1);
}

const uid = args[0];

// Initialize Firebase Admin
if (!admin.apps.length) {
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    console.error("❌ Missing Firebase credentials in environment:");
    console.error("   NEXT_PUBLIC_FIREBASE_PROJECT_ID:", projectId ? "✓" : "✗");
    console.error("   FIREBASE_CLIENT_EMAIL:", clientEmail ? "✓" : "✗");
    console.error("   FIREBASE_PRIVATE_KEY:", privateKey ? "✓" : "✗");
    process.exit(1);
  }

  admin.initializeApp({
    credential: admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    }),
  });
}

const db = admin.firestore();

/**
 * Format currency (CAD default).
 */
function fmt(amount: number, currency = "CAD"): string {
  const symbol = currency === "USD" ? "$" : "CA$";
  return `${symbol}${amount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/**
 * Get the last 3 complete months (exclude current incomplete month).
 */
function getLast3CompleteMonths(): string[] {
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  
  const months: string[] = [];
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    months.push(ym);
  }
  
  return months.reverse(); // Chronological order
}

/**
 * Compute savings components for one month (detailed breakdown).
 */
function computeSavingsComponents(
  monthlyHistory: any[],
  accountSnapshots: AccountSnapshot[],
  expenseTxns: ExpenseTxnRecord[],
  month: string
): {
  contributions: number;
  contributionTxns: Array<{ merchant: string; amount: number; category: string }>;
  cashGrowth: number;
  cashGrowthByAccount: Array<{ accountLabel: string; growth: number }>;
  debtPrincipal: number;
  debtPrincipalByAccount: Array<{ accountLabel: string; reduction: number }>;
  total: number;
} {
  // Find prior month
  const priorMonths = monthlyHistory.filter(h => h.yearMonth < month).sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));
  const prior = priorMonths[0];
  
  if (!prior) {
    return {
      contributions: 0,
      contributionTxns: [],
      cashGrowth: 0,
      cashGrowthByAccount: [],
      debtPrincipal: 0,
      debtPrincipalByAccount: [],
      total: 0,
    };
  }

  const currentSnaps = accountSnapshots.filter(s => s.statementMonth === month);
  const priorSnaps = accountSnapshots.filter(s => s.statementMonth === prior.yearMonth);
  
  // Component 1: Contributions
  const contributionTxns = expenseTxns
    .filter(t => {
      if (t.txMonth !== month) return false;
      if (isCoreExcluded(t.category)) return false;
      // Check if parent is "Investments & Savings"
      const { getParentCategory } = require("../src/lib/categoryTaxonomy");
      return getParentCategory(t.category) === "Investments & Savings";
    })
    .map(t => ({
      merchant: t.merchant,
      amount: Math.abs(t.amount),
      category: t.category,
    }));
  
  const contributions = contributionTxns.reduce((sum, t) => sum + t.amount, 0);

  // Component 2: Cash growth in checking/savings accounts
  const isCashAccount = (type: string) => {
    const t = type.toLowerCase();
    return t === "checking" || t === "savings" || t === "chequing";
  };
  
  const cashGrowthByAccount: Array<{ accountLabel: string; growth: number }> = [];
  let cashGrowth = 0;
  
  for (const current of currentSnaps) {
    if (isCashAccount(current.accountType)) {
      const priorSnap = priorSnaps.find(p => p.slug === current.slug);
      if (priorSnap) {
        const growth = current.balance - priorSnap.balance;
        if (growth > 0) {
          cashGrowth += growth;
          cashGrowthByAccount.push({
            accountLabel: current.accountName || current.slug,
            growth,
          });
        }
      }
    }
  }

  // Component 3: Debt principal paid down
  const isDebtAccount = (type: string) => {
    const t = type.toLowerCase();
    return t === "credit" || t === "loan" || t === "mortgage" || t === "loc";
  };
  
  const debtPrincipalByAccount: Array<{ accountLabel: string; reduction: number }> = [];
  let debtPrincipal = 0;
  
  for (const current of currentSnaps) {
    if (isDebtAccount(current.accountType)) {
      const priorSnap = priorSnaps.find(p => p.slug === current.slug);
      if (priorSnap) {
        const reduction = Math.abs(priorSnap.balance) - Math.abs(current.balance);
        if (reduction > 0) {
          debtPrincipal += reduction;
          debtPrincipalByAccount.push({
            accountLabel: current.accountName || current.slug,
            reduction,
          });
        }
      }
    }
  }

  // Normalize by months elapsed
  const monthsElapsed = Math.max(1, (new Date(month + "-01").getTime() - new Date(prior.yearMonth + "-01").getTime()) / (1000 * 60 * 60 * 24 * 30));
  const monthsElapsedRounded = Math.round(monthsElapsed);
  
  return {
    contributions: contributions / monthsElapsedRounded,
    contributionTxns,
    cashGrowth: cashGrowth / monthsElapsedRounded,
    cashGrowthByAccount: cashGrowthByAccount.map(a => ({ ...a, growth: a.growth / monthsElapsedRounded })),
    debtPrincipal: debtPrincipal / monthsElapsedRounded,
    debtPrincipalByAccount: debtPrincipalByAccount.map(a => ({ ...a, reduction: a.reduction / monthsElapsedRounded })),
    total: (contributions + cashGrowth + debtPrincipal) / monthsElapsedRounded,
  };
}

/**
 * Compute current card logic (income - spending).
 */
function computeCurrentCardLogic(
  monthlyHistory: any[],
  expenseTxns: ExpenseTxnRecord[],
  months: string[]
): { savings: number; savingsRate: number; income: number; spending: number } {
  const { amount: incomeAmount } = getMoneyCoachIncome(monthlyHistory);
  
  // Total spending (excluding transfers)
  const spending = expenseTxns
    .filter(t => months.includes(t.txMonth) && !isCoreExcluded(t.category))
    .reduce((sum, t) => sum + Math.abs(t.amount), 0);
  
  const avgSpending = months.length > 0 ? spending / months.length : 0;
  const savings = incomeAmount - avgSpending;
  const savingsRate = incomeAmount > 0 ? savings / incomeAmount : 0;
  
  return { savings, savingsRate, income: incomeAmount, spending: avgSpending };
}

/**
 * Main inspection routine.
 */
async function inspect(uid: string) {
  console.log("🔍 Savings Calculation Inspector\n");
  console.log(`User ID: ${uid}`);
  console.log(`Loading financial profile...\n`);

  const profile = await getFinancialProfile(uid, db);
  
  if (!profile || profile.monthlyHistory.length === 0) {
    console.error("❌ No financial data found for this user.");
    process.exit(1);
  }

  const months = getLast3CompleteMonths();
  console.log(`📅 Inspecting last 3 complete months: ${months.join(", ")}\n`);
  console.log("═".repeat(80));

  // Per-month breakdown
  for (const month of months) {
    console.log(`\n📊 ${month}`);
    console.log("─".repeat(80));
    
    const components = computeSavingsComponents(
      profile.monthlyHistory,
      profile.accountSnapshots,
      profile.expenseTxns,
      month
    );
    
    const gains = computeAssetGains(
      profile.monthlyHistory,
      profile.accountSnapshots,
      profile.expenseTxns,
      month
    );
    
    const actualSavings = computeMonthlySavings(
      profile.monthlyHistory,
      profile.accountSnapshots,
      profile.expenseTxns,
      month
    );

    console.log(`\n  💰 computeMonthlySavings() = ${fmt(actualSavings)}\n`);
    
    console.log(`  Component Breakdown:`);
    console.log(`    1️⃣  Contributions:          ${fmt(components.contributions)}`);
    if (components.contributionTxns.length > 0) {
      for (const txn of components.contributionTxns.slice(0, 5)) {
        console.log(`        • ${txn.merchant.padEnd(30)} ${fmt(txn.amount).padStart(12)} (${txn.category})`);
      }
      if (components.contributionTxns.length > 5) {
        console.log(`        ... and ${components.contributionTxns.length - 5} more`);
      }
    } else {
      console.log(`        (none)`);
    }
    
    console.log(`\n    2️⃣  Cash growth (bank accounts): ${fmt(components.cashGrowth)}`);
    if (components.cashGrowthByAccount.length > 0) {
      for (const acc of components.cashGrowthByAccount) {
        console.log(`        • ${acc.accountLabel.padEnd(30)} ${fmt(acc.growth).padStart(12)}`);
      }
    } else {
      console.log(`        (none)`);
    }
    
    console.log(`\n    3️⃣  Debt principal paid:       ${fmt(components.debtPrincipal)}`);
    if (components.debtPrincipalByAccount.length > 0) {
      for (const acc of components.debtPrincipalByAccount) {
        console.log(`        • ${acc.accountLabel.padEnd(30)} ${fmt(acc.reduction).padStart(12)}`);
      }
    } else {
      console.log(`        (none)`);
    }
    
    console.log(`\n  📈 computeAssetGains():`);
    console.log(`      Market gains:              ${fmt(gains.marketGains)}`);
    console.log(`      Manual asset changes:      ${fmt(gains.manualAssetChanges)}`);
    console.log(`      Total gains:               ${fmt(gains.totalGains)}`);
  }

  // Average
  console.log("\n" + "═".repeat(80));
  const avgSavings = computeAverageSavings(
    profile.monthlyHistory,
    profile.accountSnapshots,
    profile.expenseTxns,
    months
  );
  console.log(`\n📊 AVERAGE (Last 3 Months):`);
  console.log(`   computeAverageSavings() = ${fmt(avgSavings)}/mo\n`);

  // Current card logic (for comparison)
  const cardLogic = computeCurrentCardLogic(profile.monthlyHistory, profile.expenseTxns, months);
  console.log(`💳 Current Card Logic (for comparison):`);
  console.log(`   Income:                   ${fmt(cardLogic.income)}/mo`);
  console.log(`   Spending:                 ${fmt(cardLogic.spending)}/mo`);
  console.log(`   Savings (income - spend): ${fmt(cardLogic.savings)}/mo`);
  console.log(`   Savings rate:             ${(cardLogic.savingsRate * 100).toFixed(1)}%`);
  
  console.log("\n" + "═".repeat(80));
  console.log(`\n✅ Inspection complete. No data was modified.\n`);
}

// Run inspection
inspect(uid).catch((error) => {
  console.error("❌ Error:", error.message);
  console.error(error.stack);
  process.exit(1);
});
