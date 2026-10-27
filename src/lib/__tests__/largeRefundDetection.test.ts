/**
 * Test that buildIncomeSummary correctly detects and excludes large refunds
 * without crashing (ReferenceError: typicalMonthly before initialization).
 */

import { describe, test, expect } from "vitest";
import { buildIncomeSummary } from "../incomeSummary";
import type { IncomeTransaction } from "../incomeSummary";
import type { AccountSnapshot } from "../extractTransactions";

describe("Large Refund Detection", () => {
  test("should detect large refunds without crashing", () => {
    // Sample fixture: regular payroll + one large refund
    const incomeTxns: IncomeTransaction[] = [
      // Regular payroll - 3 months
      { source: "Acme Corp", amount: 5000, date: "2026-07-15", category: "Salary", accountSlug: "checking_1234" },
      { source: "Acme Corp", amount: 5000, date: "2026-08-15", category: "Salary", accountSlug: "checking_1234" },
      { source: "Acme Corp", amount: 5000, date: "2026-09-15", category: "Salary", accountSlug: "checking_1234" },
      
      // Large refund in April (>$1K)
      { source: "Oakbay Refund", amount: 57780, date: "2026-04-10", category: "Other", accountSlug: "checking_1234" },
    ];

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "checking_1234",
        bankName: "Test Bank",
        accountName: "Checking",
        accountType: "Checking",
        accountId: "1234",
        balance: 67780,
        currency: "CAD",
        statementMonth: "2026-09",
        interestRate: 0,
      },
    ];

    // Should not crash with ReferenceError
    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD");

    // Verify typical monthly is based on regular payroll only (refund excluded)
    expect(summary.typicalMonthly).toBe(5000);

    // Verify the refund is in unreviewed deposits
    expect(summary.unreviewedDeposits.length).toBe(1);
    expect(summary.unreviewedDeposits[0].source).toBe("Oakbay Refund");
    expect(summary.unreviewedDeposits[0].amount).toBe(57780);
    expect(summary.unreviewedDeposits[0].reason).toBe("large_refund");

    // Verify April month total excludes the unreviewed refund
    const aprilMonth = summary.monthlyHistory.find(m => m.yearMonth === "2026-04");
    expect(aprilMonth?.total).toBe(0); // Refund excluded by default
  });

  test("should not flag small one-off refunds", () => {
    const incomeTxns: IncomeTransaction[] = [
      { source: "Acme Corp", amount: 5000, date: "2026-07-15", category: "Salary", accountSlug: "checking_1234" },
      { source: "Acme Corp", amount: 5000, date: "2026-08-15", category: "Salary", accountSlug: "checking_1234" },
      // Small refund from the same employer (e.g., expense reimbursement)
      { source: "Acme Corp Refund", amount: 50, date: "2026-08-20", category: "Other", accountSlug: "checking_1234" },
    ];

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "checking_1234",
        bankName: "Test Bank",
        accountName: "Checking",
        accountType: "Checking",
        accountId: "1234",
        balance: 10050,
        currency: "CAD",
        statementMonth: "2026-08",
        interestRate: 0,
      },
    ];

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD");

    // Small one-off refund should not be flagged (needs multiple txns to establish pattern)
    const refundDeposit = summary.unreviewedDeposits.find(d => d.source === "Acme Corp Refund");
    expect(refundDeposit).toBeUndefined();
  });
});
