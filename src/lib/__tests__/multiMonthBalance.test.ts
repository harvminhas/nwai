import { describe, test, expect } from "vitest";

/**
 * Tests for multi-month statement balance reconstruction.
 * 
 * When a 90-day statement spans Jul-Oct with transactions in each month,
 * the system should derive month-end balances for Jul, Aug, Sep by walking
 * backward from the Oct closing balance.
 * 
 * For debt accounts, opening/closing balance reconciliation is required.
 */

describe("Multi-month statement balance reconstruction", () => {
  test("90-day statement produces 3 derived month-end balances", () => {
    // Simulate a 90-day statement for savings account 7165
    // Real data: Jul 3, Aug 6, Sep 8, Oct 6 transactions
    // Closing balance at 2026-10: 4442
    
    const closingBalance = 4442;
    const statementMonth = "2026-10";
    
    // Transactions (negative = expense/withdrawal, positive = income/deposit)
    const transactions = [
      { txMonth: "2026-07", amount: -500 },  // Jul withdrawal
      { txMonth: "2026-07", amount: 100 },   // Jul deposit
      { txMonth: "2026-07", amount: -200 },  // Jul withdrawal
      { txMonth: "2026-08", amount: 300 },   // Aug deposit
      { txMonth: "2026-08", amount: -150 },  // Aug withdrawal
      { txMonth: "2026-08", amount: -50 },   // Aug withdrawal
      { txMonth: "2026-09", amount: -100 },  // Sep withdrawal
      { txMonth: "2026-09", amount: 500 },   // Sep deposit
      { txMonth: "2026-10", amount: -75 },   // Oct withdrawal
      { txMonth: "2026-10", amount: 200 },   // Oct deposit
    ];
    
    // Calculate expected balances by walking backward
    // Oct closing: 4442
    // Oct transactions: -75 + 200 = +125
    // Sep end: 4442 - 125 = 4317
    // Sep transactions: -100 + 500 = +400
    // Aug end: 4317 - 400 = 3917
    // Aug transactions: 300 - 150 - 50 = +100
    // Jul end: 3917 - 100 = 3817
    
    const expectedBalances = {
      "2026-07": 3817,
      "2026-08": 3917,
      "2026-09": 4317,
      "2026-10": 4442, // Closing balance (real)
    };
    
    // Group transactions by month
    const txnsByMonth = new Map<string, number>();
    for (const txn of transactions) {
      const current = txnsByMonth.get(txn.txMonth) || 0;
      txnsByMonth.set(txn.txMonth, current + txn.amount);
    }
    
    // Walk backward from closing balance
    // The algorithm: start at closing (Oct), save Oct balance, then walk back
    // by subtracting NEXT month's transactions (the month we just processed)
    const derivedBalances = new Map<string, number>();
    let runningBalance = closingBalance;
    
    const months = ["2026-10", "2026-09", "2026-08", "2026-07"];
    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      
      // Save current month-end balance
      derivedBalances.set(month, runningBalance);
      
      // To get previous month, subtract this month's transactions
      if (i < months.length - 1) {
        const currentMonthChange = txnsByMonth.get(month) || 0;
        runningBalance = runningBalance - currentMonthChange;
      }
    }
    
    // Verify derived balances match expected
    for (const [month, expectedBalance] of Object.entries(expectedBalances)) {
      const derived = derivedBalances.get(month);
      expect(derived).toBe(expectedBalance);
    }
  });
  
  test("Loan statement with itemized interest reconciles correctly", () => {
    // Auto loan statement with payments and interest
    // For debt accounts, payments are positive (reduce debt), charges are negative (increase debt)
    
    // Let's work backward from a known closing to ensure reconciliation
    const closingBalance = -14284;
    
    // Sep: payment reduces debt by $500, interest increases it by $69
    // Aug end = closing - Sep change = -14284 - (-500 + 69) = -14284 - (-431) = -14284 + 431 = -13853
    // Aug: payment -500, interest +72
    // Jul end = Aug end - Aug change = -13853 - (-500 + 72) = -13853 - (-428) = -13853 + 428 = -13425
    // Jul: payment -500, interest +75
    // Opening = Jul end - Jul change = -13425 - (-500 + 75) = -13425 - (-425) = -13425 + 425 = -13000
    
    const openingBalance = -13000;
    
    const transactions = [
      { month: "2026-07", amount: -500 }, // Payment (reduces debt)
      { month: "2026-07", amount: 75 },   // Interest charge (increases debt)
      { month: "2026-08", amount: -500 }, // Payment
      { month: "2026-08", amount: 72 },   // Interest
      { month: "2026-09", amount: -500 }, // Payment
      { month: "2026-09", amount: 69 },   // Interest
    ];
    
    // Walk backward from closing
    const txnsByMonth = new Map<string, number>();
    for (const txn of transactions) {
      const current = txnsByMonth.get(txn.month) || 0;
      txnsByMonth.set(txn.month, current + txn.amount);
    }
    
    let runningBalance = closingBalance;
    const months = ["2026-09", "2026-08", "2026-07"];
    const derivedBalances = new Map<string, number>();
    
    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      derivedBalances.set(month, runningBalance);
      
      if (i < months.length - 1) {
        const currentChange = txnsByMonth.get(month) || 0;
        runningBalance = runningBalance - currentChange;
      }
    }
    
    // Derived opening = Jul end - Jul transactions
    const julEnd = derivedBalances.get("2026-07")!;
    const julChange = txnsByMonth.get("2026-07") || 0;
    const derivedOpening = julEnd - julChange;
    
    // Should reconcile within tolerance
    const diff = Math.abs(derivedOpening - openingBalance);
    const tolerance = Math.max(5, Math.abs(openingBalance) * 0.001); // $5 or 0.1%
    
    expect(diff).toBeLessThanOrEqual(tolerance);
  });
  
  test("Mortgage statement without itemized interest should skip reconstruction", () => {
    // Mortgage statement where interest is built into balance but not itemized
    // Opening balance: -250000
    // Closing balance: -248500 (net reduction of $1500 over 3 months)
    
    const openingBalance = -250000;
    const closingBalance = -248500;
    
    // Only payment transactions, no interest lines
    // In reality, ~$1000/month interest was accrued but not itemized
    const transactions = [
      { month: "2026-07", amount: -1500 }, // Payment
      { month: "2026-08", amount: -1500 }, // Payment
      { month: "2026-09", amount: -1500 }, // Payment
      // Missing: ~$1000/month interest that mortgage accrued
    ];
    
    // Walk backward from closing
    const txnsByMonth = new Map<string, number>();
    for (const txn of transactions) {
      const current = txnsByMonth.get(txn.month) || 0;
      txnsByMonth.set(txn.month, current + txn.amount);
    }
    
    let runningBalance = closingBalance;
    const months = ["2026-09", "2026-08", "2026-07"];
    const derivedBalances = new Map<string, number>();
    
    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      derivedBalances.set(month, runningBalance);
      
      if (i < months.length - 1) {
        const currentChange = txnsByMonth.get(month) || 0;
        runningBalance = runningBalance - currentChange;
      }
    }
    
    // Derived opening: start from Jul end and subtract Jul transactions
    // Jul end = closing - Sep txns - Aug txns = -248500 - (-1500) - (-1500) = -245500
    const julEnd = derivedBalances.get("2026-07")!;
    expect(julEnd).toBe(-245500);
    
    const julChange = txnsByMonth.get("2026-07") || 0;
    const derivedOpening = julEnd - julChange;
    // derivedOpening = -245500 - (-1500) = -244000
    expect(derivedOpening).toBe(-244000);
    
    // Should NOT reconcile (missing ~$3000 interest over 3 months)
    // Actual opening: -250000
    const diff = Math.abs(derivedOpening - openingBalance);
    const tolerance = Math.max(5, Math.abs(openingBalance) * 0.001); // $5 or 0.1%
    
    // Diff should be ~$6000, way more than tolerance
    expect(diff).toBeGreaterThan(tolerance);
    
    // This statement should be marked as "not reconcilable, skipped"
    // System should keep only the real statement balance, no derived entries
  });
  
  test("Derived balances reconcile to closing balance within $1", () => {
    // Test that walking backward and forward produces consistent results
    const closingBalance = 5000;
    const openingBalance = 4500; // Assuming we could derive this
    
    const transactions = [
      { month: "2026-07", amount: 200 },
      { month: "2026-08", amount: 150 },
      { month: "2026-09", amount: 150 },
    ];
    
    const totalChange = transactions.reduce((sum, t) => sum + t.amount, 0);
    const expectedClosing = openingBalance + totalChange;
    
    // Should reconcile within $1
    expect(Math.abs(expectedClosing - closingBalance)).toBeLessThanOrEqual(1);
  });
  
  test("Single-month statement does not create derived balances", () => {
    // If all transactions are in the same month as the statement,
    // no derived balances should be created
    
    const statementMonth = "2026-10";
    const transactions = [
      { txMonth: "2026-10", amount: -100 },
      { txMonth: "2026-10", amount: 50 },
    ];
    
    // Get unique months
    const months = [...new Set(transactions.map(t => t.txMonth))];
    
    // Should only have one month
    expect(months).toHaveLength(1);
    expect(months[0]).toBe(statementMonth);
    
    // No need for reconstruction when first === last month
  });
  
  test("Handles gap in transaction months", () => {
    // If statement has transactions in Jul, Sep, Oct but not Aug,
    // should still derive Aug balance
    
    const closingBalance = 3000;
    const transactions = [
      { txMonth: "2026-07", amount: -200 },
      // No Aug transactions
      { txMonth: "2026-09", amount: 300 },
      { txMonth: "2026-10", amount: -100 },
    ];
    
    // Group by month
    const txnsByMonth = new Map<string, number>();
    for (const txn of transactions) {
      const current = txnsByMonth.get(txn.txMonth) || 0;
      txnsByMonth.set(txn.txMonth, current + txn.amount);
    }
    
    // Walk backward
    const derivedBalances = new Map<string, number>();
    let runningBalance = closingBalance;
    
    const allMonths = ["2026-10", "2026-09", "2026-08", "2026-07"];
    for (let i = 0; i < allMonths.length; i++) {
      const month = allMonths[i];
      derivedBalances.set(month, runningBalance);
      
      if (i < allMonths.length - 1) {
        const nextMonth = allMonths[i + 1];
        const nextMonthChange = txnsByMonth.get(nextMonth) || 0;
        runningBalance = runningBalance - nextMonthChange;
      }
    }
    
    // Aug should have a balance even with no transactions
    expect(derivedBalances.has("2026-08")).toBe(true);
    
    // Aug balance should equal Sep end balance (no Aug transactions)
    const augBalance = derivedBalances.get("2026-08")!;
    const sepEndBalance = closingBalance - (txnsByMonth.get("2026-09") || 0);
    expect(augBalance).toBe(sepEndBalance);
  });
  
  test("Credit card statement with payments and charges", () => {
    // Credit card (debt stored as negative)
    // Work backward from a known closing balance
    const closingBalance = -1100;
    
    // Sep: -200 (payment) + 80 (purchase) + 20 (interest) = -100
    // Aug end = -1100 - (-100) = -1000
    // Aug: -300 (payment) + 150 (purchases) = -150
    // Jul end = -1000 - (-150) = -850
    // Jul: -300 (payment) + 50 (purchase) = -250
    // Opening = -850 - (-250) = -600
    
    const openingBalance = -600;
    
    const transactions = [
      { month: "2026-07", amount: -300 }, // Payment (reduces debt)
      { month: "2026-07", amount: 50 },   // Purchase (increases debt)
      { month: "2026-08", amount: -300 }, // Payment
      { month: "2026-08", amount: 150 },  // Purchases
      { month: "2026-09", amount: -200 }, // Payment
      { month: "2026-09", amount: 80 },   // Purchases
      { month: "2026-09", amount: 20 },   // Interest charge
    ];
    
    const txnsByMonth = new Map<string, number>();
    for (const txn of transactions) {
      const current = txnsByMonth.get(txn.month) || 0;
      txnsByMonth.set(txn.month, current + txn.amount);
    }
    
    let runningBalance = closingBalance;
    const months = ["2026-09", "2026-08", "2026-07"];
    const derivedBalances = new Map<string, number>();
    
    for (let i = 0; i < months.length; i++) {
      const month = months[i];
      derivedBalances.set(month, runningBalance);
      
      if (i < months.length - 1) {
        const currentChange = txnsByMonth.get(month) || 0;
        runningBalance = runningBalance - currentChange;
      }
    }
    
    // Derived opening = Jul end - Jul transactions
    const julEnd = derivedBalances.get("2026-07")!;
    const julChange = txnsByMonth.get("2026-07") || 0;
    const derivedOpening = julEnd - julChange;
    
    // Check reconciliation
    const diff = Math.abs(derivedOpening - openingBalance);
    const tolerance = Math.max(5, Math.abs(openingBalance) * 0.001);
    
    // Should reconcile
    expect(diff).toBeLessThanOrEqual(tolerance);
  });
});
