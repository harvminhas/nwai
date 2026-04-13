/**
 * Fetcher: Statistics Canada CPI — Food purchased from stores.
 *
 * Same WDS API as canada-cpi.ts, different vector.
 * Vector 41690914 — "Food purchased from stores", Canada, monthly (2002=100)
 * Table: 18-10-0004-01
 *
 * Linked to: user's "Groceries" spending category
 */

import type { ExternalDataPoint } from "../types";

const STATCAN_WDS    = "https://www150.statcan.gc.ca/t1/wds/rest";
const FOOD_VECTOR_ID = 41690914;

interface StatCanDataPoint { refPer: string; value: number }
interface StatCanVectorResult {
  status: string;
  object: { vectorId: number; vectorDataPoint: StatCanDataPoint[] };
}

async function fetchFoodCpiData(): Promise<{
  date: string;
  value: number;
  previous: number | null;
  yoyChange: number | null;
}> {
  const res = await fetch(`${STATCAN_WDS}/getDataFromVectorsAndLatestNPeriods`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify([{ vectorId: FOOD_VECTOR_ID, latestN: 14 }]),
    cache: "no-store",
  });

  if (!res.ok) throw new Error(`Statistics Canada food CPI error: ${res.status}`);

  const json = (await res.json()) as StatCanVectorResult[];
  const result = json[0];
  if (result?.status !== "SUCCESS") throw new Error("Statistics Canada food CPI non-success");

  const points = result.object?.vectorDataPoint ?? [];
  if (points.length < 2) throw new Error("Insufficient food CPI data");

  const latest   = points[points.length - 1];
  const previous = points[points.length - 2];
  const yearAgo  = points.length >= 13 ? points[points.length - 13] : null;

  const yoyChange = yearAgo
    ? parseFloat((((latest.value - yearAgo.value) / yearAgo.value) * 100).toFixed(1))
    : null;

  return {
    date: latest.refPer.slice(0, 7),
    value: latest.value,
    previous: previous.value,
    yoyChange,
  };
}

function nextRefreshAt(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export async function fetchCanadaFoodCPI(): Promise<ExternalDataPoint> {
  const { date, value, previous, yoyChange } = await fetchFoodCpiData();
  return {
    dataType: "canada-food-cpi",
    country: "CA",
    value: yoyChange ?? value,
    previousValue: previous,
    displayValue: yoyChange !== null ? `${yoyChange}% YoY` : value.toFixed(1),
    releaseDate: date,
    label: "Food Inflation (Groceries)",
    description: "Statistics Canada food-at-stores CPI. Tracks how much grocery prices are rising.",
    sourceUrl: "https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=1810000401",
    updatedAt: new Date().toISOString(),
    nextRefreshAt: nextRefreshAt(),
  };
}
