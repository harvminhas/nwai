/**
 * Tests for shared chart domain calculation
 * Ensures consistent, readable vertical scales across all balance charts
 */

import { describe, it, expect } from "vitest";
import { calculateBalanceChartDomain, formatChartAxisValue } from "../chartDomain";

describe("calculateBalanceChartDomain", () => {
  it("handles empty values array", () => {
    const domain = calculateBalanceChartDomain([]);
    expect(domain.min).toBe(0);
    expect(domain.max).toBe(1000);
  });

  it("handles all-zero values (no divide-by-zero)", () => {
    const domain = calculateBalanceChartDomain([0, 0, 0]);
    // Function adds standard padding even for zeros
    expect(domain.min).toBeLessThanOrEqual(0);
    expect(domain.max).toBeGreaterThan(0);
    expect(domain.max - domain.min).toBeGreaterThan(0); // Ensures yScale won't divide by zero
  });

  it("detects small changes on large balance ($100 change on $100k)", () => {
    // $100k, $100.1k - only $100 difference (0.1% change)
    const values = [100000, 100100];
    const domain = calculateBalanceChartDomain(values);
    
    // Should zoom in: small range with range-proportional padding
    // $100 range → 5x padding each side → ~$1100 total span
    // This makes the $100 change occupy ~9% of chart height (visible!)
    expect(domain.min).toBeLessThanOrEqual(100000);
    expect(domain.max).toBeGreaterThanOrEqual(100100);
    
    // $100 change should be visible: occupies meaningful portion of range
    const actualRange = domain.max - domain.min;
    const changeRatio = 100 / actualRange;
    expect(changeRatio).toBeGreaterThan(0.05); // Change is at least 5% of display
    expect(actualRange).toBeLessThan(2000); // But not excessive padding
  });

  it("applies standard padding for large changes ($10k change on $100k)", () => {
    // $100k to $110k - 10% change (large)
    const values = [100000, 110000];
    const domain = calculateBalanceChartDomain(values);
    
    // Should use standard 10% below, 5% above padding
    // Min: 100k - max(10k * 0.1, 1k) = 100k - 1k = 99k → rounds to 99k
    // Max: 110k + max(10k * 0.05, 500) = 110k + 500 → rounds to 111k
    expect(domain.min).toBeLessThanOrEqual(99000);
    expect(domain.max).toBeGreaterThanOrEqual(110500);
  });

  it("handles flat series (all same non-zero value)", () => {
    const values = [50000, 50000, 50000];
    const domain = calculateBalanceChartDomain(values);
    
    // Should detect small range and zoom in
    expect(domain.min).toBeLessThan(50000);
    expect(domain.max).toBeGreaterThan(50000);
    expect(domain.max - domain.min).toBeGreaterThan(0);
  });

  it("handles negative values (debt accounts)", () => {
    const values = [-50000, -45000, -48000];
    const domain = calculateBalanceChartDomain(values);
    
    // Min should be below most negative (-50k)
    expect(domain.min).toBeLessThan(-50000);
    // Max should be above least negative (-45k)
    expect(domain.max).toBeGreaterThan(-45000);
  });

  it("handles sign-crossing (balance going from negative to positive)", () => {
    const values = [-10000, -5000, 0, 5000, 10000];
    const domain = calculateBalanceChartDomain(values);
    
    // Should span the full range with padding
    expect(domain.min).toBeLessThan(-10000);
    expect(domain.max).toBeGreaterThan(10000);
  });

  it("rounds to thousands for clean axis labels", () => {
    const values = [12345, 23456];
    const domain = calculateBalanceChartDomain(values);
    
    // Both min and max should be multiples of 1000
    expect(domain.min % 1000).toBe(0);
    expect(domain.max % 1000).toBe(0);
  });

  it("handles single data point", () => {
    const domain = calculateBalanceChartDomain([75000]);
    
    // Should create reasonable range around single point
    expect(domain.min).toBeLessThan(75000);
    expect(domain.max).toBeGreaterThan(75000);
    expect(domain.max - domain.min).toBeGreaterThan(0);
  });

  it("handles outlier (one very large value)", () => {
    // Most values around $100k, one spike to $500k
    const values = [100000, 102000, 101000, 500000, 103000];
    const domain = calculateBalanceChartDomain(values);
    
    // Should accommodate the full range
    expect(domain.min).toBeLessThan(100000);
    expect(domain.max).toBeGreaterThanOrEqual(500000);
  });

  it("prevents exaggerating cents-level noise into huge swings", () => {
    // $100k +/- a few cents - should not create dramatic visual
    const values = [100000.00, 100000.05, 99999.95, 100000.10];
    const domain = calculateBalanceChartDomain(values);
    
    // Cents-level changes should be detected as small range
    // Domain should zoom in but not create wild swings
    const range = domain.max - domain.min;
    expect(range).toBeLessThan(10000); // Tighter than $10k range
  });
});

describe("formatChartAxisValue", () => {
  it("formats millions with M suffix", () => {
    expect(formatChartAxisValue(1500000, "$")).toBe("$1.5M");
    expect(formatChartAxisValue(2000000, "CA$")).toBe("CA$2.0M");
  });

  it("formats thousands with k suffix", () => {
    expect(formatChartAxisValue(50000, "$")).toBe("$50k");
    expect(formatChartAxisValue(1500, "$")).toBe("$2k"); // Rounds to nearest k
  });

  it("formats small values without suffix", () => {
    expect(formatChartAxisValue(500, "$")).toBe("$500");
    expect(formatChartAxisValue(0, "$")).toBe("$0");
  });

  it("handles negative values", () => {
    expect(formatChartAxisValue(-50000, "$")).toBe("-$50k");
    expect(formatChartAxisValue(-1500000, "$")).toBe("-$1.5M");
  });

  it("defaults to $ symbol", () => {
    expect(formatChartAxisValue(10000)).toBe("$10k");
  });
});
