/**
 * External Data Registry.
 *
 * Maps each ExternalDataType to:
 *   - its fetcher function
 *   - a relevance check against the user's financial profile
 *
 * To add a new data source:
 *   1. Add its type to ExternalDataType in types.ts
 *   2. Create a fetcher in fetchers/<source>.ts
 *   3. Add a descriptor here — nothing else changes
 */

import type { FinancialProfileCache } from "@/lib/financialProfile";
import type { ExternalDataDescriptor, ExternalDataPoint } from "./types";
import { fetchCanadaOvernightRate, fetchCanadaPrimeRate } from "./fetchers/canada-rates";
import { fetchCanadaCPI } from "./fetchers/canada-cpi";
import { fetchCanadaFoodCPI } from "./fetchers/canada-food-cpi";
import { fetchUsFederalFundsRate } from "./fetchers/us-rates";
import { fetchUsCpi } from "./fetchers/us-cpi";
import { fetchUsFoodCPI } from "./fetchers/us-food-cpi";
import { fetchCadUsdRate } from "./fetchers/cad-usd-rate";

// ── Country detection ──────────────────────────────────────────────────────────

const CA_BANK_RE = /\b(td|rbc|bmo|cibc|scotiabank|national bank|desjardins|tangerine|simplii|hsbc canada|laurentian|atb)\b/i;

/**
 * Auto-detect country from bank names in account snapshots.
 * Default: "US" when unrecognised.
 *
 * NOTE: call sites that have a user-confirmed country stored in Firestore
 * should use that value directly instead of calling this function.
 */
export function detectCountry(profile: FinancialProfileCache): "CA" | "US" {
  const text = profile.accountSnapshots
    .flatMap((a) => [a.bankName ?? "", a.accountName ?? ""])
    .join(" ");
  if (CA_BANK_RE.test(text)) return "CA";
  return "US";
}

// ── Relevance helpers ──────────────────────────────────────────────────────────

function hasVariableDebt(profile: FinancialProfileCache): boolean {
  return profile.accountSnapshots.some((a) =>
    /mortgage|heloc|loc|line of credit/i.test(a.accountType ?? "")
  );
}

function hasGrocerySpend(profile: FinancialProfileCache): boolean {
  return profile.expenseTxns.some((t) => {
    const cat = (t.category ?? "").toLowerCase();
    return cat === "groceries" || cat.startsWith("groceries/");
  });
}

// ── Registry ──────────────────────────────────────────────────────────────────

type FetchFn = () => Promise<ExternalDataPoint>;

/**
 * relevant() receives the resolved user country as a second argument so it
 * never needs to call detectCountry() internally. Country is always authoritative
 * (user-confirmed > auto-detected) by the time relevant() is called.
 */
export interface RegisteredDescriptor extends ExternalDataDescriptor {
  fetch: FetchFn;
  relevant: (profile: FinancialProfileCache, country: "CA" | "US") => boolean;
}

export const EXTERNAL_DATA_REGISTRY: RegisteredDescriptor[] = [
  {
    dataType: "canada-overnight-rate",
    country: "CA",
    label: "Bank of Canada Overnight Rate",
    refreshIntervalHours: 24,
    fetch: fetchCanadaOvernightRate,
    relevant: (profile, country) => country === "CA" && hasVariableDebt(profile),
  },
  {
    dataType: "canada-prime-rate",
    country: "CA",
    label: "Canadian Prime Rate",
    refreshIntervalHours: 24,
    fetch: fetchCanadaPrimeRate,
    relevant: (profile, country) => country === "CA" && hasVariableDebt(profile),
  },
  {
    dataType: "canada-cpi",
    country: "CA",
    label: "Canada CPI Inflation",
    refreshIntervalHours: 168,
    fetch: fetchCanadaCPI,
    relevant: (profile, country) =>
      country === "CA" && profile.typicalMonthly.monthsTracked >= 1,
  },
  {
    dataType: "canada-food-cpi",
    country: "CA",
    label: "Canada Food Inflation (Groceries)",
    refreshIntervalHours: 168,
    fetch: fetchCanadaFoodCPI,
    relevant: (profile, country) => country === "CA" && hasGrocerySpend(profile),
  },
  {
    dataType: "us-federal-funds-rate",
    country: "US",
    label: "Federal Funds Rate",
    refreshIntervalHours: 24,
    fetch: fetchUsFederalFundsRate,
    relevant: (profile, country) => country === "US" && hasVariableDebt(profile),
  },
  {
    dataType: "us-cpi",
    country: "US",
    label: "US CPI Inflation",
    refreshIntervalHours: 168,
    fetch: fetchUsCpi,
    relevant: (profile, country) =>
      country === "US" && profile.typicalMonthly.monthsTracked >= 1,
  },
  {
    dataType: "us-food-cpi",
    country: "US",
    label: "US Food Inflation (Groceries)",
    refreshIntervalHours: 168,
    fetch: fetchUsFoodCPI,
    relevant: (profile, country) => country === "US" && hasGrocerySpend(profile),
  },
  {
    dataType: "cad-usd-rate",
    country: "CA",
    label: "CAD/USD Exchange Rate",
    refreshIntervalHours: 24,
    fetch: fetchCadUsdRate,
    // Pure reference data — stored daily for the currency widget, never generates an insight card.
    relevant: () => false,
  },
];

export function getDescriptor(dataType: string): RegisteredDescriptor | undefined {
  return EXTERNAL_DATA_REGISTRY.find((d) => d.dataType === dataType);
}
