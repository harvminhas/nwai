import { describe, expect, it } from "vitest";
import {
  PARSER_CATEGORY_VALUES,
  USER_ONLY_PARENTS,
  buildCategoryPromptLines,
  defaultApplyToMerchant,
  isAssetPurchaseCategory,
  taxonomyForParser,
} from "../categoryTaxonomy";
import { getCategoryBucket } from "../moneyCoachBuckets";
import { CSV_PARSER_CATEGORIES } from "../csvParser";
import {
  computeTypicalSpend,
  isCoreExcluded,
  isNonSpendingGroup,
  isNotSpending,
  isTransferInterestOrCardServicing,
} from "../spendingMetrics";
import { computeMonthlyBuckets } from "../monthlyBucketComputation";
import { getMonthlyCashFlow } from "../monthlyCashFlow";
import { computeMoneyCoachBreakdown } from "../moneyCoach";
import { buildSpendingSummary, spendingForMonth } from "../spendingSummary";
import { SYSTEM_PROMPT } from "../parseStatement";
import type { ExpenseTxnRecord, IncomeTxnRecord } from "../extractTransactions";
import type { FinancialProfileCache } from "../financialProfile";
import { themeIdForCategory } from "../dailySpend";

const MONTH = "2026-10";

function expense(
  overrides: Partial<ExpenseTxnRecord> & Pick<ExpenseTxnRecord, "category" | "amount">,
): ExpenseTxnRecord {
  return {
    date: `${MONTH}-15`,
    merchant: overrides.merchant ?? "Test merchant",
    amount: overrides.amount,
    category: overrides.category,
    accountSlug: "td-chequing",
    accountLabel: "TD Chequing",
    txMonth: MONTH,
    ...overrides,
  };
}

const expenses: ExpenseTxnRecord[] = [
  expense({ merchant: "Grocery store", category: "Groceries", amount: 400 }),
  expense({ merchant: "Honda dealer", category: "Asset purchase", amount: 5000 }),
  expense({ merchant: "Brokerage", category: "Investments & Savings", amount: 800 }),
  expense({ merchant: "E-transfer", category: "Transfers", amount: 200 }),
];

const income: IncomeTxnRecord[] = [
  {
    date: `${MONTH}-01`,
    source: "Payroll",
    description: "Payroll",
    amount: 8000,
    category: "Salary",
    accountSlug: "td-chequing",
    accountLabel: "TD Chequing",
    txMonth: MONTH,
  },
];

describe("isNotSpending", () => {
  it("covers transfers, investments, asset purchases, and card servicing", () => {
    expect(isNotSpending("Transfers")).toBe(true);
    expect(isNotSpending("Transfers & Payments")).toBe(true);
    expect(isNotSpending("Interest")).toBe(true);
    expect(isNotSpending("Credit Card Payment")).toBe(true);
    expect(isNotSpending("Investments & Savings")).toBe(true);
    expect(isNotSpending("Asset purchase")).toBe(true);
    expect(isNotSpending("Vehicle")).toBe(true);
    expect(isNotSpending("Home & property")).toBe(true);
    expect(isNotSpending("Business investment")).toBe(true);
    expect(isNotSpending("Other asset")).toBe(true);
    expect(isNotSpending("Groceries")).toBe(false);
    expect(isNotSpending("Dining")).toBe(false);
    expect(isNotSpending("Debt Payments")).toBe(false);
  });

  it("isCoreExcluded uses the same function", () => {
    expect(isCoreExcluded("Asset purchase")).toBe(true);
    expect(isCoreExcluded("Investments & Savings")).toBe(true);
    expect(isCoreExcluded("Groceries")).toBe(false);
    expect(isCoreExcluded("Vehicle")).toBe(isNotSpending("Vehicle"));
    expect(isCoreExcluded("CA: RRSP")).toBe(isNotSpending("CA: RRSP"));
  });

  it("isNonSpendingGroup is only the two money-coach groups", () => {
    expect(isNonSpendingGroup("Asset purchase")).toBe(true);
    expect(isNonSpendingGroup("Vehicle")).toBe(true);
    expect(isNonSpendingGroup("Investments & Savings")).toBe(true);
    expect(isNonSpendingGroup("Transfers")).toBe(false);
    expect(isNonSpendingGroup("Groceries")).toBe(false);
  });

  it("isTransferInterestOrCardServicing does not include asset groups", () => {
    expect(isTransferInterestOrCardServicing("Transfers")).toBe(true);
    expect(isTransferInterestOrCardServicing("Investments & Savings")).toBe(false);
    expect(isTransferInterestOrCardServicing("Asset purchase")).toBe(false);
  });
});

describe("Asset purchase taxonomy", () => {
  it("is a user-only parent with Vehicle / Home & property / Business investment / Other asset", () => {
    expect(USER_ONLY_PARENTS).toContain("Asset purchase");
    expect(isAssetPurchaseCategory("Asset purchase")).toBe(true);
    expect(isAssetPurchaseCategory("Vehicle")).toBe(true);
    expect(isAssetPurchaseCategory("Home & property")).toBe(true);
    expect(isAssetPurchaseCategory("Business investment")).toBe(true);
    expect(isAssetPurchaseCategory("Other asset")).toBe(true);
    expect(isAssetPurchaseCategory("Investments & Savings")).toBe(false);
  });

  it("keeps stocks and crypto in Investments & Savings", () => {
    expect(isAssetPurchaseCategory("Stocks & ETFs")).toBe(false);
    expect(isAssetPurchaseCategory("Crypto")).toBe(false);
    expect(getCategoryBucket("Stocks & ETFs")).toBe("savings");
    expect(getCategoryBucket("Crypto")).toBe("savings");
    expect(isNotSpending("Stocks & ETFs")).toBe(true);
    expect(isNotSpending("Crypto")).toBe(true);
  });

  it("defaults recategorize to this transaction only", () => {
    expect(defaultApplyToMerchant("Asset purchase")).toBe(false);
    expect(defaultApplyToMerchant("Vehicle")).toBe(false);
    expect(defaultApplyToMerchant("Groceries")).toBe(true);
    expect(defaultApplyToMerchant("Investments & Savings")).toBe(true);
  });

  it("is excluded from AI prompt and CSV parser taxonomy", () => {
    expect(PARSER_CATEGORY_VALUES).not.toContain("Asset purchase");
    expect(PARSER_CATEGORY_VALUES).not.toContain("Vehicle");
    expect(taxonomyForParser().some(([parent]) => parent === "Asset purchase")).toBe(false);
    expect(CSV_PARSER_CATEGORIES.has("Asset purchase")).toBe(false);
    expect(CSV_PARSER_CATEGORIES.has("Vehicle")).toBe(false);
    expect(CSV_PARSER_CATEGORIES.has("Investments & Savings")).toBe(true);
    const promptLines = buildCategoryPromptLines();
    expect(promptLines).not.toMatch(/Asset purchase/i);
    expect(promptLines).not.toMatch(/\bVehicle\b/);
    expect(promptLines).not.toMatch(/Home & property/);
    // Frozen parse prompt may mention "asset purchase" in prose; it must not list it as a category.
    expect(SYSTEM_PROMPT).not.toMatch(/\n  Asset purchase/);
    expect(SYSTEM_PROMPT).not.toMatch(/Use one of:[^\n]*Asset purchase/);
  });

  it("maps to its own non-spending money-coach group", () => {
    expect(getCategoryBucket("Asset purchase")).toBe("assets");
    expect(getCategoryBucket("Vehicle")).toBe("assets");
    expect(getCategoryBucket("Investments & Savings")).toBe("savings");
  });
});

describe("spending surfaces agree for a month with an Asset purchase", () => {
  const buckets = computeMonthlyBuckets(MONTH, expenses, [], [], [], {}, "CAD");
  const spendingMonth = spendingForMonth(MONTH, expenses, [], [], [], {}, "CAD");
  const cash = getMonthlyCashFlow(
    { expenseTxns: expenses, incomeTxns: income, homeCurrency: "CAD" },
    MONTH,
  );
  const dashboardHeadline = expenses
    .filter((t) => !isCoreExcluded(t.category, { merchant: t.merchant, debtType: t.debtType }))
    .reduce((sum, t) => sum + t.amount, 0);
  const typical = computeTypicalSpend(expenses, "2026-11");
  const spending = buildSpendingSummary(expenses, [], [], [], {}, "CAD", [MONTH]);
  const coach = computeMoneyCoachBreakdown(
    {
      monthlyHistory: [
        {
          yearMonth: MONTH,
          incomeTotal: 8000,
          incomeTotalAllCredits: 8000,
          expensesTotal: 6400,
          coreExpensesTotal: 400,
          debtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          totalAssets: 0,
          totalDebts: 0,
          netWorth: 0,
        },
      ],
      expenseTxns: expenses,
      incomeTxns: income,
      coverage: { monthsCovered: 1, monthsSpan: 1, coveragePct: 100, missingMonths: [] },
      debtPaymentHistory: [],
      accountBalanceHistory: [],
      fxRates: {},
      accountSnapshots: [],
    } as unknown as FinancialProfileCache,
    [],
    income,
    [],
    "CAD",
    new Map(),
    [MONTH],
  );

  it("excludes Asset purchase and Investments & Savings from spending everywhere", () => {
    expect(buckets.total).toBe(400);
    expect(spendingMonth.total).toBe(400);
    expect(dashboardHeadline).toBe(400);
    expect(typical.median).toBe(400);
    expect(typical.avg).toBe(400);
    expect(cash.moneyOut).toBe(400);
    expect(spending.typicalMonthly).toBe(400);
    expect(coach.totalSpending).toBe(400);
    expect(coach.buckets.find((b) => b.bucket === "essentials")!.monthlyAverage).toBe(400);
    expect(buckets.total).toBe(cash.moneyOut);
    expect(buckets.total).toBe(spendingMonth.total);
    expect(buckets.total).toBe(dashboardHeadline);
    expect(buckets.total).toBe(spending.typicalMonthly);
    expect(buckets.total).toBe(coach.totalSpending);
  });

  it("reports Into assets as Asset purchases + Investments & Savings", () => {
    expect(buckets.intoAssets).toBe(5800);
    expect(spendingMonth.intoAssets).toBe(5800);
    expect(cash.intoAssets).toBe(5800);
    expect(cash.intoAssetsLines.map((l) => l.name).sort()).toEqual([
      "Asset purchases",
      "Investments & Savings",
    ]);
    expect(spending.monthlyHistory.find((m) => m.yearMonth === MONTH)?.intoAssets).toBe(5800);
  });

  it("keeps leftover as income minus spending, and cash after asset moves subtracts Into assets", () => {
    expect(cash.leftover).toBe(7600);
    expect(cash.cashAfterAssetMoves).toBe(1800);
    expect(cash.savingsRate).toBeCloseTo(7600 / 8000, 5);
  });
});

describe("daily spend tool", () => {
  it("does not include Asset purchase in spend themes", () => {
    expect(themeIdForCategory("Asset purchase")).toBeNull();
    expect(themeIdForCategory("Vehicle")).toBeNull();
    expect(themeIdForCategory("Home & property")).toBeNull();
    expect(themeIdForCategory("Groceries")).toBe("food");
  });
});
