/**
 * Near-term forecast — statistical discretionary envelope (trailing months).
 * Overlap policy: subtract subscription + cash-commitment amounts attributed to a parent category
 * per bucket before showing residual. Tracker rows / income excluded from overlap.
 */

import type { ExpenseTxnRecord } from "./extractTransactions";
import type { SubscriptionRecord } from "./insights/types";
import { getParentCategory } from "./categoryTaxonomy";
import { isCoreExcluded } from "./spendingMetrics";

export interface NearTermDiscretionaryCategoryDTO {
  parentCategory: string;
  medianMonthly: number;
  minMonthly: number;
  maxMonthly: number;
  volatile: boolean;
  residualAmount: number;
  windowLabel: string;
}

export interface NearTermBucketDiscretionaryDTO {
  categories: NearTermDiscretionaryCategoryDTO[];
  residualTotal: number;
  basisLabel: string;
}

/** Parents treated as everyday discretionary for this forecast panel (excludes housing, debt, transfers, etc.). */
export const FORECAST_DISCRETIONARY_PARENTS = new Set<string>([
  "Groceries",
  "Dining",
  "Transportation",
  "Shopping",
  "Entertainment",
  "Healthcare",
  "Personal Care",
  "Subscriptions",
  "Travel",
  "Education",
  "Cash & ATM",
  "Other",
]);

const DAYS_PER_MONTH = 30.436875;
const VOLATILE_SPREAD_RATIO = 0.45;
const TOP_CATEGORY_LIMIT = 8;
const MIN_MEDIAN_TO_SHOW = 15;

export interface NearTermLineForOverlap {
  id: string;
  kind: string;
  daysFromNow: number;
  amount: number;
  isIncome: boolean;
  href?: string;
}

function merchantSlugFromSpendingHref(href: string | undefined): string | null {
  if (!href?.includes("/account/spending/merchant/")) return null;
  const raw = href.split("/").pop();
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function subscriptionSlugFromItemId(id: string): string | null {
  const sub = id.match(/^sub-(.+)-(\d{4}-\d{2}-\d{2})-(\d+)$/);
  if (sub) {
    try {
      return decodeURIComponent(sub[1]);
    } catch {
      return sub[1];
    }
  }
  const ai = id.match(/^aisub-(.+)-(\d{4}-\d{2}-\d{2})-(\d+)$/);
  if (ai) {
    try {
      return decodeURIComponent(ai[1]);
    } catch {
      return ai[1];
    }
  }
  return null;
}

function bucketIndex(daysFromNow: number): 0 | 1 | 2 | null {
  if (daysFromNow < 0 || daysFromNow > 90) return null;
  if (daysFromNow <= 30) return 0;
  if (daysFromNow <= 60) return 1;
  return 2;
}

function medianOf(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function fmtTrailingMonthRange(monthKeys: string[]): string {
  if (monthKeys.length === 0) return "";
  const sorted = [...monthKeys].sort();
  const a = sorted[0];
  const b = sorted[sorted.length - 1];
  const da = new Date(a + "-01T12:00:00Z");
  const db = new Date(b + "-01T12:00:00Z");
  const mo = (d: Date) => d.toLocaleDateString("en-US", { month: "short" });
  if (a === b) return mo(da);
  return `${mo(da)}–${mo(db)}`;
}

export function pickTrailingMonths(allTxMonths: string[], currentYm: string, count: number): string[] {
  const hist = [...new Set(allTxMonths)].filter((m) => m < currentYm).sort();
  return hist.slice(-count);
}

function buildSlugToParent(records: SubscriptionRecord[]): Map<string, string> {
  const m = new Map<string, string>();
  for (const rec of records) {
    const raw = rec.category?.trim();
    const parent = getParentCategory(raw && raw.length > 0 ? raw : "Subscriptions");
    m.set(rec.merchantSlug, parent);
  }
  return m;
}

function buildCashIdToParent(
  cashItems: { id: string; category: string }[],
): Map<string, string> {
  const m = new Map<string, string>();
  for (const c of cashItems) {
    m.set(c.id, getParentCategory(c.category?.trim() || "Other"));
  }
  return m;
}

/**
 * Sum scheduled subscription / cash-commitment outflows per bucket & parent category (overlap removal).
 */
export function scheduledOverlapByBucket(
  lines: NearTermLineForOverlap[],
  subscriptionRecords: SubscriptionRecord[],
  cashItems: { id: string; category: string }[],
): [Record<string, number>, Record<string, number>, Record<string, number>] {
  const slugToParent = buildSlugToParent(subscriptionRecords);
  const cashIdToParent = buildCashIdToParent(cashItems);
  const buckets: [Record<string, number>, Record<string, number>, Record<string, number>] = [{}, {}, {}];

  for (const line of lines) {
    if (line.isIncome) continue;
    const bi = bucketIndex(line.daysFromNow);
    if (bi === null) continue;
    // Only overlap lines that map cleanly to a spending parent (subs + cash commitments).
    if (line.kind !== "pattern" && line.kind !== "cash") continue;

    let parent: string | null = null;

    if (line.kind === "cash") {
      if (!line.id.startsWith("cash-")) continue;
      const cid = line.id.slice("cash-".length);
      parent = cashIdToParent.get(cid) ?? null;
    } else {
      const hrefSlug = merchantSlugFromSpendingHref(line.href);
      if (hrefSlug) parent = slugToParent.get(hrefSlug) ?? null;
      if (!parent) {
        const sid = subscriptionSlugFromItemId(line.id);
        if (sid) parent = slugToParent.get(sid) ?? null;
      }
    }

    if (!parent || !FORECAST_DISCRETIONARY_PARENTS.has(parent)) continue;

    buckets[bi][parent] = (buckets[bi][parent] ?? 0) + line.amount;
  }

  return buckets;
}

export interface CategoryTrailingStat {
  parentCategory: string;
  medianMonthly: number;
  minMonthly: number;
  maxMonthly: number;
  volatile: boolean;
}

/**
 * Per-parent monthly totals over trailing months → median / min / max (core expenses only, allowlisted parents).
 */
export function computeDiscretionaryCategoryTrailing(
  expenseTxns: ExpenseTxnRecord[],
  trailingMonths: string[],
): Map<string, CategoryTrailingStat> {
  const out = new Map<string, CategoryTrailingStat>();
  if (trailingMonths.length === 0) return out;

  const parentsInPlay = new Set<string>();
  for (const t of expenseTxns) {
    if (!trailingMonths.includes(t.txMonth)) continue;
    if (isCoreExcluded(t.category ?? "")) continue;
    const p = getParentCategory(t.category ?? "Other");
    if (!FORECAST_DISCRETIONARY_PARENTS.has(p)) continue;
    parentsInPlay.add(p);
  }

  for (const parent of parentsInPlay) {
    const monthTotals = trailingMonths.map((ym) =>
      expenseTxns
        .filter((t) => t.txMonth === ym && getParentCategory(t.category ?? "Other") === parent && !isCoreExcluded(t.category ?? ""))
        .reduce((s, t) => s + t.amount, 0),
    );
    const medianMonthly = medianOf(monthTotals);
    const minMonthly = Math.min(...monthTotals);
    const maxMonthly = Math.max(...monthTotals);
    const volatile =
      medianMonthly > 0 && (maxMonthly - minMonthly) / medianMonthly >= VOLATILE_SPREAD_RATIO;

    out.set(parent, { parentCategory: parent, medianMonthly, minMonthly, maxMonthly, volatile });
  }

  return out;
}

/** Bucket 0 = day-scaled pace (~31d); buckets 1–2 = one full median month each (residual after overlap). */
export function buildBucketDiscretionaryPayload(params: {
  categoryStats: Map<string, CategoryTrailingStat>;
  overlap: [Record<string, number>, Record<string, number>, Record<string, number>];
  windowLabel: string;
  /** Calendar days in bucket 0 (typically 31 for 0–30). */
  firstBucketDayCount: number;
}): NearTermBucketDiscretionaryDTO[] {
  const { categoryStats, overlap, windowLabel, firstBucketDayCount } = params;

  const ranked = [...categoryStats.entries()]
    .filter(([, v]) => v.medianMonthly >= MIN_MEDIAN_TO_SHOW)
    .sort((a, b) => b[1].medianMonthly - a[1].medianMonthly)
    .slice(0, TOP_CATEGORY_LIMIT);

  const scales: [number, number, number] = [
    firstBucketDayCount / DAYS_PER_MONTH,
    1,
    1,
  ];

  const basisLabels: [string, string, string] = [
    `From your recent spending, scaled to about ${firstBucketDayCount} days. Subscription & fixed cash amounts already listed above are subtracted so we don’t count them twice.`,
    "From about one typical month of recent spending. Subscription & fixed cash already listed above are subtracted so we don’t count them twice.",
    "From about one typical month of recent spending. Subscription & fixed cash already listed above are subtracted so we don’t count them twice.",
  ];

  const result: NearTermBucketDiscretionaryDTO[] = [];

  for (let bi = 0; bi < 3; bi++) {
    const scale = scales[bi];
    const ov = overlap[bi];
    const categories: NearTermDiscretionaryCategoryDTO[] = [];
    let residualTotal = 0;

    for (const [parent, stat] of ranked) {
      const typical = stat.medianMonthly * scale;
      const scheduled = ov[parent] ?? 0;
      const residualAmount = Math.max(0, Math.round(typical - scheduled));
      residualTotal += residualAmount;
      categories.push({
        parentCategory: parent,
        medianMonthly: Math.round(stat.medianMonthly),
        minMonthly: Math.round(stat.minMonthly),
        maxMonthly: Math.round(stat.maxMonthly),
        volatile: stat.volatile,
        residualAmount,
        windowLabel,
      });
    }

    result.push({
      categories,
      residualTotal,
      basisLabel: basisLabels[bi],
    });
  }

  return result;
}
