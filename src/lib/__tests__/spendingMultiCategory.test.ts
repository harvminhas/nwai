import { describe, expect, it } from "vitest";
import {
  combineCategoryDrilldowns,
  combinedCategoryTitle,
  isMultiCategory,
  parseCategoryParam,
  spendingHrefForCategories,
  type CategoryDrilldownPart,
} from "../spendingMultiCategory";

function part(
  label: string,
  months: Array<[string, number]>,
  merchants: Array<[string, number]>,
  accounts: Array<[string, number, number]> = [],
): CategoryDrilldownPart {
  const total = months.reduce((sum, [, amount]) => sum + amount, 0);
  return {
    level: "category",
    breadcrumb: [{ label: "All spending", href: "/account/spending" }, { label }],
    total,
    avgPerMonth: total / months.length,
    monthlySeries: months.map(([yearMonth, amount]) => ({ yearMonth, amount })),
    comparisonSeries: months.map(([yearMonth]) => ({ yearMonth, amount: 1000 })),
    rankedItems: merchants.map(([name, amount]) => ({
      name,
      slug: name.toLowerCase(),
      total: amount,
      share: amount / total,
      trend: 0,
      monthlySeries: [],
    })),
    accounts: accounts.map(([slug, amount, count]) => ({
      label: slug,
      slug,
      total: amount,
      share: amount / total,
      count,
    })),
    currency: "CAD",
  };
}

describe("parseCategoryParam", () => {
  it("keeps a single category unchanged", () => {
    expect(parseCategoryParam("Dining")).toEqual(["Dining"]);
    expect(parseCategoryParam("")).toEqual([]);
    expect(parseCategoryParam(null)).toEqual([]);
    expect(isMultiCategory(parseCategoryParam("Dining"))).toBe(false);
  });

  it("splits known parents on commas, trims, canonicalises case and dedupes", () => {
    expect(parseCategoryParam("Groceries,Dining")).toEqual(["Groceries", "Dining"]);
    expect(parseCategoryParam(" groceries , Dining,Dining,")).toEqual(["Groceries", "Dining"]);
    expect(isMultiCategory(parseCategoryParam("Groceries,Dining"))).toBe(true);
  });

  it("treats a value with an unknown part as one raw category (old behaviour)", () => {
    expect(parseCategoryParam("Groceries,Not a category")).toEqual(["Groceries,Not a category"]);
    expect(parseCategoryParam("Debt,Dining")).toEqual(["Debt,Dining"]);
  });
});

describe("spending links and title", () => {
  it("builds single and multi-category URLs", () => {
    expect(spendingHrefForCategories(["Personal Care"])).toBe(
      "/account/spending?category=Personal%20Care",
    );
    expect(spendingHrefForCategories(["Groceries", "Dining"])).toBe(
      "/account/spending?category=Groceries,Dining",
    );
    expect(combinedCategoryTitle(["Groceries", "Dining"])).toBe("Groceries + Dining");
  });
});

describe("combineCategoryDrilldowns", () => {
  const groceries = part(
    "Groceries",
    [["2026-09", 400], ["2026-10", 500]],
    [["Loblaws", 600], ["Costco", 300]],
    [["visa_1234", 700, 10], ["checking_5678", 200, 3]],
  );
  const dining = part(
    "Dining",
    [["2026-09", 150], ["2026-10", 250]],
    [["Tim Hortons", 250], ["Costco", 150]],
    [["visa_1234", 400, 20]],
  );

  it("totals equal the sum of the individual category pages", () => {
    const combined = combineCategoryDrilldowns(["Groceries", "Dining"], [groceries, dining])!;
    expect(combined.total).toBe(groceries.total + dining.total);
    expect(combined.avgPerMonth).toBeCloseTo(groceries.avgPerMonth + dining.avgPerMonth, 10);
    expect(combined.monthlySeries).toEqual([
      { yearMonth: "2026-09", amount: 550 },
      { yearMonth: "2026-10", amount: 750 },
    ]);
    expect(combined.breadcrumb[1].label).toBe("Groceries + Dining");
    expect(combined.sections).toEqual([
      { category: "Groceries", total: 900, avgPerMonth: 450 },
      { category: "Dining", total: 400, avgPerMonth: 200 },
    ]);
  });

  it("keeps each category's merchants tagged with their category", () => {
    const combined = combineCategoryDrilldowns(["Groceries", "Dining"], [groceries, dining])!;
    expect(combined.rankedItems.map((i) => `${i.category}:${i.name}`)).toEqual([
      "Groceries:Loblaws",
      "Groceries:Costco",
      "Dining:Tim Hortons",
      "Dining:Costco",
    ]);
    const merchantSum = combined.rankedItems.reduce((sum, i) => sum + i.total, 0);
    expect(merchantSum).toBe(combined.total);
    expect(combined.rankedItems.reduce((sum, i) => sum + i.share, 0)).toBeCloseTo(1, 10);
  });

  it("merges accounts by slug", () => {
    const combined = combineCategoryDrilldowns(["Groceries", "Dining"], [groceries, dining])!;
    expect(combined.accounts?.[0]).toMatchObject({ slug: "visa_1234", total: 1100, count: 30 });
    expect(combined.accounts?.[0].share).toBeCloseTo(1100 / 1300, 10);
  });

  it("skips a category with no data and returns null when none have data", () => {
    const onlyDining = combineCategoryDrilldowns(["Groceries", "Dining"], [null, dining])!;
    expect(onlyDining.total).toBe(dining.total);
    expect(onlyDining.breadcrumb[1].label).toBe("Dining");
    expect(combineCategoryDrilldowns(["Groceries", "Dining"], [null, null])).toBeNull();
  });
});
