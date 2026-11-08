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

  // Helper to format YYYY-MM-DD as UTC date label (avoids timezone shift)
  const formatDateLabel = (dateStr: string): string => {
    const [year, month, day] = dateStr.split('-').map(Number);
    const utcDate = new Date(Date.UTC(year, month - 1, day));
    return utcDate.toLocaleDateString("en-US", { 
      month: "short", 
      year: "numeric",
      timeZone: "UTC"
    });
  };

  // Build actual valuation points
  if (asset.valuations && asset.valuations.length > 0) {
    asset.valuations.forEach(val => {
      actualPoints.push({
        date: val.effectiveDate,
        value: val.valueCents / 100,
        label: formatDateLabel(val.effectiveDate),
      });
    });
  } else {
    // Legacy: show current value as baseline
    // Use startDate if known, otherwise show as "as of today"
    const baselineDate = asset.startDate || today;
    const isUnknownDate = !asset.startDate;
    const label = isUnknownDate
      ? `As of ${formatDateLabel(baselineDate)}`
      : formatDateLabel(baselineDate);
    
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
    const [anchorYear, anchorMonth, anchorDay] = anchorPoint.date.split('-').map(Number);
    
    // Calculate projection end: today + selected years (parsed as UTC to avoid TZ shift)
    const [todayYear, todayMonth, todayDay] = today.split('-').map(Number);
    const todayDateUTC = new Date(Date.UTC(todayYear, todayMonth - 1, todayDay));
    const projectionEndDateUTC = new Date(Date.UTC(todayYear + projectionYears, todayMonth - 1, todayDay));
    const anchorDateUTC = new Date(Date.UTC(anchorYear, anchorMonth - 1, anchorDay));
    
    // Generate future projections at anchor anniversaries up to (but not beyond) projection end
    // Use sparse yearly intervals for readability
    for (let i = 1; ; i++) {
      const futureYear = anchorYear + i;
      // Clamp day to valid range for the month (handles leap year Feb 29 -> Feb 28)
      const daysInMonth = new Date(Date.UTC(futureYear, anchorMonth, 0)).getUTCDate();
      const futureDay = Math.min(anchorDay, daysInMonth);
      const futureDateUTC = new Date(Date.UTC(futureYear, anchorMonth - 1, futureDay));
      
      // Stop if this anniversary is beyond the projection end
      if (futureDateUTC > projectionEndDateUTC) break;
      
      const yearsSinceAnchor = i;
      const projectedValue = anchorValue * Math.pow(1 + rate, yearsSinceAnchor);
      const futureDateStr = futureDateUTC.toISOString().slice(0, 10);
      
      projectedPoints.push({
        date: futureDateStr,
        value: projectedValue,
        label: futureYear.toString(),
        isProjected: true,
      });
    }
    
    // Add final point at exact projection end date using fractional year compounding
    // This ensures we reach the full horizon (today + projectionYears)
    const lastAnniversary = projectedPoints.length > 0 
      ? projectedPoints[projectedPoints.length - 1].date 
      : anchorPoint.date;
    const lastAnniversaryUTC = new Date(lastAnniversary + "T00:00:00Z");
    
    // Only add endpoint if it's after the last anniversary
    if (projectionEndDateUTC > lastAnniversaryUTC) {
      // Calculate fractional years from anchor to projection end
      const msPerYear = 365.25 * 24 * 60 * 60 * 1000; // Average including leap years
      const elapsedMs = projectionEndDateUTC.getTime() - anchorDateUTC.getTime();
      const elapsedYears = elapsedMs / msPerYear;
      const endpointValue = anchorValue * Math.pow(1 + rate, elapsedYears);
      const endpointDateStr = projectionEndDateUTC.toISOString().slice(0, 10);
      
      projectedPoints.push({
        date: endpointDateStr,
        value: endpointValue,
        label: projectionEndDateUTC.getUTCFullYear().toString(),
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
