/**
 * Fetcher: Statistics Canada CPI (Consumer Price Index).
 *
 * Uses the Statistics Canada Web Data Service REST API (free, no key required).
 * Docs: https://www.statcan.gc.ca/eng/developers/wds/user-guide
 *
 * Vector: 41690973 — CPI All-items, Canada, monthly (2002=100)
 * Table:  18-10-0004-01
 */

import type { ExternalDataPoint } from "../types";

const STATCAN_WDS = "https://www150.statcan.gc.ca/t1/wds/rest";

// Vector ID for "CPI All-items, Canada, monthly (not seasonally adjusted)"
const CPI_VECTOR_ID = 41690973;

interface StatCanDataPoint {
  refPer: string;  // "YYYY-MM-DD" — first day of the reference month
  value: number;
  decimals: number;
  scalarFactorCode: number; // 0 = ×1
}

interface StatCanVectorResult {
  status: string;
  object: {
    vectorId: number;
    vectorDataPoint: StatCanDataPoint[];
  };
}

async function fetchLatestCPI(): Promise<{
  date: string;
  value: number;
  previous: number | null;
  yoyChange: number | null;
}> {
  const res = await fetch(`${STATCAN_WDS}/getDataFromVectorsAndLatestNPeriods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ vectorId: CPI_VECTOR_ID, latestN: 14 }]),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Statistics Canada API error: ${res.status}`);

  const json = (await res.json()) as StatCanVectorResult[];
  const result = json[0];
  if (result?.status !== "SUCCESS") {
    throw new Error(`Statistics Canada API returned non-success status`);
  }

  const points = result.object?.vectorDataPoint ?? [];
  if (points.length < 2) throw new Error("Insufficient CPI data from Statistics Canada");

  // Points arrive in ascending chronological order
  const latest   = points[points.length - 1];
  const previous = points[points.length - 2];
  const yearAgo  = points.length >= 13 ? points[points.length - 13] : null;

  // scalarFactorCode 0 means multiply by 1 (no scaling needed for CPI index)
  const latestVal  = latest.value;
  const prevVal    = previous.value;
  const yearAgoVal = yearAgo?.value ?? null;

  const yoyChange = yearAgoVal !== null
    ? parseFloat((((latestVal - yearAgoVal) / yearAgoVal) * 100).toFixed(1))
    : null;

  // refPer is "YYYY-MM-DD"; return as "YYYY-MM" for display
  const dateLabel = latest.refPer.slice(0, 7);

  return { date: dateLabel, value: latestVal, previous: prevVal, yoyChange };
}

function nextRefreshAt(): string {
  // CPI is released monthly — check weekly
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export async function fetchCanadaCPI(): Promise<ExternalDataPoint> {
  const { date, value, previous, yoyChange } = await fetchLatestCPI();
  const changeStr =
    yoyChange !== null ? ` (${yoyChange > 0 ? "+" : ""}${yoyChange}% year-over-year)` : "";
  return {
    dataType: "canada-cpi",
    country: "CA",
    value: yoyChange ?? value,
    previousValue: previous,
    displayValue: yoyChange !== null ? `${yoyChange}% YoY` : value.toFixed(1),
    releaseDate: date,
    label: "Canada CPI Inflation",
    description: `Consumer Price Index${changeStr}. Measures how fast everyday prices are rising.`,
    sourceUrl: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810000401",
    updatedAt: new Date().toISOString(),
    nextRefreshAt: nextRefreshAt(),
  };
}
