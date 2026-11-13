/**
 * What-changed waterfall for Assets / Debts.
 * Reuses Performance start/end, new-account, and contribution/market split rules.
 * Drivers are partitioned so start + rows = end.
 */

import { assetGroupLabel, type AssetGroup } from "./assetsSummary";
import {
  buildCategoryTrendCards,
  computeAccountFlows,
  type AccountFlows,
  type CategoryTrendKind,
  type CategoryTrendMonth,
  type CategoryTrendTxn,
  type TrendAccountRow,
} from "./categoryTrends";
import { fmt } from "./currencyUtils";
import { debtGroupLabel, type DebtGroup } from "./debtsSummary";
import type { TrendRangeKey } from "./trendRange";
import type { ManualAsset } from "./types";

const ZERO = 0.5;

export type WaterfallRowKind = "start" | "driver" | "end";
export type WaterfallTone = "up" | "down" | "neutral";

export interface WaterfallRow {
  key: string;
  label: string;
  amount: number;
  kind: WaterfallRowKind;
  tone: WaterfallTone;
  badge?: "Manual";
  barPct: number | null;
}

export interface WhatChangedModel {
  kind: CategoryTrendKind;
  title: string;
  header: string;
  summary: string;
  start: number;
  end: number;
  rows: WaterfallRow[];
  currency: string;
}

type DriverDraft = {
  key: string;
  label: string;
  amount: number;
  badge?: "Manual";
};

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-");
  const date = new Date(Number(y), Number(m) - 1, 1);
  return date.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function periodPhrase(range: TrendRangeKey): string {
  if (range === "6M") return "over the last 6 months";
  if (range === "3Y") return "over the past 3 years";
  if (range === "All") return "over this period";
  return "this year";
}

function moneyAbs(n: number, currency: string): string {
  return fmt(Math.abs(n), currency);
}

function moneySigned(n: number, currency: string): string {
  const formatted = moneyAbs(n, currency);
  if (n > ZERO) return `+${formatted}`;
  if (n < -ZERO) return `−${formatted}`;
  return formatted;
}

function flowMonthsFor(months: CategoryTrendMonth[], priorMonth?: CategoryTrendMonth | null): Set<string> {
  const sorted = [...months].sort((a, b) => a.month.localeCompare(b.month));
  return new Set((priorMonth != null ? sorted : sorted.slice(1)).map((m) => m.month));
}

function allKnown(accounts: TrendAccountRow[], flows: Map<string, AccountFlows>): boolean {
  return accounts.length > 0 && accounts.every((a) => flows.get(a.slug)?.known);
}

function putIn(accounts: TrendAccountRow[], flows: Map<string, AccountFlows>): number {
  let n = 0;
  for (const a of accounts) {
    const f = flows.get(a.slug);
    if (!f) continue;
    n += f.deposits - f.withdrawals;
  }
  return n;
}

function isManualType(type: string): boolean {
  return type.startsWith("manual-") || type === "property" || type === "vehicle";
}

function manualBucket(type: string): "property" | "vehicle" | "other" {
  const raw = type.startsWith("manual-") ? type.slice("manual-".length) : type;
  if (raw === "property") return "property";
  if (raw === "vehicle") return "vehicle";
  return "other";
}

function changeLabel(kind: CategoryTrendKind, key: string): string {
  const name =
    kind === "debt"
      ? debtGroupLabel(key as DebtGroup["type"])
      : assetGroupLabel(key as AssetGroup["type"]);
  return `Change — ${name}`;
}

function pushDriver(rows: DriverDraft[], draft: DriverDraft) {
  if (Math.abs(draft.amount) < ZERO) return;
  const existing = rows.find((r) => r.key === draft.key);
  if (existing) {
    existing.amount += draft.amount;
    return;
  }
  rows.push({ ...draft });
}

function toneFor(kind: CategoryTrendKind, amount: number): WaterfallTone {
  if (Math.abs(amount) < ZERO) return "neutral";
  if (kind === "debt") return amount < 0 ? "up" : "down";
  return amount > 0 ? "up" : "down";
}

function assetDrivers(
  cards: ReturnType<typeof buildCategoryTrendCards>,
  flows: Map<string, AccountFlows>,
): { drivers: DriverDraft[]; putIn: number; manuals: number } {
  const drivers: DriverDraft[] = [];
  let contribTotal = 0;
  let manualsTotal = 0;

  for (const card of cards) {
    const existing = card.accounts.filter((a) => !a.openedInRange);
    const opened = card.accounts.filter((a) => a.openedInRange);

    if (card.key === "registered" || card.key === "investments") {
      const contribLabel =
        card.key === "registered"
          ? "Contributions to registered accounts"
          : "Contributions to investments";
      const marketLabel =
        card.key === "registered" ? "Market growth — registered" : "Market growth — investments";
      const contribKey = card.key === "registered" ? "contrib-registered" : "contrib-investments";
      const marketKey = card.key === "registered" ? "market-registered" : "market-investments";

      if (existing.length && allKnown(existing, flows)) {
        const contrib = putIn(existing, flows);
        const change = existing.reduce((s, a) => s + a.change, 0);
        pushDriver(drivers, { key: contribKey, label: contribLabel, amount: contrib });
        pushDriver(drivers, { key: marketKey, label: marketLabel, amount: change - contrib });
        contribTotal += Math.max(contrib, 0);
      } else if (existing.length) {
        pushDriver(drivers, {
          key: `change-${card.key}`,
          label: changeLabel("asset", card.key),
          amount: existing.reduce((s, a) => s + a.change, 0),
        });
      }

      for (const a of opened) {
        if (allKnown([a], flows)) {
          const contrib = putIn([a], flows);
          pushDriver(drivers, { key: "new-accounts", label: "New accounts", amount: contrib });
          pushDriver(drivers, { key: marketKey, label: marketLabel, amount: a.change - contrib });
          contribTotal += Math.max(contrib, 0);
        } else {
          pushDriver(drivers, { key: "new-accounts", label: "New accounts", amount: a.change });
        }
      }
      continue;
    }

    if (card.key === "cash") {
      if (existing.length) {
        pushDriver(drivers, {
          key: "cash-net",
          label: "Cash & savings net change",
          amount: existing.reduce((s, a) => s + a.change, 0),
        });
      }
      for (const a of opened) {
        pushDriver(drivers, { key: "new-accounts", label: "New accounts", amount: a.change });
      }
      continue;
    }

    const existingByBucket = { property: [] as TrendAccountRow[], vehicle: [] as TrendAccountRow[], otherManual: [] as TrendAccountRow[], other: [] as TrendAccountRow[] };
    for (const a of existing) {
      if (isManualType(a.type)) {
        const bucket = manualBucket(a.type);
        if (bucket === "property") existingByBucket.property.push(a);
        else if (bucket === "vehicle") existingByBucket.vehicle.push(a);
        else existingByBucket.otherManual.push(a);
      } else {
        existingByBucket.other.push(a);
      }
    }

    const propertyChange = existingByBucket.property.reduce((s, a) => s + a.change, 0);
    const vehicleChange = existingByBucket.vehicle.reduce((s, a) => s + a.change, 0);
    const otherManualChange = existingByBucket.otherManual.reduce((s, a) => s + a.change, 0);
    const otherChange = existingByBucket.other.reduce((s, a) => s + a.change, 0);

    pushDriver(drivers, {
      key: "property",
      label: "Property re-valuation",
      amount: propertyChange,
      badge: "Manual",
    });
    manualsTotal += propertyChange;
    pushDriver(drivers, {
      key: "vehicle",
      label: vehicleChange < 0 ? "Vehicle depreciation" : "Vehicle re-valuation",
      amount: vehicleChange,
      badge: "Manual",
    });
    manualsTotal += vehicleChange;
    pushDriver(drivers, {
      key: "other-manual",
      label: "Other manual asset changes",
      amount: otherManualChange,
      badge: "Manual",
    });
    manualsTotal += otherManualChange;
    if (existingByBucket.other.length) {
      pushDriver(drivers, {
        key: `change-${card.key}`,
        label: changeLabel("asset", card.key),
        amount: otherChange,
      });
    }

    for (const a of opened) {
      pushDriver(drivers, { key: "new-accounts", label: "New accounts", amount: a.change });
    }
  }

  return { drivers, putIn: contribTotal, manuals: manualsTotal };
}

function debtDrivers(
  cards: ReturnType<typeof buildCategoryTrendCards>,
  flows: Map<string, AccountFlows>,
): { drivers: DriverDraft[]; paid: number; charges: number; interest: number } {
  const drivers: DriverDraft[] = [];
  let paid = 0;
  let charges = 0;
  let interest = 0;

  const knownExisting: TrendAccountRow[] = [];
  const unknownByCat = new Map<string, TrendAccountRow[]>();

  for (const card of cards) {
    const existing = card.accounts.filter((a) => !a.openedInRange);
    const opened = card.accounts.filter((a) => a.openedInRange);
    const known: TrendAccountRow[] = [];
    const unknown: TrendAccountRow[] = [];
    for (const a of existing) {
      if (flows.get(a.slug)?.known) known.push(a);
      else unknown.push(a);
    }
    knownExisting.push(...known);
    if (unknown.length) unknownByCat.set(card.key, unknown);

    for (const a of opened) {
      pushDriver(drivers, { key: "new-debts", label: "New debts", amount: a.change });
    }
  }

  if (knownExisting.length) {
    for (const a of knownExisting) {
      const f = flows.get(a.slug)!;
      paid += f.deposits;
      charges += f.withdrawals;
      interest += f.interestOut + f.fees;
    }
    const knownChange = knownExisting.reduce((s, a) => s + a.change, 0);
    const flowEffect = -paid + charges + interest;
    const residual = knownChange - flowEffect;
    if (residual > ZERO) charges += residual;
    else if (residual < -ZERO) paid += -residual;
    pushDriver(drivers, { key: "payments", label: "Payments", amount: -paid });
    pushDriver(drivers, { key: "charges", label: "New charges/draws", amount: charges });
    pushDriver(drivers, { key: "interest-fees", label: "Interest & fees", amount: interest });
  }

  for (const [key, accounts] of unknownByCat) {
    const paidOff = accounts.filter((a) => a.start > ZERO && Math.abs(a.end) < ZERO);
    const openUnknown = accounts.filter((a) => Math.abs(a.end) >= ZERO);
    pushDriver(drivers, {
      key: "paid-off",
      label: "Debts paid off/closed",
      amount: paidOff.reduce((s, a) => s + a.change, 0),
    });
    if (openUnknown.length) {
      pushDriver(drivers, {
        key: `change-${key}`,
        label: changeLabel("debt", key),
        amount: openUnknown.reduce((s, a) => s + a.change, 0),
      });
    }
  }

  return { drivers, paid, charges, interest };
}

function assetSummary(
  change: number,
  putInAmt: number,
  manualsAmt: number,
  range: TrendRangeKey,
  currency: string,
): string {
  const period = periodPhrase(range);
  if (Math.abs(change) < ZERO) return `Your total was unchanged ${period}.`;
  const direction = moneySigned(change, currency);
  const hasPutIn = putInAmt > ZERO;
  const hasManuals = Math.abs(manualsAmt) >= ZERO;
  if (!hasPutIn && !hasManuals) {
    return change > 0
      ? `Your total went up ${moneyAbs(change, currency)} ${period}.`
      : `Your total went down ${moneyAbs(change, currency)} ${period}.`;
  }
  const pctPart =
    hasPutIn && Math.abs(change) >= ZERO
      ? ` (${Math.round((putInAmt / Math.abs(change)) * 100)}%)`
      : "";
  const bits: string[] = [];
  if (hasPutIn) bits.push(`${moneyAbs(putInAmt, currency)}${pctPart} was money you put in`);
  if (hasManuals) bits.push(`${moneyAbs(manualsAmt, currency)} came from manual estimates`);
  return `Of the ${direction} change ${period}, ${bits.join(", and ")}.`;
}

function debtSummary(
  change: number,
  paid: number,
  charges: number,
  interest: number,
  range: TrendRangeKey,
  currency: string,
): string {
  const period = periodPhrase(range);
  const went = change < -ZERO ? "went down" : change > ZERO ? "went up" : "was unchanged";
  const head =
    Math.abs(change) < ZERO
      ? `Your debt was unchanged ${period}`
      : `Your debt ${went} ${moneyAbs(change, currency)} ${period}`;
  const bits: string[] = [];
  if (paid > ZERO) bits.push(`you paid ${moneyAbs(paid, currency)}`);
  if (charges > ZERO) bits.push(`new charges ${moneyAbs(charges, currency)}`);
  if (interest > ZERO) bits.push(`interest ${moneyAbs(interest, currency)}`);
  if (!bits.length) return `${head}.`;
  return `${head}: ${bits.join(", ")}.`;
}

function driverOrder(kind: CategoryTrendKind): string[] {
  if (kind === "debt") {
    return [
      "payments",
      "charges",
      "interest-fees",
      "new-debts",
      "paid-off",
      "change-mortgage",
      "change-credit_card",
      "change-loc",
      "change-other",
    ];
  }
  return [
    "contrib-registered",
    "market-registered",
    "contrib-investments",
    "market-investments",
    "cash-net",
    "change-cash",
    "change-registered",
    "change-investments",
    "property",
    "vehicle",
    "other-manual",
    "change-property",
    "change-other",
    "new-accounts",
  ];
}

function sortDrivers(kind: CategoryTrendKind, drivers: DriverDraft[]): DriverDraft[] {
  const order = driverOrder(kind);
  return [...drivers]
    .filter((d) => Math.abs(d.amount) >= ZERO)
    .sort((a, b) => {
      const ia = order.indexOf(a.key);
      const ib = order.indexOf(b.key);
      const sa = ia === -1 ? 100 : ia;
      const sb = ib === -1 ? 100 : ib;
      if (sa !== sb) return sa - sb;
      return Math.abs(b.amount) - Math.abs(a.amount);
    });
}

export function buildWhatChanged(opts: {
  kind: CategoryTrendKind;
  months: CategoryTrendMonth[];
  expenseTxns: CategoryTrendTxn[];
  incomeTxns: CategoryTrendTxn[];
  currency: string;
  range: TrendRangeKey;
  priorMonth?: CategoryTrendMonth | null;
  manualAssets?: ManualAsset[];
}): WhatChangedModel | null {
  const months = [...opts.months].sort((a, b) => a.month.localeCompare(b.month));
  if (months.length === 0) return null;
  const cards = buildCategoryTrendCards({
    kind: opts.kind,
    months,
    priorMonth: opts.priorMonth,
    expenseTxns: opts.expenseTxns,
    incomeTxns: opts.incomeTxns,
    currency: opts.currency,
    manualAssets: opts.manualAssets,
  });
  const slugs = new Set(cards.flatMap((c) => c.accounts.map((a) => a.slug)));
  const flows = computeAccountFlows(
    slugs,
    flowMonthsFor(months, opts.priorMonth),
    opts.incomeTxns,
    opts.expenseTxns,
  );

  const start = cards.reduce((s, c) => s + c.start, 0);
  const end = cards.reduce((s, c) => s + c.current, 0);
  const change = end - start;
  const split =
    opts.kind === "debt" ? debtDrivers(cards, flows) : assetDrivers(cards, flows);
  const sorted = sortDrivers(opts.kind, split.drivers);
  const maxAbs = Math.max(0, ...sorted.map((d) => Math.abs(d.amount)));
  const summary =
    "paid" in split
      ? debtSummary(change, split.paid, split.charges, split.interest, opts.range, opts.currency)
      : assetSummary(change, split.putIn, split.manuals, opts.range, opts.currency);

  const startMonth = months[0].month;
  const endMonth = months[months.length - 1].month;
  const accountCount = slugs.size;
  const header = `${monthLabel(startMonth)} – ${monthLabel(endMonth)} · ${accountCount} account${accountCount === 1 ? "" : "s"}`;

  const startRow: WaterfallRow = {
    key: "start",
    label: `Start of range (${monthLabel(startMonth)})`,
    amount: start,
    kind: "start",
    tone: "neutral",
    barPct: null,
  };
  const driverRows: WaterfallRow[] = sorted.map((d) => ({
    key: d.key,
    label: d.label,
    amount: d.amount,
    kind: "driver" as const,
    tone: toneFor(opts.kind, d.amount),
    badge: d.badge,
    barPct: maxAbs > 0 ? (Math.abs(d.amount) / maxAbs) * 100 : 0,
  }));
  const endRow: WaterfallRow = {
    key: "end",
    label: `End of range (${monthLabel(endMonth)})`,
    amount: end,
    kind: "end",
    tone: "neutral",
    barPct: null,
  };

  return {
    kind: opts.kind,
    title: opts.kind === "debt" ? "What moved your debt" : "What moved your total",
    header,
    summary,
    start,
    end,
    rows: [startRow, ...driverRows, endRow],
    currency: opts.currency,
  };
}
