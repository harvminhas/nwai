/**
 * FX rate fetching with a 24-hour Firestore cache.
 *
 * The cache document lives at fxRates/{FROM}_{TO} (e.g. "USD_CAD").
 * The FIRST request after the cache expires fetches a fresh rate from
 * api.frankfurter.app and writes it back; all subsequent requests read
 * the cached value until the next expiry.
 *
 * This is a server-only module (uses firebase-admin).
 */

import type * as Firestore from "firebase-admin/firestore";

const CACHE_TTL_MS   = 24 * 60 * 60 * 1000; // 24 hours
const FRANKFURTER    = "https://api.frankfurter.app/latest";
const HOME_CURRENCY  = "CAD";

export interface FxRate {
  from:      string;
  to:        string;
  rate:      number;
  fetchedAt: string; // ISO
}

/**
 * Returns the FX rate for `from` → `to` (e.g. USD → CAD).
 * Always returns 1.0 if from === to.
 * Reads from Firestore cache; refreshes if older than 24 hours.
 */
export async function getFxRate(
  from: string,
  to:   string,
  db:   Firestore.Firestore,
): Promise<FxRate> {
  from = from.toUpperCase();
  to   = to.toUpperCase();

  if (from === to) return { from, to, rate: 1, fetchedAt: new Date().toISOString() };

  const docId  = `${from}_${to}`;
  const docRef = db.collection("fxRates").doc(docId);

  // ── Try cached value ─────────────────────────────────────────────────────
  try {
    const snap = await docRef.get();
    if (snap.exists) {
      const data      = snap.data() as FxRate;
      const ageMs     = Date.now() - new Date(data.fetchedAt).getTime();
      if (ageMs < CACHE_TTL_MS && data.rate > 0) {
        return data;
      }
    }
  } catch {
    // Firestore read failed — fall through to live fetch
  }

  // ── Fetch fresh rate ─────────────────────────────────────────────────────
  const fresh = await fetchLiveRate(from, to);

  // Write back to Firestore (fire-and-forget — never block the caller)
  docRef.set(fresh).catch((e) =>
    console.error(`[fxRates] failed to cache ${docId}:`, e)
  );

  return fresh;
}

/**
 * Given the set of currencies present across all account snapshots, returns
 * a map of { "USD": <USD→CAD rate>, "EUR": <EUR→CAD rate>, ... }.
 * CAD (home currency) is always 1.0.
 */
export async function getFxRatesForCurrencies(
  currencies: Set<string>,
  db: Firestore.Firestore,
): Promise<Map<string, number>> {
  const rateMap = new Map<string, number>();
  rateMap.set(HOME_CURRENCY, 1);

  const foreign = Array.from(currencies).filter((c) => c !== HOME_CURRENCY);
  if (foreign.length === 0) return rateMap;

  await Promise.all(
    foreign.map(async (currency) => {
      try {
        const fx = await getFxRate(currency, HOME_CURRENCY, db);
        rateMap.set(currency, fx.rate);
      } catch (e) {
        console.error(`[fxRates] could not get rate for ${currency}:`, e);
        // Fall back to 1.0 so the app doesn't crash — but log it clearly
        rateMap.set(currency, 1);
      }
    })
  );

  return rateMap;
}

async function fetchLiveRate(from: string, to: string): Promise<FxRate> {
  const url = `${FRANKFURTER}?from=${from}&to=${to}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Frankfurter API ${res.status}: ${res.statusText}`);
  const json = await res.json() as { rates: Record<string, number>; date: string };
  const rate = json.rates[to];
  if (!rate || rate <= 0) throw new Error(`No rate for ${from}→${to} in response`);
  return { from, to, rate, fetchedAt: new Date().toISOString() };
}
