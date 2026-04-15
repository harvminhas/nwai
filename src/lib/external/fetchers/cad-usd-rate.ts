/**
 * Fetcher: CAD/USD exchange rate.
 *
 * Uses the Bank of Canada Valet API (no key required).
 * Series FXUSDCAD = USD expressed in Canadian dollars (i.e. how many CAD per 1 USD).
 *
 * Docs: https://www.bankofcanada.ca/valet/docs
 */

import type { ExternalDataPoint } from "../types";

const VALET_BASE = "https://www.bankofcanada.ca/valet";

function nextRefreshAt(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
}

export async function fetchCadUsdRate(): Promise<ExternalDataPoint> {
  // FXUSDCAD: price of 1 USD in CAD (e.g. 1.38 means 1 USD = 1.38 CAD)
  const url = `${VALET_BASE}/observations/FXUSDCAD/json?recent=2&order_dir=desc`;
  const res = await fetch(url, { next: { revalidate: 0 } });
  if (!res.ok) throw new Error(`BoC Valet FXUSDCAD error: ${res.status}`);

  const json = await res.json();
  const obs: Array<{ d: string; FXUSDCAD: { v: string } }> =
    json?.observations ?? [];
  if (obs.length === 0) throw new Error("No FXUSDCAD observations");

  const cadPerUsd = parseFloat(obs[0].FXUSDCAD.v);
  const prevCadPerUsd = obs[1] ? parseFloat(obs[1].FXUSDCAD.v) : null;
  if (!isFinite(cadPerUsd) || cadPerUsd <= 0)
    throw new Error(`Invalid FXUSDCAD value: ${obs[0].FXUSDCAD.v}`);

  const usdPerCad = Math.round((1 / cadPerUsd) * 10000) / 10000;

  return {
    dataType: "cad-usd-rate",
    country: "CA",           // BoC is the source; country tag is CA
    value: cadPerUsd,        // stored value = CAD per 1 USD
    previousValue: prevCadPerUsd,
    displayValue: `1 USD = ${cadPerUsd.toFixed(4)} CAD`,
    releaseDate: obs[0].d,
    label: "CAD/USD Exchange Rate",
    description: `1 USD = ${cadPerUsd.toFixed(4)} CAD · 1 CAD = ${usdPerCad.toFixed(4)} USD. Bank of Canada noon rate.`,
    sourceUrl: "https://www.bankofcanada.ca/rates/exchange/",
    updatedAt: new Date().toISOString(),
    nextRefreshAt: nextRefreshAt(24),
  };
}
