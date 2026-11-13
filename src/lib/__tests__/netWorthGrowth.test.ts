import { describe, expect, it } from "vitest";
import type { MonthlyHistoryEntry } from "../financialProfile";
import {
  computeMonthGrowth,
  computeNetWorthGrowth,
  isInterestOrFeeCategory,
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

function explained(b: ReturnType<typeof computeMonthGrowth>): number {
  return (
    b.savingsForReconciliation +
    b.debtPaydown +
    b.investmentDelta +
    b.otherAssetChanges +
    (b.unexplained ?? 0)
  );
}

describe("isInterestOrFeeCategory", () => {
  it("treats Interest and Fees parents as identifiable", () => {
    expect(isInterestOrFeeCategory("Interest")).toBe(true);
    expect(isInterestOrFeeCategory("Fees")).toBe(true);
    expect(isInterestOrFeeCategory("Bank Fees")).toBe(true);
    expect(isInterestOrFeeCategory("NSF/OD Fees")).toBe(true);
    expect(isInterestOrFeeCategory("Annual Card Fee")).toBe(true);
  });

  it("does not treat similarly named non-fee categories as fees", () => {
    expect(isInterestOrFeeCategory("Condo Fees")).toBe(false);
    expect(isInterestOrFeeCategory("School Fees")).toBe(false);
    expect(isInterestOrFeeCategory("Dining")).toBe(false);
  });
});

describe("gross and net savings", () => {
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
    expect(result.netSavings).toBeNull();
    expect(result.savingsForReconciliation).toBe(2000);
  });

  it("savings rate is null when income is 0", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 9000,
      incomeTotal: 0,
      coreExpensesTotal: 1000,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 9000 }],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.grossSavings).toBe(-1000);
    expect(result.savingsRate).toBeNull();
  });

  it("net savings = gross − identifiable interest and fees", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 11900,
      incomeTotal: 5000,
      coreExpensesTotal: 3000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 12800 },
        { slug: "visa", label: "Visa", type: "credit", value: -900 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 80, category: "Interest", accountSlug: "visa" },
        { txMonth: "2026-10", amount: 20, category: "Bank Fees", accountSlug: "visa" },
        { txMonth: "2026-10", amount: 200, category: "Shopping", accountSlug: "visa" },
      ],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 400, currency: "CAD" }],
    });
    expect(result.interestAndFeesIdentifiable).toBe(true);
    expect(result.interestAndFees).toBe(100);
    expect(result.netSavings).toBe(1900);
    expect(result.savingsForReconciliation).toBe(1900);
  });

  it("shows gross only when debt statements have charges but no interest/fee lines", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 11000,
      incomeTotal: 5000,
      coreExpensesTotal: 3000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 12000 },
        { slug: "visa", label: "Visa", type: "credit", value: -1000 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 300, category: "Shopping", accountSlug: "visa" },
      ],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 200, currency: "CAD" }],
    });
    expect(result.interestAndFeesIdentifiable).toBe(false);
    expect(result.netSavings).toBeNull();
    expect(result.interestAndFeesMissingNote).toBe(true);
    expect(result.savingsForReconciliation).toBe(2000);
  });

  it("counts installmentInterestAmount on a mortgage payment as identifiable interest", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 10500,
      incomeTotal: 5000,
      coreExpensesTotal: 4000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 110500 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -100000 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 10000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 110500 },
        { slug: "mtg", label: "Mortgage", type: "mortgage", value: -100500 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      expenseTxns: [
        {
          txMonth: "2026-10",
          amount: 2000,
          category: "Installment Servicing",
          accountSlug: "mtg",
          installmentInterestAmount: 1500,
        },
      ],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "mtg", statementMonth: "2026-10", paymentsMade: 2000, currency: "CAD" }],
    });
    expect(result.interestAndFeesIdentifiable).toBe(true);
    expect(result.interestAndFees).toBe(1500);
    expect(result.netSavings).toBe(1000 - 1500);
  });
});

describe("debt paydown (Paid − New charges)", () => {
  const previous = month({
    yearMonth: "2026-09",
    netWorth: 9000,
    byAccount: [
      { slug: "chk", label: "Checking", type: "checking", value: 10000 },
      { slug: "visa", label: "Visa", type: "credit", value: -1000 },
    ],
  });

  it("paydown = paymentsMade − new charges, matching PR #76 Paid/New charges", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 9400,
      incomeTotal: 0,
      coreExpensesTotal: 0,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10200 },
        { slug: "visa", label: "Visa", type: "credit", value: -800 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 300, category: "Shopping", accountSlug: "visa" },
      ],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 500, currency: "CAD" }],
    });
    expect(result.debtPaydown).toBe(200);
    expect(result.debtAccounts[0].paid).toBe(500);
    expect(result.debtAccounts[0].newCharges).toBe(300);
    expect(result.debtAccounts[0].usedActivity).toBe(true);
  });

  it("falls back to legacy income credits when paymentsMade is 0 (PR #76)", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 9200,
      incomeTotal: 0,
      coreExpensesTotal: 0,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "visa", label: "Visa", type: "credit", value: -800 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-10", amount: 200, accountSlug: "visa" }],
      debtPaymentHistory: [],
    });
    expect(result.debtAccounts[0].paid).toBe(200);
    expect(result.debtPaydown).toBe(200);
  });

  it("treats CSV-shaped and PDF-shaped debt txns the same", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 9100,
      incomeTotal: 0,
      coreExpensesTotal: 0,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "visa", label: "Visa", type: "credit", value: -900 },
      ],
    });
    const csv = computeMonthGrowth(current, previous, {
      expenseTxns: [{ txMonth: "2026-10", amount: 50, category: "Interest", accountSlug: "visa" }],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 150, currency: "CAD" }],
    });
    const pdf = computeMonthGrowth(current, previous, {
      expenseTxns: [{ txMonth: "2026-10", amount: 50, category: "Interest", accountSlug: "visa" }],
      incomeTxns: [],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 150, currency: "CAD" }],
    });
    expect(csv.debtPaydown).toBe(pdf.debtPaydown);
    expect(csv.interestAndFees).toBe(pdf.interestAndFees);
    expect(csv.debtPaydown).toBe(100);
  });

  it("does not treat a first-statement debt baseline as paydown", () => {
    const priorNoVisa = month({
      yearMonth: "2026-09",
      netWorth: 10000,
      byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 10000 }],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 8000,
      incomeTotal: 0,
      coreExpensesTotal: 0,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 10000 },
        { slug: "visa", label: "Visa", type: "credit", value: -2000 },
      ],
    });
    const result = computeMonthGrowth(current, priorNoVisa, {
      expenseTxns: [],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.debtPaydown).toBe(0);
  });
});

describe("investment contribution split", () => {
  const previous = month({
    yearMonth: "2026-09",
    netWorth: 50000,
    byAccount: [
      { slug: "tfsa", label: "TFSA", type: "investment", value: 50000 },
    ],
  });

  it("splits Δ into contributions, withdrawals, and market growth when the account has its own txns", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 53000,
      incomeTotal: 0,
      coreExpensesTotal: 0,
      byAccount: [{ slug: "tfsa", label: "TFSA", type: "investment", value: 53000 }],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [{ txMonth: "2026-10", amount: 200, category: "Transfers", accountSlug: "tfsa" }],
      incomeTxns: [{ txMonth: "2026-10", amount: 1000, accountSlug: "tfsa" }],
      debtPaymentHistory: [],
    });
    const acc = result.investmentAccounts[0];
    expect(acc.split).toBe("split");
    expect(acc.contributions).toBe(1000);
    expect(acc.withdrawals).toBe(200);
    expect(acc.marketGrowth).toBe(2200); // 3000 − (1000 − 200)
    expect(result.investmentDelta).toBe(3000);
  });

  it("labels growth unsplit when the investment account has no own deposits/withdrawals", () => {
    const current = month({
      yearMonth: "2026-10",
      netWorth: 52000,
      incomeTotal: 5000,
      coreExpensesTotal: 2500,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 2000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 50000 },
      ],
    });
    const prior = month({
      yearMonth: "2026-09",
      netWorth: 50000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 2000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 48000 },
      ],
    });
    const result = computeMonthGrowth(current, prior, {
      // Checking-side "Investments & Savings" must not be guessed as TFSA contributions
      expenseTxns: [
        { txMonth: "2026-10", amount: 500, category: "Investments & Savings", accountSlug: "chk" },
      ],
      incomeTxns: [],
      debtPaymentHistory: [],
    });
    expect(result.investmentAccounts[0].split).toBe("unsplit");
    expect(result.investmentAccounts[0].contributions).toBeNull();
    expect(result.investmentAccounts[0].marketGrowth).toBeNull();
    expect(result.investmentUnsplit).toBe(2000);
    expect(result.investmentContributions).toBe(0);
  });
});

describe("other assets and reconciliation", () => {
  it("counts manual asset valuation changes", () => {
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
    expect(result.grossSavings).toBe(1000);
    expect(result.netWorthChange).toBe(15000);
    expect(result.unexplained).toBe(0);
    expect(explained(result)).toBe(result.netWorthChange);
  });

  it("always surfaces the remainder as unexplained — never drops it", () => {
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
    // Gross savings 1000; cash rose 1250.5 → remainder 250.5
    expect(result.grossSavings).toBe(1000);
    expect(result.unexplained).toBeCloseTo(250.5);
    expect(explained(result)).toBeCloseTo(1250.5);
    expect(result.unexplained).not.toBe(0);
  });

  it("reconciliation identity holds with savings + paydown + investments + other + unexplained", () => {
    const previous = month({
      yearMonth: "2026-09",
      netWorth: 40000,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 8000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 20000 },
        { slug: "visa", label: "Visa", type: "credit", value: -3000 },
        { slug: "manual-car", label: "Car", type: "manual-vehicle", value: 15000 },
      ],
    });
    const current = month({
      yearMonth: "2026-10",
      netWorth: 44500,
      incomeTotal: 6000,
      coreExpensesTotal: 3500,
      byAccount: [
        { slug: "chk", label: "Checking", type: "checking", value: 9000 },
        { slug: "tfsa", label: "TFSA", type: "investment", value: 21500 },
        { slug: "visa", label: "Visa", type: "credit", value: -2500 },
        { slug: "manual-car", label: "Car", type: "manual-vehicle", value: 16500 },
      ],
    });
    const result = computeMonthGrowth(current, previous, {
      expenseTxns: [
        { txMonth: "2026-10", amount: 200, category: "Shopping", accountSlug: "visa" },
        { txMonth: "2026-10", amount: 50, category: "Interest", accountSlug: "visa" },
      ],
      incomeTxns: [{ txMonth: "2026-10", amount: 500, accountSlug: "tfsa" }],
      debtPaymentHistory: [{ accountSlug: "visa", statementMonth: "2026-10", paymentsMade: 750, currency: "CAD" }],
    });
    expect(result.netWorthChange).toBe(4500);
    expect(explained(result)).toBeCloseTo(4500);
    expect(result.unexplained).not.toBeNull();
  });
});

describe("range summation", () => {
  it("sums components and computes savings rate over the range", () => {
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
        netWorth: 13000,
        incomeTotal: 5000,
        coreExpensesTotal: 3000,
        byAccount: [{ slug: "chk", label: "Checking", type: "checking", value: 13000 }],
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
    expect(range).not.toBeNull();
    expect(range!.income).toBe(9000);
    expect(range!.spending).toBe(5500);
    expect(range!.grossSavings).toBe(3500);
    expect(range!.savingsRate).toBeCloseTo(3500 / 9000);
    expect(range!.netWorthChange).toBe(3000); // 1500 + 1500
    expect(explained(range!)).toBeCloseTo(range!.netWorthChange!);
  });

  it("marks mixed split/unsplit investment accounts as unsplit over the range", () => {
    const months = computeNetWorthGrowth({
      monthlyHistory: [
        month({
          yearMonth: "2026-09",
          netWorth: 20000,
          byAccount: [{ slug: "tfsa", label: "TFSA", type: "investment", value: 20000 }],
        }),
        month({
          yearMonth: "2026-10",
          netWorth: 21000,
          byAccount: [{ slug: "tfsa", label: "TFSA", type: "investment", value: 21000 }],
        }),
        month({
          yearMonth: "2026-11",
          netWorth: 22000,
          byAccount: [{ slug: "tfsa", label: "TFSA", type: "investment", value: 22000 }],
        }),
      ],
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-10", amount: 400, accountSlug: "tfsa" }],
      debtPaymentHistory: [],
    });
    const range = sumGrowthBreakdowns(months, ["2026-10", "2026-11"]);
    expect(range!.investmentAccounts[0].split).toBe("unsplit");
    expect(range!.investmentAccounts[0].contributions).toBeNull();
  });
});
