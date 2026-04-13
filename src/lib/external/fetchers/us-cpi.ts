/**
 * Fetcher: US Consumer Price Index (CPI-U, All Items).
 *
 * Uses the BLS Public Data API v1 — no registration key required.
 * Series: CUUR0000SA0 — CPI-U, All items, not seasonally adjusted
 * Docs: https://www.bls.gov/developers/api_signature.htm
 *
 * Rate limit: 25 queries/day without a key (sufficient for daily cron).
 */

import type { ExternalDataPoint } from "../types";

const BLS_API = "https://api.bls.gov/publicAPI/v1/timeseries/data/CUUR0000SA0";

interface BlsDataPoint {
  year: string;
  period: string;  // "M01" – "M12" or "M13" (annual)
  periodName: string;
  value: string;
}

interface BlsResponse {
  status: string;
  Results?: {
    series: Array<{
      data: BlsDataPoint[];
    }>;
  };
}

async function fetchLatestUsCpi(): Promise<{
  date: string;
  value: number;
  previous: number | null;
  yoyChange: number | null;
}> {
  const res = await fetch(BLS_API, { cache: "no-store" });
  if (!res.ok) throw new Error(`BLS API error: ${res.status}`);

  const json = (await res.json()) as BlsResponse;
  if (json.status !== "REQUEST_SUCCEEDED") {
    throw new Error(`BLS API returned non-success status: ${json.status}`);
  }

  const data = json.Results?.series[0]?.data ?? [];
  // BLS returns newest first; filter out annual (M13) entries
  const monthly = data
    .filter((d) => d.period !== "M13")
    .sort((a, b) => {
      const aDate = `${a.year}-${a.period}`;
      const bDate = `${b.year}-${b.period}`;
      return bDate.localeCompare(aDate); // descending
    });

  if (monthly.length < 2) throw new Error("Insufficient BLS CPI data");

  const latest = monthly[0];
  const previous = monthly[1];
  const yearAgo = monthly.find(
    (d) => d.year === String(parseInt(latest.year, 10) - 1) && d.period === latest.period,
  );

  const latestVal = parseFloat(latest.value);
  const prevVal = parseFloat(previous.value);
  const yearAgoVal = yearAgo ? parseFloat(yearAgo.value) : null;

  const yoyChange =
    yearAgoVal !== null
      ? +(((latestVal - yearAgoVal) / yearAgoVal) * 100).toFixed(1)
      : null;

  // Convert BLS period "M03" → "YYYY-MM"
  const monthNum = latest.period.replace("M", "").padStart(2, "0");
  const dateLabel = `${latest.year}-${monthNum}`;

  return { date: dateLabel, value: latestVal, previous: prevVal, yoyChange };
}

function nextRefreshAt(): string {
  return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
}

export async function fetchUsCpi(): Promise<ExternalDataPoint> {
  const { date, value, previous, yoyChange } = await fetchLatestUsCpi();

  const changeStr =
    yoyChange !== null ? ` (${yoyChange > 0 ? "+" : ""}${yoyChange}% year-over-year)` : "";

  return {
    dataType: "us-cpi",
    country: "US",
    value: yoyChange ?? value,
    previousValue: previous,
    displayValue: yoyChange !== null ? `${yoyChange}% YoY` : value.toFixed(1),
    releaseDate: date,
    label: "US CPI Inflation",
    description: `Consumer Price Index${changeStr}. Measures how fast everyday prices are rising.`,
    sourceUrl: "https://www.bls.gov/cpi/",
    updatedAt: new Date().toISOString(),
    nextRefreshAt: nextRefreshAt(),
  };
}
