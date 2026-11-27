/**
 * Net savings is balances only: bank/cash/savings + cards + debts, month-end
 * vs prior month-end. Investments and assets are excluded; categories never
 * matter.
 */

import { describe, expect, it } from "vitest";
import type { AccountBalanceHistory, MonthlyHistoryEntry } from "../financialProfile";
import type { ExpenseTxnRecord } from "../extractTransactions";
import { computeMonthlySavings, computeWindowSavings } from "../savingsCalculations";

const noHistory = [] as MonthlyHistoryEntry[];

function account(
  slug: string,
  accountType: string,
  entries: Array<[string, number]>,
  currency = "CAD",
): AccountBalanceHistory {
  return {
    slug,
    label: slug,
    accountType,
    currency,
    entries: entries.map(([yearMonth, balance]) => ({ yearMonth, balance })),
  };
}

function withdrawal(category: string): ExpenseTxnRecord {
  return {
    date: "2026-10-12",
    txMonth: "2026-10",
    merchant: "GC 1176-CASH WITHDRA",
    category,
    amount: 8000,
    accountSlug: "chq",
    accountLabel: "Chequing",
  } as ExpenseTxnRecord;
}

describe("Net savings — balances only", () => {
  // CA$8,000 Honda down payment withdrawn from chequing in October.
  const chequing = account("chq", "checking", [
    ["2026-09", 20000],
    ["2026-10", 12500], // −8,000 down payment, +500 otherwise
  ]);

  it("lowers the down-payment month by 8,000 whether tagged Cash & ATM or Asset purchase", () => {
    const asCash = computeMonthlySavings(noHistory, [chequing], [withdrawal("Cash & ATM")], "2026-10");
    const asAsset = computeMonthlySavings(noHistory, [chequing], [withdrawal("Asset purchase")], "2026-10");
    const untagged = computeMonthlySavings(noHistory, [chequing], [], "2026-10");
    expect(asCash.total).toBe(-7500);
    expect(asAsset.total).toBe(-7500);
    expect(untagged.total).toBe(-7500);
  });

  it("excludes investment accounts and does not add back Investments & Savings outflows", () => {
    const tfsa = account("tfsa", "investment", [
      ["2026-09", 10000],
      ["2026-10", 12000],
    ]);
    const chq = account("chq", "checking", [
      ["2026-09", 5000],
      ["2026-10", 3000], // moved 2,000 into the TFSA
    ]);
    const contribution = {
      ...withdrawal("Investments & Savings"),
      merchant: "TFSA CONTRIBUTION",
      amount: 2000,
    } as ExpenseTxnRecord;
    const result = computeMonthlySavings(noHistory, [chq, tfsa], [contribution], "2026-10");
    expect(result.total).toBe(-2000);
    expect(result.contributionsToOutside).toBe(0);
    expect(result.details.cashAccounts.map((a) => a.slug)).toEqual(["chq"]);
  });

  it("ignores property and other asset accounts", () => {
    const house = account("house", "property", [
      ["2026-09", 800000],
      ["2026-10", 820000],
    ]);
    const car = account("car", "vehicle", [
      ["2026-09", 0],
      ["2026-10", 31500],
    ]);
    expect(computeMonthlySavings(noHistory, [house, car], [], "2026-10").total).toBe(0);
  });

  it("adds debt paid down and subtracts card or loan balance increases", () => {
    const visa = account("visa", "credit", [
      ["2026-09", -3000],
      ["2026-10", -3600], // card balance up 600
    ]);
    const loan = account("loan", "loan", [
      ["2026-09", -20000],
      ["2026-10", -19000], // paid down 1,000
    ]);
    const positiveLoc = account("loc", "line_of_credit", [
      ["2026-09", 5000], // stored as a positive balance owed
      ["2026-10", 5400], // drew 400
    ]);
    const result = computeMonthlySavings(noHistory, [visa, loan, positiveLoc], [], "2026-10");
    expect(result.netDebtChange).toBe(-600 + 1000 - 400);
    expect(result.total).toBe(0);
  });

  it("compares with the prior calendar month and carries forward the most recent balance", () => {
    const loan = account("loan", "loan", [
      ["2026-07", -20000],
      // Aug missing → carry forward July
      ["2026-09", -18858],
    ]);
    const sep = computeMonthlySavings(noHistory, [loan], [], "2026-09");
    expect(sep.priorMonth).toBe("2026-08");
    expect(sep.total).toBeCloseTo(1142, 6);
    expect(sep.details.debtAccounts[0].priorCarriedForward).toBe(true);
  });

  it("leaves months with no balances to compare out of the average instead of counting 0", () => {
    const chq = account("chq", "checking", [
      ["2026-08", 1000],
      ["2026-09", 1600],
    ]);
    // Jul: no baseline. Oct: no October statement (only carried forward).
    const result = computeWindowSavings(noHistory, [chq], [], ["2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(result.monthlyBreakdown.map((m) => m.measured)).toEqual([false, false, true, false]);
    expect(result.measuredMonths).toEqual(["2026-09"]);
    expect(result.monthlyAverage.total).toBe(600);
  });

  it("drawer month rows and per-account rows sum to the card average", () => {
    const chq = account("chq", "checking", [
      ["2026-06", 5000],
      ["2026-07", 4000],
      ["2026-08", 6000],
      ["2026-09", 7000],
    ]);
    const visa = account("visa", "credit", [
      ["2026-06", -2000],
      ["2026-07", -3000],
      ["2026-08", -2500],
      ["2026-09", -2000],
    ]);
    const result = computeWindowSavings(noHistory, [chq, visa], [], ["2026-07", "2026-08", "2026-09"]);
    const totals = result.monthlyBreakdown.map((m) => m.total);
    expect(totals).toEqual([-2000, 2500, 1500]);
    expect(result.monthlyAverage.total).toBeCloseTo(2000 / 3, 8);
    for (const m of result.monthlyBreakdown) {
      const rows = [...m.accounts.cashAccounts, ...m.accounts.debtAccounts];
      expect(rows.reduce((s, a) => s + a.change, 0)).toBeCloseTo(m.total, 8);
    }
  });

  it("converts foreign-currency balances to the home currency", () => {
    const usd = account(
      "usd",
      "savings",
      [
        ["2026-09", 1000],
        ["2026-10", 1500],
      ],
      "USD",
    );
    const result = computeMonthlySavings(noHistory, [usd], [], "2026-10", new Map(), {
      homeCurrency: "CAD",
      fxRates: { USD: 1.4 },
    });
    expect(result.total).toBeCloseTo(700, 6);
  });
});
