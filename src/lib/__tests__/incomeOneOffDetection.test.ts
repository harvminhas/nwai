import { describe, it, expect } from "vitest";
import { buildIncomeSummary } from "../incomeSummary";
import type { IncomeTxnRecord, AccountSnapshot } from "../extractTransactions";

describe("Income One-Off Detection", () => {
  it("should detect within-source one-offs (bonuses) and exclude from typical", () => {
    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "td-1234",
        bankName: "TD",
        accountId: "1234",
        accountName: "TD Checking",
        accountType: "checking",
        balance: 5000,
        statementMonth: "2026-09",
        interestRate: null,
        currency: "CAD",
      },
    ];

    // MAM PAY: normal biweekly CA$4,278, with a CA$24,695 bonus on Sep 4
    // MATHL PAY: steady CA$6,700/month
    // MOBILE DEPOSIT: single CA$6,506 on Jul 6 (should be one-off, not regular semi-annual)
    const incomeTxns: IncomeTxnRecord[] = [
      // MAM PAY - Jul
      { source: "MAM PAY", amount: 4278, date: "2026-07-10", category: "Salary", txMonth: "2026-07", accountSlug: "td-1234" },
      { source: "MAM PAY", amount: 4278, date: "2026-07-24", category: "Salary", txMonth: "2026-07", accountSlug: "td-1234" },
      
      // MAM PAY - Aug
      { source: "MAM PAY", amount: 4278, date: "2026-08-07", category: "Salary", txMonth: "2026-08", accountSlug: "td-1234" },
      { source: "MAM PAY", amount: 4278, date: "2026-08-21", category: "Salary", txMonth: "2026-08", accountSlug: "td-1234" },
      
      // MAM PAY - Sep (normal + BONUS)
      { source: "MAM PAY", amount: 4278, date: "2026-09-04", category: "Salary", txMonth: "2026-09", accountSlug: "td-1234" },
      { source: "MAM PAY", amount: 24695, date: "2026-09-04", category: "Bonus", txMonth: "2026-09", accountSlug: "td-1234" }, // BONUS!
      { source: "MAM PAY", amount: 4278, date: "2026-09-18", category: "Salary", txMonth: "2026-09", accountSlug: "td-1234" },
      
      // MATHL PAY - steady monthly
      { source: "MATHL PAY", amount: 6700, date: "2026-07-15", category: "Salary", txMonth: "2026-07", accountSlug: "td-1234" },
      { source: "MATHL PAY", amount: 6700, date: "2026-08-15", category: "Salary", txMonth: "2026-08", accountSlug: "td-1234" },
      { source: "MATHL PAY", amount: 6700, date: "2026-09-15", category: "Salary", txMonth: "2026-09", accountSlug: "td-1234" },
      
      // MOBILE DEPOSIT - single occurrence (should be one-off)
      { source: "MOBILE DEPOSIT", amount: 6506, date: "2026-07-06", category: "Other", txMonth: "2026-07", accountSlug: "td-1234" },
      
      // Small government benefits
      { source: "CRA DEPOSIT", amount: 300, date: "2026-07-20", category: "Government", txMonth: "2026-07", accountSlug: "td-1234" },
      { source: "CRA DEPOSIT", amount: 300, date: "2026-08-20", category: "Government", txMonth: "2026-08", accountSlug: "td-1234" },
      { source: "CRA DEPOSIT", amount: 300, date: "2026-09-20", category: "Government", txMonth: "2026-09", accountSlug: "td-1234" },
    ];

    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD");

    console.log("\n=== Income One-Off Detection Test ===");
    console.log(`\nAll sources:`, summary.sources.map(s => `${s.canonicalName} (${s.count} txns)`).join(", "));

    // Find the MAM PAY source
    const mamPay = summary.sources.find(s => s.canonicalName === "MAM PAY");
    console.log(`\nMAM PAY: ${mamPay ? mamPay.count : 0} transactions`);
    if (mamPay) {
      console.log(`  Transactions:`, mamPay.transactions.map(t => `${t.date}: CA$${t.amount}`).join(", "));
      console.log(`  Average: CA$${mamPay.avgAmount.toFixed(0)}, Frequency: ${mamPay.frequency}`);
    }
    expect(mamPay).toBeDefined();
    expect(mamPay!.frequency).toBe("bi-weekly");
    
    // Find the MATHL PAY source
    const mathlPay = summary.sources.find(s => s.canonicalName === "MATHL PAY");
    expect(mathlPay).toBeDefined();
    expect(mathlPay!.frequency).toBe("monthly");
    
    // Find MOBILE DEPOSIT - should be marked as one-off (single occurrence)
    const mobileDeposit = summary.sources.find(s => s.canonicalName === "MOBILE DEPOSIT");
    expect(mobileDeposit).toBeDefined();
    expect(mobileDeposit!.isOneOff).toBe(true);
    
    // Find CRA DEPOSIT - should be regular
    const craDeposit = summary.sources.find(s => s.canonicalName === "CRA DEPOSIT");
    expect(craDeposit).toBeDefined();
    expect(craDeposit!.isOneOff).toBe(false);

    // Check monthly history - Sep should have bonus as one-off
    const sepHistory = summary.monthlyHistory.find(m => m.yearMonth === "2026-09");
    expect(sepHistory).toBeDefined();
    
    // Sep total = 2×4278 (MAM regular) + 24695 (MAM bonus) + 6700 (MATHL) + 300 (CRA) = 40,251
    expect(sepHistory!.total).toBe(2 * 4278 + 24695 + 6700 + 300);
    
    // Sep regular = 2×4278 (MAM) + 6700 (MATHL) + 300 (CRA) = 15,556
    // Sep one-off = 24,695 (bonus)
    expect(sepHistory!.regular).toBe(2 * 4278 + 6700 + 300);
    expect(sepHistory!.oneOff).toBe(24695);

    // Typical monthly should be based on last 3 complete months (Jul, Aug, Sep) regular only
    // Jul regular: 2×4278 (MAM) + 6700 (MATHL) + 300 (CRA) = 15,556
    // Jul one-off: 6,506 (MOBILE DEPOSIT)
    // Aug regular: 2×4278 (MAM) + 6700 (MATHL) + 300 (CRA) = 15,556
    // Sep regular: 2×4278 (MAM) + 6700 (MATHL) + 300 (CRA) = 15,556
    // Typical = (15556 + 15556 + 15556) / 3 = 15,556
    
    const julHistory = summary.monthlyHistory.find(m => m.yearMonth === "2026-07");
    expect(julHistory!.regular).toBe(2 * 4278 + 6700 + 300); // 15,556
    expect(julHistory!.oneOff).toBe(6506); // MOBILE DEPOSIT
    
    const augHistory = summary.monthlyHistory.find(m => m.yearMonth === "2026-08");
    expect(augHistory!.regular).toBe(2 * 4278 + 6700 + 300); // 15,556
    expect(augHistory!.oneOff).toBe(0);
    
    console.log("\n=== Monthly Breakdown ===");
    console.log(`Jul regular: CA$${julHistory!.regular.toLocaleString()}, one-off: CA$${julHistory!.oneOff.toLocaleString()}`);
    console.log(`Aug regular: CA$${augHistory!.regular.toLocaleString()}, one-off: CA$${augHistory!.oneOff.toLocaleString()}`);
    console.log(`Sep regular: CA$${sepHistory!.regular.toLocaleString()}, one-off: CA$${sepHistory!.oneOff.toLocaleString()}`);
    console.log(`\nTypical monthly: CA$${summary.typicalMonthly.toLocaleString()}`);
    console.log(`Expected: CA$15,556 (average of 3 months)`);
    
    expect(summary.typicalMonthly).toBe(15556);
    
    // MAM PAY average should exclude the bonus
    // 7 transactions total, 6 regular (4278 each), 1 bonus (24695)
    // Average of regular only = 4278
    expect(mamPay!.avgAmount).toBe(4278);
    
    // MAM PAY monthly equivalent: 4278 × 2.17 (bi-weekly) ≈ 9,283
    expect(mamPay!.monthlyEquivalent).toBeCloseTo(4278 * 2.17, 0);
    
    // MATHL PAY monthly equivalent = 6700
    expect(mathlPay!.monthlyEquivalent).toBe(6700);
    
    // Expected typical ≈ MAM PAY ~8.5k + MATHL PAY ~6.7k + CRA ~300 + other small = ~15.5k
    // Actual: (4278 × 2.17) + 6700 + 300 ≈ 9283 + 6700 + 300 = 16,283
    // But the calculation uses actual 3-month average: 19,556
    // This is correct because we have 2 full biweekly cycles per month in the data
    
    console.log("\n=== Income One-Off Detection Test ===");
    console.log(`\nMAM PAY: ${mamPay!.count} transactions, avg CA$${mamPay!.avgAmount.toFixed(0)}, ${mamPay!.frequency}`);
    console.log(`  Transactions:`, mamPay!.transactions.map(t => `${t.date}: CA$${t.amount}`).join(", "));
    console.log(`MATHL PAY: ${mathlPay!.count} transactions, avg CA$${mathlPay!.avgAmount.toFixed(0)}, ${mathlPay!.frequency}`);
    console.log(`MOBILE DEPOSIT: ${mobileDeposit!.count} transaction, one-off = ${mobileDeposit!.isOneOff}`);
    console.log(`CRA DEPOSIT: ${craDeposit!.count} transactions, one-off = ${craDeposit!.isOneOff}`);
    console.log(`\nJul 2026: regular CA$${julHistory!.regular.toLocaleString()}, one-off CA$${julHistory!.oneOff.toLocaleString()}`);
    console.log(`Aug 2026: regular CA$${augHistory!.regular.toLocaleString()}, one-off CA$${augHistory!.oneOff.toLocaleString()}`);
    console.log(`Sep 2026: regular CA$${sepHistory!.regular.toLocaleString()}, one-off CA$${sepHistory!.oneOff.toLocaleString()} (bonus)`);
    console.log(`\nTypical monthly (regular only): CA$${summary.typicalMonthly.toLocaleString()}`);
    console.log(`Breakdown: MAM PAY 2×CA$${mamPay!.avgAmount.toLocaleString()} + MATHL CA$${mathlPay!.avgAmount.toLocaleString()} + CRA CA$300 = CA$15,556`);
    console.log("\n✓ Test passed");
  });
});
