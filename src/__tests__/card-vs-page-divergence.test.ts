/**
 * Fixture test to diagnose card vs page spending divergence.
 * 
 * Tests the EXACT same data through both paths:
 * - Card path: computeMoneyCoachBreakdown
 * - Page path: buildSpendingSummary
 * 
 * Prints per-bucket breakdown to identify which line items differ.
 */

import { describe, test, expect } from "vitest";
import { computeMoneyCoachBreakdown } from "@/lib/moneyCoach";
import { buildSpendingSummary } from "@/lib/spendingSummary";
import type { FinancialProfileCache, ExpenseTxnRecord, AccountSnapshot, DebtPaymentHistoryEntry, IncomeTxnRecord } from "@/lib/types";

describe("Card vs Page Divergence", () => {
  test("card and page must compute identical spending from same data", () => {
    // Fixture: 3 months of data with various transaction types
    const months = ["2026-07", "2026-08", "2026-09"];
    
    const expenseTxns: ExpenseTxnRecord[] = [
      // Fixed: Mortgage
      { txMonth: "2026-07", date: "2026-07-01", category: "Housing", merchant: "MORTGAGE PAYMENT", amount: 2000, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-08", date: "2026-08-01", category: "Housing", merchant: "MORTGAGE PAYMENT", amount: 2000, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-09", date: "2026-09-01", category: "Housing", merchant: "MORTGAGE PAYMENT", amount: 2000, accountSlug: "checking", currency: "CAD" },
      
      // Essentials: Groceries
      { txMonth: "2026-07", date: "2026-07-15", category: "Groceries", merchant: "SOBEYS", amount: 300, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-08", date: "2026-08-15", category: "Groceries", merchant: "SOBEYS", amount: 300, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-09", date: "2026-09-15", category: "Groceries", merchant: "SOBEYS", amount: 300, accountSlug: "checking", currency: "CAD" },
      
      // Flexible: Dining
      { txMonth: "2026-07", date: "2026-07-20", category: "Dining", merchant: "RESTAURANT", amount: 100, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-08", date: "2026-08-20", category: "Dining", merchant: "RESTAURANT", amount: 100, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-09", date: "2026-09-20", category: "Dining", merchant: "RESTAURANT", amount: 100, accountSlug: "checking", currency: "CAD" },
      
      // Debt Payments (should be excluded from spending)
      { txMonth: "2026-07", date: "2026-07-25", category: "Debt Payments", merchant: "CC PAYMENT", amount: 500, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-08", date: "2026-08-25", category: "Debt Payments", merchant: "CC PAYMENT", amount: 500, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-09", date: "2026-09-25", category: "Debt Payments", merchant: "CC PAYMENT", amount: 500, accountSlug: "checking", currency: "CAD" },
      
      // Transfers (should be excluded)
      { txMonth: "2026-07", date: "2026-07-10", category: "Transfers", merchant: "E-TRANSFER", amount: 200, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-08", date: "2026-08-10", category: "Transfers", merchant: "E-TRANSFER", amount: 200, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-09", date: "2026-09-10", category: "Transfers", merchant: "E-TRANSFER", amount: 200, accountSlug: "checking", currency: "CAD" },
      
      // Investments & Savings (should be excluded)
      { txMonth: "2026-07", date: "2026-07-05", category: "Investments & Savings", merchant: "RRSP", amount: 400, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-08", date: "2026-08-05", category: "Investments & Savings", merchant: "RRSP", amount: 400, accountSlug: "checking", currency: "CAD" },
      { txMonth: "2026-09", date: "2026-09-05", category: "Investments & Savings", merchant: "RRSP", amount: 400, accountSlug: "checking", currency: "CAD" },
    ];
    
    const accountSnapshots: AccountSnapshot[] = [
      { slug: "checking", accountName: "Checking", currency: "CAD", accountType: "checking" },
      { slug: "cc-visa", accountName: "Visa", currency: "CAD", accountType: "credit_card" },
    ];
    
    const debtPaymentHistory: DebtPaymentHistoryEntry[] = [
      { accountSlug: "cc-visa", statementMonth: "2026-07", paymentsMade: 500 },
      { accountSlug: "cc-visa", statementMonth: "2026-08", paymentsMade: 500 },
      { accountSlug: "cc-visa", statementMonth: "2026-09", paymentsMade: 500 },
    ];
    
    const incomeTxns: IncomeTxnRecord[] = [
      { txMonth: "2026-07", date: "2026-07-01", source: "SALARY", amount: 5000, category: "Income", accountSlug: "checking", currency: "CAD", description: "Pay" },
      { txMonth: "2026-08", date: "2026-08-01", source: "SALARY", amount: 5000, category: "Income", accountSlug: "checking", currency: "CAD", description: "Pay" },
      { txMonth: "2026-09", date: "2026-09-01", source: "SALARY", amount: 5000, category: "Income", accountSlug: "checking", currency: "CAD", description: "Pay" },
    ];
    
    // Mock profile
    const profile: FinancialProfileCache = {
      uid: "test",
      expenseTxns,
      incomeTxns,
      accountSnapshots,
      debtPaymentHistory,
      accountBalanceHistory: [],
      monthlyHistory: months.map(m => ({
        yearMonth: m,
        incomeTotal: 5000,
        expenseTotal: 3500,
        netChange: 1500,
        endBalance: 10000,
      })),
      coverage: { monthsCovered: 3, monthsSpan: 3, coveragePct: 100, missingMonths: [] },
      fxRates: {},
      homeCurrency: "CAD",
      schemaVersion: 1,
      computedAt: new Date().toISOString(),
      sourceVersion: "test",
    };
    
    // CARD PATH: computeMoneyCoachBreakdown
    const cardResult = computeMoneyCoachBreakdown(
      profile,
      [], // userReviews
      incomeTxns,
      accountSnapshots,
      "CAD",
      new Map(), // incomeDepositReviews
      months
    );
    
    // PAGE PATH: buildSpendingSummary
    const pageResult = buildSpendingSummary(
      expenseTxns,
      accountSnapshots,
      debtPaymentHistory,
      [], // userReviews
      {},
      "CAD",
      months
    );
    
    // Print detailed breakdown
    console.log("\n=== CARD VS PAGE BREAKDOWN ===");
    console.log("\nCARD (computeMoneyCoachBreakdown):");
    console.log(`  Income: ${cardResult.incomeAmount}`);
    console.log(`  Total Spending: ${cardResult.totalSpending}`);
    cardResult.buckets.forEach(b => {
      console.log(`  ${b.label}: ${b.monthlyAverage}`);
    });
    
    console.log("\nPAGE (buildSpendingSummary):");
    console.log(`  Typical Monthly: ${pageResult.typicalMonthly}`);
    console.log("  (No per-bucket breakdown available)");
    
    console.log("\nEXPECTED:");
    console.log("  Fixed (Mortgage): 2000");
    console.log("  Essentials (Groceries): 300");
    console.log("  Flexible (Dining): 100");
    console.log("  TOTAL: 2400");
    console.log("  Excluded: Debt Payments (500), Transfers (200), Investments (400)");
    
    // Expected: 2000 (mortgage) + 300 (groceries) + 100 (dining) = 2400 per month
    // Debt payments, transfers, and investments should be EXCLUDED
    const expectedSpending = 2400;
    
    expect(cardResult.totalSpending).toBe(expectedSpending);
    expect(pageResult.typicalMonthly).toBe(expectedSpending);
    expect(cardResult.totalSpending).toBe(pageResult.typicalMonthly);
  });
});
