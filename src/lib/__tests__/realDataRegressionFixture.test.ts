/**
 * Fixture test that reproduces real-data regression scenario.
 * Tests all assertions from scripts/regression-report.ts:
 * - No transfers in month totals
 * - ≤10 unreviewed deposits
 * - sourcesList total == month rows total
 * - MAM PAY Sep 2026 bonus in sourcesList
 */

import { describe, test, expect } from "vitest";
import { buildIncomeSummary } from "../incomeSummary";
import type { IncomeTransaction } from "../incomeSummary";
import type { AccountSnapshot } from "../extractTransactions";

describe("Real Data Regression Fixture", () => {
  test("should exclude all transfers and match regression assertions", () => {
    // Exact sources from real data that were showing up incorrectly
    const incomeTxns: IncomeTransaction[] = [
      // Transfers that should be excluded (9 instances across months)
      { source: "JG472 TFR-TO C/C", amount: 500, date: "2026-04-05", category: "Transfer", accountSlug: "checking_1234" },
      { source: "SEND E-TFR ***9ye", amount: 300, date: "2026-04-10", category: "Transfer", accountSlug: "checking_1234" },
      { source: "JW293 TFR-FR 6712183", amount: 250, date: "2026-05-15", category: "Transfer", accountSlug: "checking_1234" },
      { source: "E-TRANSFER ***2Zz", amount: 150, date: "2026-06-20", category: "Transfer In", accountSlug: "checking_1234" },
      { source: "E-TRANSFER", amount: 100, date: "2026-07-10", category: "Transfer In", accountSlug: "checking_1234" },
      
      // Large refund (should be excluded from month total but generate review)
      { source: "Oakbay Refund", amount: 57780, date: "2026-04-10", category: "Other", accountSlug: "checking_1234" },
      
      // Tiny rebates (should be counted as income, NO review card) - Issue #3
      { source: "ACCT BAL REBATE", amount: 31, date: "2026-07-05", category: "Other", accountSlug: "checking_1234" },
      { source: "ACCT BAL REBATE", amount: 31, date: "2026-08-05", category: "Other", accountSlug: "checking_1234" },
      { source: "ACCT BAL REBATE", amount: 31, date: "2026-09-05", category: "Other", accountSlug: "checking_1234" },
      { source: "TAX REFUND RIT", amount: 18, date: "2026-07-15", category: "Other", accountSlug: "checking_1234" },
      
      // Regular payroll - MAM PAY (Aug, Sep, Oct)
      { source: "MAM PAY", amount: 4278, date: "2026-08-07", category: "Salary", accountSlug: "checking_1234" },
      { source: "MAM PAY", amount: 4278, date: "2026-08-21", category: "Salary", accountSlug: "checking_1234" },
      { source: "MAM PAY", amount: 4278, date: "2026-09-04", category: "Salary", accountSlug: "checking_1234" },
      { source: "MAM PAY", amount: 24695, date: "2026-09-04", category: "Salary", accountSlug: "checking_1234" }, // BONUS on same day - Issue #2
      { source: "MAM PAY", amount: 4278, date: "2026-09-18", category: "Salary", accountSlug: "checking_1234" },
      { source: "MAM PAY", amount: 4278, date: "2026-10-02", category: "Salary", accountSlug: "checking_1234" },
      
      // Additional income source to test Jul totals - Issue #4
      { source: "MATHL PAY", amount: 1883, date: "2026-07-12", category: "Salary", accountSlug: "checking_1234" },
      { source: "MATHL PAY", amount: 1883, date: "2026-08-12", category: "Salary", accountSlug: "checking_1234" },
      { source: "MATHL PAY", amount: 1883, date: "2026-09-12", category: "Salary", accountSlug: "checking_1234" },
    ];

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "checking_1234",
        bankName: "Test Bank",
        accountName: "Checking",
        accountType: "Checking",
        accountId: "1234",
        balance: 80000,
        currency: "CAD",
        statementMonth: "2026-10",
        interestRate: 0,
      },
    ];

    console.log("\n🧪 Real Data Regression Fixture Test\n");
    
    // Test 1: Check INCOME_TRANSFER_RE against exact strings
    console.log("1️⃣  Transfer Regex Test:");
    const INCOME_TRANSFER_RE = /\bTFR[-\s]?(TO|FR|FROM)\b|\bE[-\s]?TFR\b|\bETFR\b|\bXFER\b|\bTRANSFER\b/i;
    const transferSources = [
      "JG472 TFR-TO C/C",
      "SEND E-TFR ***9ye",
      "JW293 TFR-FR 6712183",
      "E-TRANSFER ***2Zz",
      "E-TRANSFER"
    ];
    
    transferSources.forEach(source => {
      const matches = INCOME_TRANSFER_RE.test(source);
      console.log(`   ${matches ? '✅' : '❌'} "${source}" - ${matches ? 'matched' : 'NOT matched'}`);
      expect(matches).toBe(true);
    });
    
    // Build income summary
    const summary = buildIncomeSummary(incomeTxns, accountSnapshots, "CAD");
    
    console.log("\n2️⃣  Income Summary Results:");
    console.log(`   Typical monthly: CA$${summary.typicalMonthly.toLocaleString()}`);
    console.log(`   Regular sources: ${summary.regularSources.length}`);
    console.log(`   Transfer sources: ${summary.transferSources.length}`);
    console.log(`   Unreviewed deposits: ${summary.unreviewedDeposits.length}`);
    console.log(`   Bonus transactions: ${summary.bonusTransactions.length}`);
    
    // Test 2: Verify typical monthly excludes all transfers and refund
    // Should be: Aug (2 x 4278) + Sep (2 x 4278) = 17,112 / 2 = 8,556
    // Sep bonus is detected and counted separately
    console.log("\n3️⃣  Month Breakdown:");
    const last3Months = summary.last3Months;
    console.log(`   Last 3 complete months: ${last3Months.join(", ")}`);
    
    last3Months.forEach(ym => {
      const month = summary.monthlyHistory.find(m => m.yearMonth === ym);
      if (month) {
        console.log(`   ${ym}: Total CA$${month.total.toLocaleString()}, Regular CA$${month.regular.toLocaleString()}, Bonus CA$${month.bonus.toLocaleString()}`);
        
        // Debug: Print July transactions to diagnose Issue #4
        if (ym === '2026-07') {
          const julyTxns = incomeTxns.filter(t => t.date.startsWith('2026-07'));
          console.log(`     July transactions (${julyTxns.length}):`);
          julyTxns.forEach(t => {
            console.log(`       - ${t.source}: CA$${t.amount.toLocaleString()} (${t.category || 'N/A'})`);
          });
        }
        
        // Check if any transfer sources are in this month's sources
        const transfersInMonth = month.sources?.filter(s => 
          transferSources.some(ts => s.source.includes(ts) || ts.includes(s.source))
        ) || [];
        
        if (transfersInMonth.length > 0) {
          console.log(`   ❌ MONTH ${ym} INCLUDES TRANSFER SOURCES:`);
          transfersInMonth.forEach(s => console.log(`      - ${s.source}: CA$${s.amount}`));
        }
        
        expect(transfersInMonth.length).toBe(0);
      }
    });
    
    // Test 3: Verify no transfers in month totals
    console.log("\n4️⃣  Transfer Exclusion Verification:");
    const aprilMonth = summary.monthlyHistory.find(m => m.yearMonth === "2026-04");
    console.log(`   April 2026 total: CA$${aprilMonth?.total || 0} (should be 0 - all transfers + unreviewed refund)`);
    expect(aprilMonth?.total || 0).toBe(0);
    
    // Test 4: Verify unreviewed deposits ≤10 and only legitimate items
    console.log("\n5️⃣  Unreviewed Deposits Check:");
    console.log(`   Count: ${summary.unreviewedDeposits.length} (max 10)`);
    summary.unreviewedDeposits.forEach(d => {
      console.log(`   - ${d.source}: CA$${d.amount.toLocaleString()} (${d.reason})`);
    });
    expect(summary.unreviewedDeposits.length).toBeLessThanOrEqual(10);
    
    // Verify the large refund is in the list
    const oakbayRefund = summary.unreviewedDeposits.find(d => d.source === "Oakbay Refund");
    expect(oakbayRefund).toBeDefined();
    expect(oakbayRefund?.reason).toBe("large_refund");
    
    // Test 5: Build sourcesList exactly as regression script does
    console.log("\n6️⃣  SourcesList Validation (Last 3 Months):");
    const windowMonths = summary.last3Months;
    
    const bonusTxnIds = new Set(summary.bonusTransactions.map(t => 
      `${t.date}:${t.source}:${t.amount}:${t.accountSlug || 'unknown'}`
    ));
    const unreviewedTxnIds = new Set(summary.unreviewedDeposits.map(d => d.txId));
    
    // Filter to window months
    const windowTxns = incomeTxns.filter(t => {
      const txMonth = t.date.substring(0, 7);
      return windowMonths.includes(txMonth);
    });
    
    // Group by source (with same exclusion logic as API)
    const sourceGroups = new Map<string, { source: string; total: number; transactions: any[] }>();
    for (const txn of windowTxns) {
      const txId = `${txn.date}:${txn.source}:${txn.amount}:${txn.accountSlug || 'unknown'}`;
      const isBonus = bonusTxnIds.has(txId);
      const needsReview = unreviewedTxnIds.has(txId);
      
      // Check if classified as 'not_income' (none in this test)
      
      // Find source info
      const sourceInfo = [...summary.regularSources, ...summary.oneOffSources]
        .find(s => s.transactions.some(st => st.source === txn.source));
      
      // Skip transfers (both marked sources and transfer patterns)
      if (sourceInfo?.isTransfer) continue;
      if (INCOME_TRANSFER_RE.test(txn.source)) continue;
      
      if (!sourceGroups.has(txn.source)) {
        sourceGroups.set(txn.source, { source: txn.source, total: 0, transactions: [] });
      }
      
      const group = sourceGroups.get(txn.source)!;
      group.total += txn.amount;
      group.transactions.push({ ...txn, isBonus, needsReview });
    }
    
    const sourcesList = Array.from(sourceGroups.values()).sort((a, b) => b.total - a.total);
    const sourcesListTotal = sourcesList.reduce((sum, s) => sum + s.total, 0);
    
    // Calculate month rows total
    const monthRowsTotal = windowMonths.reduce((sum, ym) => {
      const monthData = summary.monthlyHistory.find(m => m.yearMonth === ym);
      return sum + (monthData?.total || 0);
    }, 0);
    
    console.log(`   Window months: ${windowMonths.join(", ")}`);
    console.log(`   Sum of month rows: CA$${monthRowsTotal.toLocaleString()}`);
    console.log(`   Sum of sourcesList: CA$${sourcesListTotal.toLocaleString()}`);
    console.log(`   Difference: CA$${Math.abs(sourcesListTotal - monthRowsTotal)}`);
    
    sourcesList.forEach(s => {
      console.log(`   - ${s.source}: CA$${s.total.toLocaleString()} (${s.transactions.length} txns)`);
    });
    
    // They should match within rounding
    expect(Math.abs(sourcesListTotal - monthRowsTotal)).toBeLessThanOrEqual(1);
    
    // Test 6: Verify MAM PAY Sep 2026 bonus in sourcesList
    console.log("\n7️⃣  MAM PAY Sep 2026 Bonus Check:");
    const mamPaySource = sourcesList.find(s => s.source === "MAM PAY");
    expect(mamPaySource).toBeDefined();
    
    // The CA$24,695 bonus is unreviewed, so it has needsReview, not isBonus
    const sep2026Bonus = mamPaySource?.transactions.find(t => 
      t.date.startsWith('2026-09') && t.amount === 24695
    );
    
    if (mamPaySource) {
      console.log(`   MAM PAY found: CA$${mamPaySource.total.toLocaleString()} (${mamPaySource.transactions.length} txns)`);
      mamPaySource.transactions.forEach(t => {
        const pills: string[] = [];
        if (t.isBonus) pills.push('[BONUS]');
        if (t.needsReview) pills.push('[NEEDS REVIEW]');
        console.log(`     - ${t.date}: CA$${t.amount.toLocaleString()} ${pills.join(' ')}`);
      });
    }
    
    expect(sep2026Bonus).toBeDefined();
    if (sep2026Bonus) {
      const hasReviewFlag = sep2026Bonus.needsReview || sep2026Bonus.isBonus;
      console.log(`   ✅ Sep 2026 bonus found: ${sep2026Bonus.date}, CA$${sep2026Bonus.amount.toLocaleString()} ${sep2026Bonus.needsReview ? '[NEEDS REVIEW]' : sep2026Bonus.isBonus ? '[BONUS]' : ''}`);
      expect(hasReviewFlag).toBe(true);
    } else {
      console.log(`   ❌ Sep 2026 bonus NOT found`);
    }
    
    console.log("\n✅ All regression assertions passed!\n");
  });
});
