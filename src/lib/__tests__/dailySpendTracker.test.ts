import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ExpenseTxnRecord } from "../extractTransactions";
import { buildDailySpend } from "../dailySpend";
import { computeMonthSpending } from "../spendingMetrics";
import { themeAmountsFromSpending } from "../dailySpend";
import {
  actualDailyFromThemeTotal,
  applyTargetEdit,
  buildDailySpendTrackerView,
  createTrackerRecord,
  HOUSING_EXCLUDED_FROM_TARGET_NOTE,
  joinThemeLabels,
  monthHit,
  monthKept,
  monthPromise,
  nextFullCalendarMonth,
  paceDailyFromThemeTotal,
  periodForMonth,
  sameThemeSelection,
  trackableThemeIds,
  TRACKED_DAILY_SPEND_THEME_IDS,
  trackedThemeTotal,
  parseTrackerRecord,
  usualFromDailySpend,
} from "../dailySpendTracker";

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

beforeEach(() => {
  (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__ = new Date("2026-11-23T12:00:00");
});

afterEach(() => {
  delete (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__;
});

describe("tracker start month and periods", () => {
  it("starts on the next full calendar month after the current month", () => {
    expect(nextFullCalendarMonth("2026-11")).toBe("2026-12");
    expect(nextFullCalendarMonth("2026-12")).toBe("2027-01");
    const record = createTrackerRecord({
      targetDaily: 40,
      usualDailyAtStart: 50,
      usualByThemeAtStart: { food: 30, "getting-around": 15, fun: 5 },
      currentYm: "2026-11",
    });
    expect(record.startMonth).toBe("2026-12");
    expect(record.trackedThemes).toEqual(["food", "getting-around", "fun"]);
    expect(record.periods).toEqual([{ targetDaily: 40, startMonth: "2026-12" }]);
  });

  it("updates a period that has not started yet instead of adding another", () => {
    const started = createTrackerRecord({
      targetDaily: 40,
      usualDailyAtStart: 50,
      usualByThemeAtStart: {},
      currentYm: "2026-11",
    });
    const edited = applyTargetEdit(started, 35, "2026-11");
    expect(edited.targetDaily).toBe(35);
    expect(edited.usualDailyAtStart).toBe(50);
    expect(edited.periods).toEqual([{ targetDaily: 35, startMonth: "2026-12" }]);
  });

  it("starts a new period from the next month when the current period is already in force", () => {
    const record = createTrackerRecord({
      targetDaily: 40,
      usualDailyAtStart: 50,
      usualByThemeAtStart: {},
      currentYm: "2026-11",
    });
    const edited = applyTargetEdit(record, 32, "2027-02");
    expect(edited.periods).toEqual([
      { targetDaily: 40, startMonth: "2026-12" },
      { targetDaily: 32, startMonth: "2027-03" },
    ]);
    expect(periodForMonth(edited.periods, "2026-12")?.targetDaily).toBe(40);
    expect(periodForMonth(edited.periods, "2027-02")?.targetDaily).toBe(40);
    expect(periodForMonth(edited.periods, "2027-03")?.targetDaily).toBe(32);
    expect(edited.usualDailyAtStart).toBe(50);
  });
});

describe("stored record", () => {
  it("keeps Housing out of the stored tracked theme list", () => {
    const parsed = parseTrackerRecord({
      targetDaily: 40,
      usualDailyAtStart: 50,
      startMonth: "2026-12",
      trackedThemes: ["food", "housing", "fun", "getting-around"],
      periods: [{ targetDaily: 40, startMonth: "2026-12" }],
      startedAt: "2026-11-23T12:00:00.000Z",
    });
    expect(parsed?.trackedThemes).toEqual(["food", "fun", "getting-around"]);
    expect(parsed?.trackedThemes).not.toContain("housing");
  });
});

describe("promise, kept, and pace math", () => {
  it("promises (usual − target) × calendar days in the month", () => {
    expect(monthPromise(50, 40, "2026-12")).toBeCloseTo(10 * 31, 10);
    expect(monthPromise(50, 40, "2027-02")).toBeCloseTo(10 * 28, 10);
  });

  it("keeps (usual − actual daily) × days and can be negative", () => {
    expect(monthKept(50, 45, "2026-12")).toBeCloseTo(5 * 31, 10);
    expect(monthKept(50, 55, "2026-12")).toBeCloseTo(-5 * 31, 10);
  });

  it("uses days elapsed for in-progress pace, not calendar days", () => {
    expect(paceDailyFromThemeTotal(230, 23)).toBeCloseTo(10, 10);
    expect(actualDailyFromThemeTotal(310, "2026-10")).toBeCloseTo(310 / 31, 10);
    expect(monthHit(39.9, 40)).toBe(true);
    expect(monthHit(40.1, 40)).toBe(false);
  });
});

describe("buildDailySpendTrackerView", () => {
  const usualByTheme = { food: 10, "getting-around": 5, fun: 2 };

  function viewFor(
    txns: ExpenseTxnRecord[],
    recordOverrides: Parameters<typeof createTrackerRecord>[0] & { currentYm?: string } = {
      targetDaily: 12,
      usualDailyAtStart: 17,
      usualByThemeAtStart: usualByTheme,
      currentYm: "2026-09",
    },
  ) {
    const record = createTrackerRecord(recordOverrides);
    return buildDailySpendTrackerView(record, {
      expenseTxns: txns,
      fxRates: {},
      currency: "CAD",
    });
  }

  it("scores only finished complete months and keeps the current month as pace", () => {
    const txns = [
      expense({ category: "Groceries", amount: 310, txMonth: "2026-10" }),
      expense({ category: "Gas", amount: 155, txMonth: "2026-10" }),
      expense({ category: "Streaming", amount: 31, txMonth: "2026-10" }),
      expense({ category: "Groceries", amount: 2300, txMonth: "2026-11" }),
    ];
    const view = viewFor(txns, {
      targetDaily: 12,
      usualDailyAtStart: 17,
      usualByThemeAtStart: usualByTheme,
      currentYm: "2026-09",
    });
    expect(view.record.startMonth).toBe("2026-10");
    expect(view.finishedMonths.map((m) => m.yearMonth)).toEqual(["2026-10"]);
    expect(view.finishedMonths.map((m) => m.yearMonth)).not.toContain("2026-11");
    expect(view.lastFinished?.yearMonth).toBe("2026-10");
    expect(view.lastFinished?.actualDaily).toBeCloseTo((310 + 155 + 31) / 31, 10);
    expect(view.lastFinished?.actualMonth).toBe(496);
    expect(view.lastFinished?.targetMonth).toBeCloseTo(12 * 31, 10);
    expect(view.lastFinished?.promised).toBeCloseTo((17 - 12) * 31, 10);
    expect(view.lastFinished?.kept).toBeCloseTo((17 - 496 / 31) * 31, 10);
    expect(view.pace?.yearMonth).toBe("2026-11");
    expect(view.pace?.daysElapsed).toBe(23);
    expect(view.pace?.actualDaily).toBeCloseTo(2300 / 23, 10);
    expect(view.totalKept).toBeCloseTo(view.lastFinished!.kept, 10);
  });

  it("excludes Housing from the target actuals", () => {
    const txns = [
      expense({ category: "Groceries", amount: 310, txMonth: "2026-10" }),
      expense({ category: "Rent", amount: 2000, txMonth: "2026-10" }),
      expense({ category: "Utilities", amount: 150, txMonth: "2026-10" }),
    ];
    const spending = computeMonthSpending("2026-10", txns);
    const amounts = themeAmountsFromSpending(spending);
    expect(amounts.housing).toBe(2150);
    expect(amounts.food).toBe(310);
    expect(trackedThemeTotal(amounts)).toBe(310);
    expect(TRACKED_DAILY_SPEND_THEME_IDS).not.toContain("housing");
    expect(HOUSING_EXCLUDED_FROM_TARGET_NOTE).toMatch(/Housing/);

    const view = viewFor(txns, {
      targetDaily: 8,
      usualDailyAtStart: 10,
      usualByThemeAtStart: { food: 10, "getting-around": 0, fun: 0 },
      currentYm: "2026-09",
    });
    expect(view.lastFinished?.actualMonth).toBe(310);
    expect(view.lastFinished?.actualDaily).toBeCloseTo(310 / 31, 10);
    expect(view.lastFinished?.actualMonth).not.toBe(2460);
  });

  it("applies the new target only from the next month after an edit", () => {
    const txns = [
      expense({ category: "Groceries", amount: 310, txMonth: "2026-12" }),
      expense({ category: "Groceries", amount: 310, txMonth: "2027-01" }),
      expense({ category: "Groceries", amount: 280, txMonth: "2027-02" }),
    ];
    (globalThis as { __TEST_NOW__?: Date }).__TEST_NOW__ = new Date("2027-02-10T12:00:00");
    const started = createTrackerRecord({
      targetDaily: 8,
      usualDailyAtStart: 12,
      usualByThemeAtStart: { food: 12, "getting-around": 0, fun: 0 },
      currentYm: "2026-11",
    });
    const edited = applyTargetEdit(started, 6, "2027-02");
    const view = buildDailySpendTrackerView(edited, {
      expenseTxns: txns,
      fxRates: {},
      currency: "CAD",
    });
    expect(view.finishedMonths.map((m) => m.yearMonth)).toEqual(["2026-12", "2027-01"]);
    expect(view.finishedMonths.every((m) => m.targetDaily === 8)).toBe(true);
    expect(view.finishedMonths.find((m) => m.yearMonth === "2027-02")).toBeUndefined();
    expect(view.pace?.yearMonth).toBe("2027-02");
    expect(view.pace?.targetDaily).toBe(8);
    expect(periodForMonth(edited.periods, "2027-03")?.targetDaily).toBe(6);
  });

  it("matches usualFromDailySpend to the three tracked themes, not Housing", () => {
    const txns = ["2026-08", "2026-09", "2026-10"].flatMap((ym) => [
      expense({ category: "Groceries", amount: 92, txMonth: ym }),
      expense({ category: "Rent", amount: 2000, txMonth: ym }),
      expense({ category: "Gas", amount: 92, txMonth: ym }),
    ]);
    const result = buildDailySpend({
      expenseTxns: txns,
      accountSnapshots: snapshots as never,
      debtPaymentHistory: [],
      userReviews: [],
      fxRates: {},
      currency: "CAD",
      range: "3m",
    });
    const usual = usualFromDailySpend(result);
    const housing = result.themes.find((t) => t.id === "housing")!.dailyRate;
    expect(housing).toBeGreaterThan(0);
    expect(usual.usualDaily).toBeCloseTo(
      (result.themes.find((t) => t.id === "food")!.dailyRate +
        result.themes.find((t) => t.id === "getting-around")!.dailyRate +
        result.themes.find((t) => t.id === "fun")!.dailyRate),
      10,
    );
    expect(usual.usualDaily + housing).toBeCloseTo(result.everydayDailyRate, 10);
  });

  it("lists themes that went over the frozen usual", () => {
    const txns = [
      expense({ category: "Groceries", amount: 620, txMonth: "2026-10" }),
      expense({ category: "Gas", amount: 31, txMonth: "2026-10" }),
    ];
    const view = viewFor(txns, {
      targetDaily: 12,
      usualDailyAtStart: 15,
      usualByThemeAtStart: { food: 10, "getting-around": 5, fun: 0 },
      currentYm: "2026-09",
    });
    const overIds = view.lastFinished?.themesOverUsual.map((t) => t.id);
    expect(overIds).toContain("food");
    expect(overIds).not.toContain("getting-around");
  });
});

describe("What-if chips and the tracker", () => {
  it("drops Housing and unknown ids from a chip selection, in tracked order", () => {
    expect(trackableThemeIds(["fun", "housing", "food", "nope"])).toEqual(["food", "fun"]);
    expect(trackableThemeIds(["housing"])).toEqual([]);
    expect(trackableThemeIds(null)).toEqual([]);
  });

  it("starts tracking the selected chips only", () => {
    const record = createTrackerRecord({
      targetDaily: 20,
      usualDailyAtStart: 25,
      usualByThemeAtStart: { food: 20, "getting-around": 9, fun: 5 },
      currentYm: "2026-11",
      trackedThemes: ["food", "fun"],
    });
    expect(record.trackedThemes).toEqual(["food", "fun"]);
    expect(record.usualByThemeAtStart).toEqual({ food: 20, fun: 5 });
    const parsed = parseTrackerRecord(JSON.parse(JSON.stringify(record)));
    expect(parsed?.trackedThemes).toEqual(["food", "fun"]);
  });

  it("never tracks Housing and falls back to all tracked themes when nothing is left", () => {
    const record = createTrackerRecord({
      targetDaily: 20,
      usualDailyAtStart: 25,
      usualByThemeAtStart: {},
      currentYm: "2026-11",
      trackedThemes: ["housing"],
    });
    expect(record.trackedThemes).toEqual([...TRACKED_DAILY_SPEND_THEME_IDS]);
  });

  it("keeps the usual equal to the selected chips' daily rates", () => {
    const txns = ["2026-08", "2026-09", "2026-10"].flatMap((ym) => [
      expense({ category: "Groceries", amount: 92, txMonth: ym }),
      expense({ category: "Rent", amount: 2000, txMonth: ym }),
      expense({ category: "Gas", amount: 92, txMonth: ym }),
    ]);
    const result = buildDailySpend({
      expenseTxns: txns,
      accountSnapshots: snapshots as never,
      debtPaymentHistory: [],
      userReviews: [],
      fxRates: {},
      currency: "CAD",
      range: "3m",
    });
    const rate = (id: string) => result.themes.find((t) => t.id === id)!.dailyRate;
    expect(usualFromDailySpend(result, ["food"]).usualDaily).toBeCloseTo(rate("food"), 10);
    expect(usualFromDailySpend(result, ["food", "housing"]).usualDaily).toBeCloseTo(
      rate("food") + rate("housing"),
      10,
    );
  });

  it("only counts tracked themes in month results", () => {
    const record = createTrackerRecord({
      targetDaily: 10,
      usualDailyAtStart: 12,
      usualByThemeAtStart: { food: 12 },
      currentYm: "2026-09",
      trackedThemes: ["food"],
    });
    const view = buildDailySpendTrackerView(record, {
      expenseTxns: [
        expense({ category: "Groceries", amount: 310, txMonth: "2026-10" }),
        expense({ category: "Gas", amount: 310, txMonth: "2026-10" }),
      ],
      fxRates: {},
      currency: "CAD",
    });
    const october = view.finishedMonths.find((m) => m.yearMonth === "2026-10");
    expect(october?.actualMonth).toBeCloseTo(310, 6);
  });

  it("joins labels and compares selections", () => {
    expect(joinThemeLabels(["fun", "food"])).toBe("Eating and Fun & entertainment");
    expect(joinThemeLabels(TRACKED_DAILY_SPEND_THEME_IDS)).toBe(
      "Eating, Getting around, and Fun & entertainment",
    );
    expect(sameThemeSelection(["food", "fun"], ["fun", "food"])).toBe(true);
    expect(sameThemeSelection(["food", "fun", "housing"], ["fun", "food"])).toBe(false);
  });
});
