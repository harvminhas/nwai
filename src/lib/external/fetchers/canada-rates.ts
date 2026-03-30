/**
 * Fetcher: Bank of Canada rates.
 *
 * Uses the Bank of Canada public Valet API (no key required).
 * Docs: https://www.bankofcanada.ca/valet/docs
 *
 * Sources:
 *   CORRA group  — Canadian Overnight Repo Rate Average (series AVG.INTWO)
 *   V80691311    — Canadian Prime Rate (chartered banks, weekly)
 */

import type { ExternalDataPoint } from "../types";

const VALET_BASE = "https://www.bankofcanada.ca/valet";

interface ValetObservation {
  d: string; // date YYYY-MM-DD
  [series: string]: { v: string } | string;
}

interface ValetGroupResponse {
  observations: ValetObservation[];
}

function nextRefreshAt(intervalHours: number): string {
  return new Date(Date.now() + intervalHours * 60 * 60 * 1000).toISOString();
}

/** Fetch the Bank of Canada overnight rate via the CORRA group endpoint. */
async function fetchCORRA(): Promise<{ date: string; value: number; previous: number | null }> {
  const url = `${VALET_BASE}/observations/group/CORRA/json?recent=2&order_dir=desc`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Bank of Canada CORRA API error: ${res.status}`);

  const json = (await res.json()) as ValetGroupResponse;
  const obs = json.observations ?? [];
  if (obs.length === 0) throw new Error("No CORRA observations returned");

  const latest   = obs[0];
  const previous = obs[1] ?? null;

  // The CORRA group uses "AVG.INTWO" as the key for the daily average rate
  const latestVal = parseFloat((latest["AVG.INTWO"] as { v: string }).v);
  const prevVal   = previous ? parseFloat((previous["AVG.INTWO"] as { v: string }).v) : null;

  return { date: latest.d as string, value: latestVal, previous: prevVal };
}

/** Fetch a single V-series from the BoC Valet observations endpoint. */
async function fetchVSeries(
  vectorId: string,
): Promise<{ date: string; value: number; previous: number | null }> {
  const url = `${VALET_BASE}/observations/${vectorId}/json?recent=3&order_dir=desc`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`Bank of Canada API error: ${res.status} for ${vectorId}`);

  const json = (await res.json()) as ValetGroupResponse;
  const obs  = json.observations ?? [];
  if (obs.length === 0) throw new Error(`No observations returned for ${vectorId}`);

  const latest   = obs[0];
  const previous = obs[1] ?? null;

  const latestVal = parseFloat((latest[vectorId] as { v: string }).v);
  const prevVal   = previous ? parseFloat((previous[vectorId] as { v: string }).v) : null;

  return { date: latest.d as string, value: latestVal, previous: prevVal };
}

/** Fetch the Bank of Canada overnight rate (CORRA). */
export async function fetchCanadaOvernightRate(): Promise<ExternalDataPoint> {
  const { date, value, previous } = await fetchCORRA();
  return {
    dataType: "canada-overnight-rate",
    country: "CA",
    value,
    previousValue: previous,
    displayValue: `${value.toFixed(2)}%`,
    releaseDate: date,
    label: "Bank of Canada Overnight Rate",
    description:
      "The Bank of Canada policy interest rate (CORRA). Changes directly affect variable-rate mortgages, HELOCs, and lines of credit.",
    sourceUrl: "https://www.bankofcanada.ca/rates/interest-rates/corra/",
    updatedAt: new Date().toISOString(),
    nextRefreshAt: nextRefreshAt(24),
  };
}

/** Fetch the Canadian prime lending rate (V80691311, weekly). */
export async function fetchCanadaPrimeRate(): Promise<ExternalDataPoint> {
  const { date, value, previous } = await fetchVSeries("V80691311");
  return {
    dataType: "canada-prime-rate",
    country: "CA",
    value,
    previousValue: previous,
    displayValue: `${value.toFixed(2)}%`,
    releaseDate: date,
    label: "Canadian Prime Rate",
    description:
      "The prime lending rate used by Canadian banks to set variable-rate mortgage and HELOC rates.",
    sourceUrl: "https://www.bankofcanada.ca/rates/banking-and-financial-statistics/posted-interest-rates-offered-by-chartered-banks/",
    updatedAt: new Date().toISOString(),
    nextRefreshAt: nextRefreshAt(24),
  };
}
