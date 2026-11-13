import { describe, expect, it } from "vitest";
import { sparklineYDomain } from "../sparklineScale";

describe("sparklineYDomain", () => {
  it("scales to the series min/max with padding, not zero", () => {
    const d = sparklineYDomain([10000, 10100, 10200]);
    expect(d.min).toBeLessThan(10000);
    expect(d.max).toBeGreaterThan(10200);
    expect(d.min).toBeGreaterThan(5000);
    expect(d.max - d.min).toBeCloseTo(200 * 1.16, 5);
  });

  it("does not pin a high-balance series to zero", () => {
    const d = sparklineYDomain([50000, 50500, 51000]);
    expect(d.min).toBeGreaterThan(40000);
    expect(d.max).toBeGreaterThan(51000);
  });

  it("pads a flat series so the line is not clipped to an edge", () => {
    const d = sparklineYDomain([12000, 12000, 12000]);
    expect(d.min).toBeLessThan(12000);
    expect(d.max).toBeGreaterThan(12000);
  });
});
