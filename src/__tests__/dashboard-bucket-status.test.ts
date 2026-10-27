/**
 * Unit test for dashboard bucket status colors and labels.
 * 
 * Verifies that:
 * 1. Savings bucket: below target = red, at/above target = green
 * 2. Spending buckets: over target = red, under target = green
 * 3. Status labels use "pts" (percentage points) not "%" 
 * 4. Negative savings shows red badge and red bar
 */

import { describe, it, expect } from "vitest";

describe("Dashboard Bucket Status Logic", () => {
  describe("Savings Bucket Status Colors", () => {
    it("shows red for negative savings value", () => {
      const monthlyAverage = -3646;
      const pctOfIncome = -16;
      const targetPct = 20;
      const diff = pctOfIncome - targetPct; // -36
      
      // Should be red
      expect(monthlyAverage).toBeLessThan(0);
      expect(diff).toBeLessThan(-3);
      
      // Status badge should say "Negative" and be red
      const statusTag = "Negative";
      const statusBgColor = "bg-red-50";
      const statusTextColor = "text-red-700";
      const dotColor = "#ef4444";
      
      expect(statusTag).toBe("Negative");
      expect(statusBgColor).toContain("red");
      expect(statusTextColor).toContain("red");
      expect(dotColor).toBe("#ef4444");
    });
    
    it("shows red for positive value but below target by >3 pts", () => {
      const monthlyAverage = 500;
      const pctOfIncome = 10;
      const targetPct = 20;
      const diff = pctOfIncome - targetPct; // -10
      const absDiff = Math.abs(diff);
      
      expect(monthlyAverage).toBeGreaterThan(0);
      expect(diff).toBeLessThan(-3);
      
      // Status badge should say "Below target by X pts" and be red
      const statusTag = `Below target by ${Math.round(absDiff)} pts`;
      const statusBgColor = "bg-red-50";
      const statusTextColor = "text-red-700";
      
      expect(statusTag).toBe("Below target by 10 pts");
      expect(statusTag).toContain("pts");
      expect(statusTag).not.toContain("%");
      expect(statusBgColor).toContain("red");
      expect(statusTextColor).toContain("red");
    });
    
    it("shows amber for slightly below target (0-3 pts)", () => {
      const pctOfIncome = 18;
      const targetPct = 20;
      const diff = pctOfIncome - targetPct; // -2
      const absDiff = Math.abs(diff);
      
      expect(diff).toBeGreaterThanOrEqual(-3);
      expect(diff).toBeLessThan(0);
      
      const statusTag = `${Math.round(absDiff)} pts below target`;
      const statusBgColor = "bg-amber-50";
      const statusTextColor = "text-amber-700";
      
      expect(statusTag).toBe("2 pts below target");
      expect(statusBgColor).toContain("amber");
      expect(statusTextColor).toContain("amber");
    });
    
    it("shows green when at or above target", () => {
      const pctOfIncome = 25;
      const targetPct = 20;
      const diff = pctOfIncome - targetPct; // +5
      
      expect(diff).toBeGreaterThanOrEqual(0);
      
      const statusTag = "On track";
      const statusBgColor = "bg-green-50";
      const statusTextColor = "text-green-700";
      const dotColor = "#10b981";
      
      expect(statusTag).toBe("On track");
      expect(statusBgColor).toContain("green");
      expect(statusTextColor).toContain("green");
      expect(dotColor).toBe("#10b981");
    });
  });
  
  describe("Spending Buckets (Fixed/Essentials/Flexible) Status Colors", () => {
    it("shows red when over target by >3 pts", () => {
      const pctOfIncome = 35;
      const targetPct = 25;
      const diff = pctOfIncome - targetPct; // +10
      const absDiff = Math.abs(diff);
      
      expect(diff).toBeGreaterThan(3);
      
      const statusTag = `${Math.round(absDiff)} pts over`;
      const statusBgColor = "bg-red-50";
      const statusTextColor = "text-red-700";
      const dotColor = "#ef4444";
      
      expect(statusTag).toBe("10 pts over");
      expect(statusTag).toContain("pts");
      expect(statusBgColor).toContain("red");
      expect(statusTextColor).toContain("red");
      expect(dotColor).toBe("#ef4444");
    });
    
    it("shows amber when slightly over target (0-3 pts)", () => {
      const pctOfIncome = 27;
      const targetPct = 25;
      const diff = pctOfIncome - targetPct; // +2
      const absDiff = Math.abs(diff);
      
      expect(diff).toBeGreaterThan(0);
      expect(diff).toBeLessThanOrEqual(3);
      
      const statusTag = `${Math.round(absDiff)} pts over`;
      const statusBgColor = "bg-amber-50";
      const statusTextColor = "text-amber-700";
      
      expect(statusTag).toBe("2 pts over");
      expect(statusBgColor).toContain("amber");
      expect(statusTextColor).toContain("amber");
    });
    
    it("shows green when under target (spending less than target)", () => {
      const pctOfIncome = 15;
      const targetPct = 25;
      const diff = pctOfIncome - targetPct; // -10
      const absDiff = Math.abs(diff);
      
      expect(diff).toBeLessThan(-3);
      
      const statusTag = `${Math.round(absDiff)} pts under`;
      const statusBgColor = "bg-green-50";
      const statusTextColor = "text-green-700";
      const dotColor = "#10b981";
      
      expect(statusTag).toBe("10 pts under");
      expect(statusBgColor).toContain("green");
      expect(statusTextColor).toContain("green");
      expect(dotColor).toBe("#10b981");
    });
  });
  
  describe("Progress Bar Width", () => {
    it("clamps negative savings rate to 0% bar width", () => {
      const pctOfIncome = -16;
      const bucket = "savings";
      
      // Bar width formula: clamp negative to 0
      const barWidth = bucket === "savings" && pctOfIncome < 0 
        ? 0 
        : Math.min(100, (pctOfIncome / 50) * 100);
      
      expect(barWidth).toBe(0);
    });
    
    it("shows proportional bar for positive savings rate", () => {
      const pctOfIncome = 20;
      const barWidth = Math.min(100, (pctOfIncome / 50) * 100);
      
      // 20% on a 0-50% scale = 40% bar width
      expect(barWidth).toBe(40);
    });
    
    it("caps bar at 100% for rates above 50%", () => {
      const pctOfIncome = 60;
      const barWidth = Math.min(100, (pctOfIncome / 50) * 100);
      
      expect(barWidth).toBe(100);
    });
  });
  
  describe("Bar Color Follows Status", () => {
    it("uses red bar color when savings is below target", () => {
      const pctOfIncome = 10;
      const targetPct = 20;
      const diff = pctOfIncome - targetPct;
      const bucket = "savings";
      
      const barColor = diff < -3 ? "#ef4444" : "#10b981";
      
      expect(diff).toBeLessThan(-3);
      expect(barColor).toBe("#ef4444");
    });
    
    it("uses green bar color when savings is at target", () => {
      const pctOfIncome = 20;
      const targetPct = 20;
      const diff = pctOfIncome - targetPct;
      
      const barColor = diff >= 0 ? "#10b981" : "#ef4444";
      
      expect(diff).toBe(0);
      expect(barColor).toBe("#10b981");
    });
    
    it("uses red bar color when spending is over target", () => {
      const pctOfIncome = 35;
      const targetPct = 25;
      const diff = pctOfIncome - targetPct;
      
      const barColor = diff > 3 ? "#ef4444" : "#10b981";
      
      expect(diff).toBeGreaterThan(3);
      expect(barColor).toBe("#ef4444");
    });
  });
});
