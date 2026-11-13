import { describe, expect, it } from "vitest";
import type { MonthlyHistoryEntry } from "../financialProfile";
import {
  computeMonthGrowth,
  computeNetWorthGrowth,
  flowExplained,
  formatGrowthChartTitle,
  isDebtAccountType,
  isInterestNotInSpending,
  isInterestOrFeeCategory,
  isInvestmentAccountType,
  sumGrowthBreakdowns,
  type NetWorthGrowthInput,
} from "../netWorthGrowth";

function month(partial: Partial<MonthlyHistoryEntry> & { yearMonth: string; netWorth: number }): MonthlyHistoryEntry {
  return {
    expensesTotal: 0,
    coreExpensesTotal: 0,
    incomeTotal: 0,
    incomeTotalAllCredits: 0,
    debtPaymentsTotal: 0,
    cardServicingPaymentsTotal: 0,
    minDebtPaymentsTotal: 0,
    totalAssets: Math.max(0, partial.netWorth),
    totalDebts: 0,
    byAccount: [],
    ...partial,
  };
}

describe("account type classification", () => {
  it("does not treat an overdrawn chequing account as debt", () => {
    expect(isDebtAccountType("checking", -400)).toBe(false);
    expect(isDebtAccountType("credit", -400)).toBe(true);
    expect(isDebtAccountType("line_of_credit", -20000)).toBe(true);
  });

  it("treats TFSA/RRSP savings labels as investment-type", () => {
    expect(isInvestmentAccountType("investment", "Brokerage")).toBe(true);
    expect(isInvestmentAccountType("savings", "TD TFSA")).toBe(true);
    expect(isInvestmentAccountType("savings", "Everyday Savings")).toBe(false);
  });
});

describe("interest vs fees already in spending", () => {
  it("Fees stay in spending; Interest is core-excluded", () => {
    expect(isInterestOrFeeCategory("Bank Fees")).toBe(true);
    expect(isInterestOrFeeCategory("Annual Card Fee")).toBe(true);
    expect(isInterestNotInSpending("Bank Fees")).toBe(false);
    expect(isInterestNotInSpending("Annual Card Fee")).toBe(false);
    expect(isInterestNotInSpending("Interest")).toBe(true);
    expect(isInterestNotInSpending("Installment Servicing")).toBe(false);
  });
});

describe("gross savings", () => {
  const previous = month({
    yearMonth: "2026-09",
    netWorth: 10000,
    byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 10000 }],
  });

  it("gross savings = income − spending, with savings rate", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 12000,
      incomeTotal: 5000,
      coreExpensesTotal: 3000,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 12000 }],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.grossSavings).toBe(2000);
    expect(result.savingsRate).toBeCloseTo(0.4);
    expect(result.savingsForReconciliation).toBe(2000);
    expect(result.unexplained).toBe(0);
    expect(flowExplained(result)).toBe(result.netWorthChange);
  });

  it("strips investment-statement deposits out of income", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 15500,
      incomeTotal: 6500, // 6000 salary + 500 TFSA deposit wrongly included
      coreExpensesTotal: 4000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10500 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 14000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 4000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-10", amount: 500, accountSlug: "tfsa", category: "Salary" }],
      debtPaymentHistory: [],
    });
    expect(result.income).toBe(6000);
    expect(result.grossSavings).toBe(2000);
  });

  it("does not strip deposits already excluded from incomeTotal (TFR descriptor)", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 15500,
      incomeTotal: 6000, // TFR deposit already excluded by profile
      coreExpensesTotal: 4000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10500 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 14000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 4000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [],
      incomeTxns: [{
        txMonth: "2026-10",
        amount: 500,
        accountSlug: "tfsa",
        category: "Salary",
        source: "TFR-TO TFSA",
      }],
      debtPaymentHistory: [],
    });
    expect(result.income).toBe(6000);
    expect(result.grossSavings).toBe(2000);
  });

  it("does not strip deposits already excluded via a user Transfer income rule", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 15500,
      incomeTotal: 6000,
      coreExpensesTotal: 4000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10500 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 14000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 4000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [],
      incomeTxns: [{
        txMonth: "2026-10",
        amount: 500,
        accountSlug: "tfsa",
        category: "Salary",
        source: "CONTRIBUTION",
      }],
      debtPaymentHistory: [],
      incomeCategoryRules: { contribution: "Transfer" },
    });
    expect(result.income).toBe(6000);
  });

  it("does not strip deposits already excluded via saved transfer sources", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 15500,
      incomeTotal: 6000,
      coreExpensesTotal: 4000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10500 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 14000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 4000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [],
      incomeTxns: [{
        txMonth: "2026-10",
        amount: 500,
        accountSlug: "tfsa",
        category: "Salary",
        source: "CONTRIBUTION",
      }],
      debtPaymentHistory: [],
      userTransferSources: ["CONTRIBUTION"],
    });
    expect(result.income).toBe(6000);
    expect(result.grossSavings).toBe(2000);
  });
});

describe("flow identity: review example (no double counting)", () => {
  it("income 6000, spending 4000 with 800 card charges, pay card 1000, TFSA transfer 500, market +100 → ΔNW 2100, unexplained 0", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 14000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "visa", label: "Visa", type: "credit", value: -1000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 16100,
      incomeTotal: 6000,
      coreExpensesTotal: 4000, // 3200 cash + 800 card charges; payment and TFSA transfer excluded
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 6300 },
        { slug: "visa", label: "Visa", type: "credit", value: -800 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10600 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 3200, category: "Groceries", accountSlug: "chk" },
        { txMonth: "2026-10", amount: 800, category: "Shopping", accountSlug: "visa" },
        { txMonth: "2026-10", amount: 1000, category: "Card Servicing", accountSlug: "chk" },
        { txMonth: "2026-10", amount: 500, category: "Transfers", accountSlug: "chk" },
      ],
      incomeTxns: [{ txMonth: "2026-10", amount: 500, accountSlug: "tfsa", category: "Transfer In" }],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 1000, currency: "CAD" }],
    });

    expect(result.grossSavings).toBe(2000);
    expect(result.revolvingPaydown).toBe(200);
    expect(result.investedFromSavings).toBe(500);
    expect(result.investmentMarketGrowth).toBe(100);
    expect(result.installmentPrincipalAddBack).toBe(0);
    expect(result.interestFeesNotInSpending).toBe(0);
    expect(result.netWorthChange).toBe(2100);
    expect(result.unexplained).toBeCloseTo(0);
    expect(flowExplained(result)).toBeCloseTo(2100);
    // Allocation is NOT part of the recon total
    expect(result.cashKept).toBe(2000 - 200 - 500);
  });
});

describe("installment principal add-back and fees already in spending", () => {
  it("adds back mortgage principal already counted in spending; does not subtract installment interest again", () => {
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 10000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 110500 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -100500 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 11500,
      incomeTotal: 5000,
      coreExpensesTotal: 4000, // includes the $2000 installment payment
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 111500 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -100000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [
        {
          txMonth: "2026-10",
          amount: 2000,
          category: "Installment Servicing",
          accountSlug: "chk",
          installmentInterestAmount: 1500,
        },
      ],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "mtg", statementMonth: "2026-10", paymentsMade: 2000, currency: "CAD" }],
    });
    expect(result.grossSavings).toBe(1000);
    expect(result.interestFeesNotInSpending).toBe(0);
    expect(result.installmentPrincipalAddBack).toBe(500);
    expect(result.installmentAccounts[0].principalChange).toBe(500);
    expect(result.installmentAccounts[0].paydown).toBe(2000);
    expect(result.revolvingPaydown).toBe(0);
    expect(result.netWorthChange).toBe(1500);
    expect(result.unexplained).toBeCloseTo(0);
  });

  it("does not subtract a mortgage statement Interest line (principal add-back already nets it)", () => {
    const prior = month({
      yearMonth: "2026-09",
      netWorth: -88000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 12000 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -100000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: -89200,
      incomeTotal: 0,
      coreExpensesTotal: 2000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -99200 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [
        {
          txMonth: "2026-10",
          amount: 2000,
          category: "Installment Servicing",
          accountSlug: "chk",
        },
        { txMonth: "2026-10", amount: 1200, category: "Interest", accountSlug: "mtg" },
      ],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "mtg", statementMonth: "2026-10", paymentsMade: 2000, currency: "CAD" }],
    });
    expect(result.interestFeesNotInSpending).toBe(0);
    expect(result.installmentPrincipalAddBack).toBe(800);
    expect(result.netWorthChange).toBe(-1200);
    expect(result.unexplained).toBeCloseTo(0);
  });

  it("does not subtract annual card fees already in spending", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 9000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "visa", label: "Visa", type: "credit", value: -1000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 8861,
      incomeTotal: 0,
      coreExpensesTotal: 139,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "visa", label: "Visa", type: "credit", value: -1139 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [{ txMonth: "2026-10", amount: 139, category: "Annual Card Fee", accountSlug: "visa" }],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.interestFeesNotInSpending).toBe(0);
    expect(result.grossSavings).toBe(-139);
    expect(result.unexplained).toBeCloseTo(0);
  });

  it("does not subtract bank/NSF fees already in spending", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 10000,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 10000 }],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 9955,
      incomeTotal: 0,
      coreExpensesTotal: 45,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 9955 }],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [{ txMonth: "2026-10", amount: 45, category: "NSF/OD Fees", accountSlug: "chk" }],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.interestFeesNotInSpending).toBe(0);
    expect(result.grossSavings).toBe(-45);
    expect(result.unexplained).toBeCloseTo(0);
  });

  it("subtracts CC Interest that is not in spending", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 9000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "visa", label: "Visa", type: "credit", value: -1000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 8920,
      incomeTotal: 0,
      coreExpensesTotal: 0,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "visa", label: "Visa", type: "credit", value: -1080 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [{ txMonth: "2026-10", amount: 80, category: "Interest", accountSlug: "visa" }],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.interestFeesNotInSpending).toBe(80);
    expect(result.netSavings).toBe(-80);
    expect(result.unexplained).toBeCloseTo(0);
  });
});

describe("new accounts and overdrawn chequing", () => {
  it("puts a first-statement LOC on New accounts, not unexplained", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 10000,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 10000 }],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: -10000,
      incomeTotal: 0,
      coreExpensesTotal: 0,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "loc", label: "Home LOC", type: "line_of_credit", value: -20000 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.newAccountsTotal).toBe(-20000);
    expect(result.debtPaydown).toBe(0);
    expect(result.unexplained).toBeCloseTo(0);
  });

  it("keeps overdrawn chequing as cash, not a debt account", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 500,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 500 }],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: -400,
      incomeTotal: 0,
      coreExpensesTotal: 900,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: -400 }],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [{ txMonth: "2026-10", amount: 900, category: "Groceries", accountSlug: "chk" }],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.debtAccounts).toHaveLength(0);
    expect(result.grossSavings).toBe(-900);
    expect(result.unexplained).toBeCloseTo(0);
  });
});

describe("debt paydown stays an allocation (PR #76 Paid − New charges)", () => {
  const previous = month({
    yearMonth: "2026-09",
    netWorth: 9000,
    byAccount: [
      { slug: "chk", label: "Checking", type: "checking", value: 10000 },
      { slug: "visa", label: "Visa", type: "credit", value: -1000 },
    ],
  });

  it("paydown = paymentsMade − new charges", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 8700,
      incomeTotal: 0,
      coreExpensesTotal: 300,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 9500 },
        { slug: "visa", label: "Visa", type: "credit", value: -800 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [{ txMonth: "2026-10", amount: 300, category: "Shopping", accountSlug: "visa" }],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 500, currency: "CAD" }],
    });
    expect(result.revolvingPaydown).toBe(200);
    expect(result.debtAccounts[0].kind).toBe("revolving");
    expect(result.unexplained).toBeCloseTo(0);
  });

  it("treats CSV-shaped and PDF-shaped debt txns the same", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 8950,
      incomeTotal: 0,
      coreExpensesTotal: 0,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 9900 },
        { slug: "visa", label: "Visa", type: "credit", value: -950 },
      ],
    });
    const input = {
      expenseTxns: [{ txMonth: "2026-10", amount: 50, category: "Interest", accountSlug: "visa" }],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 100, currency: "CAD" }],
    };
    const csv = computeMonthGrowth(current, previous, input);
    const pdf = computeMonthGrowth(current, previous, input);
    expect(csv.revolvingPaydown).toBe(pdf.revolvingPaydown);
    expect(csv.interestFeesNotInSpending).toBe(pdf.interestFeesNotInSpending);
    expect(csv.unexplained).toBeCloseTo(0);
  });
});

describe("investment split", () => {
  it("splits Δ into contributions and market growth", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 50000,
      byAccount: [{ slug: "tfsa", label: "TFSA", type: "investment", value: 50000 }],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 53000,
      incomeTotal: 0,
      coreExpensesTotal: 0,
      byAccount: [{ slug: "tfsa", label: "TFSA", type: "investment", value: 53000 }],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [{ txMonth: "2026-10", amount: 200, category: "Transfers", accountSlug: "tfsa" }],
      incomeTxns: [{ txMonth: "2026-10", amount: 1000, accountSlug: "tfsa", category: "Transfer In" }],
      debtPaymentHistory: [],
    });
    expect(result.investmentAccounts[0].split).toBe("split");
    expect(result.investmentMarketGrowth).toBe(2200);
    expect(result.investedFromSavings).toBe(800);
  });

  it("keeps unsplit Δ out of the recon total when the contribution was a Transfer", () => {
    // Review example: income 6000, spending 4000, $1000 card payment, $500 TFSA
    // Transfer, markets +$100, TFSA statement has no deposit/withdrawal lines.
    // Adding unsplit $600 into the total would show $2600 vs actual ΔNW $2100.
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 14000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "visa", label: "Visa", type: "credit", value: -1000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 16100,
      incomeTotal: 6000,
      coreExpensesTotal: 4000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 6300 },
        { slug: "visa", label: "Visa", type: "credit", value: -800 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10600 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 3200, category: "Groceries", accountSlug: "chk" },
        { txMonth: "2026-10", amount: 800, category: "Shopping", accountSlug: "visa" },
        { txMonth: "2026-10", amount: 1000, category: "Card Servicing", accountSlug: "chk" },
        { txMonth: "2026-10", amount: 500, category: "Transfers", accountSlug: "chk" },
      ],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 1000, currency: "CAD" }],
    });
    expect(result.grossSavings).toBe(2000);
    expect(result.investmentUnsplit).toBe(600);
    expect(result.investmentMarketGrowth).toBe(0);
    expect(result.spendingInvestmentAddBack).toBe(0);
    expect(result.netWorthChange).toBe(2100);
    expect(result.unexplained).toBeCloseTo(100);
    expect(flowExplained(result)).toBeCloseTo(result.netWorthChange!);
    expect(flowExplained(result)).not.toBeCloseTo(2000 + 600);
  });

  it("keeps unsplit Δ out of the recon total when the contribution was counted as spending", () => {
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 50000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 2000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 48000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 54500,
      incomeTotal: 5000,
      coreExpensesTotal: 2500,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 4500 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 50000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 2000, category: "Groceries", accountSlug: "chk" },
        { txMonth: "2026-10", amount: 500, category: "Investments & Savings", accountSlug: "chk" },
      ],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.investmentAccounts[0].split).toBe("unsplit");
    expect(result.investmentMarketGrowth).toBe(0);
    expect(result.investmentUnsplit).toBe(2000);
    expect(result.investedFromSavings).toBe(500);
    expect(result.spendingInvestmentAddBack).toBe(0);
    expect(result.grossSavings).toBe(2500);
    expect(result.netWorthChange).toBe(4500);
    expect(result.unexplained).toBeCloseTo(2000);
    expect(flowExplained(result)).toBeCloseTo(result.netWorthChange!);
  });

  it("strips investment-statement withdrawals that were counted as spending", () => {
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 15000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 15000,
      incomeTotal: 0,
      coreExpensesTotal: 500,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5500 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 9500 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [{ txMonth: "2026-10", amount: 500, category: "Other", accountSlug: "tfsa" }],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.spending).toBe(0);
    expect(result.investmentWithdrawals).toBe(500);
    expect(result.investmentMarketGrowth).toBe(0);
    expect(result.unexplained).toBeCloseTo(0);
  });

  it("adds investment withdrawals back into cash kept so it matches checking change", () => {
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 15000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 15000,
      incomeTotal: 0,
      coreExpensesTotal: 1000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 6000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 9000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [{ txMonth: "2026-10", amount: 1000, category: "Other", accountSlug: "tfsa" }],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    const checkingChange =
      (current.byAccount!.find((a) => a.slug === "chk")!.value) -
      (prior.byAccount!.find((a) => a.slug === "chk")!.value);
    expect(result.investmentWithdrawals).toBe(1000);
    expect(result.spending).toBe(0);
    expect(result.cashKept).toBe(1000);
    expect(result.cashKept).toBe(checkingChange);
    expect(result.netWorthChange).toBe(0);
    expect(result.unexplained).toBeCloseTo(0);
    expect(flowExplained(result)).toBeCloseTo(result.netWorthChange!);
  });

  it("splits a savings-type TFSA the same way as an investment account", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 10000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TD TFSA", type: "savings", value: 5000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 11600,
      incomeTotal: 2000,
      coreExpensesTotal: 500,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 6000 },
        { slug: "tfsa", label: "TD TFSA", type: "savings", value: 5600 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 500, category: "Groceries", accountSlug: "chk" },
        { txMonth: "2026-10", amount: 500, category: "Transfers", accountSlug: "chk" },
      ],
      incomeTxns: [{ txMonth: "2026-10", amount: 500, accountSlug: "tfsa", category: "Transfer In" }],
      debtPaymentHistory: [],
    });
    expect(result.investmentAccounts[0].split).toBe("split");
    expect(result.investedFromSavings).toBe(500);
    expect(result.investmentMarketGrowth).toBe(100);
    expect(result.unexplained).toBeCloseTo(0);
  });

  it("adds back Investments & Savings already in spending when the TFSA split is known", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 10000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 5000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 5000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 11600,
      incomeTotal: 2000,
      coreExpensesTotal: 1000, // 500 groceries + 500 Investments & Savings
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 6000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 5600 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 500, category: "Groceries", accountSlug: "chk" },
        { txMonth: "2026-10", amount: 500, category: "CA: TFSA", accountSlug: "chk" },
      ],
      incomeTxns: [{ txMonth: "2026-10", amount: 500, accountSlug: "tfsa", category: "Transfer In" }],
      debtPaymentHistory: [],
    });
    expect(result.grossSavings).toBe(1000);
    expect(result.spendingInvestmentAddBack).toBe(500);
    expect(result.investedFromSavings).toBe(500);
    expect(result.investmentMarketGrowth).toBe(100);
    expect(result.unexplained).toBeCloseTo(0);
  });
});

describe("other assets", () => {
  it("counts manual asset valuation changes for existing assets", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 300000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "manual-house", label: "House", type: "manual-property", value: 290000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 315000,
      incomeTotal: 5000,
      coreExpensesTotal: 4000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 11000 },
        { slug: "manual-house", label: "House", type: "manual-property", value: 304000 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.otherAssetChanges).toBe(14000);
    expect(result.newAccountsTotal).toBe(0);
    expect(result.unexplained).toBeCloseTo(0);
  });

  it("always surfaces a remainder as unexplained when data is incomplete", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 10000,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 10000 }],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 11250.5,
      incomeTotal: 3000,
      coreExpensesTotal: 2000,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 11250.5 }],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.unexplained).toBeCloseTo(250.5);
    expect(flowExplained(result)).toBeCloseTo(1250.5);
  });
});

describe("complete realistic month — unexplained ≈ 0", () => {
  it("card payment + TFSA transfer + mortgage installment + annual fee + new LOC + overdrawn chequing", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: -190500,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 500 },
        { slug: "visa", label: "Visa", type: "credit", value: -1000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -200000 },
      ],
    });
    // Checking: 500+6000-4000 groc -1000 card pay -500 TFSA -2000 mtg = -1000
    // Visa: -1000-800-139-50+1000 = -989
    // TFSA: 10000+500+100 = 10600
    // Mtg: -199500
    // LOC new: -20000
    // NW = -1000-989+10600-199500-20000 = -210889
    const current = month({
      yearMonth: "2026-10",
      netWorth: -210889,
      incomeTotal: 6000,
      coreExpensesTotal: 4000 + 800 + 139 + 2000, // groc + card charges + annual fee + installment
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: -1000 },
        { slug: "visa", label: "Visa", type: "credit", value: -989 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 10600 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -199500 },
        { slug: "loc", label: "Home LOC", type: "line_of_credit", value: -20000 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 4000, category: "Groceries", accountSlug: "chk" },
        { txMonth: "2026-10", amount: 1000, category: "Card Servicing", accountSlug: "chk" },
        { txMonth: "2026-10", amount: 500, category: "Transfers", accountSlug: "chk" },
        {
          txMonth: "2026-10",
          amount: 2000,
          category: "Installment Servicing",
          accountSlug: "chk",
          installmentInterestAmount: 1500,
        },
        { txMonth: "2026-10", amount: 800, category: "Shopping", accountSlug: "visa" },
        { txMonth: "2026-10", amount: 139, category: "Annual Card Fee", accountSlug: "visa" },
        { txMonth: "2026-10", amount: 50, category: "Interest", accountSlug: "visa" },
      ],
      incomeTxns: [{ txMonth: "2026-10", amount: 500, accountSlug: "tfsa", category: "Transfer In" }],
      debtPaymentHistory: [
        { accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 1000, currency: "CAD" },
        { accountSlug: "mtg", statementMonth: "2026-10", paymentsMade: 2000, currency: "CAD" },
      ],
    });

    expect(result.debtAccounts.find((a) => a.slug === "chk")).toBeUndefined();
    expect(result.grossSavings).toBe(6000 - 6939);
    expect(result.interestFeesNotInSpending).toBe(50);
    expect(result.installmentPrincipalAddBack).toBe(500);
    expect(result.investmentMarketGrowth).toBe(100);
    expect(result.newAccountsTotal).toBe(-20000);
    expect(result.revolvingPaydown).toBe(1000 - (800 + 139));
    expect(result.investedFromSavings).toBe(500);
    expect(result.cashKept).toBeCloseTo(-1500);
    expect(result.netWorthChange).toBe(-20389);
    expect(result.unexplained).toBeCloseTo(0, 6);
    expect(flowExplained(result)).toBeCloseTo(-20389);
  });
});

describe("range summation", () => {
  it("sums flow components and savings rate over the range", () => {
    const history: MonthlyHistoryEntry[] = [
      month({
        yearMonth: "2026-08",
        netWorth: 10000,
        incomeTotal: 4000,
        coreExpensesTotal: 3000,
        byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 10000 }],
      }),
      month({
        yearMonth: "2026-09",
        netWorth: 11500,
        incomeTotal: 4000,
        coreExpensesTotal: 2500,
        byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 11500 }],
      }),
      month({
        yearMonth: "2026-10",
        netWorth: 13500,
        incomeTotal: 5000,
        coreExpensesTotal: 3000,
        byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 13500 }],
      }),
    ];
    const input: NetWorthGrowthInput = {
      monthlyHistory: history,
      expenseTxns: [],
      incomeTxns: [],
      debtPaymentHistory: [],
    };
    const months = computeNetWorthGrowth(input);
    const range = sumGrowthBreakdowns(months, ["2026-09", "2026-10"]);
    expect(range!.income).toBe(9000);
    expect(range!.grossSavings).toBe(3500);
    expect(range!.savingsRate).toBeCloseTo(3500 / 9000);
    expect(range!.netWorthChange).toBe(3500);
    expect(range!.unexplained).toBeCloseTo(0);
    expect(flowExplained(range!)).toBeCloseTo(3500);

    const all = sumGrowthBreakdowns(months);
    // First history month is the baseline, not a growth month.
    expect(all!.grossSavings).toBe(3500);
    expect(all!.netWorthChange).toBe(3500);
    expect(all!.unexplained).toBeCloseTo(0);
  });
});

describe("12-month chart window", () => {
  it("computes the first visible month's change from the month before the window", () => {
    const history: MonthlyHistoryEntry[] = [];
    for (let i = 0; i < 15; i++) {
      const d = new Date(2025, i, 1);
      const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      history.push(month({
        yearMonth: ym,
        netWorth: i * 1000,
        incomeTotal: i === 0 ? 0 : 1000,
        coreExpensesTotal: 0,
        byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: i * 1000 }],
      }));
    }
    const months = computeNetWorthGrowth(
      { monthlyHistory: history, expenseTxns: [], incomeTxns: [], debtPaymentHistory: [] },
      { windowMonths: 12 },
    );
    expect(months).toHaveLength(12);
    expect(months[0].yearMonth).toBe("2025-04");
    expect(months[0].hasPreviousMonth).toBe(true);
    expect(months[0].netWorthChange).toBe(1000);
    expect(months[0].unexplained).toBeCloseTo(0);

    const range = sumGrowthBreakdowns(months, months.map((m) => m.yearMonth));
    expect(range!.netWorthChange).toBe(12000);
    expect(range!.unexplained).toBeCloseTo(0);
    expect(flowExplained(range!)).toBeCloseTo(12000);
  });
});

describe("chart title", () => {
  it("reflects the selected 3M/6M/All range", () => {
    expect(formatGrowthChartTitle(3)).toBe("3-Month Trend");
    expect(formatGrowthChartTitle(6)).toBe("6-Month Trend");
    expect(formatGrowthChartTitle(0)).toBe("All-time Trend");
  });
});
