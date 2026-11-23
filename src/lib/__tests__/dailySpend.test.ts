import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExpenseTxnRecord } from "../extractTransactions";
import { getParentCategory } from "../categoryTaxonomy";
import { spendingForMonth } from "../spendingSummary";
import {
  buildDailySpend,
  calendarDaysInMonth,
  calendarDaysInMonths,
  dailyRateFromMonthlyTotals,
  daysElapsedInMonth,
  deltaKind,
  foodSplitForCategory,
  lastNForRange,
  monthlyKeep,
  monthsSooner,
  parseDailySpendRange,
  priorWindowMonths,
  themeAmountsFromCategories,
  themeIdForCategory,
  yearlyKeep,
  EVEN_DELTA_THRESHOLD,
} from "../dailySpend";

function expense(
  overrides: Partial<ExpenseTxnRecord> & Pick<ExpenseTxnRecord, "category" | "amount" | "txMonth">,
): ExpenseTxnRecord {
  return {
    date: `${overrides.txMonth}-15`,
    merchant: overrides.merchant ?? "Store",
    accountSlug: "checking_1234",
    accountLabel: "Checking",
    ...overrides,
  };
}

const snapshots = [{ slug: "checking_1234", accountName: "Chequing", bankName: "TD" }];

function spend(txns: ExpenseTxnRecord[], range: "3m" | "6m" | "12m" = "3m") {
  return buildDailySpend({
    expenseTxns: txns,
    accountSnapshots: snapshots as never,
    debtPaymentHistory: [],
    userReviews: [],
    fxRates: {},
    currency: "CAD",
    range,
  });
}

beforeEach(() => {
  (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__ = new Date("2026-11-23T12:00:00");
});

afterEach(() => {
  delete (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__;
});

describe("theme mapping", () => {
  it("maps Food as Groceries plus Dining subtypes", () => {
    expect(themeIdForCategory("Groceries")).toBe("food");
    expect(foodSplitForCategory("Groceries")).toBe("groceries");
    for (const dining of ["Dining", "Restaurants", "Coffee & Drinks", "Fast Food", "Food Delivery"]) {
      expect(themeIdForCategory(dining)).toBe("food");
      expect(foodSplitForCategory(dining)).toBe("eating-out");
    }
  });

  it("maps Getting around to Transportation subtypes except Car Insurance", () => {
    for (const cat of ["Transportation", "Gas", "Parking", "Transit", "Rideshare", "Auto Service"]) {
      expect(themeIdForCategory(cat)).toBe("getting-around");
    }
    expect(themeIdForCategory("Car Insurance")).toBeNull();
  });

  it("maps Shopping and its subtypes", () => {
    for (const cat of ["Shopping", "Clothing", "Electronics", "Home & Garden", "Online Shopping"]) {
      expect(themeIdForCategory(cat)).toBe("shopping");
    }
  });

  it("maps Fun & going out to Entertainment excluding Streaming", () => {
    for (const cat of ["Entertainment", "Movies & Events", "Sports", "Hobbies"]) {
      expect(themeIdForCategory(cat)).toBe("fun");
    }
    expect(themeIdForCategory("Streaming")).toBeNull();
    expect(themeIdForCategory("streaming services")).toBeNull();
  });

  it("maps Personal care and subtypes", () => {
    for (const cat of [
      "Personal Care",
      "Spa",
      "Salon & Haircare",
      "Massage",
      "Skincare & Beauty",
      "Barber",
      "Nail Care",
    ]) {
      expect(themeIdForCategory(cat)).toBe("personal-care");
    }
  });

  it("excludes bills, transfers, savings, and other non-everyday categories", () => {
    const excluded = [
      "Housing",
      "Rent",
      "Mortgage",
      "Utilities",
      "Subscriptions",
      "Software",
      "Insurance",
      "Life Insurance",
      "Taxes",
      "Income Tax",
      "Debt",
      "Installment Servicing",
      "Card Servicing",
      "Loan payments",
      "Education",
      "Tuition",
      "Healthcare",
      "Pharmacy",
      "Travel",
      "Flights",
      "Cash & ATM",
      "Fees",
      "Bank Fees",
      "Transfers",
      "Transfer Out",
      "Transfers & Payments",
      "Investments & Savings",
      "CA: RRSP",
      "Interest",
      "Other",
    ];
    for (const cat of excluded) {
      expect(themeIdForCategory(cat)).toBeNull();
    }
  });
});

describe("daily-rate math over calendar days", () => {
  it("divides the window sum by calendar days, using mean × n / days", () => {
    expect(calendarDaysInMonth("2026-08")).toBe(31);
    expect(calendarDaysInMonth("2026-09")).toBe(30);
    expect(calendarDaysInMonth("2026-10")).toBe(31);
    expect(calendarDaysInMonths(["2026-08", "2026-09", "2026-10"])).toBe(92);

    const monthly = [310, 300, 310];
    expect(dailyRateFromMonthlyTotals(monthly, ["2026-08", "2026-09", "2026-10"])).toBeCloseTo(
      920 / 92,
      10,
    );
  });

  it("returns 0 for an empty window", () => {
    expect(dailyRateFromMonthlyTotals([], [])).toBe(0);
  });

  it("builds a 3-month everyday daily rate from theme spend / calendar days", () => {
    const txns = [
      expense({ category: "Groceries", amount: 310, txMonth: "2026-08" }),
      expense({ category: "Groceries", amount: 300, txMonth: "2026-09" }),
      expense({ category: "Groceries", amount: 310, txMonth: "2026-10" }),
      expense({ category: "Rent", amount: 2000, txMonth: "2026-08" }),
      expense({ category: "Car Insurance", amount: 150, txMonth: "2026-09" }),
      expense({ category: "Streaming", amount: 18, txMonth: "2026-10" }),
    ];
    const result = spend(txns);
    expect(result.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(result.calendarDays).toBe(92);
    expect(result.everydayDailyRate).toBeCloseTo(920 / 92, 10);
    const food = result.themes.find((t) => t.id === "food");
    expect(food?.dailyRate).toBeCloseTo(920 / 92, 10);
    expect(food?.groceriesDaily).toBeCloseTo(920 / 92, 10);
    expect(food?.eatingOutDaily).toBe(0);
  });
});

describe("current month is excluded from the average", () => {
  it("uses finished months only and reports this-month-so-far separately", () => {
    const txns = [
      expense({ category: "Groceries", amount: 310, txMonth: "2026-08" }),
      expense({ category: "Groceries", amount: 300, txMonth: "2026-09" }),
      expense({ category: "Groceries", amount: 310, txMonth: "2026-10" }),
      expense({ category: "Groceries", amount: 2300, txMonth: "2026-11" }),
    ];
    const result = spend(txns);
    expect(result.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(result.months).not.toContain("2026-11");
    expect(result.everydayDailyRate).toBeCloseTo(920 / 92, 10);
    expect(daysElapsedInMonth()).toBe(23);
    expect(result.currentMonth).toMatchObject({
      yearMonth: "2026-11",
      isInProgress: true,
      inProgressLabel: "In progress",
      daysElapsed: 23,
      themeTotal: 2300,
    });
    expect(result.currentMonth?.dailyRate).toBeCloseTo(2300 / 23, 10);
  });
});

describe("prior-window delta", () => {
  it("compares against the preceding equal window of finished months", () => {
    expect(
      priorWindowMonths(
        ["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"],
        ["2026-08", "2026-09", "2026-10"],
      ),
    ).toEqual(["2026-05", "2026-06", "2026-07"]);

    const txns = [
      expense({ category: "Shopping", amount: 310, txMonth: "2026-05" }),
      expense({ category: "Shopping", amount: 300, txMonth: "2026-06" }),
      expense({ category: "Shopping", amount: 310, txMonth: "2026-07" }),
      expense({ category: "Shopping", amount: 620, txMonth: "2026-08" }),
      expense({ category: "Shopping", amount: 600, txMonth: "2026-09" }),
      expense({ category: "Shopping", amount: 620, txMonth: "2026-10" }),
    ];
    const result = spend(txns);
    expect(result.priorMonths).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(result.everydayDailyRate).toBeCloseTo(1840 / 92, 10);
    expect(result.priorEverydayDailyRate).toBeCloseTo(920 / 92, 10);
    expect(result.everydayDelta).toBeCloseTo(1840 / 92 - 920 / 92, 10);
    expect(result.everydayDeltaKind).toBe("up");
  });

  it("treats a change within ±CA$0.50 as about even", () => {
    expect(deltaKind(0.4)).toBe("even");
    expect(deltaKind(-0.5)).toBe("even");
    expect(deltaKind(0.51)).toBe("up");
    expect(deltaKind(-0.51)).toBe("down");
    expect(EVEN_DELTA_THRESHOLD).toBe(0.5);
  });
});

describe("theme monthly total matches the Spending summary", () => {
  it("equals rolled-up Spending category totals for the same month", () => {
    const txns = [
      expense({ category: "Groceries", amount: 100, txMonth: "2026-10" }),
      expense({ category: "Restaurants", amount: 40, txMonth: "2026-10" }),
      expense({ category: "Coffee & Drinks", amount: 15, txMonth: "2026-10" }),
      expense({ category: "Gas", amount: 80, txMonth: "2026-10" }),
      expense({ category: "Car Insurance", amount: 150, txMonth: "2026-10" }),
      expense({ category: "Clothing", amount: 60, txMonth: "2026-10" }),
      expense({ category: "Movies & Events", amount: 25, txMonth: "2026-10" }),
      expense({ category: "Streaming", amount: 18, txMonth: "2026-10" }),
      expense({ category: "Barber", amount: 35, txMonth: "2026-10" }),
      expense({ category: "Rent", amount: 2000, txMonth: "2026-10" }),
      expense({ category: "Subscriptions", amount: 20, txMonth: "2026-10" }),
    ];

    const spending = spendingForMonth(
      "2026-10",
      txns,
      snapshots as never,
      [],
      [],
      {},
      "CAD",
    );
    const rolled = new Map<string, number>();
    for (const cat of spending.categories) {
      const parent = getParentCategory(cat.category);
      rolled.set(parent, (rolled.get(parent) ?? 0) + cat.amount);
    }

    const themes = themeAmountsFromCategories(spending.categories);
    expect(themes.food).toBe((rolled.get("Groceries") ?? 0) + (rolled.get("Dining") ?? 0));
    expect(themes.food).toBe(155);
    expect(themes.shopping).toBe(rolled.get("Shopping") ?? 0);
    expect(themes["personal-care"]).toBe(rolled.get("Personal Care") ?? 0);

    const carInsurance = spending.categories
      .filter((c) => c.category.trim().toLowerCase() === "car insurance")
      .reduce((sum, c) => sum + c.amount, 0);
    expect(themes["getting-around"]).toBe((rolled.get("Transportation") ?? 0) - carInsurance);

    const streaming = spending.categories
      .filter((c) => c.category.trim().toLowerCase() === "streaming")
      .reduce((sum, c) => sum + c.amount, 0);
    expect(themes.fun).toBe((rolled.get("Entertainment") ?? 0) - streaming);

    const result = spend([
      ...txns,
      expense({ category: "Groceries", amount: 100, txMonth: "2026-08" }),
      expense({ category: "Groceries", amount: 100, txMonth: "2026-09" }),
    ]);
    expect(result.months).toContain("2026-10");
    const octFood = themeAmountsFromCategories(
      spendingForMonth("2026-10", txns, snapshots as never, [], [], {}, "CAD").categories,
    ).food;
    expect(octFood).toBe(themes.food);
  });
});

describe("6-month and 12-month windows", () => {
  it("uses monthsForCashFlowAverage last N finished months", () => {
    const txns = [
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ].flatMap((ym) => [expense({ category: "Shopping", amount: 100, txMonth: ym })]);
    const six = spend(txns, "6m");
    expect(six.months).toEqual(["2026-05", "2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
    expect(six.priorMonths).toEqual(["2026-01", "2026-02", "2026-03", "2026-04"]);
    const twelve = spend(txns, "12m");
    expect(twelve.months).toEqual([
      "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
      "2026-07", "2026-08", "2026-09", "2026-10",
    ]);
    expect(twelve.months).not.toContain("2026-11");
  });
});

describe("range helpers and what-if math", () => {
  it("parses 3m/6m/12m and defaults to 3m", () => {
    expect(parseDailySpendRange("3m")).toBe("3m");
    expect(parseDailySpendRange("6m")).toBe("6m");
    expect(parseDailySpendRange("12m")).toBe("12m");
    expect(parseDailySpendRange("3mo")).toBe("3m");
    expect(lastNForRange("6m")).toBe(6);
    expect(lastNForRange("12m")).toBe(12);
  });

  it("keeps monthly × 30.4 and yearly × 365", () => {
    expect(monthlyKeep(50, 40)).toBeCloseTo(10 * 30.4, 10);
    expect(yearlyKeep(50, 40)).toBeCloseTo(10 * 365, 10);
  });

  it("computes months sooner from remaining budget vs set-aside + savings", () => {
    expect(monthsSooner(1200, 100, 50)).toBe(4);
    expect(monthsSooner(1200, 100, 0)).toBeNull();
    expect(monthsSooner(0, 100, 50)).toBeNull();
  });
});
