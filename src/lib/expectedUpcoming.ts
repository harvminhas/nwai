/**
 * Shared "What we expect" pipeline — Today dashboard and Forecast near-term use the same
 * projection rules; callers pass `horizonDays` and slice into windows with `filterUpcomingByDayRange`.
 */

import type { ParsedStatementData } from "@/lib/types";
import type { SubscriptionRecord, SubscriptionFrequency } from "@/lib/insights/types";
import type { IncomeTxnRecord } from "@/lib/extractTransactions";
import type { CashIncomeEntry } from "@/lib/cashIncome";
import type { SourceMapping } from "@/lib/sourceMappings";
import { merchantSlug } from "@/lib/applyRules";
import {
  effectiveSubscriptionAmount,
  effectiveSubscriptionFrequency,
  nextSubscriptionOccurrence,
} from "@/lib/subscriptionRegistry";
import { detectFrequency } from "@/lib/incomeEngine";
import { projectNextDates, toDateStr } from "@/lib/projectionEngine";
import { INCOME_TRANSFER_RE } from "@/lib/spendingMetrics";
import { resolveCanonical } from "@/lib/sourceMappings";

// ── Public types (also re-exported from /api/user/insights/route for dashboard imports) ──

export type UpcomingItemType = "cash-out" | "cash-in" | "subscription" | "debt";

export interface UpcomingItem {
  id: string;
  /** ISO date "YYYY-MM-DD" for known dates; "this-month" for no-exact-date items */
  date: string;
  /** negative = overdue; 9999 = "this month" (no exact date) */
  daysFromNow: number;
  title: string;
  subtitle?: string;
  amount: number;
  type: UpcomingItemType;
  href?: string;
  isOverdue: boolean;
  isThisMonth: boolean;
  predictedDate?: string;
  occurrenceCount?: number;
}

export const DEFAULT_WHAT_WE_EXPECT_HORIZON_DAYS = 30;

/** Cash commitments row shape from Firestore */
export interface ExpectedCashCommitment {
  id: string;
  name: string;
  amount: number;
  frequency: string;
  category: string;
  notes?: string;
  nextDate?: string;
  sourceVisitId?: string;
  sourceEventId?: string;
}

export interface BuildExpectedUpcomingParams {
  /** Include items with daysFromNow in [-overdueGraceDays, horizonDays] (dated rows). */
  horizonDays: number;
  overdueGraceDays?: number;
  today: string;
  now: Date;
  /** Calendar month key YYYY-MM */
  thisMonth: string;
  consolidated: ParsedStatementData | null;
  subscriptionRecords: SubscriptionRecord[];
  subscriptionSlugs: Set<string>;
  cashItems: ExpectedCashCommitment[];
  cashIncomeItems: CashIncomeEntry[];
  incomeTxns: IncomeTxnRecord[];
  sourceMappings: SourceMapping[];
  /** Latest parsed statement per account / consolidation inputs — used for patterns + CC mins */
  parsedStatements: ParsedStatementData[];
  /** False for Forecast near-term (omit estimated card minimum rows). Default true. */
  includeCcMinimumEstimates?: boolean;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function subscriptionEligibleForUpcoming(rec: SubscriptionRecord): boolean {
  if (rec.upcomingSuppressed) return false;
  return rec.status === "confirmed" || rec.status === "user_confirmed";
}

export function normKeyExpected(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00").getTime() - new Date(a + "T00:00:00").getTime();
  return Math.round(ms / 86400000);
}

function fmtUsd(v: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(v);
}

interface MerchantPattern {
  days: number[];
  accounts: string[];
}

function buildMerchantPatterns(parsedStatements: ParsedStatementData[]): Map<string, MerchantPattern> {
  const merchantPatterns = new Map<string, MerchantPattern>();
  for (const p of parsedStatements) {
    const acctLabel = [p.bankName ?? "", p.accountId ? `*${p.accountId.slice(-4)}` : ""]
      .filter(Boolean)
      .join(" ");
    for (const txn of p.expenses?.transactions ?? []) {
      if (!txn.date || !txn.merchant) continue;
      const day = parseInt(txn.date.slice(8, 10));
      if (isNaN(day) || day < 1 || day > 31) continue;
      const key = normKeyExpected(txn.merchant);
      if (!merchantPatterns.has(key)) merchantPatterns.set(key, { days: [], accounts: [] });
      const pat = merchantPatterns.get(key)!;
      pat.days.push(day);
      if (acctLabel && !pat.accounts.includes(acctLabel)) pat.accounts.push(acctLabel);
    }
    for (const txn of p.income?.transactions ?? []) {
      if (!txn.date || !txn.source) continue;
      const day = parseInt(txn.date.slice(8, 10));
      if (isNaN(day) || day < 1 || day > 31) continue;
      const key = normKeyExpected(txn.source);
      if (!merchantPatterns.has(key)) merchantPatterns.set(key, { days: [], accounts: [] });
      const pat = merchantPatterns.get(key)!;
      pat.days.push(day);
      if (acctLabel && !pat.accounts.includes(acctLabel)) pat.accounts.push(acctLabel);
    }
  }
  return merchantPatterns;
}

function predictPattern(
  merchantPatterns: Map<string, MerchantPattern>,
  merchantName: string,
): { medianDay: number; account: string } | null {
  const searchKey = normKeyExpected(merchantName);
  if (!searchKey) return null;
  let bestPat: MerchantPattern | null = null;
  let bestScore = 0;
  for (const [k, v] of merchantPatterns) {
    const shorter = Math.min(k.length, searchKey.length);
    if (shorter < 3) continue;
    let overlap = 0;
    for (let i = 0; i < shorter; i++) if (k[i] === searchKey[i]) overlap++;
    const score = overlap / shorter;
    const prefixLen = Math.min(6, shorter);
    const prefixMatch = k.slice(0, prefixLen) === searchKey.slice(0, prefixLen);
    if (prefixMatch && score > bestScore && v.days.length >= 1) {
      bestScore = score;
      bestPat = v;
    }
  }
  if (!bestPat || bestPat.days.length === 0) return null;
  const sorted = [...bestPat.days].sort((a, b) => a - b);
  const medianDay = sorted[Math.floor(sorted.length / 2)];
  return { medianDay, account: bestPat.accounts[0] ?? "" };
}

function nextOccurrence(
  merchantPatterns: Map<string, MerchantPattern>,
  merchantName: string,
  today: string,
  now: Date,
): { date: string; daysFromNow: number; account: string } | null {
  const pat = predictPattern(merchantPatterns, merchantName);
  if (!pat) return null;
  const { medianDay, account } = pat;
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const targetDay = Math.min(medianDay, daysInMonth);
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(targetDay).padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${mm}-${dd}`;
  const diff = daysBetween(today, dateStr);
  return { date: dateStr, daysFromNow: diff, account };
}

/** One billing period after `ymd` — must match cadence in `nextSubscriptionOccurrence`. */
function subscriptionDatePlusOnePeriod(ymd: string, freq: SubscriptionFrequency): string {
  let d = new Date(ymd.slice(0, 10) + "T12:00:00Z");
  switch (freq) {
    case "weekly":
      d = new Date(d.getTime() + 7 * 86400000);
      break;
    case "biweekly":
      d = new Date(d.getTime() + 14 * 86400000);
      break;
    case "monthly":
      d.setUTCMonth(d.getUTCMonth() + 1);
      break;
    case "quarterly":
      d.setUTCMonth(d.getUTCMonth() + 3);
      break;
    case "annual":
      d.setUTCMonth(d.getUTCMonth() + 12);
      break;
    default:
      d.setUTCMonth(d.getUTCMonth() + 1);
  }
  return toDateStr(d);
}

function enumerateSubscriptionCharges(
  anchorYmd: string,
  freq: SubscriptionFrequency,
  todayYmd: string,
  horizonDays: number,
  maxOccurrences = 24,
): { dateStr: string; daysFromNow: number }[] {
  const results: { dateStr: string; daysFromNow: number }[] = [];
  let anchor = anchorYmd;
  const seen = new Set<string>();
  for (let i = 0; i < maxOccurrences; i++) {
    const { dateStr, daysFromNow } = nextSubscriptionOccurrence(anchor, freq, todayYmd);
    if (daysFromNow > horizonDays) break;
    if (daysFromNow >= -3 && !seen.has(dateStr)) {
      seen.add(dateStr);
      results.push({ dateStr, daysFromNow });
    }
    anchor = subscriptionDatePlusOnePeriod(dateStr, freq);
  }
  return results;
}

function mapAiFrequency(freqRaw: string | undefined): SubscriptionFrequency {
  const s = (freqRaw ?? "monthly").toLowerCase();
  if (s.includes("week") && !s.includes("bi")) return "weekly";
  if (s.includes("bi") || s.includes("2 week")) return "biweekly";
  if (s.includes("quarter")) return "quarterly";
  if (s.includes("year") || s.includes("annual")) return "annual";
  return "monthly";
}

/**
 * Items whose billing date falls in [minDay, maxDay] (days from today).
 * Undated `isThisMonth` rows (`daysFromNow` ≥ 9000) appear only when minDay === 0.
 */
export function filterUpcomingByDayRange(
  items: UpcomingItem[],
  minDay: number,
  maxDay: number,
): UpcomingItem[] {
  return items.filter((i) => {
    if (i.daysFromNow >= 9000) return minDay === 0;
    return i.daysFromNow >= minDay && i.daysFromNow <= maxDay;
  });
}

/** Same ordering as the legacy /insights upcoming sort */
export function sortExpectedUpcomingItems(upcoming: UpcomingItem[], today: string): void {
  upcoming.sort((a, b) => {
    if (a.isOverdue && !b.isOverdue) return -1;
    if (!a.isOverdue && b.isOverdue) return 1;
    if (!a.isThisMonth && b.isThisMonth) return -1;
    if (a.isThisMonth && !b.isThisMonth) return 1;
    if (a.isThisMonth && b.isThisMonth) {
      const aDate = a.predictedDate ?? "";
      const bDate = b.predictedDate ?? "";
      const aIsPast = aDate && aDate < today;
      const bIsPast = bDate && bDate < today;
      if (!aIsPast && bIsPast) return -1;
      if (aIsPast && !bIsPast) return 1;
      if (!aIsPast && !bIsPast) return aDate.localeCompare(bDate);
      return bDate.localeCompare(aDate);
    }
    return a.date.localeCompare(b.date);
  });
}

// ── core builder ──────────────────────────────────────────────────────────────

export function buildExpectedUpcomingItems(p: BuildExpectedUpcomingParams): UpcomingItem[] {
  const horizonDays = p.horizonDays;
  const overdueGrace = p.overdueGraceDays ?? 3;
  const today = p.today;
  const now = p.now;
  const thisMonth = p.thisMonth;
  const consolidated = p.consolidated;
  const includeCc = p.includeCcMinimumEstimates !== false;

  const merchantPatterns = buildMerchantPatterns(p.parsedStatements);

  const SUB_HORIZON: Partial<Record<SubscriptionFrequency, number>> = {
    weekly: 21,
    biweekly: 28,
    monthly: 45,
    quarterly: 60,
    annual: 60,
  };

  const upcoming: UpcomingItem[] = [];
  const seenMerchants = new Set<string>();

  // ── A. Cash commitments ─────────────────────────────────────────────────────
  for (const c of p.cashItems) {
    if (c.sourceVisitId || c.sourceEventId) continue;
    if (!c.nextDate) continue;
    const diff = daysBetween(today, c.nextDate);
    if (diff > horizonDays) continue;
    if (diff < -overdueGrace) continue;
    const key = normKeyExpected(c.name);
    if (seenMerchants.has(key)) continue;
    seenMerchants.add(key);
    upcoming.push({
      id: `cash-${c.id}`,
      date: c.nextDate,
      daysFromNow: diff,
      title: c.name,
      subtitle: c.frequency === "once" ? "One-off cash payment" : `${c.frequency} · ${c.category}`,
      amount: c.amount,
      type: "cash-out",
      href: "/account/spending?tab=cash",
      isOverdue: diff < 0,
      isThisMonth: false,
    });
  }

  // ── B. Firestore subscriptions (enumerate occurrences inside horizon) ─────
  for (const rec of p.subscriptionRecords) {
    if (!subscriptionEligibleForUpcoming(rec)) continue;
    const effAmt = effectiveSubscriptionAmount(rec);
    const effFreq = effectiveSubscriptionFrequency(rec);
    if (effAmt == null || !effFreq) continue;
    const nk = normKeyExpected(rec.name);
    if (seenMerchants.has(`sub-${nk}`)) continue;

    const anchor = (rec.lastSeenAt ?? rec.firstSeenAt ?? today).slice(0, 10);
    const { daysFromNow: firstDays } = nextSubscriptionOccurrence(anchor, effFreq, today);
    const cadenceCap = SUB_HORIZON[effFreq] ?? 45;
    const isOverdueSub = firstDays < 0 && firstDays >= -overdueGrace;
    if (firstDays > Math.min(cadenceCap, horizonDays) && !isOverdueSub) continue;

    const occurrences = enumerateSubscriptionCharges(anchor, effFreq, today, horizonDays).filter(
      (o) => o.daysFromNow <= horizonDays && o.daysFromNow >= -overdueGrace,
    );
    if (occurrences.length === 0) continue;

    seenMerchants.add(`sub-${nk}`);
    const occMeta = nextOccurrence(merchantPatterns, rec.name, today, now);
    let idx = 0;
    for (const o of occurrences) {
      const subtitleParts: string[] = [`Recurring · ${effFreq}`];
      if (occMeta?.account) subtitleParts.push(occMeta.account);
      if (rec.occurrenceCount != null && rec.occurrenceCount > 0) {
        subtitleParts.push(`${rec.occurrenceCount} charges seen`);
      }
      upcoming.push({
        id: `sub-${rec.merchantSlug}-${o.dateStr}-${idx++}`,
        date: o.dateStr,
        daysFromNow: o.daysFromNow,
        title: rec.name,
        subtitle: subtitleParts.join(" · "),
        amount: effAmt,
        type: "subscription",
        href: `/account/spending/merchant/${rec.merchantSlug}`,
        isOverdue: o.daysFromNow < 0 && o.daysFromNow >= -overdueGrace,
        isThisMonth: false,
        predictedDate: o.dateStr,
        occurrenceCount: rec.occurrenceCount ?? 0,
      });
    }
  }

  // ── C. AI subscriptions (when no Firestore row for slug) ──────────────────
  const aiSubsFromStatements = consolidated?.subscriptions ?? [];
  for (const sub of aiSubsFromStatements) {
    const slug = merchantSlug(sub.name);
    if (slug && p.subscriptionSlugs.has(slug)) continue;
    const key = normKeyExpected(sub.name);
    if (seenMerchants.has(`aisub-${key}`)) continue;
    const amount = sub.amount ?? 0;
    if (amount <= 0) continue;

    const freq = mapAiFrequency(sub.frequency);
    const anchorYm =
      consolidated?.statementDate?.slice(0, 10) ?? `${thisMonth}-15`;
    const { daysFromNow: firstAi } = nextSubscriptionOccurrence(anchorYm, freq, today);
    const cadenceCapAi = SUB_HORIZON[freq] ?? 45;
    if (firstAi > Math.min(cadenceCapAi, horizonDays) && !(firstAi < 0 && firstAi >= -overdueGrace)) continue;

    const occMeta = nextOccurrence(merchantPatterns, sub.name, today, now);
    const occurrences = enumerateSubscriptionCharges(anchorYm, freq, today, horizonDays).filter(
      (o) => o.daysFromNow <= horizonDays && o.daysFromNow >= -overdueGrace,
    );
    if (occurrences.length === 0) continue;

    seenMerchants.add(`aisub-${key}`);
    let j = 0;
    for (const o of occurrences) {
      const subtitleParts: string[] = [`Recurring · ${sub.frequency ?? "monthly"}`];
      if (occMeta?.account) subtitleParts.push(occMeta.account);
      upcoming.push({
        id: `aisub-${slug}-${o.dateStr}-${j++}`,
        date: o.dateStr,
        daysFromNow: o.daysFromNow,
        title: sub.name,
        subtitle: subtitleParts.join(" · "),
        amount,
        type: "subscription",
        href: `/account/spending/merchant/${merchantSlug(sub.name)}`,
        isOverdue: o.daysFromNow < 0 && o.daysFromNow >= -overdueGrace,
        isThisMonth: false,
        predictedDate: o.dateStr,
      });
    }
  }

  // ── D. CC minimum estimates ─────────────────────────────────────────────────
  if (includeCc) {
    for (const stmt of p.parsedStatements) {
      const acctType = (stmt.accountType ?? "").toLowerCase();
      if (acctType !== "credit" && acctType !== "credit card") continue;
      const balance = Math.abs(stmt.netWorth ?? 0);
      if (balance < 50) continue;
      const minPayment = Math.max(25, balance * 0.02);
      const label = stmt.bankName
        ? `${stmt.bankName}${stmt.accountId ? ` ···${stmt.accountId.slice(-4)}` : ""}`
        : "Credit card";
      const dedupeKey = `cc-min-${label.toLowerCase().replace(/\s+/g, "-")}`;
      if (seenMerchants.has(dedupeKey)) continue;
      seenMerchants.add(dedupeKey);
      upcoming.push({
        id: dedupeKey,
        date: thisMonth,
        daysFromNow: 9999,
        title: `${label} minimum`,
        subtitle: `Est. minimum payment · ${fmtUsd(balance)} balance`,
        amount: Math.round(minPayment),
        type: "debt",
        href: "/account/liabilities",
        isOverdue: false,
        isThisMonth: true,
      });
    }
  }

  // ── E. Expected income (statement-derived) ────────────────────────────────
  const incomeBySource = new Map<string, IncomeTxnRecord[]>();
  for (const txn of p.incomeTxns) {
    const src = txn.source || txn.description || "income";
    if (INCOME_TRANSFER_RE.test(src)) continue;
    const canonical = resolveCanonical(src, p.sourceMappings);
    const k = normKeyExpected(canonical);
    const arr = incomeBySource.get(k) ?? [];
    arr.push(txn);
    incomeBySource.set(k, arr);
  }

  for (const [srcKey, txns] of incomeBySource) {
    if (txns.length < 2) continue;
    const sortedByDate = [...txns].sort((a, b) => b.date.localeCompare(a.date));
    const lastDate = sortedByDate[0].date;
    const allDates = txns.map((t) => t.date).filter(Boolean).sort();
    const freq = detectFrequency(allDates);
    const latestAmt = sortedByDate.find((t) => t.amount > 0)?.amount ?? 0;
    if (latestAmt <= 0) continue;

    const sourceName = resolveCanonical(
      txns[0].source || txns[0].description || srcKey.replace(/\b\w/g, (c) => c.toUpperCase()),
      p.sourceMappings,
    );

    if (freq.frequency !== "irregular" && freq.medianGap && freq.medianGap >= 5) {
      const projections = projectNextDates(lastDate, freq.medianGap, 24, true);
      const seenDates = new Set<string>();
      for (const proj of projections) {
        if (proj.daysFromToday > horizonDays) break;
        if (proj.daysFromToday < -overdueGrace) continue;
        if (seenDates.has(proj.dateStr)) continue;
        seenDates.add(proj.dateStr);
        const patternLabel = `Predicted from ${freq.medianGap}-day pattern`;
        upcoming.push({
          id: `income-proj-${srcKey}-${proj.dateStr}`,
          date: proj.dateStr,
          daysFromNow: proj.daysFromToday,
          title: sourceName,
          subtitle:
            proj.daysFromToday < 0
              ? `May have already arrived · ${patternLabel}`
              : patternLabel,
          amount: Math.round(latestAmt),
          type: "cash-in",
          href: "/account/income",
          isOverdue: proj.daysFromToday < 0,
          isThisMonth: false,
          predictedDate: proj.dateStr,
        });
      }
    } else {
      const days = allDates.map((d) => parseInt(d.slice(8, 10)));
      const medianDay = [...days].sort((a, b) => a - b)[Math.floor(days.length / 2)];
      const daysInMo = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
      const targetDay = Math.min(medianDay, daysInMo);
      const expectedDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(targetDay).padStart(2, "0")}`;
      const diff = daysBetween(today, expectedDate);
      if (diff <= horizonDays && diff >= -overdueGrace) {
        upcoming.push({
          id: `income-${srcKey}`,
          date: expectedDate,
          daysFromNow: diff,
          title: sourceName,
          subtitle:
            diff < 0
              ? "May have already arrived"
              : `Based on ${txns.length} deposit${txns.length !== 1 ? "s" : ""}`,
          amount: Math.round(latestAmt),
          type: "cash-in",
          href: "/account/income",
          isOverdue: diff < 0,
          isThisMonth: diff < -overdueGrace,
        });
      }
    }
  }

  // ── F. Cash income entries ────────────────────────────────────────────────
  for (const entry of p.cashIncomeItems) {
    if (entry.frequency === "once") {
      if (!entry.nextDate) continue;
      const diff = daysBetween(today, entry.nextDate);
      if (diff > horizonDays || diff < -overdueGrace) continue;
      const dedupe = `cash-income-once-${entry.id}`;
      if (seenMerchants.has(dedupe)) continue;
      seenMerchants.add(dedupe);
      upcoming.push({
        id: dedupe,
        date: entry.nextDate,
        daysFromNow: diff,
        title: entry.name,
        subtitle: `One-off · ${entry.category}`,
        amount: entry.amount,
        type: "cash-in",
        href: "/account/income?tab=cash",
        isOverdue: diff < 0,
        isThisMonth: false,
      });
    } else {
      if (!entry.nextDate) continue;
      const freqDays: Record<string, number> = {
        weekly: 7,
        biweekly: 14,
        monthly: 30,
        quarterly: 91,
        annual: 365,
      };
      const gap = freqDays[entry.frequency] ?? 30;
      const incomeLookAhead = Math.max(horizonDays, gap + 7);

      let cursor = new Date(entry.nextDate + "T12:00:00Z");
      const todayMs = new Date(today + "T00:00:00Z").getTime();
      const gapMs = gap * 86_400_000;
      while (cursor.getTime() < todayMs - overdueGrace * 86_400_000) {
        cursor = new Date(cursor.getTime() + gapMs);
      }

      for (let i = 0; i < 16; i++) {
        const daysFromNow = Math.round((cursor.getTime() - todayMs) / 86_400_000);
        if (daysFromNow > incomeLookAhead) break;
        const dateStr = toDateStr(cursor);
        const dedupe = `cash-income-${entry.id}-${dateStr}`;
        if (!seenMerchants.has(dedupe)) {
          seenMerchants.add(dedupe);
          upcoming.push({
            id: dedupe,
            date: dateStr,
            daysFromNow,
            title: entry.name,
            subtitle:
              daysFromNow < 0
                ? `May have already arrived · ${entry.frequency} · ${entry.category}`
                : `${entry.frequency} · ${entry.category}`,
            amount: entry.amount,
            type: "cash-in",
            href: "/account/income?tab=cash",
            isOverdue: daysFromNow < 0,
            isThisMonth: dateStr.slice(0, 7) === today.slice(0, 7),
            predictedDate: dateStr,
          });
        }
        cursor = new Date(cursor.getTime() + gapMs);
      }
    }
  }

  sortExpectedUpcomingItems(upcoming, today);
  return upcoming;
}
