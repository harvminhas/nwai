/**
 * Radar (calendar collision) detection.
 *
 * Looks 60 days forward and identifies when detected patterns produce
 * unusual outcomes vs a typical month:
 *
 *   A. Three-occurrence month — biweekly income / expense with 3 hits in one month
 *   B. Bill timing collision — large annual/quarterly fee lands between paydays
 *   C. Subscription cluster — 4+ subs renewing within a 7-day window
 *
 * Sorting: warn current month → warn next month → windfall current →
 *           windfall next → neutral
 */

import { detectFrequency } from "@/lib/incomeEngine";
import {
  projectNextDates,
  datesInMonth,
  nextUpcoming,
  toDateStr,
} from "@/lib/projectionEngine";
import type { RadarItem, RadarBreakdownRow } from "./types";
import type { IncomeTxnRecord, ExpenseTxnRecord } from "@/lib/extractTransactions";

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtCurrency(v: number): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency", currency: "CAD",
    minimumFractionDigits: 0, maximumFractionDigits: 0,
  }).format(Math.abs(v));
}

function fmtMonthName(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-CA", { month: "long" });
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric" });
}

function monthKeyOffset(offset: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + offset);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── A. Three-occurrence month ─────────────────────────────────────────────────

interface RecurringPattern {
  id: string;
  label: string;
  isIncome: boolean;
  lastDateStr: string;
  medianGapDays: number;
  typicalAmount: number;   // per-occurrence median
  occurrenceCount: number;
  icon: string;
  href?: string;
}

function detectExtraOccurrenceMonth(
  pattern: RecurringPattern,
  currentMonthKey: string,
): RadarItem | null {
  // Require at least 6 confirmed occurrences in history for high-confidence detection.
  // Fewer than 6 means we don't have enough data to trust the frequency.
  if (pattern.occurrenceCount < 6) return null;

  // Compute typical occurrences per month from the gap (e.g. weekly=4, bi-weekly=2)
  const typicalPerMonth = Math.round(30 / pattern.medianGapDays);
  if (typicalPerMonth < 1) return null;

  // Only check the current month — next-month predictions are too speculative
  const projections = projectNextDates(pattern.lastDateStr, pattern.medianGapDays, 16, true);
  const hitsInMonth = datesInMonth(projections, currentMonthKey);

  // Only flag if there is genuinely an EXTRA occurrence vs the typical count
  if (hitsInMonth.length <= typicalPerMonth) return null;

  const monthName   = fmtMonthName(currentMonthKey);
  const extra       = pattern.typicalAmount;                         // cost of one extra occurrence
  const typical     = pattern.typicalAmount * typicalPerMonth;
  const total       = pattern.typicalAmount * hitsInMonth.length;
  const extraCount  = hitsInMonth.length - typicalPerMonth;

  // Skip warn items where the extra amount is trivial
  if (!pattern.isIncome && extra * extraCount < MIN_EXTRA_WARN) return null;

  const intervalLabel = pattern.medianGapDays <= 10 ? "weekly" : "bi-weekly";

  const breakdown: RadarBreakdownRow[] = hitsInMonth.map((hit, i) => ({
    label: `${fmtDate(hit.dateStr)}${i >= typicalPerMonth ? " (extra)" : ""}`,
    value: fmtCurrency(pattern.typicalAmount),
  }));
  breakdown.push(
    { label: "Typical month total", value: fmtCurrency(typical) },
    { label: `${monthName} total`,  value: fmtCurrency(total)   },
    { label: "Extra vs typical",    value: pattern.isIncome ? `+${fmtCurrency(extra * extraCount)}` : `−${fmtCurrency(extra * extraCount)}` },
  );

  return {
    id: `three-occ-${pattern.id}-${currentMonthKey}`,
    type: pattern.isIncome ? "windfall" : "warn",
    icon: pattern.icon,
    pill: pattern.isIncome ? "Extra income" : "Cash flow pressure",
    when: monthName,
    targetMonthKey: currentMonthKey,
    title: pattern.isIncome
      ? `${hitsInMonth.length} paydays in ${monthName} — an extra ${fmtCurrency(extra * extraCount)} coming in`
      : `${hitsInMonth.length} ${pattern.label} payments in ${monthName} — ${fmtCurrency(extra * extraCount)} more than usual`,
    sub: `${fmtCurrency(total)} total vs typical ${fmtCurrency(typical)}`,
    amount: pattern.isIncome ? `+${fmtCurrency(extra * extraCount)}` : `−${fmtCurrency(extra * extraCount)}`,
    amountLabel: "extra this month",
    expand: {
      breakdown,
      note: pattern.isIncome
        ? `Because ${pattern.label} pays every ${intervalLabel}, some months contain ${hitsInMonth.length} payments instead of the usual ${typicalPerMonth}. The extra ${fmtCurrency(extra * extraCount)} is a good moment to top up savings or accelerate a debt payoff.`
        : `Because ${pattern.label} is collected every ${intervalLabel}, some months have ${hitsInMonth.length} withdrawals instead of the usual ${typicalPerMonth}. Budget an extra ${fmtCurrency(extra * extraCount)} in ${monthName}.`,
      confidence: {
        level: pattern.occurrenceCount >= 12 ? "high" : "medium",
        text:  `Based on ${pattern.occurrenceCount} confirmed occurrences`,
      },
      primaryAction: {
        label: pattern.isIncome ? "Plan the extra" : "Model in Scenarios",
        href:  pattern.isIncome ? "/account/goals" : "/account/spending",
      },
    },
  };
}

// ── B. Bill timing collision ──────────────────────────────────────────────────

interface AnnualBill {
  id: string;
  label: string;
  amount: number;
  nextDateStr: string;
  icon: string;
  href?: string;
}

function detectBillTimingCollision(
  bill: AnnualBill,
  incomePatterns: RecurringPattern[],
): RadarItem | null {
  if (!bill.nextDateStr) return null;

  const billDate = new Date(bill.nextDateStr + "T00:00:00Z");
  const billYM   = bill.nextDateStr.slice(0, 7);

  // Find the nearest payday before and after the bill date
  let daysToPrevPay = Infinity;
  let daysToNextPay = Infinity;

  for (const pat of incomePatterns) {
    const projections = projectNextDates(pat.lastDateStr, pat.medianGapDays, 12, true);
    for (const p of projections) {
      const d = new Date(p.dateStr + "T00:00:00Z");
      const diff = Math.round((billDate.getTime() - d.getTime()) / 86_400_000);
      if (diff >= 0 && diff < daysToPrevPay) daysToPrevPay = diff;
      if (diff < 0 && Math.abs(diff) < daysToNextPay) daysToNextPay = Math.abs(diff);
    }
  }

  // Flag if bill lands more than 5 days after last payday AND 5+ days before next
  if (daysToPrevPay < 5 || daysToNextPay < 5) return null;
  if (daysToPrevPay + daysToNextPay < 12) return null;

  const monthName  = fmtMonthName(billYM);
  const billFmt    = fmtDate(bill.nextDateStr);

  return {
    id: `bill-timing-${bill.id}`,
    type: "warn",
    icon: bill.icon,
    pill: "Bill timing",
    when: billFmt,
    targetMonthKey: billYM,
    title: `${bill.label} lands on a low-balance day`,
    sub: `${billFmt} is between paydays — chequing may be below $500`,
    amount: `−${fmtCurrency(bill.amount)}`,
    amountLabel: `due ${billFmt}`,
    expand: {
      breakdown: [
        { label: "Bill amount",            value: fmtCurrency(bill.amount) },
        { label: "Days since last payday", value: `${daysToPrevPay}d` },
        { label: "Days to next payday",    value: `${daysToNextPay}d` },
      ],
      note: `${bill.label} (${fmtCurrency(bill.amount)}) is due on ${billFmt}, which falls roughly ${daysToPrevPay} days after your last payday and ${daysToNextPay} days before the next one. Make sure chequing has enough buffer.`,
      confidence: {
        level: "medium",
        text: "Based on detected payment pattern",
      },
      primaryAction: {
        label: "View bill",
        href: bill.href ?? "/account/spending",
      },
    },
  };
}

// ── C. Subscription cluster ───────────────────────────────────────────────────

interface SubItem {
  name: string;
  amount: number;
  predictedDate?: string; // "YYYY-MM-DD"
}

function detectSubscriptionCluster(
  subs: SubItem[],
  currentMonthKey: string,
): RadarItem | null {
  if (subs.length < 4) return null;

  // Group subs with a known date into 7-day windows
  const dated = subs.filter((s) => s.predictedDate);
  if (dated.length < 4) return null;

  // Sort by date
  dated.sort((a, b) => (a.predictedDate! > b.predictedDate! ? 1 : -1));

  // Sliding window: find best 7-day cluster
  let bestStart = 0;
  let bestCount = 0;
  let bestTotal = 0;
  let bestWindowStart = dated[0].predictedDate!;

  for (let i = 0; i < dated.length; i++) {
    const windowStart = new Date(dated[i].predictedDate! + "T00:00:00Z");
    const windowEnd   = new Date(windowStart.getTime() + 6 * 86_400_000);
    const inWindow    = dated.filter((s) => {
      const d = new Date(s.predictedDate! + "T00:00:00Z");
      return d >= windowStart && d <= windowEnd;
    });
    if (inWindow.length > bestCount) {
      bestCount        = inWindow.length;
      bestStart        = i;
      bestTotal        = inWindow.reduce((s, x) => s + x.amount, 0);
      bestWindowStart  = dated[i].predictedDate!;
    }
  }

  if (bestCount < 4) return null;

  const windowEnd = new Date(new Date(bestWindowStart + "T00:00:00Z").getTime() + 6 * 86_400_000);
  const startFmt  = fmtDate(bestWindowStart);
  const endFmt    = fmtDate(toDateStr(windowEnd));
  const ym        = bestWindowStart.slice(0, 7);

  const clusterSubs = dated.slice(bestStart, bestStart + bestCount);

  return {
    id: `sub-cluster-${ym}`,
    type: "warn",
    icon: "💳",
    pill: "Subscription cluster",
    when: `${startFmt}–${endFmt}`,
    targetMonthKey: ym,
    title: `${bestCount} subscriptions renew in the first week of ${fmtMonthName(ym)}`,
    sub: `All detected from statement history — ${fmtCurrency(bestTotal)} total clustered in 7 days`,
    amount: `−${fmtCurrency(bestTotal)}`,
    amountLabel: `week of ${startFmt}`,
    expand: {
      breakdown: clusterSubs.map((s) => ({
        label: s.name,
        value: fmtCurrency(s.amount),
      })).concat([
        { label: "7-day total", value: fmtCurrency(bestTotal) },
      ]),
      confidence: {
        level: "medium",
        text: "Based on recurring subscription detections",
      },
      primaryAction: {
        label: "Review subscriptions",
        href: "/account/spending?tab=subscriptions",
      },
    },
  };
}

// ── D. Net-effect annotation ──────────────────────────────────────────────────

/**
 * When the same month has both a 3-payday windfall AND a 3-payment warn,
 * annotate both with the net effect so the user sees the full picture.
 */
function annotateNetEffect(items: RadarItem[]): RadarItem[] {
  // Group by targetMonthKey
  const byMonth = new Map<string, RadarItem[]>();
  for (const item of items) {
    const arr = byMonth.get(item.targetMonthKey) ?? [];
    arr.push(item);
    byMonth.set(item.targetMonthKey, arr);
  }

  for (const [, monthItems] of byMonth) {
    const windfalls = monthItems.filter((i) => i.type === "windfall" && i.id.startsWith("three-occ"));
    const warnings  = monthItems.filter((i) => i.type === "warn"     && i.id.startsWith("three-occ"));
    if (windfalls.length === 0 || warnings.length === 0) continue;

    const totalIn  = windfalls.reduce((s, i) => s + parseFloat(i.amount.replace(/[^0-9.]/g, "")), 0);
    const totalOut = warnings.reduce( (s, i) => s + parseFloat(i.amount.replace(/[^0-9.]/g, "")), 0);
    const net      = totalIn - totalOut;
    const netNote  = net > 0
      ? `Net effect: despite the 3-payment warning, the 3-payday windfall more than offsets it. Your ${fmtMonthName(windfalls[0].targetMonthKey)} net cash position is projected to be ${fmtCurrency(net)} stronger than a typical month.`
      : `Net effect: the 3-payment pressure outweighs the 3-payday boost by ${fmtCurrency(Math.abs(net))} this month.`;

    for (const item of [...windfalls, ...warnings]) {
      if (!item.expand.note) item.expand.note = netNote;
      else item.expand.note += " " + netNote;
    }
  }

  return items;
}

// ── sort ──────────────────────────────────────────────────────────────────────

function sortRadar(items: RadarItem[], currentMonthKey: string): RadarItem[] {
  const order = (item: RadarItem) => {
    const isCurrent = item.targetMonthKey === currentMonthKey;
    if (item.type === "warn"     && isCurrent)  return 0;
    if (item.type === "warn"     && !isCurrent) return 1;
    if (item.type === "windfall" && isCurrent)  return 2;
    if (item.type === "windfall" && !isCurrent) return 3;
    return 4; // neutral
  };
  return [...items].sort((a, b) => order(a) - order(b));
}

// ── constants ─────────────────────────────────────────────────────────────────

/** Minimum extra-vs-typical amount (in native currency) to surface a warn item.
 *  Prevents flagging trivial variance like a $7 coffee shop with 3 visits. */
const MIN_EXTRA_WARN = 35;

/**
 * Variable/discretionary spending categories excluded from three-occurrence detection.
 * These merchants recur because of habit, not because they're scheduled payments —
 * predicting "3 Petro-Canada fill-ups in April" is meaningless and confusing.
 * Only FIXED scheduled payments (loans, utilities, rent, insurance, investments)
 * are worth surfacing as cash-flow pressure.
 */
const VARIABLE_CATEGORY_KEYWORDS = [
  "gas", "fuel", "petro", "gasoline",
  "grocer", "grocery", "supermarket", "food store",
  "restaurant", "dining", "fast food", "coffee", "cafe", "bakery",
  "retail", "shopping", "clothing", "department store",
  "entertainment", "streaming", "movie", "bar", "pub",
  "pharmacy", "drug store",
  "parking", "transit", "transport",
];

function isVariableSpending(category: string, merchant: string): boolean {
  const text = (category + " " + merchant).toLowerCase();
  return VARIABLE_CATEGORY_KEYWORDS.some((kw) => text.includes(kw));
}

// ── main entry ────────────────────────────────────────────────────────────────

export interface RadarInput {
  incomeTxns: IncomeTxnRecord[];
  expenseTxns: ExpenseTxnRecord[];
  cashCommitments: {
    id: string; name: string; amount: number;
    frequency: string; nextDate?: string; category?: string;
  }[];
  aiSubs: { name: string; amount: number; frequency?: string }[];
  merchantPatternDates: Map<string, { dates: string[]; amounts: number[] }>;
}

export function computeRadarItems(input: RadarInput): RadarItem[] {
  const now             = new Date();
  const currentMonthKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const nextMonthKey    = monthKeyOffset(1);
  const items: RadarItem[] = [];

  // ── A. Three-occurrence months ─────────────────────────────────────────────

  // ─ Income sources ─
  // Group incomeTxns by source
  const incomeBySource = new Map<string, IncomeTxnRecord[]>();
  for (const txn of input.incomeTxns) {
    const key = (txn.source || txn.description || "income").toLowerCase().trim().slice(0, 40);
    const arr = incomeBySource.get(key) ?? [];
    arr.push(txn);
    incomeBySource.set(key, arr);
  }

  const incomePatterns: RecurringPattern[] = [];

  for (const [key, txns] of incomeBySource) {
    if (txns.length < 3) continue;
    const dates  = txns.map((t) => t.date).filter(Boolean).sort();
    const freq   = detectFrequency(dates);
    if (freq.frequency !== "bi-weekly" && freq.frequency !== "weekly") continue;
    if (!freq.medianGap || freq.medianGap < 5) continue;

    const sorted  = [...txns].sort((a, b) => b.date.localeCompare(a.date));
    const lastDate = sorted[0].date;
    const amounts  = txns.map((t) => t.amount).filter((a) => a > 0);
    const median   = amounts.sort((a, b) => a - b)[Math.floor(amounts.length / 2)];

    const pattern: RecurringPattern = {
      id: key,
      label: sorted[0].source || sorted[0].description || key,
      isIncome: true,
      lastDateStr: lastDate,
      medianGapDays: freq.medianGap,
      typicalAmount: median,
      occurrenceCount: txns.length,
      icon: "💵",
      href: "/account/income",
    };

    incomePatterns.push(pattern);
    const item = detectExtraOccurrenceMonth(pattern, currentMonthKey);
    if (item) items.push(item);
  }

  // ─ Recurring expense sources ─
  // Build per-merchant date+amount lists from all expense transactions
  const expByMerchant = new Map<string, ExpenseTxnRecord[]>();
  for (const txn of input.expenseTxns) {
    const key = txn.merchant.toLowerCase().trim().slice(0, 40);
    const arr = expByMerchant.get(key) ?? [];
    arr.push(txn);
    expByMerchant.set(key, arr);
  }

  for (const [key, txns] of expByMerchant) {
    if (txns.length < 3) continue;

    // Skip variable/discretionary spending — only fixed scheduled payments matter
    const sorted0  = [...txns].sort((a, b) => b.date.localeCompare(a.date));
    if (isVariableSpending(sorted0[0].category ?? "", sorted0[0].merchant ?? key)) continue;

    const dates = txns.map((t) => t.date).filter(Boolean).sort();
    const freq  = detectFrequency(dates);
    if (freq.frequency !== "bi-weekly" && freq.frequency !== "weekly") continue;
    if (!freq.medianGap || freq.medianGap < 5) continue;

    const lastDate = sorted0[0].date;
    const amounts  = txns.map((t) => t.amount).filter((a) => a > 0);
    const median   = amounts.sort((a, b) => a - b)[Math.floor(amounts.length / 2)];

    const cat  = sorted0[0].category?.toLowerCase() ?? "";
    const icon = cat.includes("mortgage") || cat.includes("housing")  ? "🏠"
               : cat.includes("loan") || cat.includes("debt")         ? "📋"
               : cat.includes("insurance")                            ? "🛡️"
               : "📅";

    const pattern: RecurringPattern = {
      id: key,
      label: sorted0[0].merchant,
      isIncome: false,
      lastDateStr: lastDate,
      medianGapDays: freq.medianGap,
      typicalAmount: median,
      occurrenceCount: txns.length,
      icon,
      href: "/account/spending",
    };

    const expItem = detectExtraOccurrenceMonth(pattern, currentMonthKey);
    if (expItem) items.push(expItem);
  }

  // ── B. Bill timing collision ───────────────────────────────────────────────
  // Annual/quarterly large expenses in the next 60 days
  const todayStr = toDateStr(new Date());

  // Find candidate annual bills: merchantPatternDates with 1 hit/year pattern
  for (const [name, data] of input.merchantPatternDates) {
    if (data.dates.length < 1 || data.amounts.length < 1) continue;
    if (data.dates.length > 6) continue; // too many = not annual

    const latestDate = [...data.dates].sort().pop()!;
    // Next occurrence ~1 year from the last one
    const lastTs   = new Date(latestDate + "T00:00:00Z").getTime();
    const nextTs   = lastTs + 365 * 86_400_000;
    const nextDate = toDateStr(new Date(nextTs));

    if (nextDate < todayStr) continue; // already past
    const daysAway = Math.round((new Date(nextDate + "T00:00:00Z").getTime() - new Date(todayStr + "T00:00:00Z").getTime()) / 86_400_000);
    if (daysAway > 60) continue;

    const avgAmt = data.amounts.reduce((s, a) => s + a, 0) / data.amounts.length;
    if (avgAmt < 100) continue; // too small to bother flagging

    const bill: AnnualBill = {
      id: name.replace(/\s+/g, "-").toLowerCase().slice(0, 30),
      label: name,
      amount: Math.round(avgAmt),
      nextDateStr: nextDate,
      icon: "📄",
      href: "/account/spending",
    };

    const radarItem = detectBillTimingCollision(bill, incomePatterns);
    if (radarItem) items.push(radarItem);
  }

  // ── C. Subscription cluster ────────────────────────────────────────────────
  // Only monthly subs belong in a "renewals this week" cluster. Annual/quarterly
  // subs are projected to their real next-occurrence date and only included if
  // that date is within 60 days. A single historical occurrence with no explicit
  // frequency is treated as unknown cadence — no projection.
  const subItems: SubItem[] = [];
  const clusterTodayStr = toDateStr(new Date());

  for (const sub of input.aiSubs) {
    const key = sub.name.toLowerCase().trim().slice(0, 40);
    const pat = input.merchantPatternDates.get(key);

    // ── determine cadence ──────────────────────────────────────────────────
    // Priority: (1) explicit frequency from subscription record, (2) computed
    // from historical interval, (3) unknown (no projection).
    const explicitFreq = (sub.frequency ?? "").toLowerCase();
    const isExplicitLong = explicitFreq === "annual" || explicitFreq === "yearly" || explicitFreq === "quarterly";
    const isExplicitShort = explicitFreq === "monthly" || explicitFreq === "weekly" || explicitFreq === "biweekly";

    if (!pat || pat.dates.length === 0) {
      // No history — no projection possible
      subItems.push({ name: sub.name, amount: sub.amount });
      continue;
    }

    const sortedDates = [...pat.dates].sort();
    const latestDate  = sortedDates[sortedDates.length - 1];

    // Compute interval only when we have ≥2 data points
    let computedIntervalDays: number | null = null;
    if (sortedDates.length >= 2) {
      let totalMs = 0;
      for (let i = 1; i < sortedDates.length; i++) {
        totalMs += new Date(sortedDates[i]).getTime() - new Date(sortedDates[i - 1]).getTime();
      }
      computedIntervalDays = totalMs / (sortedDates.length - 1) / 86_400_000;
    }

    const isLongCadence =
      isExplicitLong ||                         // explicit annual/quarterly label
      (computedIntervalDays !== null && computedIntervalDays > 45); // computed interval > 45 days

    const isShortCadence =
      isExplicitShort ||                        // explicit monthly/weekly label
      (computedIntervalDays !== null && computedIntervalDays <= 45);

    if (isLongCadence) {
      // Annual/quarterly: compute real next occurrence; only include if ≤60 days away
      const intervalForProjection = computedIntervalDays ?? (explicitFreq === "quarterly" ? 91 : 365);
      const nextTs   = new Date(latestDate + "T00:00:00Z").getTime() + intervalForProjection * 86_400_000;
      const nextDate = toDateStr(new Date(nextTs));
      if (nextDate < clusterTodayStr) {
        subItems.push({ name: sub.name, amount: sub.amount });
        continue;
      }
      const daysAway = Math.round(
        (new Date(nextDate + "T00:00:00Z").getTime() - new Date(clusterTodayStr + "T00:00:00Z").getTime()) / 86_400_000,
      );
      subItems.push({
        name: sub.name,
        amount: sub.amount,
        ...(daysAway <= 60 ? { predictedDate: nextDate } : {}),
      });
    } else if (isShortCadence) {
      // Monthly: project the median day-of-month to next month
      const days      = pat.dates.map((d) => parseInt(d.slice(8, 10)));
      const medianDay = days.sort((a, b) => a - b)[Math.floor(days.length / 2)];
      const nm   = new Date(); nm.setMonth(nm.getMonth() + 1); nm.setDate(1);
      const maxD = new Date(nm.getFullYear(), nm.getMonth() + 1, 0).getDate();
      const dd   = String(Math.min(medianDay, maxD)).padStart(2, "0");
      const mm   = String(nm.getMonth() + 1).padStart(2, "0");
      subItems.push({ name: sub.name, amount: sub.amount, predictedDate: `${nm.getFullYear()}-${mm}-${dd}` });
    } else {
      // Single occurrence, unknown cadence — no projection
      subItems.push({ name: sub.name, amount: sub.amount });
    }
  }

  const clusterItem = detectSubscriptionCluster(subItems, nextMonthKey);
  if (clusterItem) items.push(clusterItem);

  // ── Deduplicate: same merchant+month from both income and expense txns ────────
  // Normalize the key by stripping all non-alphanumeric chars so minor spelling
  // differences ("WS Investments INV" vs "ws-investments-inv") collapse to one entry.
  const seen  = new Set<string>();
  const deduped = items.filter((item) => {
    const normId = item.id.replace(/[^a-z0-9]/gi, "").toLowerCase();
    if (seen.has(normId)) return false;
    seen.add(normId);
    return true;
  });

  // ── Annotate net effect & sort ─────────────────────────────────────────────
  const annotated = annotateNetEffect(deduped);
  const sorted    = sortRadar(annotated, currentMonthKey);

  // ── Cap: max 3 warn + 2 windfall per month, 8 total ───────────────────────
  const warnCurrent   = sorted.filter((i) => i.type === "warn"     && i.targetMonthKey === currentMonthKey).slice(0, 3);
  const warnNext      = sorted.filter((i) => i.type === "warn"     && i.targetMonthKey === nextMonthKey).slice(0, 2);
  const windCurrent   = sorted.filter((i) => i.type === "windfall" && i.targetMonthKey === currentMonthKey).slice(0, 2);
  const windNext      = sorted.filter((i) => i.type === "windfall" && i.targetMonthKey === nextMonthKey).slice(0, 1);
  const other         = sorted.filter((i) => i.targetMonthKey !== currentMonthKey && i.targetMonthKey !== nextMonthKey);

  const capped = [...warnCurrent, ...warnNext, ...windCurrent, ...windNext, ...other].slice(0, 8);
  return sortRadar(capped, currentMonthKey);
}
