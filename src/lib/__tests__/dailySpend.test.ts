import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExpenseTxnRecord } from "../extractTransactions";
import { getParentCategory } from "../categoryTaxonomy";
import { spendingForMonth } from "../spendingSummary";
import { buildMerchantAliasResolver, resolveSpendingMerchant } from "../merchantAliases";
import {
  buildDailySpend,
  calendarDaysInMonth,
  calendarDaysInMonths,
  dailyRateFromMonthlyTotals,
  daysElapsedInMonth,
  deltaKind,
  foodSplitForCategory,
  fullySavedSoonerLabel,
  lastNCalendarMonths,
  lastNForRange,
  NO_SPEND_THIS_MONTH_MESSAGE,
  monthlyKeep,
  monthsSooner,
  parseDailySpendRange,
  parseDailySpendTheme,
  priorWindowMonths,
  spendingHrefForTheme,
  themeAmountsFromCategories,
  themeIdForCategory,
  visitsPerMonth,
  visitsPerMonthLabel,
  yearlyKeep,
  EVEN_DELTA_THRESHOLD,
  THEME_SERIES_MONTHS,
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
    expect(result.currentMonth?.hasEverydaySpend).toBe(true);
  });

  it("flags no everyday spend this month instead of a CA$0/day rate", () => {
    const txns = [
      expense({ category: "Groceries", amount: 310, txMonth: "2026-10" }),
      expense({ category: "Rent", amount: 2000, txMonth: "2026-11" }),
    ];
    const result = spend(txns);
    expect(result.currentMonth).toMatchObject({
      yearMonth: "2026-11",
      inProgressLabel: "In progress",
      themeTotal: 0,
      hasEverydaySpend: false,
    });
    expect(NO_SPEND_THIS_MONTH_MESSAGE).toBe("No spending recorded yet this month");
  });

  it("hides the current-month strip when the month has no data at all", () => {
    const txns = [expense({ category: "Groceries", amount: 310, txMonth: "2026-10" })];
    expect(spend(txns).currentMonth).toBeNull();
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

describe("theme subcategory daily rates sum to the theme", () => {
  it("sums Food leaves to the theme, and eating-out bars to eating out", () => {
    const txns = [
      expense({ category: "Groceries", amount: 310, txMonth: "2026-08" }),
      expense({ category: "Restaurants", amount: 93, txMonth: "2026-08" }),
      expense({ category: "Coffee & Drinks", amount: 31, txMonth: "2026-08" }),
      expense({ category: "Fast Food", amount: 62, txMonth: "2026-08" }),
      expense({ category: "Food Delivery", amount: 31, txMonth: "2026-08" }),
      expense({ category: "Dining", amount: 15, txMonth: "2026-08" }),
      expense({ category: "Groceries", amount: 300, txMonth: "2026-09" }),
      expense({ category: "Restaurants", amount: 90, txMonth: "2026-09" }),
      expense({ category: "Coffee & Drinks", amount: 30, txMonth: "2026-09" }),
      expense({ category: "Fast Food", amount: 60, txMonth: "2026-09" }),
      expense({ category: "Food Delivery", amount: 30, txMonth: "2026-09" }),
      expense({ category: "Dining", amount: 15, txMonth: "2026-09" }),
      expense({ category: "Groceries", amount: 310, txMonth: "2026-10" }),
      expense({ category: "Restaurants", amount: 93, txMonth: "2026-10" }),
      expense({ category: "Coffee & Drinks", amount: 31, txMonth: "2026-10" }),
      expense({ category: "Fast Food", amount: 62, txMonth: "2026-10" }),
      expense({ category: "Food Delivery", amount: 31, txMonth: "2026-10" }),
      expense({ category: "Dining", amount: 15, txMonth: "2026-10" }),
    ];
    const food = spend(txns).themes.find((t) => t.id === "food");
    expect(food).toBeTruthy();
    const leafSum = food!.detail.subcategories.reduce((sum, bar) => sum + bar.dailyRate, 0);
    expect(leafSum).toBeCloseTo(food!.dailyRate, 10);
    expect((food!.groceriesDaily ?? 0) + (food!.eatingOutDaily ?? 0)).toBeCloseTo(food!.dailyRate, 10);
    const eatingOutSum = food!.detail.foodSplit!.eatingOutSubcategories.reduce(
      (sum, bar) => sum + bar.dailyRate,
      0,
    );
    expect(eatingOutSum).toBeCloseTo(food!.eatingOutDaily ?? 0, 10);
    const labels = food!.detail.foodSplit!.eatingOutSubcategories.map((b) => b.label);
    expect(labels).toEqual(
      expect.arrayContaining(["Restaurants", "Coffee & Drinks", "Fast Food", "Food Delivery", "Dining"]),
    );
  });

  it("sums Getting around subtypes (excluding car insurance) to the theme", () => {
    const txns = ["2026-08", "2026-09", "2026-10"].flatMap((ym) => [
      expense({ category: "Gas", amount: 80, txMonth: ym }),
      expense({ category: "Parking", amount: 20, txMonth: ym }),
      expense({ category: "Transportation", amount: 10, txMonth: ym }),
      expense({ category: "Car Insurance", amount: 150, txMonth: ym }),
    ]);
    const around = spend(txns).themes.find((t) => t.id === "getting-around");
    expect(around).toBeTruthy();
    const sum = around!.detail.subcategories.reduce((s, bar) => s + bar.dailyRate, 0);
    expect(sum).toBeCloseTo(around!.dailyRate, 10);
    expect(around!.dailyRate).toBeCloseTo((80 + 20 + 10) * 3 / 92, 10);
    expect(around!.detail.subcategories.map((b) => b.label)).not.toContain("Car Insurance");
  });
});

describe("merchant totals match Spending grouping for the same window", () => {
  it("merges canonical aliases and source mappings the way Spending does", () => {
    const txns = [
      expense({ category: "Groceries", amount: 100, txMonth: "2026-08", merchant: "AMZN MKTP CA" }),
      expense({ category: "Groceries", amount: 50, txMonth: "2026-08", merchant: "Amazon.ca" }),
      expense({ category: "Restaurants", amount: 12, txMonth: "2026-08", merchant: "TIM HORTONS #3125" }),
      expense({ category: "Groceries", amount: 100, txMonth: "2026-09", merchant: "AMZN MKTP CA" }),
      expense({ category: "Groceries", amount: 50, txMonth: "2026-09", merchant: "Amazon.ca" }),
      expense({ category: "Restaurants", amount: 12, txMonth: "2026-09", merchant: "TIM HORTONS #3125" }),
      expense({ category: "Groceries", amount: 100, txMonth: "2026-10", merchant: "AMZN MKTP CA" }),
      expense({ category: "Groceries", amount: 50, txMonth: "2026-10", merchant: "Amazon.ca" }),
      expense({ category: "Restaurants", amount: 12, txMonth: "2026-10", merchant: "TIM HORTONS #3125" }),
    ];
    const mappings = [
      { canonical: "Tim Hortons", alias: "TIM HORTONS #3125", status: "confirmed" as const, type: "expense" as const },
    ];
    const result = buildDailySpend({
      expenseTxns: txns,
      accountSnapshots: snapshots as never,
      debtPaymentHistory: [],
      userReviews: [],
      fxRates: {},
      currency: "CAD",
      range: "3m",
      sourceMappings: mappings,
    });
    const food = result.themes.find((t) => t.id === "food")!;
    const expected = new Map<string, { name: string; total: number; count: number }>();
    const aliasResolver = buildMerchantAliasResolver(mappings);
    for (const txn of txns) {
      if (!result.months.includes(txn.txMonth)) continue;
      if (themeIdForCategory(txn.category) !== "food") continue;
      const { slug, name } = resolveSpendingMerchant(txn.merchant, aliasResolver);
      const cur = expected.get(slug) ?? { name, total: 0, count: 0 };
      cur.total += Math.abs(txn.amount);
      cur.count += 1;
      expected.set(slug, cur);
    }
    const amazon = food.detail.merchants.find((m) => m.slug === "amazon");
    expect(amazon).toBeTruthy();
    expect(amazon!.name).toBe("Amazon");
    expect(amazon!.total).toBe(expected.get("amazon")?.total);
    expect(amazon!.dailyRate).toBeCloseTo(amazon!.total / result.calendarDays, 10);
    expect(amazon!.total).toBe(450);

    const tims = food.detail.merchants.find((m) => m.name === "Tim Hortons");
    expect(tims).toBeTruthy();
    expect(tims!.total).toBe(36);
    expect(tims!.dailyRate).toBeCloseTo(36 / 92, 10);
  });
});

describe("visits per month", () => {
  it("rounds transaction count over the window divided by month count, singular at 1", () => {
    expect(visitsPerMonth(3, 3)).toBe(1);
    expect(visitsPerMonth(5, 3)).toBe(2);
    expect(visitsPerMonth(1, 3)).toBe(0);
    expect(visitsPerMonthLabel(1)).toBe("1 visit/mo");
    expect(visitsPerMonthLabel(2)).toBe("2 visits/mo");
    expect(visitsPerMonthLabel(0)).toBe("<1 visit/mo");

    const txns = ["2026-08", "2026-09", "2026-10"].flatMap((ym) => [
      expense({ category: "Groceries", amount: 20, txMonth: ym, merchant: "Loblaws" }),
      expense({ category: "Groceries", amount: 15, txMonth: ym, merchant: "Loblaws" }),
    ]);
    const food = spend(txns).themes.find((t) => t.id === "food")!;
    const loblaws = food.detail.merchants.find((m) => m.name === "Loblaws");
    expect(loblaws?.count).toBe(6);
    expect(loblaws?.visitsPerMonth).toBe(2);
  });
});

describe("6-month series excludes the current month from the average", () => {
  it("plots last 6 calendar months with the current month dashed and out of the average", () => {
    expect(lastNCalendarMonths(THEME_SERIES_MONTHS, "2026-11")).toEqual([
      "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ]);
    const txns = [
      "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ].map((ym) => expense({ category: "Shopping", amount: ym === "2026-11" ? 2300 : 304, txMonth: ym }));
    const result = spend(txns, "3m");
    expect(result.months).toEqual(["2026-08", "2026-09", "2026-10"]);
    expect(result.months).not.toContain("2026-11");
    const shopping = result.themes.find((t) => t.id === "shopping")!;
    const series = shopping.detail.series;
    expect(series.map((p) => p.yearMonth)).toEqual([
      "2026-06", "2026-07", "2026-08", "2026-09", "2026-10", "2026-11",
    ]);
    const nov = series.find((p) => p.yearMonth === "2026-11")!;
    expect(nov.isInProgress).toBe(true);
    expect(nov.dailyRate).toBeCloseTo(2300 / 23, 10);
    expect(series.filter((p) => !p.isInProgress).every((p) => p.yearMonth !== "2026-11")).toBe(true);
    expect(shopping.dailyRate).toBeCloseTo((304 * 3) / 92, 10);
    const oct = series.find((p) => p.yearMonth === "2026-10")!;
    expect(oct.isInProgress).toBe(false);
    expect(oct.dailyRate).toBeCloseTo(304 / 31, 10);
  });
});

describe("6-month series starts at the first month with data", () => {
  it("leaves months before the user's first data off the line instead of plotting $0", () => {
    const txns = ["2026-09", "2026-10", "2026-11"].map((ym) =>
      expense({ category: "Shopping", amount: 300, txMonth: ym }),
    );
    const shopping = spend(txns).themes.find((t) => t.id === "shopping")!;
    expect(shopping.detail.series.map((p) => p.yearMonth)).toEqual([
      "2026-09", "2026-10", "2026-11",
    ]);
    expect(spend([]).themes[0].detail.series).toEqual([]);
  });
});

describe("spending deep-link", () => {
  it("links to the Spending page category query the drilldown already supports", () => {
    expect(spendingHrefForTheme("food")).toBe("/account/spending?category=Groceries,Dining");
    expect(spendingHrefForTheme("personal-care")).toBe("/account/spending?category=Personal%20Care");
    const result = spend([expense({ category: "Gas", amount: 100, txMonth: "2026-10" })]);
    const byId = Object.fromEntries(result.themes.map((t) => [t.id, t.detail]));
    expect(byId["getting-around"].spendingNote).toMatch(/Car Insurance/);
    expect(byId.fun.spendingNote).toMatch(/Streaming/);
    expect(byId.food.spendingNote).toBeUndefined();
    expect(spendingHrefForTheme("getting-around")).toBe(
      "/account/spending?category=Transportation",
    );
    expect(parseDailySpendTheme("food")).toBe("food");
    expect(parseDailySpendTheme("nope")).toBeNull();
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

  it("words the plan result as fully saved, singular for one month", () => {
    expect(fullySavedSoonerLabel(1)).toBe("Fully saved 1 month sooner");
    expect(fullySavedSoonerLabel(4)).toBe("Fully saved 4 months sooner");
  });
});
