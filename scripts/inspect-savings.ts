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
import { getFinancialProfile, type AccountBalanceHistory } from "../src/lib/financialProfile";
import { computeMonthlySavings, computeAssetGains, computeAverageSavings, type MonthlySavingsResult } from "../src/lib/savingsCalculations";
import { getMoneyCoachIncome } from "../src/lib/incomeMetrics";
import { isCoreExcluded } from "../src/lib/spendingMetrics";
import type { ExpenseTxnRecord } from "../src/lib/extractTransactions";

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
 * Compute current card logic (income - spending).
 */
function computeCurrentCardLogic(
  monthlyHistory: any[],
  expenseTxns: ExpenseTxnRecord[],
  incomeTxns: any[],
  accountSnapshots: any[],
  currency: string,
  incomeDepositReviews: Map<string, string>,
  months: string[]
): { savings: number; savingsRate: number; income: number; spending: number } {
  const { amount: incomeAmount } = getMoneyCoachIncome(
    monthlyHistory,
    incomeTxns,
    accountSnapshots,
    currency,
    incomeDepositReviews
  );
  
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
  console.log("🔍 Savings Calculation Inspector (NET Approach)\n");
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
    
    const result = computeMonthlySavings(
      profile.monthlyHistory,
      profile.accountBalanceHistory,
      profile.expenseTxns,
      month
    );
    
    const gains = computeAssetGains(
      profile.monthlyHistory,
      profile.accountBalanceHistory,
      profile.expenseTxns,
      month
    );

    console.log(`\n  💰 computeMonthlySavings() = ${fmt(result.total)}\n`);
    
    // Component 1: Cash accounts
    console.log(`  💵 CASH ACCOUNTS (NET CHANGE: ${fmt(result.netCashChange)}):`);
    if (result.details.cashAccounts.length > 0) {
      for (const acc of result.details.cashAccounts) {
        const priorFlag = acc.priorCarriedForward ? " [carried forward]" : "";
        const currentFlag = acc.currentCarriedForward ? " [carried forward]" : "";
        console.log(`      • ${acc.accountLabel}`);
        console.log(`        Prior:   ${fmt(acc.priorBalance).padStart(12)}${priorFlag}`);
        console.log(`        Current: ${fmt(acc.currentBalance).padStart(12)}${currentFlag}`);
        console.log(`        Change:  ${fmt(acc.change).padStart(12)} ${acc.change >= 0 ? "✓" : "⚠️"}`);
      }
    } else {
      console.log(`      (no cash accounts tracked)\n`);
    }
    
    // Component 2: Debt accounts
    console.log(`\n  💳 DEBT ACCOUNTS (NET CHANGE: ${fmt(result.netDebtChange)}):`);
    if (result.details.debtAccounts.length > 0) {
      for (const acc of result.details.debtAccounts) {
        const priorFlag = acc.priorCarriedForward ? " [carried forward]" : "";
        const currentFlag = acc.currentCarriedForward ? " [carried forward]" : "";
        const changeLabel = acc.change > 0 ? "paid down" : acc.change < 0 ? "new borrowing" : "no change";
        console.log(`      • ${acc.accountLabel}`);
        console.log(`        Prior:   ${fmt(acc.priorBalance).padStart(12)}${priorFlag}`);
        console.log(`        Current: ${fmt(acc.currentBalance).padStart(12)}${currentFlag}`);
        console.log(`        Change:  ${fmt(acc.change).padStart(12)} (${changeLabel})`);
      }
    } else {
      console.log(`      (no debt accounts tracked)\n`);
    }
    
    // Component 3: Outside contributions
    console.log(`\n  🏦 CONTRIBUTIONS TO OUTSIDE ACCOUNTS: ${fmt(result.contributionsToOutside)}`);
    if (result.details.contributions.length > 0) {
      for (const txn of result.details.contributions) {
        const flag = txn.needsConfirmation ? " ⚠️  NEEDS CONFIRMATION" : "";
        console.log(`      • ${txn.merchant.padEnd(30)} ${fmt(txn.amount).padStart(12)} (${txn.category})${flag}`);
      }
    } else {
      console.log(`      (none)\n`);
    }
    
    if (result.needsConfirmation.length > 0) {
      console.log(`\n  ⚠️  ITEMS NEEDING USER CONFIRMATION:`);
      for (const item of result.needsConfirmation) {
        console.log(`      • ${item.merchant} - ${fmt(item.amount)} on ${item.date}`);
        console.log(`        Category: ${item.category}`);
        console.log(`        Question: Does this count as savings?`);
      }
    }
    
    console.log(`\n  📊 CALCULATION BREAKDOWN:`);
    console.log(`      Cash change:         ${fmt(result.netCashChange).padStart(12)}`);
    console.log(`      Debt change:         ${fmt(result.netDebtChange).padStart(12)}`);
    console.log(`      Outside contrib:     ${fmt(result.contributionsToOutside).padStart(12)}`);
    console.log(`      ────────────────────────────────`);
    console.log(`      Total savings:       ${fmt(result.total).padStart(12)}`);
    
    console.log(`\n  📈 computeAssetGains() (excluded from savings):`);
    console.log(`      Market gains:              ${fmt(gains.marketGains)}`);
    console.log(`      Manual asset changes:      ${fmt(gains.manualAssetChanges)}`);
    console.log(`      Total gains:               ${fmt(gains.totalGains)}`);
  }

  // Average
  console.log("\n" + "═".repeat(80));
  const avgSavings = computeAverageSavings(
    profile.monthlyHistory,
    profile.accountBalanceHistory,
    profile.expenseTxns,
    months
  );
  console.log(`\n📊 AVERAGE (Last 3 Months):`);
  console.log(`   computeAverageSavings() = ${fmt(avgSavings)}/mo\n`);

  // Current card logic (for comparison)
  const cardLogic = computeCurrentCardLogic(
    profile.monthlyHistory, 
    profile.expenseTxns, 
    profile.incomeTxns,
    profile.accountSnapshots,
    profile.homeCurrency || "CAD",
    new Map(), // No income deposit reviews in this script
    months
  );
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
