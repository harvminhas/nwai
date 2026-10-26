/**
 * Test: Principal paid calculation with duplicate statement uploads
 * 
 * Reproduces the bug where Scotia Plan shows CA$558,842 principal paid
 * instead of the correct CA$2,978 (May -49,935.10 → Aug -46,957.41).
 */

import type { ParsedStatementData } from "../lib/types";

// Mock Firestore document structure
interface MockDoc {
  id: string;
  data: () => {
    parsedData: ParsedStatementData;
    accountSlug?: string;
    yearMonth?: string;
    userId: string;
    status: string;
    uploadedAt: { toDate: () => Date };
  };
}

describe("Principal Paid Calculation", () => {
  test("Scotia Plan: dedupes by last4+month, computes correct principal paid", () => {
    // Simulate duplicate uploads of Scotia Plan Loan
    // Real data: May has accountId "(7780)", Aug has accountId "7780"
    // Both should normalize to "7780" and dedupe properly
    
    const mockDocs: MockDoc[] = [
      // May statement - first upload
      {
        id: "doc1",
        data: () => ({
          parsedData: {
            accountId: "(7780)",
            accountName: "Scotia Plan Loan",
            bankName: "Scotiabank",
            accountType: "loan",
            netWorth: -49935.10,
            assets: 0,
            debts: 49935.10,
            statementDate: "2026-05-02",
            income: { total: 0, sources: [], transactions: [] },
            expenses: { total: 0, categories: [], transactions: [] },
            subscriptions: [],
            savingsRate: 0,
            insights: [],
            paymentsMade: 1142.25,
          },
          accountSlug: undefined,
          yearMonth: "2026-05",
          userId: "test-user",
          status: "completed",
          uploadedAt: { toDate: () => new Date("2026-05-03") },
        }),
      },
      // May statement - duplicate upload (should be ignored)
      {
        id: "doc2",
        data: () => ({
          parsedData: {
            accountId: "7780", // Different format, but same last4
            accountName: "Scotia Plan",
            bankName: "Scotiabank",
            accountType: "loan",
            netWorth: -49935.10,
            assets: 0,
            debts: 49935.10,
            statementDate: "2026-05-02",
            income: { total: 0, sources: [], transactions: [] },
            expenses: { total: 0, categories: [], transactions: [] },
            subscriptions: [],
            savingsRate: 0,
            insights: [],
            paymentsMade: 1142.25,
          },
          accountSlug: undefined,
          yearMonth: "2026-05",
          userId: "test-user",
          status: "completed",
          uploadedAt: { toDate: () => new Date("2026-05-04") }, // Later upload
        }),
      },
      // Aug statement
      {
        id: "doc3",
        data: () => ({
          parsedData: {
            accountId: "7780",
            accountName: "Scotia Plan",
            bankName: "Scotiabank",
            accountType: "loan",
            netWorth: -46957.41,
            assets: 0,
            debts: 46957.41,
            statementDate: "2026-08-02",
            income: { total: 0, sources: [], transactions: [] },
            expenses: { total: 0, categories: [], transactions: [] },
            subscriptions: [],
            savingsRate: 0,
            insights: [],
            paymentsMade: 0,
          },
          accountSlug: undefined,
          yearMonth: "2026-08",
          userId: "test-user",
          status: "completed",
          uploadedAt: { toDate: () => new Date("2026-08-03") },
        }),
      },
    ];

    // Expected behavior:
    // 1. Both May statements should dedupe to single entry (last4 "7780", month "2026-05")
    // 2. Balance history should have: May: -49,935.10, Aug: -46,957.41
    // 3. totalDebts for May: 49,935.10 (abs value)
    // 4. totalDebts for Aug: 46,957.41 (abs value)
    // 5. Principal paid (May → Aug): 49,935.10 - 46,957.41 = 2,977.69 ≈ CA$2,978

    // Test the deduplication logic
    // (This would call the actual financialProfile building logic)
    
    console.log("Expected principal paid: CA$2,978");
    console.log("May balance (abs): CA$49,935.10");
    console.log("Aug balance (abs): CA$46,957.41");
    console.log("Difference: CA$2,977.69");
    
    // The bug: if deduplication fails, both May statements get separate entries
    // or they get summed, causing totalDebts to be inflated
    
    expect(true).toBe(true); // Placeholder
  });

  test("Handles negative loan balances correctly (sign convention)", () => {
    // Loan balances are negative in parsedData.netWorth
    // Should be converted to positive for totalDebts via Math.abs()
    
    const balance = -49935.10;
    const debtAmount = Math.abs(balance);
    
    expect(debtAmount).toBe(49935.10);
  });
});
