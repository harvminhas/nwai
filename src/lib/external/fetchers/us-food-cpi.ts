/**
 * Fetcher: US CPI — Food at home (BLS series CUUR0000SAF11).
 *
 * BLS Public Data API v1, no key required.
 * Series: CUUR0000SAF11 — CPI-U, Food at home, not seasonally adjusted
 *
 * Linked to: user's "Groceries" spending category
 */

import type { ExternalDataPoint } from "../types";

const BLS_API = "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SAF11";

interface BlsDataPoint {
  year: string;
  period: string;
  value: string;
}

interface BlsResponse {
  status: string;
  Results?: { series: Array<{ data: BlsDataPoint[] }> };
}

async function fetchFoodAtHomeData(): Promise<{
  date: string;
  value: number;
  previous: number | null;
  yoyChange: number | null;
}> {
  const res = await fetch(BLS_API, { cache: "no-store" });
  if (!res.ok) throw new Error(`BLS food CPI error: ${res.status}`);

  const json = (await res.json()) as BlsResponse;
  if (json.status !== "REQUEST_SUCCEEDED") throw new Error(`BLS food CPI non-success: ${json.status}`);

  const data = json.Results?.series[0]?.data ?? [];
  const monthly = data
    .filter((d) => d.period !== "M13")
    .sort((a, b) => `${b.year}-${b.period}`.localeCompare(`${a.year}-${a.period}`));

  if (monthly.length < 2) throw new Error("Insufficient BLS food CPI data");

  const latest  = monthly[0];
  const prev    = monthly[1];
  const yearAgo = monthly.find(
    (d) => d.year === String(parseInt(latest.year, 10) - 1) && d.period === latest.period,
  );

  const latestVal  = parseFloat(latest.value);
  const prevVal    = parseFloat(prev.value);
  const yearAgoVal = yearAgo ? parseFloat(yearAgo.value) : null;
  const yoyChange  = yearAgoVal !== null
    ? +(((latestVal - yearAgoVal) / yearAgoVal) * 100).toFixed(1)
    : null;

  const monthNum  = latest.period.replace("M", "").padStart(2, "0");
  return { date: `${latest.year}-${monthNum}`, value: latestVal, previous: prevVal, yoyChange };
}

function nextRefreshAt(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export async function fetchUsFoodCPI(): Promise<ExternalDataPoint> {
  const { date, value, previous, yoyChange } = await fetchFoodAtHomeData();
  return {
    dataType: "us-food-cpi",
    country: "US",
    value: yoyChange ?? value,
    previousValue: previous,
    displayValue: yoyChange !== null ? `${yoyChange}% YoY` : value.toFixed(1),
    releaseDate: date,
    label: "Food Inflation (Groceries)",
    description: "BLS food-at-home CPI. Tracks how much grocery prices are rising.",
    sourceUrl: "https://www.bls.gov/cpi/",
    updatedAt: new Date().toISOString(),
    nextRefreshAt: nextRefreshAt(),
  };
}
