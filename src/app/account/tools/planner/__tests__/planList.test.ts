import { describe, expect, it } from "vitest";
import { formatCurrency } from "@/lib/currencyUtils";
import {
  PLAN_DATE_RANGE_ERROR,
  dateRangeErrorForSave,
  formatPlanDateRange,
  formatYearSubtotal,
  groupPlans,
  isPlanCompleted,
  monthlySetAside,
  validatePlanDates,
  type PlanListItem,
} from "../planList";

const TODAY = "2026-11-22";

function item(overrides: Partial<PlanListItem> = {}): PlanListItem {
  return {
    id: overrides.id ?? "p1",
    name: overrides.name ?? "Plan",
    startDate: overrides.startDate ?? "2026-12-01",
    endDate: overrides.endDate ?? "2026-12-20",
    budget: overrides.budget ?? 1000,
    completedAt: overrides.completedAt,
  };
}

describe("groupPlans", () => {
  it("puts in-progress plans first, then future years soonest-first, then past newest-first", () => {
    const inProgressB = item({
      id: "ip-b",
      name: "Active B",
      startDate: "2026-11-10",
      endDate: "2026-12-01",
      budget: 200,
    });
    const inProgressA = item({
      id: "ip-a",
      name: "Active A",
      startDate: "2026-11-01",
      endDate: "2026-11-30",
      budget: 100,
    });
    const future2028 = item({
      id: "f-28",
      name: "Later",
      startDate: "2028-01-15",
      endDate: "2028-01-20",
      budget: 500,
    });
    const future2027Late = item({
      id: "f-27b",
      name: "Winter",
      startDate: "2027-12-01",
      endDate: "2027-12-10",
      budget: 8500,
    });
    const future2027Early = item({
      id: "f-27a",
      name: "Spring",
      startDate: "2027-05-03",
      endDate: "2027-05-15",
      budget: 20000,
    });
    const pastOlder = item({
      id: "past-old",
      name: "Old",
      startDate: "2025-06-01",
      endDate: "2025-06-10",
      budget: 50,
    });
    const pastNewer = item({
      id: "past-new",
      name: "Recent",
      startDate: "2026-10-01",
      endDate: "2026-10-15",
      budget: 75,
    });

    const grouped = groupPlans(
      [
        future2028,
        pastOlder,
        inProgressB,
        future2027Late,
        pastNewer,
        future2027Early,
        inProgressA,
      ],
      TODAY,
    );

    expect(grouped.inProgress.map((p) => p.id)).toEqual(["ip-a", "ip-b"]);
    expect(grouped.futureByYear.map((g) => g.year)).toEqual([2027, 2028]);
    expect(grouped.futureByYear[0].plans.map((p) => p.id)).toEqual(["f-27a", "f-27b"]);
    expect(grouped.futureByYear[0].budgetTotal).toBe(28500);
    expect(grouped.futureByYear[1].plans.map((p) => p.id)).toEqual(["f-28"]);
    expect(grouped.past.map((p) => p.id)).toEqual(["past-new", "past-old"]);
  });

  it("does not create an Upcoming bucket — future plans only appear under year groups", () => {
    const grouped = groupPlans(
      [item({ id: "trip", startDate: "2027-05-03", endDate: "2027-05-15", budget: 5000 })],
      TODAY,
    );
    expect(grouped.inProgress).toEqual([]);
    expect(grouped.past).toEqual([]);
    expect(grouped.futureByYear).toHaveLength(1);
    expect(grouped.futureByYear[0].year).toBe(2027);
    expect(Object.keys(grouped)).toEqual(["inProgress", "futureByYear", "past"]);
  });

  it("treats startDate <= today <= endDate as in progress, including today-only plans", () => {
    const grouped = groupPlans(
      [item({ id: "today", startDate: TODAY, endDate: TODAY, budget: 10 })],
      TODAY,
    );
    expect(grouped.inProgress.map((p) => p.id)).toEqual(["today"]);
    expect(grouped.futureByYear).toEqual([]);
    expect(grouped.past).toEqual([]);
  });

  it("does not put a plan in two buckets when dates are invalid (end before start)", () => {
    const grouped = groupPlans(
      [
        item({
          id: "invalid",
          startDate: "2027-01-01",
          endDate: "2026-01-01",
          budget: 1,
        }),
      ],
      TODAY,
    );
    expect(grouped.futureByYear[0]?.plans.map((p) => p.id)).toEqual(["invalid"]);
    expect(grouped.inProgress).toEqual([]);
    expect(grouped.past).toEqual([]);
  });
});

describe("formatPlanDateRange", () => {
  it("uses a single date when start and end are the same", () => {
    expect(formatPlanDateRange("2027-05-03", "2027-05-03")).toBe("May 3, 2027");
  });

  it("omits the repeated year when start and end are in the same year", () => {
    expect(formatPlanDateRange("2027-05-03", "2027-05-15")).toBe("May 3 – May 15, 2027");
  });

  it("keeps both years when the range crosses a year boundary", () => {
    expect(formatPlanDateRange("2026-12-28", "2027-01-04")).toBe(
      "Dec 28, 2026 – Jan 4, 2027",
    );
  });
});

describe("formatYearSubtotal", () => {
  it("uses existing currency formatting and singular plan wording", () => {
    expect(formatYearSubtotal(3, 28500, "CAD")).toBe(
      `3 plans · ${formatCurrency(28500, "CAD")}`,
    );
    expect(formatYearSubtotal(1, 5000, "CAD")).toBe(
      `1 plan · ${formatCurrency(5000, "CAD")}`,
    );
  });
});

describe("validatePlanDates", () => {
  it("accepts equal dates and end after start", () => {
    expect(validatePlanDates("2027-05-03", "2027-05-03")).toBeNull();
    expect(validatePlanDates("2027-05-03", "2027-05-15")).toBeNull();
  });

  it("rejects end before start with a plain-language message", () => {
    expect(validatePlanDates("2027-05-15", "2027-05-03")).toBe(PLAN_DATE_RANGE_ERROR);
    expect(PLAN_DATE_RANGE_ERROR.toLowerCase()).toContain("end date");
    expect(PLAN_DATE_RANGE_ERROR.toLowerCase()).toContain("start date");
  });
});

describe("dateRangeErrorForSave", () => {
  const inverted = { startDate: "2027-07-05", endDate: "2026-11-22" };

  it("skips the check when both dates are unchanged from the loaded plan", () => {
    expect(
      dateRangeErrorForSave(inverted.startDate, inverted.endDate, inverted),
    ).toBeNull();
  });

  it("rejects changing a date to an invalid range", () => {
    expect(
      dateRangeErrorForSave("2027-07-05", "2026-01-01", inverted),
    ).toBe(PLAN_DATE_RANGE_ERROR);
  });

  it("accepts fixing inverted dates", () => {
    expect(
      dateRangeErrorForSave("2026-11-22", "2027-07-05", inverted),
    ).toBeNull();
  });

  it("always validates on create (no stored plan)", () => {
    expect(dateRangeErrorForSave("2027-07-05", "2026-11-22", null)).toBe(
      PLAN_DATE_RANGE_ERROR,
    );
  });
});

describe("isPlanCompleted", () => {
  it("treats a missing completedAt as not completed", () => {
    expect(isPlanCompleted({})).toBe(false);
    expect(isPlanCompleted({ completedAt: null })).toBe(false);
    expect(isPlanCompleted({ completedAt: "" })).toBe(false);
    expect(isPlanCompleted({ completedAt: "2026-11-22T00:00:00.000Z" })).toBe(true);
  });
});

describe("monthlySetAside", () => {
  it("returns null for in-progress or over-budget plans", () => {
    expect(monthlySetAside(item({ startDate: TODAY, endDate: TODAY, budget: 100 }), 0, TODAY)).toBeNull();
    expect(
      monthlySetAside(item({ startDate: "2027-05-01", endDate: "2027-05-10", budget: 100 }), 150, TODAY),
    ).toBeNull();
  });

  it("divides remaining budget across months until start", () => {
    const startDate = "2027-05-22";
    const amount = monthlySetAside(
      item({ startDate, endDate: "2027-05-30", budget: 6000 }),
      0,
      TODAY,
    );
    const months = Math.max(
      1,
      Math.ceil(
        (new Date(`${startDate}T00:00:00`).getTime() -
          new Date(`${TODAY}T00:00:00`).getTime()) /
          (30 * 24 * 60 * 60 * 1000),
      ),
    );
    expect(amount).toBe(6000 / months);
    expect(amount).toBeGreaterThan(0);
  });
});
