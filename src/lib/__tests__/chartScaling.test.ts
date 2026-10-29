import { describe, test, expect } from "vitest";
import { scaleBalancePoints, type ChartDimensions } from "../chartScaling";

const defaultDimensions: ChartDimensions = {
  chartWidth: 400,
  chartHeight: 200,
  padding: { top: 20, right: 20, bottom: 30, left: 50 },
};

describe("scaleBalancePoints", () => {
  test("returns empty array for empty history", () => {
    const result = scaleBalancePoints([], defaultDimensions, false);
    expect(result).toEqual([]);
  });

  test("centers single point at mid-chart", () => {
    const history = [
      { month: "2024-01", monthLabel: "Jan 2024", balance: 1000 },
    ];
    
    const result = scaleBalancePoints(history, defaultDimensions, false);
    
    expect(result).toHaveLength(1);
    expect(result[0].x).toBe(50 + (400 - 50 - 20) / 2); // padding.left + plotWidth/2 = 215
    expect(result[0].y).toBe(20 + (200 - 20 - 30) / 2); // padding.top + plotHeight/2 = 95
    expect(Number.isFinite(result[0].x)).toBe(true);
    expect(Number.isFinite(result[0].y)).toBe(true);
  });

  test("handles constant values (max === min) without NaN", () => {
    const history = [
      { month: "2024-01", monthLabel: "Jan 2024", balance: 5000 },
      { month: "2024-02", monthLabel: "Feb 2024", balance: 5000 },
      { month: "2024-03", monthLabel: "Mar 2024", balance: 5000 },
    ];
    
    const result = scaleBalancePoints(history, defaultDimensions, false);
    
    expect(result).toHaveLength(3);
    
    // All points should be at mid-height (since all values are equal)
    result.forEach(point => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.x).toBeGreaterThan(0);
      expect(point.y).toBeGreaterThan(0);
      expect(point.y).toBeLessThan(defaultDimensions.chartHeight);
    });
    
    // Points should be horizontally distributed
    expect(result[0].x).toBeLessThan(result[1].x);
    expect(result[1].x).toBeLessThan(result[2].x);
    
    // Y values should all be the same (mid-line)
    expect(result[0].y).toBe(result[1].y);
    expect(result[1].y).toBe(result[2].y);
  });

  test("filters out non-finite balances", () => {
    const history = [
      { month: "2024-01", monthLabel: "Jan 2024", balance: 1000 },
      { month: "2024-02", monthLabel: "Feb 2024", balance: NaN },
      { month: "2024-03", monthLabel: "Mar 2024", balance: 2000 },
      { month: "2024-04", monthLabel: "Apr 2024", balance: Infinity },
    ];
    
    const result = scaleBalancePoints(history, defaultDimensions, false);
    
    // Only 2 valid points
    expect(result).toHaveLength(2);
    expect(result[0].balance).toBe(1000);
    expect(result[1].balance).toBe(2000);
    
    // All coordinates finite
    result.forEach(point => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    });
  });

  test("returns empty for all non-finite balances", () => {
    const history = [
      { month: "2024-01", monthLabel: "Jan 2024", balance: NaN },
      { month: "2024-02", monthLabel: "Feb 2024", balance: Infinity },
    ];
    
    const result = scaleBalancePoints(history, defaultDimensions, false);
    expect(result).toEqual([]);
  });

  test("handles normal varying values correctly", () => {
    const history = [
      { month: "2024-01", monthLabel: "Jan 2024", balance: 1000 },
      { month: "2024-02", monthLabel: "Feb 2024", balance: 1500 },
      { month: "2024-03", monthLabel: "Mar 2024", balance: 1200 },
    ];
    
    const result = scaleBalancePoints(history, defaultDimensions, false);
    
    expect(result).toHaveLength(3);
    
    // All finite
    result.forEach(point => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    });
    
    // X increases
    expect(result[0].x).toBeLessThan(result[1].x);
    expect(result[1].x).toBeLessThan(result[2].x);
    
    // Y varies with balance (inverted - lower balance = higher Y)
    expect(result[0].y).toBeGreaterThan(result[1].y); // 1000 < 1500
    expect(result[1].y).toBeLessThan(result[2].y);    // 1500 > 1200
  });

  test("handles zero balance", () => {
    const history = [
      { month: "2024-01", monthLabel: "Jan 2024", balance: 0 },
      { month: "2024-02", monthLabel: "Feb 2024", balance: 0 },
    ];
    
    const result = scaleBalancePoints(history, defaultDimensions, false);
    
    expect(result).toHaveLength(2);
    result.forEach(point => {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
    });
  });
});
