/**
 * Production reconciliation: calculateNetWorthForMonths → assets/debts summaries.
 * Asserts Trends detail rows come from the same byAccount that produced the plotted total.
 */

import { describe, it, expect } from "vitest";
import { buildProductionTrendsFixture } from "./trendsMonthCompositionFixture";

describe("Trends month composition — production core → summary", () => {
  const { assetsSummary, debtsSummary, monthlyHistory } = buildProductionTrendsFixture();

  it("core includes carry-forward FX account, manual asset from startDate, and manual liability from updatedAt", () => {
    const jan = monthlyHistory.find((m) => m.yearMonth === "2026-01")!;
    const feb = monthlyHistory.find((m) => m.yearMonth === "2026-02")!;
    const mar = monthlyHistory.find((m) => m.yearMonth === "2026-03")!;

    // Jan: USD checking 1000*1.35 + CAD investment 5000; no car (start Feb); no federal loan (updated Feb)
    expect(jan.totalAssets).toBe(1350 + 5000);
    expect(jan.totalDebts).toBe(2000 + 8000);
    expect(jan.byAccount?.find((a) => a.slug === "manual-car-1")).toBeUndefined();
    expect(jan.byAccount?.find((a) => a.slug === "manual-student-1")).toBeUndefined();

    // Feb: checking 1100*1.35 + carried investment 5000 + car 25000; visa 1800 + osap 7900 + federal 15000
    expect(feb.totalAssets).toBe(1485 + 5000 + 25000);
    expect(feb.totalDebts).toBe(1800 + 7900 + 15000);
    expect(feb.byAccount?.find((a) => a.slug === "cad-investment")?.value).toBe(5000);
    expect(feb.byAccount?.find((a) => a.slug === "manual-car-1")?.value).toBe(25000);
    expect(feb.byAccount?.find((a) => a.slug === "manual-student-1")?.value).toBe(-15000);

    // Mar: checking 1200*1.35 + carried 5000 + car; visa 1600 + osap 7800 + federal
    expect(mar.totalAssets).toBe(1620 + 5000 + 25000);
    expect(mar.totalDebts).toBe(1600 + 7800 + 15000);
  });

  it("does not double-count imported OSAP that is also stored as a manual liability", () => {
    for (const month of monthlyHistory) {
      const osapRows = (month.byAccount || []).filter((a) => a.label === "OSAP Student Loan");
      expect(osapRows).toHaveLength(1);
      expect(osapRows[0].slug).toBe("osap-imported");
    }
  });

  it("assets summary accountDetails sum to the plotted monthly total", () => {
    expect(assetsSummary.monthlyHistory.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);

    for (const month of assetsSummary.monthlyHistory) {
      expect(month.accountDetails).toBeDefined();
      const rowSum = month.accountDetails!.reduce((sum, row) => sum + row.value, 0);
      expect(rowSum).toBe(month.total);
      expect(month.accountDetails!.every((row) => row.value > 0)).toBe(true);
    }

    const mar = assetsSummary.monthlyHistory.find((m) => m.month === "2026-03")!;
    expect(mar.accountDetails!.map((r) => r.label).sort()).toEqual(
      ["2022 Honda Civic", "CAD Investment", "US Checking"].sort()
    );
  });

  it("debts summary accountDetails sum to the plotted monthly total including the federal student loan", () => {
    expect(debtsSummary.monthlyHistory.map((m) => m.month)).toEqual(["2026-01", "2026-02", "2026-03"]);

    for (const month of debtsSummary.monthlyHistory) {
      expect(month.accountDetails).toBeDefined();
      const rowSum = month.accountDetails!.reduce((sum, row) => sum + Math.abs(row.value), 0);
      expect(rowSum).toBe(month.totalDebt);
      expect(month.accountDetails!.every((row) => row.value < 0)).toBe(true);
    }

    const jan = debtsSummary.monthlyHistory.find((m) => m.month === "2026-01")!;
    expect(jan.accountDetails!.some((r) => r.label === "Federal Student Loan")).toBe(false);

    const mar = debtsSummary.monthlyHistory.find((m) => m.month === "2026-03")!;
    expect(mar.accountDetails!.some((r) => r.label === "Federal Student Loan")).toBe(true);
    expect(mar.accountDetails!.filter((r) => r.label === "OSAP Student Loan")).toHaveLength(1);
  });
});
