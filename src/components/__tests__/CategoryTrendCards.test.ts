import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";
import { describeAssetChangePill, describeDebtChangePill } from "@/lib/categoryTrends";

const src = readFileSync(resolve(__dirname, "../CategoryTrendCards.tsx"), "utf8");

describe("CategoryTrendCards layout", () => {
  it("stacks one card per row on mobile and titles the grid By category", () => {
    expect(src).toContain("By category");
    expect(src).toContain("grid-cols-1");
    expect(src).toContain("md:grid-cols-2");
  });

  it("paints debt decreases green and increases red", () => {
    expect(src).toContain('tone === "down" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700"');
    const paid = describeDebtChangePill(-500, "CAD");
    expect(paid.tone).toBe("down");
    expect(paid.text).toMatch(/Paid down/);
    const grew = describeDebtChangePill(200, "CAD");
    expect(grew.tone).toBe("up");
    expect(grew.text).toMatch(/Grew/);
    const up = describeAssetChangePill(100, 0.1, "CAD");
    expect(up.tone).toBe("up");
  });

  it("expands accounts in place instead of navigating away", () => {
    expect(src).toContain("View account →");
    expect(src).toContain("View ${card.accountCount} accounts →");
    expect(src).toContain("Hide accounts");
    expect(src).toContain("sparklineYDomain");
    expect(src).toContain("account.href");
    expect(src).not.toContain("href={card.href}");
  });
});
