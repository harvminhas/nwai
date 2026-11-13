/**
 * Start-vs-end category cards for Assets / Debts Trends.
 * Uses the same byAccount balances the Trends month detail uses.
 * Does not change shared net-worth math.
 */

import { accountDetailHref } from "./accountDetailHref";
import { resolveAccountDisplayName } from "./accountListLabel";
import { assetCategory, assetGroupLabel, type AssetGroup } from "./assetsSummary";
import { getParentCategory } from "./categoryTaxonomy";
import { fmt } from "./currencyUtils";
import { debtCategory, debtGroupLabel, type DebtGroup } from "./debtsSummary";
import type { ManualAsset } from "./types";

function displayName(label: string, slug: string): string {
  return resolveAccountDisplayName({ historyLabel: label, fallback: slug }).primary;
}

export type CategoryTrendKind = "asset" | "debt";

export interface TrendAccountRow {
  slug: string;
  label: string;
  type: string;
  start: number;
  end: number;
  change: number;
  openedInRange: boolean;
}

export interface CategoryTrendCard {
  key: string;
  label: string;
  kind: CategoryTrendKind;
  current: number;
  start: number;
  change: number;
  changePercent: number | null;
  sparkline: number[];
  subtitle: string | null;
  staleNote: string | null;
  accountCount: number;
  href: string;
  accounts: TrendAccountRow[];
  newAccountNote: string | null;
}

export interface CategoryTrendMonth {
  month: string;
  accountDetails?: Array<{ slug: string; label: string; type: string; value: number }>;
}

export interface CategoryTrendTxn {
  txMonth: string;
  amount: number;
  accountSlug: string;
  category?: string;
}

export function isInvestmentMarketIncome(category?: string | null): boolean {
  if (!category) return false;
  const raw = category.trim().toLowerCase().replace(/^income\s*[-—]\s*/, "");
  return (
    raw === "dividend" ||
    raw === "dividends" ||
    raw === "interest" ||
    raw === "distribution" ||
    raw === "distributions" ||
    raw.includes("dividend") ||
    raw.includes("distribution")
  );
}

function monthsBetween(fromIso: string, asOf: Date): number {
  const from = new Date(fromIso.slice(0, 10) + "T00:00:00");
  if (Number.isNaN(from.getTime())) return 0;
  return (asOf.getTime() - from.getTime()) / (1000 * 60 * 60 * 24 * 30.4375);
}

function moneyAbs(n: number, currency: string): string {
  return fmt(Math.abs(n), currency);
}

/** Absolute currency with a minus sign when `n` is negative (unicode minus). */
function moneySigned(n: number, currency: string): string {
  const formatted = fmt(Math.abs(n), currency);
  return n < -0.005 ? `−${formatted}` : formatted;
}

function pct(start: number, change: number): number | null {
  if (Math.abs(start) < 0.005) return null;
  return change / Math.abs(start);
}

function signedAmount(kind: CategoryTrendKind, value: number): number {
  return kind === "debt" ? Math.abs(value) : value;
}

function includeRow(kind: CategoryTrendKind, value: number): boolean {
  return kind === "debt" ? value < 0 : value > 0;
}

function categoryOf(
  kind: CategoryTrendKind,
  type: string,
  label: string,
): string {
  return kind === "debt" ? debtCategory(type, label) : assetCategory(type, label);
}

function categoryLabel(kind: CategoryTrendKind, key: string): string {
  if (kind === "debt") return debtGroupLabel(key as DebtGroup["type"]);
  return assetGroupLabel(key as AssetGroup["type"]);
}

function categoryHref(kind: CategoryTrendKind, key: string, accounts: TrendAccountRow[]): string {
  if (accounts.length === 1) {
    const href = accountDetailHref({
      slug: accounts[0].slug,
      type: accounts[0].type,
      side: kind === "debt" ? "debt" : "asset",
    });
    if (href) return href;
  }
  if (kind === "debt") return `/account/liabilities/category/${key}`;
  return `/account/assets/category/${key}`;
}

type AccountFlows = {
  deposits: number;
  withdrawals: number;
  interestIn: number;
  interestOut: number;
  fees: number;
  known: boolean;
};

function emptyFlows(): AccountFlows {
  return { deposits: 0, withdrawals: 0, interestIn: 0, interestOut: 0, fees: 0, known: false };
}

function flowsFor(
  slugs: Set<string>,
  months: Set<string>,
  incomeTxns: CategoryTrendTxn[],
  expenseTxns: CategoryTrendTxn[],
): Map<string, AccountFlows> {
  const map = new Map<string, AccountFlows>();
  const ensure = (slug: string) => {
    const prev = map.get(slug) ?? emptyFlows();
    prev.known = true;
    map.set(slug, prev);
    return prev;
  };
  for (const t of incomeTxns) {
    if (!months.has(t.txMonth) || !slugs.has(t.accountSlug)) continue;
    const row = ensure(t.accountSlug);
    if (isInvestmentMarketIncome(t.category) || getParentCategory(t.category ?? "") === "Interest") {
      row.interestIn += Math.abs(t.amount);
      continue;
    }
    row.deposits += Math.abs(t.amount);
  }
  for (const t of expenseTxns) {
    if (!months.has(t.txMonth) || !slugs.has(t.accountSlug)) continue;
    const row = ensure(t.accountSlug);
    const parent = getParentCategory(t.category ?? "");
    if (parent === "Interest") {
      row.interestOut += Math.abs(t.amount);
      continue;
    }
    if (parent === "Fees") {
      row.fees += Math.abs(t.amount);
      continue;
    }
    row.withdrawals += Math.abs(t.amount);
  }
  return map;
}

function latestManualValuation(asset: ManualAsset): { date: string; monthsAgo: number } | null {
  const asOf = new Date();
  const dated = [...(asset.valuations ?? [])].sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate));
  const last = dated[dated.length - 1];
  const iso = last?.effectiveDate || asset.updatedAt;
  if (!iso) return null;
  return { date: iso.slice(0, 10), monthsAgo: monthsBetween(iso, asOf) };
}

function formatMonYear(iso: string): string {
  const [y, m] = iso.slice(0, 7).split("-");
  const date = new Date(parseInt(y, 10), parseInt(m, 10) - 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function joinParts(parts: Array<string | null | undefined>): string | null {
  const clean = parts.filter((p): p is string => !!p && p.trim().length > 0);
  return clean.length ? clean.join(" · ") : null;
}

function assetSubtitle(
  key: string,
  card: Pick<CategoryTrendCard, "start" | "change" | "changePercent" | "accounts">,
  flows: Map<string, AccountFlows>,
  manuals: ManualAsset[],
  currency: string,
): string | null {
  const slugs = new Set(card.accounts.map((a) => a.slug));
  if (key === "cash") {
    const known = card.accounts.every((a) => flows.get(a.slug)?.known);
    if (!known) return null;
    let deposits = 0;
    let withdrawals = 0;
    let interest = 0;
    for (const slug of slugs) {
      const f = flows.get(slug);
      if (!f) continue;
      deposits += f.deposits;
      withdrawals += f.withdrawals;
      interest += f.interestIn;
    }
    const net = deposits - withdrawals;
    const netLine = net >= 0 ? `Net inflow ${moneyAbs(net, currency)}` : `Net outflow ${moneyAbs(net, currency)}`;
    const interestLine = interest > 0.005 ? `Interest earned ${moneyAbs(interest, currency)}` : null;
    return joinParts([netLine, interestLine]);
  }

  if (key === "investments" || key === "registered") {
    const known = card.accounts.length > 0 && card.accounts.every((a) => flows.get(a.slug)?.known);
    if (known) {
      let putIn = 0;
      for (const slug of slugs) {
        const f = flows.get(slug)!;
        putIn += f.deposits - f.withdrawals;
      }
      const market = card.change - putIn;
      const marketPct = pct(card.start, market);
      const contrib = putIn >= 0
        ? `Contributions ${moneyAbs(putIn, currency)}`
        : `Withdrawals ${moneyAbs(putIn, currency)}`;
      const marketLine =
        marketPct != null
          ? `Market growth ${moneySigned(market, currency)} (${market >= 0 ? "+" : "−"}${Math.round(Math.abs(marketPct) * 100)}%)`
          : `Market growth ${moneySigned(market, currency)}`;
      return joinParts([contrib, marketLine]);
    }
    if (card.changePercent != null) {
      const sign = card.change >= 0 ? "+" : "−";
      return `Return ${sign}${Math.round(Math.abs(card.changePercent) * 100)}%`;
    }
    return null;
  }

  const manualsInCard = manuals.filter((a) => slugs.has(`manual-${a.id}`));
  if (manualsInCard.length > 0 && manualsInCard.length === card.accounts.length) {
    const dated = manualsInCard
      .map(latestManualValuation)
      .filter((v): v is NonNullable<typeof v> => v != null)
      .sort((a, b) => b.date.localeCompare(a.date));
    const revalued = dated[0] ? `re-valued ${formatMonYear(dated[0].date)}` : null;
    const rates = manualsInCard
      .map((a) => a.annualGrowthRate)
      .filter((r): r is number => r != null && Number.isFinite(r));
    const rateLine =
      rates.length === 1
        ? `${rates[0] >= 0 ? "+" : "−"}${Math.abs(rates[0])}% / year`
        : null;
    return joinParts(["Manual", revalued, rateLine]);
  }
  if (card.changePercent != null) {
    const sign = card.change >= 0 ? "+" : "−";
    return `Return ${sign}${Math.round(Math.abs(card.changePercent) * 100)}%`;
  }
  return null;
}

function debtSubtitle(
  accounts: TrendAccountRow[],
  flows: Map<string, AccountFlows>,
  currency: string,
): string | null {
  const known = accounts.length > 0 && accounts.every((a) => flows.get(a.slug)?.known);
  if (!known) return null;
  let paid = 0;
  let charges = 0;
  let interest = 0;
  let fees = 0;
  for (const a of accounts) {
    const f = flows.get(a.slug);
    if (!f) continue;
    paid += f.deposits;
    charges += f.withdrawals;
    interest += f.interestOut;
    fees += f.fees;
  }
  return joinParts([
    paid > 0.005 ? `Paid ${moneyAbs(paid, currency)}` : null,
    charges > 0.005 ? `New charges ${moneyAbs(charges, currency)}` : null,
    interest > 0.005 ? `Interest ${moneyAbs(interest, currency)}` : null,
    fees > 0.005 ? `Fees ${moneyAbs(fees, currency)}` : null,
  ]);
}

function staleNoteFor(
  accounts: TrendAccountRow[],
  manuals: ManualAsset[],
): string | null {
  const slugs = new Set(accounts.map((a) => a.slug));
  let oldest: { monthsAgo: number } | null = null;
  for (const asset of manuals) {
    if (!slugs.has(`manual-${asset.id}`)) continue;
    const v = latestManualValuation(asset);
    if (!v || v.monthsAgo <= 6) continue;
    if (!oldest || v.monthsAgo > oldest.monthsAgo) oldest = v;
  }
  if (!oldest) return null;
  const mo = Math.round(oldest.monthsAgo);
  return `Valued ${mo} mo ago`;
}

export function buildCategoryTrendCards(opts: {
  kind: CategoryTrendKind;
  months: CategoryTrendMonth[];
  expenseTxns: CategoryTrendTxn[];
  incomeTxns: CategoryTrendTxn[];
  currency: string;
  manualAssets?: ManualAsset[];
  /** Ending snapshot of the month immediately before `months[0]`. */
  priorMonth?: CategoryTrendMonth | null;
}): CategoryTrendCard[] {
  const { kind, currency, manualAssets = [] } = opts;
  const months = [...opts.months].sort((a, b) => a.month.localeCompare(b.month));
  if (months.length === 0) return [];
  const hasPrior = opts.priorMonth != null;
  // With a prior snapshot, count every in-range month. With no prior, the first
  // in-range month IS the start, so flows begin at the second month.
  const flowMonths = new Set((hasPrior ? months : months.slice(1)).map((m) => m.month));
  const startSnapshot = hasPrior ? opts.priorMonth! : months[0];

  const startBySlug = new Map<string, { slug: string; label: string; type: string; value: number; category: string }>();
  for (const row of startSnapshot.accountDetails ?? []) {
    if (!includeRow(kind, row.value)) continue;
    startBySlug.set(row.slug, {
      slug: row.slug,
      label: displayName(row.label, row.slug),
      type: row.type,
      value: signedAmount(kind, row.value),
      category: categoryOf(kind, row.type, row.label),
    });
  }

  const seenBySlug = new Map<string, { slug: string; label: string; type: string; category: string }>();
  for (const m of months) {
    for (const row of m.accountDetails ?? []) {
      if (!includeRow(kind, row.value)) continue;
      seenBySlug.set(row.slug, {
        slug: row.slug,
        label: displayName(row.label, row.slug),
        type: row.type,
        category: categoryOf(kind, row.type, row.label),
      });
    }
  }

  const endMonth = months[months.length - 1];
  const endBySlug = new Map<string, { slug: string; label: string; type: string; value: number; category: string }>();
  for (const row of endMonth.accountDetails ?? []) {
    if (!includeRow(kind, row.value)) continue;
    endBySlug.set(row.slug, {
      slug: row.slug,
      label: displayName(row.label, row.slug),
      type: row.type,
      value: signedAmount(kind, row.value),
      category: categoryOf(kind, row.type, row.label),
    });
  }

  const grouped = new Map<string, TrendAccountRow[]>();
  for (const [slug, seen] of seenBySlug) {
    const startRow = startBySlug.get(slug);
    const last = endBySlug.get(slug);
    const start = startRow?.value ?? 0;
    const end = last?.value ?? 0;
    const category = last?.category ?? seen.category;
    const row: TrendAccountRow = {
      slug,
      label: last?.label || seen.label,
      type: last?.type ?? seen.type,
      start,
      end,
      change: end - start,
      openedInRange: !startRow,
    };
    const list = grouped.get(category) ?? [];
    list.push(row);
    grouped.set(category, list);
  }

  const sparklineByCat = new Map<string, number[]>();
  for (const m of months) {
    const totals = new Map<string, number>();
    for (const row of m.accountDetails ?? []) {
      if (!includeRow(kind, row.value)) continue;
      const cat = categoryOf(kind, row.type, row.label);
      totals.set(cat, (totals.get(cat) ?? 0) + signedAmount(kind, row.value));
    }
    for (const key of grouped.keys()) {
      const series = sparklineByCat.get(key) ?? [];
      series.push(totals.get(key) ?? 0);
      sparklineByCat.set(key, series);
    }
  }

  const allSlugs = new Set([...seenBySlug.keys()]);
  const flows = flowsFor(allSlugs, flowMonths, opts.incomeTxns, opts.expenseTxns);

  const cards: CategoryTrendCard[] = [];
  for (const [key, accounts] of grouped) {
    if (accounts.length === 0) continue;
    accounts.sort((a, b) => Math.abs(b.change) - Math.abs(a.change));
    const start = accounts.reduce((s, a) => s + a.start, 0);
    const end = accounts.reduce((s, a) => s + a.end, 0);
    const change = end - start;
    const opened = accounts.filter((a) => a.openedInRange);
    const cardBase = {
      start,
      change,
      changePercent: pct(start, change),
      accounts,
    };
    const subtitle =
      kind === "debt"
        ? debtSubtitle(accounts, flows, currency)
        : assetSubtitle(key, cardBase, flows, manualAssets, currency);
    cards.push({
      key,
      label: categoryLabel(kind, key),
      kind,
      current: end,
      start,
      change,
      changePercent: pct(start, change),
      sparkline: sparklineByCat.get(key) ?? [],
      subtitle,
      staleNote: kind === "asset" ? staleNoteFor(accounts, manualAssets) : null,
      accountCount: accounts.length,
      href: categoryHref(kind, key, accounts),
      accounts,
      newAccountNote:
        opened.length > 0
          ? `Opened this period: ${opened.map((a) => a.label).join(", ")}`
          : null,
    });
  }

  return cards.sort((a, b) => b.current - a.current);
}

export function describeDebtChangePill(change: number, currency: string): { text: string; tone: "up" | "down" | "flat" } {
  if (Math.abs(change) < 0.5) return { text: "No change", tone: "flat" };
  if (change < 0) return { text: `Paid down ${moneyAbs(change, currency)}`, tone: "down" };
  return { text: `Grew ${moneyAbs(change, currency)}`, tone: "up" };
}

export function describeAssetChangePill(
  change: number,
  changePercent: number | null,
  currency: string,
): { text: string; tone: "up" | "down" | "flat" } {
  if (Math.abs(change) < 0.5) return { text: "No change", tone: "flat" };
  const pctPart =
    changePercent != null && Math.round(Math.abs(changePercent) * 100) > 0
      ? ` · ${change >= 0 ? "+" : "−"}${Math.round(Math.abs(changePercent) * 100)}%`
      : "";
  const sign = change >= 0 ? "+" : "−";
  return {
    text: `${sign}${moneyAbs(change, currency)}${pctPart}`,
    tone: change > 0 ? "up" : "down",
  };
}
