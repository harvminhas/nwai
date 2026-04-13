/**
 * Fetcher: US Federal Funds Rate (target upper bound).
 *
 * Uses the FRED public observations JSON API — no API key required.
 * Series: DFEDTARU — Federal Funds Target Range - Upper Limit (daily)
 * Docs: https://fred.stlouisfed.org/series/DFEDTARU
 *
 * The CSV endpoint is blocked by server-side fetch (ECONNRESET).
 * The observations JSON endpoint is accessible without auth.
 */

import type { ExternalDataPoint } from "../types";

const FRED_OBS_URL =
  "https://api.stlouisfed.org/fred/series/observations" +
  "?series_id=DFEDTARU&sort_order=desc&limit=5&output_type=1&file_type=json" +
  "&api_key=anonymous";

interface FredObservation {
  date: string;
  value: string;
}

async function fetchFredObs(
  seriesId: string,
): Promise<{ date: string; value: number; previous: number | null }> {
  const url =
    `https://api.stlouisfed.org/fred/series/observations` +
    `?series_id=${seriesId}&sort_order=desc&limit=5&output_type=1&file_type=json` +
    `&api_key=anonymous`;

  const res = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/json" },
  });

  if (!res.ok) {
    throw new Error(`FRED API error ${res.status} for ${seriesId}`);
  }

  const json = (await res.json()) as { observations?: FredObservation[] };
  const obs = (json.observations ?? []).filter((o) => o.value !== "." && o.value !== "");

  if (obs.length < 1) throw new Error(`No valid FRED observations for ${seriesId}`);

  const latest = obs[0];
  const previous = obs[1] ?? null;

  return {
    date: latest.date,
    value: parseFloat(latest.value),
    previous: previous ? parseFloat(previous.value) : null,
  };
}

function nextRefreshAt(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

/** Fetch the US Federal Funds target rate (upper bound of the FOMC target range). */
export async function fetchUsFederalFundsRate(): Promise<ExternalDataPoint> {
  const { date, value, previous } = await fetchFredObs("DFEDTARU");

  return {
    dataType: "us-federal-funds-rate",
    country: "US",
    value,
    previousValue: previous,
    displayValue: `${value.toFixed(2)}%`,
    releaseDate: date,
    label: "Federal Funds Rate",
    description:
      "The Federal Reserve target rate. Changes directly affect variable-rate mortgages, HELOCs, and lines of credit.",
    sourceUrl: "https://www.federalreserve.gov/monetarypolicy/openmarketoperations.htm",
    updatedAt: new Date().toISOString(),
    nextRefreshAt: nextRefreshAt(24),
  };
}
