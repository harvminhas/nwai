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

// ── Country detection ──────────────────────────────────────────────────────────

const CA_BANK_RE = /\b(td|rbc|bmo|cibc|scotiabank|national bank|desjardins|tangerine|simplii|hsbc canada|laurentian|atb)\b/i;
const US_BANK_RE = /\b(chase|bank of america|wells fargo|citi|us bank|capital one|pnc|truist|ally)\b/i;

export function detectCountry(profile: FinancialProfileCache): "CA" | "US" | null {
  const banks = profile.accountSnapshots.map((a) => a.bankName ?? "").join(" ");
  if (CA_BANK_RE.test(banks)) return "CA";
  if (US_BANK_RE.test(banks)) return "US";
  return null;
}

// ── Relevance helpers ──────────────────────────────────────────────────────────

function hasVariableDebt(profile: FinancialProfileCache): boolean {
  return profile.accountSnapshots.some((a) =>
    /mortgage|heloc|loc|line of credit/i.test(a.accountType ?? "")
  );
}

function hasInvestments(profile: FinancialProfileCache): boolean {
  return (
    profile.accountSnapshots.some((a) => /investment|rrsp|tfsa|brokerage/i.test(a.accountType ?? "")) ||
    profile.monthlyHistory.some((h) =>
      // User has "Investments & Savings" category spending (contributions)
      h.expensesTotal - h.coreExpensesTotal > 50
    )
  );
}

// ── Registry ──────────────────────────────────────────────────────────────────

type FetchFn = () => Promise<ExternalDataPoint>;

export interface RegisteredDescriptor extends ExternalDataDescriptor {
  fetch: FetchFn;
}

export const EXTERNAL_DATA_REGISTRY: RegisteredDescriptor[] = [
  {
    dataType: "canada-overnight-rate",
    country: "CA",
    label: "Bank of Canada Overnight Rate",
    refreshIntervalHours: 24,
    fetch: fetchCanadaOvernightRate,
    relevant: (profile) =>
      detectCountry(profile) === "CA" && hasVariableDebt(profile),
  },
  {
    dataType: "canada-prime-rate",
    country: "CA",
    label: "Canadian Prime Rate",
    refreshIntervalHours: 24,
    fetch: fetchCanadaPrimeRate,
    relevant: (profile) =>
      detectCountry(profile) === "CA" && hasVariableDebt(profile),
  },
  {
    dataType: "canada-cpi",
    country: "CA",
    label: "Canada CPI Inflation",
    refreshIntervalHours: 168, // weekly
    fetch: fetchCanadaCPI,
    relevant: (profile) =>
      detectCountry(profile) === "CA" &&
      profile.typicalMonthly.monthsTracked >= 3, // need history to compare against
  },
];

export function getDescriptor(dataType: string): RegisteredDescriptor | undefined {
  return EXTERNAL_DATA_REGISTRY.find((d) => d.dataType === dataType);
}
