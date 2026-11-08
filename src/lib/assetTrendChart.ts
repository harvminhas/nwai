/**
 * Asset Trend Chart Model
 * Generates actual + projected data points for combined chart visualization.
 */

import type { ManualAsset } from "./types";

export interface TrendDataPoint {
  date: string; // YYYY-MM-DD
  value: number;
  label: string;
  isBaseline?: boolean;
  isProjected?: boolean;
}

interface TrendChartData {
  actualPoints: TrendDataPoint[];
  projectedPoints: TrendDataPoint[];
  todayDate: string; // YYYY-MM-DD - marker for current date
}

/**
 * Get today's date in America/New_York timezone as YYYY-MM-DD
 */
function getTodayInNewYork(): string {
  const nyDate = new Date().toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(nyDate).toISOString().slice(0, 10);
}

/**
 * Build trend chart data from asset valuations and projections.
 * 
 * Actual points:
 * - If explicit valuations exist, use them
 * - Otherwise, show legacy baseline using asset.value + startDate (or "as of" today if unknown)
 * 
 * Projected points:
 * - Only if annualGrowthRate exists and is non-zero
 * - Anchored on most recent ACTUAL valuation (effectiveDate <= today)
 * - Future-dated valuations are shown as actual but not used for projection anchor
 */
export function buildTrendChartData(
  asset: ManualAsset,
  projectionYears: number = 5
): TrendChartData {
  const today = getTodayInNewYork();
  const actualPoints: TrendDataPoint[] = [];

  // Build actual valuation points
  if (asset.valuations && asset.valuations.length > 0) {
    asset.valuations.forEach(val => {
      const date = new Date(val.effectiveDate);
      actualPoints.push({
        date: val.effectiveDate,
        value: val.valueCents / 100,
        label: date.toLocaleDateString("en-US", { month: "short", year: "numeric" }),
      });
    });
  } else {
    // Legacy: show current value as baseline
    // Use startDate if known, otherwise show as "as of today"
    const baselineDate = asset.startDate || today;
    const isUnknownDate = !asset.startDate;
    const date = new Date(baselineDate);
    const label = isUnknownDate
      ? `As of ${date.toLocaleDateString("en-US", { month: "short", year: "numeric" })}`
      : date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
    
    actualPoints.push({
      date: baselineDate,
      value: asset.value,
      label,
      isBaseline: true,
    });
  }

  // Sort actual points by date
  actualPoints.sort((a, b) => a.date.localeCompare(b.date));

  // Build projected points if growth rate exists
  const projectedPoints: TrendDataPoint[] = [];
  const hasRate = asset.annualGrowthRate !== null && 
                  asset.annualGrowthRate !== undefined && 
                  asset.annualGrowthRate !== 0;

  if (hasRate) {
    const rate = asset.annualGrowthRate! / 100;
    
    // Find most recent actual value (not future-dated)
    const actualNotFuture = actualPoints.filter(p => p.date <= today);
    const anchorPoint = actualNotFuture.length > 0 
      ? actualNotFuture[actualNotFuture.length - 1]
      : actualPoints[0]; // Fallback to first point if all are future
    
    const anchorValue = anchorPoint.value;
    const anchorDate = new Date(anchorPoint.date);
    
    // Calculate projection end: today + selected years
    const todayDate = new Date(today);
    const projectionEndDate = new Date(todayDate);
    projectionEndDate.setFullYear(todayDate.getFullYear() + projectionYears);
    
    // Calculate years from anchor to projection end
    const anchorYear = anchorDate.getFullYear();
    const endYear = projectionEndDate.getFullYear();
    const totalYearsFromAnchor = endYear - anchorYear;
    
    // Generate future projections from anchor through today + selected years
    // Use sparse yearly intervals for readability
    for (let i = 1; i <= totalYearsFromAnchor; i++) {
      const yearsSinceAnchor = i;
      const projectedValue = anchorValue * Math.pow(1 + rate, yearsSinceAnchor);
      const futureDate = new Date(anchorDate);
      futureDate.setFullYear(anchorDate.getFullYear() + i);
      const futureDateStr = futureDate.toISOString().slice(0, 10);
      
      projectedPoints.push({
        date: futureDateStr,
        value: projectedValue,
        label: futureDate.getFullYear().toString(),
        isProjected: true,
      });
    }
  }

  return { actualPoints, projectedPoints, todayDate: today };
}

/**
 * Get display valuations for table (includes legacy baseline if no explicit valuations)
 */
export function getDisplayValuations(asset: ManualAsset): Array<{
  id: string;
  effectiveDate: string;
  valueCents: number;
  createdAt: string;
  isBaseline?: boolean;
}> {
  if (asset.valuations && asset.valuations.length > 0) {
    return asset.valuations;
  }
  
  // Legacy baseline
  const today = getTodayInNewYork();
  return [{
    id: '__baseline__',
    effectiveDate: asset.startDate || today,
    valueCents: Math.round(asset.value * 100),
    createdAt: new Date().toISOString(),
    isBaseline: true,
  }];
}
