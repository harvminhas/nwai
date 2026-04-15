/**
 * GET /api/user/currency-info
 *
 * Returns currency context for the dashboard header widget:
 *   homeCurrency  — "USD" | "CAD"
 *   currencies    — distinct ISO-4217 codes in the user's accounts
 *   showExchange  — true when user has both CAD and USD accounts
 *   cadPerUsd     — how many CAD per 1 USD  (e.g. 1.38)
 *   usdPerCad     — how many USD per 1 CAD  (e.g. 0.72)
 *   rateDate      — YYYY-MM-DD of the published rate
 *   rateSource    — attribution string
 *
 * The exchange rate is read from externalData/cad-usd-rate (populated daily
 * by the cron job). If the cron hasn't run yet, a live fetch is attempted.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { detectCountry } from "@/lib/external/registry";
import { getExternalData, setExternalData } from "@/lib/external/store";
import { fetchCadUsdRate } from "@/lib/external/fetchers/cad-usd-rate";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const userDoc = await db.collection("users").doc(access.targetUid).get();
  const confirmedCountry = userDoc.data()?.country as "CA" | "US" | undefined;

  let profile;
  try {
    profile = await getFinancialProfile(access.targetUid, db);
  } catch {
    return NextResponse.json({
      homeCurrency: confirmedCountry === "CA" ? "CAD" : "USD",
      currencies: [],
      showExchange: false,
      cadPerUsd: null,
      usdPerCad: null,
      rateDate: null,
      rateSource: "Bank of Canada",
    });
  }

  const country = confirmedCountry ?? detectCountry(profile);
  const homeCurrency = country === "CA" ? "CAD" : "USD";

  const currencies = [
    ...new Set(
      profile.accountSnapshots
        .map((a) => (a.currency ?? "").toUpperCase())
        .filter(Boolean),
    ),
  ];

  const hasCAD = currencies.includes("CAD");
  const hasUSD = currencies.includes("USD");
  const showExchange = hasCAD && hasUSD;

  let cadPerUsd: number | null = null;
  let usdPerCad: number | null = null;
  let rateDate: string | null = null;

  if (showExchange) {
    // Read from the daily-refreshed external data store
    let point = await getExternalData("cad-usd-rate", db);

    // If cron hasn't run yet, do a live fetch and cache it
    if (!point) {
      try {
        point = await fetchCadUsdRate();
        await setExternalData(point, db);
      } catch (err) {
        console.error("[currency-info] live rate fetch failed:", err);
      }
    }

    if (point) {
      cadPerUsd = point.value;
      usdPerCad = Math.round((1 / point.value) * 10000) / 10000;
      rateDate = point.releaseDate;
    }
  }

  return NextResponse.json({
    homeCurrency,
    currencies,
    showExchange,
    cadPerUsd,
    usdPerCad,
    rateDate,
    rateSource: "Bank of Canada",
  });
}
