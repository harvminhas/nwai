/**
 * Multi-category Spending view ("Groceries + Dining").
 *
 * The Spending drilldown API stays single-category. The page fetches each
 * category's existing level=category response and combines them here, so
 * the combined total is exactly the sum of the individual category pages.
 * A single category (or anything that is not a list of known parents) keeps
 * the old behaviour and URL.
 */

import { PARENT_CATEGORIES } from "./categoryTaxonomy";

export interface CategoryMonthlySeries {
  yearMonth: string;
  amount: number;
}

export interface CategoryRankedItem {
  name: string;
  slug: string;
  total: number;
  share: number;
  trend: number;
  monthlySeries: CategoryMonthlySeries[];
  subLabel?: string;
  category?: string;
  txCount?: number;
}

export interface CategoryAccountBreakdown {
  label: string;
  slug: string;
  total: number;
  share: number;
  count: number;
}

/** The subset of a level=category drilldown response this combiner reads. */
export interface CategoryDrilldownPart {
  level: "category";
  breadcrumb: { label: string; href?: string }[];
  total: number;
  avgPerMonth: number;
  monthlySeries: CategoryMonthlySeries[];
  comparisonSeries?: CategoryMonthlySeries[];
  rankedItems: CategoryRankedItem[];
  accounts?: CategoryAccountBreakdown[];
  currency: string;
}

export interface CategorySection {
  category: string;
  total: number;
  avgPerMonth: number;
}

export interface CombinedCategoryDrilldown extends CategoryDrilldownPart {
  categories: string[];
  sections: CategorySection[];
}

function canonicalParent(name: string): string | null {
  const lower = name.trim().toLowerCase();
  return PARENT_CATEGORIES.find((p) => p.toLowerCase() === lower) ?? null;
}

/**
 * Parse `?category=`. "Groceries,Dining" → ["Groceries", "Dining"].
 * Returns the raw value as a single-item list (unchanged behaviour) unless
 * every comma-separated part is a known parent category.
 */
export function parseCategoryParam(raw: string | null | undefined): string[] {
  const value = raw ?? "";
  if (!value) return [];
  if (!value.includes(",")) return [value];
  const parts: string[] = [];
  for (const piece of value.split(",")) {
    if (!piece.trim()) continue;
    const parent = canonicalParent(piece);
    // Debt's page is built from payment history, not merchants; never combine it.
    if (!parent || parent === "Debt") return [value];
    if (!parts.includes(parent)) parts.push(parent);
  }
  return parts.length > 0 ? parts : [value];
}

export function isMultiCategory(categories: string[]): boolean {
  return categories.length > 1;
}

export function combinedCategoryTitle(categories: string[]): string {
  return categories.join(" + ");
}

/** `/account/spending?category=Groceries,Dining`; one category keeps the old URL. */
export function spendingHrefForCategories(categories: string[]): string {
  if (categories.length === 1) {
    return `/account/spending?category=${encodeURIComponent(categories[0])}`;
  }
  return `/account/spending?category=${categories.map(encodeURIComponent).join(",")}`;
}

function sumSeries(seriesList: CategoryMonthlySeries[][]): CategoryMonthlySeries[] {
  const totals = new Map<string, number>();
  for (const series of seriesList) {
    for (const point of series) {
      totals.set(point.yearMonth, (totals.get(point.yearMonth) ?? 0) + point.amount);
    }
  }
  return Array.from(totals.keys())
    .sort()
    .map((yearMonth) => ({ yearMonth, amount: totals.get(yearMonth) ?? 0 }));
}

/**
 * Combine per-category level=category responses. `parts[i]` belongs to
 * `categories[i]`; a null part (category not found) is skipped.
 */
export function combineCategoryDrilldowns(
  categories: string[],
  parts: Array<CategoryDrilldownPart | null>,
): CombinedCategoryDrilldown | null {
  const present: Array<{ category: string; part: CategoryDrilldownPart }> = [];
  categories.forEach((category, idx) => {
    const part = parts[idx];
    if (part) present.push({ category, part });
  });
  if (present.length === 0) return null;

  const total = present.reduce((sum, p) => sum + p.part.total, 0);
  const avgPerMonth = present.reduce((sum, p) => sum + p.part.avgPerMonth, 0);
  const monthlySeries = sumSeries(present.map((p) => p.part.monthlySeries));

  const rankedItems: CategoryRankedItem[] = present.flatMap(({ category, part }) =>
    part.rankedItems.map((item) => ({
      ...item,
      category,
      share: total > 0 ? item.total / total : 0,
    })),
  );

  const accountMap = new Map<string, CategoryAccountBreakdown>();
  for (const { part } of present) {
    for (const acc of part.accounts ?? []) {
      const cur = accountMap.get(acc.slug);
      if (cur) {
        cur.total += acc.total;
        cur.count += acc.count;
      } else {
        accountMap.set(acc.slug, { ...acc });
      }
    }
  }
  const accounts = Array.from(accountMap.values())
    .map((acc) => ({ ...acc, share: total > 0 ? acc.total / total : 0 }))
    .sort((a, b) => b.total - a.total);

  const shown = present.map((p) => p.category);
  const first = present[0].part;
  return {
    level: "category",
    breadcrumb: [
      { label: "All spending", href: "/account/spending" },
      { label: combinedCategoryTitle(shown) },
    ],
    total,
    avgPerMonth,
    monthlySeries,
    comparisonSeries: first.comparisonSeries,
    rankedItems,
    accounts: accounts.length > 0 ? accounts : undefined,
    currency: first.currency,
    categories: shown,
    sections: present.map(({ category, part }) => ({
      category,
      total: part.total,
      avgPerMonth: part.avgPerMonth,
    })),
  };
}
