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
    
    console.log(`  Component Breakdown:`);
    console.log(`    1️⃣  Contributions:          ${fmt(result.contributions)}`);
    if (result.details.contributions.length > 0) {
      for (const txn of result.details.contributions) {
        const flag = txn.needsConfirmation ? " ⚠️  NEEDS CONFIRMATION" : "";
        console.log(`        • ${txn.merchant.padEnd(30)} ${fmt(txn.amount).padStart(12)} (${txn.category})${flag}`);
      }
    } else {
      console.log(`        (none)`);
    }
    
    console.log(`\n    2️⃣  Cash growth (bank accounts): ${fmt(result.cashGrowth)}`);
    if (result.details.cashGrowth.length > 0) {
      for (const acc of result.details.cashGrowth) {
        console.log(`        • ${acc.accountLabel.padEnd(30)} ${fmt(acc.growth).padStart(12)}`);
        console.log(`          Balance: ${fmt(acc.priorBalance)} → ${fmt(acc.currentBalance)}`);
      }
    } else {
      console.log(`        (none)`);
    }
    
    console.log(`\n    3️⃣  Debt principal paid:       ${fmt(result.debtPrincipal)}`);
    if (result.details.debtPrincipal.length > 0) {
      for (const acc of result.details.debtPrincipal) {
        console.log(`        • ${acc.accountLabel.padEnd(30)} ${fmt(acc.reduction).padStart(12)}`);
        console.log(`          Balance: ${fmt(acc.priorBalance)} → ${fmt(acc.currentBalance)}`);
      }
    } else {
      console.log(`        (none)`);
    }
    
    if (result.needsConfirmation.length > 0) {
      console.log(`\n  ⚠️  ITEMS NEEDING USER CONFIRMATION:`);
      for (const item of result.needsConfirmation) {
        console.log(`      • ${item.merchant} - ${fmt(item.amount)} on ${item.date}`);
        console.log(`        Category: ${item.category}`);
        console.log(`        Question: Does this count as savings?`);
      }
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
    profile.accountBalanceHistory,
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
