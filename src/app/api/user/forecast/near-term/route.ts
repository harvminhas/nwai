/**
 * GET /api/user/forecast/near-term
 *
 * 90-day cash-flow style projection: same core rules as Today → "What we expect",
 * plus Tracker-backed Events / Set Payments.
 *
 * Summary `totalOutflow` is a **full horizon estimate**: sum over each window of
 * (scheduled/project outflows in that window + discretionary residual envelope for that window).
 * `scheduledOutflow` is dated/project lines only; `discretionaryEnvelopeTotal` is the envelope portion only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { consolidateStatements, getYearMonth } from "@/lib/consolidate";
import { buildAccountSlug } from "@/lib/accountSlug";
import type { ParsedStatementData } from "@/lib/types";
import type { SubscriptionRecord } from "@/lib/insights/types";
import type { UserEvent, TxTag } from "@/lib/events/types";
import type { CashIncomeEntry } from "@/lib/cashIncome";
import type { SourceMapping } from "@/lib/sourceMappings";
import { buildExpectedUpcomingItems, type UpcomingItem } from "@/lib/expectedUpcoming";
import { toDateStr } from "@/lib/projectionEngine";
import { txFingerprint } from "@/lib/txFingerprint";
import {
  buildBucketDiscretionaryPayload,
  computeDiscretionaryCategoryTrailing,
  fmtTrailingMonthRange,
  pickTrailingMonths,
  scheduledOverlapByBucket,
  type NearTermBucketDiscretionaryDTO,
  type NearTermLineForOverlap,
} from "@/lib/forecastNearTermDiscretionary";

const HORIZON_DAYS = 90;
/** Calendar days in bucket 0 (days 0–30 inclusive). */
const FIRST_BUCKET_DAY_COUNT = 31;

/** Inclusive day ranges — must match `bucket()` slices and discretionary bucket indices. */
const NEAR_TERM_BUCKET_DAY_RANGES: readonly [readonly [number, number], readonly [number, number], readonly [number, number]] = [
  [0, 30],
  [31, 60],
  [61, HORIZON_DAYS],
];

export type NearTermKind = "pattern" | "set_payment" | "event" | "income" | "cash";

export interface NearTermItemDTO {
  id: string;
  kind: NearTermKind;
  title: string;
  subtitle: string;
  /** Primary calendar date YYYY-MM-DD */
  date: string;
  /** Optional end for ranged Events */
  dateEnd?: string;
  daysFromNow: number;
  /** Absolute magnitude (always ≥ 0). Income uses positive display via isIncome. */
  amount: number;
  isIncome: boolean;
  /** estimate | fixed | scheduled | remaining | high confidence */
  amountLabel: string;
  href?: string;
}

export interface NearTermBucketDTO {
  label: string;
  rangeLabel: string;
  /** Income − scheduled outflows (incl. confirmed Services) − discretionary envelope for this window — same components as headline net. */
  netDisplay: number;
  items: NearTermItemDTO[];
  discretionary: NearTermBucketDiscretionaryDTO;
}

/** Map shared upcoming row → Forecast DTO (drops CC-minimum debt placeholders). */
function upcomingToNearTermDTO(item: UpcomingItem, todayYmd: string): NearTermItemDTO | null {
  if (item.type === "debt") return null;

  const isIncome = item.type === "cash-in";
  let kind: NearTermKind = "pattern";
  if (item.type === "cash-out") kind = "cash";
  else if (isIncome) kind = "income";

  let date = item.date;
  if (date.length === 7) date = `${date}-01`;

  let daysFromNow = item.daysFromNow;
  if (daysFromNow >= 9000) daysFromNow = 0;

  let subtitle = item.subtitle ?? "";
  if (item.type === "subscription" && subtitle.startsWith("Recurring ·")) {
    subtitle = subtitle.replace(/^Recurring ·/, "Detected ·");
  }

  let amountLabel = "estimate";
  if (isIncome) {
    const basedOn = subtitle.match(/Based on (\d+) deposits/);
    const n = basedOn ? parseInt(basedOn[1], 10) : 0;
    if (subtitle.includes("Predicted from") || n >= 6) amountLabel = "high confidence";
  } else if (item.type === "cash-out") {
    amountLabel = "scheduled";
  }

  return {
    id: item.id,
    kind,
    title: item.title,
    subtitle: subtitle.trim() || item.title,
    date: date.length >= 10 ? date : todayYmd,
    daysFromNow,
    amount: Math.round(item.amount),
    isIncome,
    amountLabel,
    href: item.href,
  };
}

/** Confirmed Firestore subscriptions (`sub-*`) — omitted from bucket lists only; still on timeline, summaries, overlap. */
function isConfirmedFirestoreSubscriptionRow(item: NearTermItemDTO): boolean {
  return item.id.startsWith("sub-");
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime();
  return Math.round(ms / 86_400_000);
}

function detectHeavyWeekAlert(items: NearTermItemDTO[], homeCurrency: string): string | null {
  const expenses = items.filter((i) => !i.isIncome && i.daysFromNow >= 0);
  if (expenses.length < 3) return null;

  type Dated = NearTermItemDTO & { t: number };
  const dated = expenses
    .map((i) => ({ ...i, t: new Date(i.date + "T12:00:00Z").getTime() }))
    .sort((a, b) => a.t - b.t);

  const WINDOW_MS = 7 * 86_400_000;
  let best: { sum: number; win: Dated[] } | null = null;
  for (let i = 0; i < dated.length; i++) {
    const startT = dated[i].t;
    const win: Dated[] = [];
    let sum = 0;
    for (let j = i; j < dated.length && dated[j].t <= startT + WINDOW_MS; j++) {
      win.push(dated[j]);
      sum += dated[j].amount;
    }
    if (win.length >= 3 && sum >= 2500 && (!best || sum > best.sum)) {
      best = { sum, win };
    }
  }
  if (!best || best.win.length < 3) return null;

  const fmt = (n: number) =>
    new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: homeCurrency,
      maximumFractionDigits: 0,
    }).format(n);

  const top = [...best.win].sort((a, b) => b.amount - a.amount).slice(0, 4);
  const parts = top.map((x) => `${x.title} (${fmt(x.amount)})`);
  return `Heavy week ahead: ${parts.join(", ")} stack within about 7 days (~${fmt(best.sum)} total).`;
}

/** Timeline dots: income must stay visible — a plain slice(0, 40) on date-sorted rows often drops every inflow. */
function buildNearTermTimeline(items: NearTermItemDTO[], horizonDays: number, maxDots = 40): NearTermItemDTO[] {
  const pool = items.filter((i) => i.daysFromNow >= 0 && i.daysFromNow <= horizonDays);
  const cmp = (a: NearTermItemDTO, b: NearTermItemDTO) =>
    a.daysFromNow !== b.daysFromNow ? a.daysFromNow - b.daysFromNow : a.date.localeCompare(b.date);
  const incomes = pool.filter((i) => i.isIncome).sort(cmp);
  const expenses = pool.filter((i) => !i.isIncome).sort(cmp);
  const incomesShown = incomes.slice(0, maxDots);
  const expenseSlots = Math.max(0, maxDots - incomesShown.length);
  const timeline = [...incomesShown, ...expenses.slice(0, expenseSlots)];
  timeline.sort(cmp);
  return timeline;
}

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  const today = todayISO();
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const currentYear = String(now.getFullYear());

  try {
    const stmtSnap = await db
      .collection("statements")
      .where("userId", "==", uid)
      .where("status", "==", "completed")
      .orderBy("uploadedAt", "desc")
      .get();

    let consolidated: ParsedStatementData | null = null;
    if (!stmtSnap.empty) {
      const allDocs = stmtSnap.docs;
      const yearMonths = new Set<string>();
      for (const d of allDocs) {
        const p = d.data().parsedData as ParsedStatementData | undefined;
        let ym = p?.statementDate ? getYearMonth(p.statementDate) : "";
        if (!ym) {
          const raw = d.data().uploadedAt?.toDate?.() ?? d.data().uploadedAt;
          if (raw)
            ym = (
              typeof raw === "object" && "toISOString" in raw ? (raw as Date).toISOString() : String(raw)
            ).slice(0, 7);
        }
        if (ym) yearMonths.add(ym);
      }
      const currentYm = Array.from(yearMonths).sort().reverse()[0];
      if (currentYm) {
        const latestPerAccount = new Map<string, ParsedStatementData>();
        for (const d of allDocs) {
          const p = d.data().parsedData as ParsedStatementData | undefined;
          if (!p) continue;
          let ym = p.statementDate ? getYearMonth(p.statementDate) : "";
          if (!ym) {
            const raw = d.data().uploadedAt?.toDate?.() ?? d.data().uploadedAt;
            if (raw)
              ym = (
                typeof raw === "object" && "toISOString" in raw ? (raw as Date).toISOString() : String(raw)
              ).slice(0, 7);
          }
          if (!ym || ym > currentYm) continue;
          const slug = buildAccountSlug(p.bankName, p.accountId, p.accountName, p.accountType);
          if (!latestPerAccount.has(slug)) latestPerAccount.set(slug, p);
        }
        consolidated = consolidateStatements(Array.from(latestPerAccount.values()), currentYm);
      }
    }

    const [
      profile,
      subscriptionsSnap,
      eventsSnap,
      tagsSnap,
      cashSnap,
      sourceMappingsSnap,
      cashIncomeSnap,
    ] = await Promise.all([
      getFinancialProfile(uid, db),
      db.collection(`users/${uid}/subscriptions`).get(),
      db.collection(`users/${uid}/events`).orderBy("createdAt", "desc").get(),
      db.collection(`users/${uid}/txTags`).get(),
      db.collection(`users/${uid}/cashCommitments`).get(),
      db.collection(`users/${uid}/sourceMappings`).get(),
      db.collection(`users/${uid}/cashIncome`).get(),
    ]);

    const subscriptionRecords = subscriptionsSnap.docs.map((d) => d.data() as SubscriptionRecord);
    const subscriptionSlugs = new Set(subscriptionRecords.map((r) => r.merchantSlug));
    const sourceMappings = sourceMappingsSnap.docs.map((d) => d.data() as SourceMapping);
    const cashIncomeItems = cashIncomeSnap.docs.map((d) => d.data() as CashIncomeEntry);

    const expenseTxns = profile.expenseTxns ?? [];
    const incomeTxns = profile.incomeTxns ?? [];
    const homeCurrency = profile.homeCurrency ?? "CAD";

    const txByFingerprint = new Map<string, { amount: number; date: string; merchant: string }>();
    for (const tx of expenseTxns) {
      const fp = txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.merchant);
      txByFingerprint.set(fp, { amount: Math.abs(tx.amount), date: tx.date, merchant: tx.merchant });
    }

    const eventsById = new Map(eventsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as UserEvent]));

    const tagTotals = new Map<string, number>();
    for (const tagDoc of tagsSnap.docs) {
      const tag = tagDoc.data() as TxTag;
      const fpKey = tag.txFingerprint ?? tagDoc.id;
      const txRow = txByFingerprint.get(fpKey);
      if (!txRow) continue;
      for (const eventId of tag.eventIds ?? []) {
        const ev = eventsById.get(eventId);
        if (!ev) continue;
        if (ev.type === "annual" && !txRow.date.startsWith(currentYear)) continue;
        tagTotals.set(eventId, (tagTotals.get(eventId) ?? 0) + txRow.amount);
      }
    }

    const parsedStatements: ParsedStatementData[] = [];
    for (const d of stmtSnap.docs) {
      const p = d.data().parsedData as ParsedStatementData | undefined;
      if (p) parsedStatements.push(p);
    }

    const cashItemsForBuilder = cashSnap.docs.map((d) => d.data() as {
      id: string;
      name: string;
      amount: number;
      frequency: string;
      category: string;
      notes?: string;
      nextDate?: string;
      sourceVisitId?: string;
      sourceEventId?: string;
    });

    const sharedUpcoming = buildExpectedUpcomingItems({
      horizonDays: HORIZON_DAYS,
      today,
      now,
      thisMonth,
      consolidated,
      subscriptionRecords,
      subscriptionSlugs,
      cashItems: cashItemsForBuilder,
      cashIncomeItems,
      incomeTxns,
      sourceMappings,
      parsedStatements,
      includeCcMinimumEstimates: false,
    });

    const items: NearTermItemDTO[] = [];
    for (const row of sharedUpcoming) {
      const dto = upcomingToNearTermDTO(row, today);
      if (dto) items.push(dto);
    }

    // ── Trackers: Set Payments ───────────────────────────────────────────────
    for (const ev of eventsById.values()) {
      if (ev.archivedAt) continue;
      if (ev.kind !== "scheduled_payment") continue;
      const slots = ev.scheduledPayments ?? [];
      let si = 0;
      for (const slot of slots) {
        const diff = daysBetween(today, slot.date);
        if (diff > HORIZON_DAYS || diff < -3) continue;
        items.push({
          id: `sched-${ev.id}-${slot.date}-${si++}`,
          kind: "set_payment",
          title: ev.name,
          subtitle: `From Trackers · set schedule · ${fmtMoney(slot.estimatedAmount, homeCurrency)} due`,
          date: slot.date,
          daysFromNow: diff,
          amount: Math.round(slot.estimatedAmount),
          isIncome: false,
          amountLabel: "scheduled",
          href: `/account/events/${ev.id}`,
        });
      }
    }

    // ── Trackers: Events (budget projects) ─────────────────────────────────
    for (const ev of eventsById.values()) {
      if (ev.archivedAt) continue;
      if ((ev.kind ?? "project") !== "project") continue;
      const budget = ev.budget;
      if (budget == null || budget <= 0) continue;
      const tagged = tagTotals.get(ev.id) ?? 0;
      const ledger = ev.ledgerTotal ?? 0;
      const spent = tagged + ledger;
      const remaining = Math.max(0, budget - spent);
      if (remaining <= 0) continue;

      const start = ev.startDate ?? ev.date;
      const end = ev.endDate ?? ev.startDate ?? ev.date;
      if (!start && !end) continue;

      const windowEnd = new Date(today + "T12:00:00Z");
      windowEnd.setUTCDate(windowEnd.getUTCDate() + HORIZON_DAYS);
      const windowEndStr = toDateStr(windowEnd);

      const spanStart = start ?? end!;
      const spanEnd = end ?? start!;
      if (spanEnd < today) continue;
      if (spanStart > windowEndStr) continue;

      const anchorDate = spanEnd;
      const diff = daysBetween(today, anchorDate);

      items.push({
        id: `event-${ev.id}`,
        kind: "event",
        title: ev.name,
        subtitle: `From Trackers · ${fmtMoney(spent, homeCurrency)} of ${fmtMoney(budget, homeCurrency)} spent`,
        date: spanStart,
        dateEnd: spanEnd !== spanStart ? spanEnd : undefined,
        daysFromNow: Math.min(Math.max(diff, 0), HORIZON_DAYS),
        amount: Math.round(remaining),
        isIncome: false,
        amountLabel: "remaining",
        href: `/account/events/${ev.id}`,
      });
    }

    items.sort((a, b) => {
      if (a.daysFromNow !== b.daysFromNow) return a.daysFromNow - b.daysFromNow;
      return a.date.localeCompare(b.date);
    });

    /** Full projection including confirmed subs — overlap + summary totals. */
    const itemsUi = items.filter((i) => !isConfirmedFirestoreSubscriptionRow(i));

    const outflows = items.filter((i) => !i.isIncome && i.daysFromNow >= 0 && i.daysFromNow <= HORIZON_DAYS);
    const inflows = items.filter((i) => i.isIncome && i.daysFromNow >= 0 && i.daysFromNow <= HORIZON_DAYS);

    /** Sum of discrete projected expense rows only (subs, cash items, trackers, patterns …). */
    const scheduledOutflow = outflows.reduce((s, i) => s + i.amount, 0);
    const totalIncomeRounded = Math.round(inflows.reduce((s, i) => s + i.amount, 0));

    const alert = detectHeavyWeekAlert(items.filter((i) => i.daysFromNow >= -3), homeCurrency);

    const trailingYm = pickTrailingMonths(profile.allTxMonths ?? [], thisMonth, 3);
    const windowLabel = fmtTrailingMonthRange(trailingYm);
    const categoryStats = computeDiscretionaryCategoryTrailing(expenseTxns, trailingYm);
    const overlapLines: NearTermLineForOverlap[] = items.map((i) => ({
      id: i.id,
      kind: i.kind,
      daysFromNow: i.daysFromNow,
      amount: i.amount,
      isIncome: i.isIncome,
      href: i.href,
    }));
    const overlapTriple = scheduledOverlapByBucket(overlapLines, subscriptionRecords, cashItemsForBuilder);
    const discretionaryBuckets = buildBucketDiscretionaryPayload({
      categoryStats,
      overlap: overlapTriple,
      windowLabel,
      firstBucketDayCount: FIRST_BUCKET_DAY_COUNT,
    });

    let forecastTotalOutflow = 0;
    for (let bi = 0; bi < 3; bi++) {
      const [lo, hi] = NEAR_TERM_BUCKET_DAY_RANGES[bi];
      const schedWindow = items
        .filter((i) => !i.isIncome && i.daysFromNow >= lo && i.daysFromNow <= hi)
        .reduce((s, i) => s + i.amount, 0);
      forecastTotalOutflow += schedWindow + discretionaryBuckets[bi].residualTotal;
    }
    forecastTotalOutflow = Math.round(forecastTotalOutflow);

    const discretionaryEnvelopeTotal = Math.round(
      discretionaryBuckets.reduce((s, b) => s + b.residualTotal, 0),
    );

    function bucket(startDay: number, endDay: number, discIdx: 0 | 1 | 2): NearTermBucketDTO {
      const slice = itemsUi.filter((i) => i.daysFromNow >= startDay && i.daysFromNow <= endDay);
      const sliceFull = items.filter((i) => i.daysFromNow >= startDay && i.daysFromNow <= endDay);
      const incomeInWindow = sliceFull.filter((i) => i.isIncome).reduce((s, i) => s + i.amount, 0);
      const scheduledOutInWindow = sliceFull.filter((i) => !i.isIncome).reduce((s, i) => s + i.amount, 0);
      const envelope = discretionaryBuckets[discIdx].residualTotal;
      /** Matches headline math for this window: income − all scheduled outflows (incl. Services) − discretionary envelope. */
      const netDisplay = Math.round(incomeInWindow - scheduledOutInWindow - envelope);
      const d0 = new Date(today + "T12:00:00Z");
      d0.setUTCDate(d0.getUTCDate() + startDay);
      const d1 = new Date(today + "T12:00:00Z");
      d1.setUTCDate(d1.getUTCDate() + endDay);
      const rangeLabel = `${d0.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${d1.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      const discRows = discretionaryBuckets[discIdx].categories.filter((c) => c.residualAmount > 0).length;
      const label =
        startDay === 0
          ? `NEXT 30 DAYS · ${slice.length + discRows} ITEMS`
          : `${startDay}–${endDay} DAYS · ${slice.length + discRows} ITEMS`;
      return {
        label,
        rangeLabel,
        netDisplay,
        items: slice,
        discretionary: discretionaryBuckets[discIdx],
      };
    }

    const buckets: NearTermBucketDTO[] = [
      bucket(0, 30, 0),
      bucket(31, 60, 1),
      bucket(61, HORIZON_DAYS, 2),
    ];

    /** Timeline shows all projected flows including confirmed Services (orange); buckets stay uncluttered. */
    const timeline = buildNearTermTimeline(items, HORIZON_DAYS, 40);

    return NextResponse.json({
      today,
      horizonDays: HORIZON_DAYS,
      homeCurrency,
      summary: {
        /** Scheduled/project rows summed across the horizon (narrow definition). */
        scheduledOutflow: Math.round(scheduledOutflow),
        /** Estimated total cash leaving accounts: per-window scheduled amounts + discretionary residual envelope. */
        totalOutflow: forecastTotalOutflow,
        discretionaryEnvelopeTotal,
        totalIncome: totalIncomeRounded,
        net: totalIncomeRounded - forecastTotalOutflow,
        outflowCount: outflows.length,
        incomeCount: inflows.length,
      },
      alert,
      timeline,
      buckets,
    });
  } catch (err) {
    console.error("[forecast/near-term] GET error", err);
    return NextResponse.json({ error: "Failed to load near-term forecast" }, { status: 500 });
  }
}

function fmtMoney(n: number, currency: string): string {
  return new Intl.NumberFormat("en-CA", {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(n);
}
