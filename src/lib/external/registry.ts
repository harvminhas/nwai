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

// ── Country detection ──────────────────────────────────────────────────────────

const CA_BANK_RE = /\b(td|rbc|bmo|cibc|scotiabank|national bank|desjardins|tangerine|simplii|hsbc canada|laurentian|atb)\b/i;
const US_BANK_RE = /\b(chase|bank of america|wells fargo|citi|us bank|capital one|pnc|truist|ally)\b/i;

export function detectCountry(profile: FinancialProfileCache): "CA" | "US" | null {
  // Check bankName, accountName, and accountType fields across all snapshots
  const text = profile.accountSnapshots
    .flatMap((a) => [a.bankName ?? "", a.accountName ?? ""])
    .join(" ");
  if (CA_BANK_RE.test(text)) return "CA";
  if (US_BANK_RE.test(text)) return "US";
  return null;
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
      profile.typicalMonthly.monthsTracked >= 1,
  },
  {
    dataType: "canada-food-cpi",
    country: "CA",
    label: "Canada Food Inflation (Groceries)",
    refreshIntervalHours: 168,
    fetch: fetchCanadaFoodCPI,
    relevant: (profile) =>
      detectCountry(profile) === "CA" && hasGrocerySpend(profile),
  },
  {
    dataType: "us-federal-funds-rate",
    country: "US",
    label: "Federal Funds Rate",
    refreshIntervalHours: 24,
    fetch: fetchUsFederalFundsRate,
    relevant: (profile) =>
      detectCountry(profile) === "US" && hasVariableDebt(profile),
  },
  {
    dataType: "us-cpi",
    country: "US",
    label: "US CPI Inflation",
    refreshIntervalHours: 168, // weekly
    fetch: fetchUsCpi,
    relevant: (profile) =>
      detectCountry(profile) === "US" &&
      profile.typicalMonthly.monthsTracked >= 1,
  },
  {
    dataType: "us-food-cpi",
    country: "US",
    label: "US Food Inflation (Groceries)",
    refreshIntervalHours: 168,
    fetch: fetchUsFoodCPI,
    relevant: (profile) =>
      detectCountry(profile) === "US" && hasGrocerySpend(profile),
  },
];

export function getDescriptor(dataType: string): RegisteredDescriptor | undefined {
  return EXTERNAL_DATA_REGISTRY.find((d) => d.dataType === dataType);
}
