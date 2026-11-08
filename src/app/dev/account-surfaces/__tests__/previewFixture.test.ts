import { describe, it, expect } from "vitest";
import {
  buildPreviewAssetsSummary,
  buildPreviewDebtsSummary,
  buildPreviewSwitcherItems,
} from "@/lib/accountSectionPreviewFixture";

describe("synthetic Assets/Debts preview fixture", () => {
  it("includes long names, large amounts, manual and imported rows, and many months", () => {
    const assets = buildPreviewAssetsSummary("many");
    expect(assets.currency).toBe("CAD");
    expect(assets.totalAssets).toBeGreaterThan(1_000_000);
    expect(assets.groups.length).toBeGreaterThanOrEqual(5);
    expect(assets.monthlyHistory).toHaveLength(12);
    expect(JSON.stringify(assets)).toContain("HPE Hewlett Packard Enterprise");
    expect(JSON.stringify(assets)).toContain("2 Bettey Drive");
    expect(assets.groups.some((g) => g.manualAssets.length > 0)).toBe(true);
    expect(assets.groups.some((g) => g.accounts.length > 0)).toBe(true);
    const latest = assets.monthlyHistory[assets.monthlyHistory.length - 1];
    const rowSum = latest.accountDetails!.reduce((s, r) => s + r.value, 0);
    expect(rowSum).toBeCloseTo(latest.total, 6);
  });

  it("builds empty and single-month histories for Trends edge states", () => {
    expect(buildPreviewAssetsSummary("empty").monthlyHistory).toEqual([]);
    expect(buildPreviewAssetsSummary("one").monthlyHistory).toHaveLength(1);
    expect(buildPreviewDebtsSummary("empty").monthlyHistory).toEqual([]);
    expect(buildPreviewDebtsSummary("one").monthlyHistory).toHaveLength(1);
  });

  it("includes imported and manual debts with long card names", () => {
    const debts = buildPreviewDebtsSummary("many");
    expect(debts.totalDebt).toBeGreaterThan(400_000);
    expect(JSON.stringify(debts)).toContain("Platinum Rewards World Elite");
    expect(JSON.stringify(debts)).toContain("OSAP provincial student loan");
    expect(debts.groups.some((g) => g.manualLiabilities.length > 0)).toBe(true);
    expect(buildPreviewSwitcherItems("assets").some((i) => i.icon === "asset")).toBe(true);
    expect(buildPreviewSwitcherItems("debts").some((i) => i.icon === "debt")).toBe(true);
  });
});
