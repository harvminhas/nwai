/**
 * Unit test for AI chat tool executors
 * Verifies each tool executes without exceptions using synthetic profile data
 */

import { executeTool } from "../src/lib/chat/executor";
import type { FinancialProfileCache } from "../src/lib/financialProfile";

// Create synthetic profile for testing
const syntheticProfile: FinancialProfileCache = {
  updatedAt: new Date().toISOString(),
  sourceVersion: "test",
  schemaVersion: "1",
  monthlyHistory: [
    {
      yearMonth: "2026-09",
      incomeTotal: 5000,
      coreExpensesTotal: 3000,
      debtPaymentsTotal: 500,
      minDebtPaymentsTotal: 500,
      cardServicingPaymentsTotal: 0,
    },
    {
      yearMonth: "2026-10",
      incomeTotal: 5200,
      coreExpensesTotal: 3100,
      debtPaymentsTotal: 500,
      minDebtPaymentsTotal: 500,
      cardServicingPaymentsTotal: 0,
    },
    {
      yearMonth: "2026-11",
      incomeTotal: 5100,
      coreExpensesTotal: 3050,
      debtPaymentsTotal: 500,
      minDebtPaymentsTotal: 500,
      cardServicingPaymentsTotal: 0,
    },
  ],
  typicalMonthly: { median: 3000, avg: 3050, basisMonthsUsed: 3 },
  coverage: { monthsCovered: 3, monthsSpan: 3, coveragePct: 100, missingMonths: [] },
  manualAssets: [],
  balanceSnapshots: [],
  expenseTxns: [
    {
      date: "2026-11-15",
      txMonth: "2026-11",
      amount: 100,
      merchant: "Test Merchant",
      category: "Groceries",
      accountSlug: "test-account",
      accountLabel: "Test Account",
      currency: "CAD",
    },
  ],
  incomeTxns: [
    {
      date: "2026-11-01",
      txMonth: "2026-11",
      amount: 5100,
      source: "Test Employer",
      description: "Payroll",
      accountSlug: "test-account",
      currency: "CAD",
    },
  ],
  accountSnapshots: [
    {
      slug: "test-checking",
      bankName: "Test Bank",
      accountId: "1234",
      accountType: "checking",
      balance: 10000,
      currency: "CAD",
    },
  ],
  allTxMonths: ["2026-09", "2026-10", "2026-11"],
  latestTxMonth: "2026-11",
  portfolioHoldings: [],
  homeCurrency: "CAD",
  fxRates: {},
  accountRates: [],
  debtPaymentHistory: [],
  accountBalanceHistory: [
    {
      slug: "test-checking",
      label: "Test Bank ••••1234",
      accountType: "checking",
      currency: "CAD",
      entries: [
        { yearMonth: "2026-09", balance: 9000 },
        { yearMonth: "2026-10", balance: 9500 },
        { yearMonth: "2026-11", balance: 10000 },
      ],
    },
  ],
  confirmedSubscriptions: [
    {
      merchantSlug: "netflix",
      name: "Netflix",
      amount: 15,
      frequency: "monthly",
      currency: "CAD",
      status: "active",
      lastSeenAt: "2026-11-01",
    },
  ],
  cashCommitmentEntries: [
    {
      id: "test-1",
      name: "Gym Membership",
      amount: 50,
      frequency: "monthly",
      category: "Healthcare",
      status: "active",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    },
  ],
  goals: [],
};

console.log("🧪 Testing AI Chat Tool Executors\n");

let passCount = 0;
let failCount = 0;

function testTool(name: string, params: Record<string, unknown>) {
  try {
    console.log(`Testing: ${name}`);
    const result = executeTool(name, params, syntheticProfile);
    
    if (!result.ok) {
      console.log(`  ❌ FAIL: ${result.error}`);
      failCount++;
      return;
    }
    
    if (!result.data) {
      console.log(`  ❌ FAIL: No data returned`);
      failCount++;
      return;
    }
    
    console.log(`  ✅ PASS: Returned data with ${Object.keys(result.data).length} fields`);
    passCount++;
  } catch (err) {
    console.log(`  ❌ FAIL: Exception: ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.stack) {
      console.log(`     Stack: ${err.stack.split('\n').slice(0, 3).join('\n')}`);
    }
    failCount++;
  }
}

// Test all new tools
testTool("get_income_summary", { range: "3mo" });
testTool("get_spending_summary", { range: "3mo" });
testTool("list_cash_expenses", {});
testTool("get_savings_summary", { range: "3mo" });
testTool("get_net_worth", {});
testTool("list_accounts", {});
testTool("list_subscriptions", {});
testTool("list_plans", {});

console.log(`\n📊 Results: ${passCount} passed, ${failCount} failed`);

if (failCount > 0) {
  process.exit(1);
}

console.log("✅ All tests passed");
