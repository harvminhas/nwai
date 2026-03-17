/**
 * Shared income reliability + frequency scoring engine.
 * Used by both the Income list page and the Income source detail page.
 */

export type Reliability = "very stable" | "stable" | "quarterly" | "one-time" | "irregular";
export type Frequency   = "weekly" | "bi-weekly" | "monthly" | "quarterly" | "semi-annual" | "irregular";

export interface SourceMonthData {
  yearMonth: string;
  amount: number;
  transactions: { date?: string; amount: number }[];
}

export interface ReliabilityResult {
  reliability: Reliability;
  score: number;
  amountScore: number;
  timingScore: number;
  frequencyScore: number;
  note?: string;
}

export interface FrequencyResult {
  frequency: Frequency;
  medianGap: number | null;
  stdDev: number | null;
  sampleCount: number;
}

// ── keyword lists ─────────────────────────────────────────────────────────────

const ONE_TIME_KEYWORDS = [
  "cra", "gst", "hst", "refund", "rebate", "tax return", "ccb", "canada child",
  "oas", "cerb", "ei benefit", "ei payment", "stimulus", "benefit payment",
];
const QUARTERLY_KEYWORDS = [
  "dividend", "quarterly", "distribution", "tfsa dividend", "rrsp dividend",
];

// ── reliability scorer ────────────────────────────────────────────────────────

export function scoreSource(
  description: string,
  history: SourceMonthData[],
  totalMonthsTracked: number,
): ReliabilityResult {
  const desc = description.toLowerCase();
  const n = history.length;

  if (ONE_TIME_KEYWORDS.some((k) => desc.includes(k)) || (n === 1 && totalMonthsTracked >= 3)) {
    return { reliability: "one-time", score: 0, amountScore: 0, timingScore: 0, frequencyScore: 0, note: "excluded from monthly average" };
  }

  if (QUARTERLY_KEYWORDS.some((k) => desc.includes(k))) {
    return { reliability: "quarterly", score: 70, amountScore: 80, timingScore: 70, frequencyScore: 50 };
  }

  if (totalMonthsTracked >= 4) {
    const freq = n / totalMonthsTracked;
    if (freq >= 0.2 && freq <= 0.4) {
      return { reliability: "quarterly", score: 70, amountScore: 80, timingScore: 70, frequencyScore: 50 };
    }
  }

  // Amount consistency (50% weight)
  let amountScore: number;
  if (n < 2) {
    if (desc.includes("salary") || desc.includes("payroll") || desc.includes("wage")) amountScore = 95;
    else if (desc.includes("rental") || desc.includes("rent")) amountScore = 85;
    else amountScore = 50;
  } else {
    const amounts = history.map((h) => h.amount);
    const mean = amounts.reduce((s, a) => s + a, 0) / n;
    const stddev = Math.sqrt(amounts.reduce((s, a) => s + (a - mean) ** 2, 0) / n);
    const cv = mean > 0 ? stddev / mean : 1;
    amountScore = Math.max(0, Math.min(100, 100 - cv * 333));
  }

  // Timing consistency (30% weight)
  let timingScore: number;
  const allTxns = history.flatMap((h) => h.transactions);
  const datedTxns = allTxns.filter((t) => t.date);
  if (datedTxns.length < 2) {
    if (desc.includes("salary") || desc.includes("payroll")) timingScore = 90;
    else if (desc.includes("rental") || desc.includes("rent")) timingScore = 75;
    else timingScore = 50;
  } else {
    const days = datedTxns.map((t) => new Date(t.date! + "T12:00:00").getDate());
    const txnsPerMonth = datedTxns.length / Math.max(n, 1);
    if (txnsPerMonth <= 1.3) {
      const mean = days.reduce((s, d) => s + d, 0) / days.length;
      const avgDeviation = days.reduce((s, d) => s + Math.min(Math.abs(d - mean), 31 - Math.abs(d - mean)), 0) / days.length;
      timingScore = Math.max(0, Math.min(100, 100 - avgDeviation * 14));
    } else {
      const firstHalf  = days.filter((d) => d <= 15);
      const secondHalf = days.filter((d) => d > 15);
      if (firstHalf.length > 0 && secondHalf.length > 0) {
        const variance = (cluster: number[]) => {
          const m = cluster.reduce((s, d) => s + d, 0) / cluster.length;
          return cluster.reduce((s, d) => s + Math.abs(d - m), 0) / cluster.length;
        };
        timingScore = Math.max(0, Math.min(100, 100 - ((variance(firstHalf) + variance(secondHalf)) / 2) * 14));
      } else {
        timingScore = 60;
      }
    }
  }

  // Frequency score (20% weight)
  const frequencyScore = totalMonthsTracked <= 1
    ? 50
    : Math.min(100, (n / totalMonthsTracked) * 100);

  const score = Math.round(amountScore * 0.5 + timingScore * 0.3 + frequencyScore * 0.2);
  const reliability: Reliability = score >= 88 ? "very stable" : score >= 70 ? "stable" : "irregular";

  return { reliability, score, amountScore: Math.round(amountScore), timingScore: Math.round(timingScore), frequencyScore: Math.round(frequencyScore) };
}

// ── frequency detector ────────────────────────────────────────────────────────

export function detectFrequency(allDates: string[]): FrequencyResult {
  const dated = allDates.filter(Boolean).sort();
  if (dated.length < 2) return { frequency: "irregular", medianGap: null, stdDev: null, sampleCount: dated.length };

  const timestamps = dated.map((d) => new Date(d + "T12:00:00").getTime());
  const gaps: number[] = [];
  for (let i = 1; i < timestamps.length; i++) {
    gaps.push(Math.round((timestamps[i] - timestamps[i - 1]) / 86_400_000));
  }

  const sorted = [...gaps].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const avg    = gaps.reduce((s, g) => s + g, 0) / gaps.length;
  const stdDev = Math.sqrt(gaps.reduce((s, g) => s + (g - avg) ** 2, 0) / gaps.length);

  let bucket: Frequency;
  if      (median <= 8)   bucket = "weekly";
  else if (median <= 19)  bucket = "bi-weekly";
  else if (median <= 45)  bucket = "monthly";
  else if (median <= 100) bucket = "quarterly";
  else if (median <= 200) bucket = "semi-annual";
  else                    bucket = "irregular";

  if (bucket !== "irregular" && stdDev > 0.5 * median) bucket = "irregular";

  return { frequency: bucket, medianGap: median, stdDev: Math.round(stdDev), sampleCount: dated.length };
}

// ── visual config ─────────────────────────────────────────────────────────────

export const FREQUENCY_CONFIG: Record<Frequency, { label: string; badge: string; description: string }> = {
  "weekly":      { label: "weekly",      badge: "border-blue-200 bg-blue-50 text-blue-700",       description: "Deposits arrive every week" },
  "bi-weekly":   { label: "bi-weekly",   badge: "border-purple-200 bg-purple-50 text-purple-700", description: "Twice a month — e.g. 1st & 15th" },
  "monthly":     { label: "monthly",     badge: "border-green-200 bg-green-50 text-green-700",    description: "Arrives once a month" },
  "quarterly":   { label: "quarterly",   badge: "border-amber-200 bg-amber-50 text-amber-700",    description: "Every ~3 months" },
  "semi-annual": { label: "semi-annual", badge: "border-indigo-200 bg-indigo-50 text-indigo-700", description: "Twice a year" },
  "irregular":   { label: "irregular",   badge: "border-orange-200 bg-orange-50 text-orange-600", description: "No consistent pattern" },
};

export const RELIABILITY_CONFIG: Record<Reliability, {
  label: string; badge: string; barColor: string; barWidthClass: string; description: string;
}> = {
  "very stable": { label: "very stable", badge: "border-green-200 bg-green-50 text-green-700",    barColor: "#10b981", barWidthClass: "w-full",   description: "Consistent amount, predictable timing every month" },
  "stable":      { label: "stable",      badge: "border-green-100 bg-green-50 text-green-600",    barColor: "#34d399", barWidthClass: "w-4/5",    description: "Reliable amount, minor timing variance allowed" },
  "quarterly":   { label: "quarterly",   badge: "border-amber-200 bg-amber-50 text-amber-600",    barColor: "#f59e0b", barWidthClass: "w-2/5",    description: "Predictable every ~3 months — cadence, not instability" },
  "one-time":    { label: "one-time",    badge: "border-gray-200 bg-gray-50 text-gray-500",       barColor: "#d1d5db", barWidthClass: "w-1/12",   description: "Single deposit — excluded from monthly average" },
  "irregular":   { label: "irregular",   badge: "border-orange-200 bg-orange-50 text-orange-600", barColor: "#fb923c", barWidthClass: "w-1/4",    description: "No consistent pattern detected" },
};
