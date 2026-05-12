/**
 * GET /api/user/forecast/near-term
 *
 * 90-day cash-flow style projection: recurring/subscription charges, expected income,
 * manual cash commitments, and Tracker-backed Events / Set Payments.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { consolidateStatements, getYearMonth } from "@/lib/consolidate";
import { buildAccountSlug } from "@/lib/accountSlug";
import { merchantSlug } from "@/lib/applyRules";
import type { ParsedStatementData } from "@/lib/types";
import type { SubscriptionRecord } from "@/lib/insights/types";
import type { SubscriptionFrequency } from "@/lib/insights/types";
import type { UserEvent, TxTag } from "@/lib/events/types";
import {
  effectiveSubscriptionAmount,
  effectiveSubscriptionFrequency,
  nextSubscriptionOccurrence,
} from "@/lib/subscriptionRegistry";
import { detectFrequency } from "@/lib/incomeEngine";
import { projectNextDates, toDateStr } from "@/lib/projectionEngine";
import { INCOME_TRANSFER_RE } from "@/lib/spendingMetrics";
import { resolveCanonical } from "@/lib/sourceMappings";
import type { SourceMapping } from "@/lib/sourceMappings";
import { txFingerprint } from "@/lib/txFingerprint";

const HORIZON_DAYS = 90;

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
  netDisplay: number;
  items: NearTermItemDTO[];
}

function subscriptionEligibleForUpcoming(rec: SubscriptionRecord): boolean {
  if (rec.upcomingSuppressed) return false;
  return rec.status === "confirmed" || rec.status === "user_confirmed";
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysBetween(a: string, b: string): number {
  const ms = new Date(b + "T12:00:00Z").getTime() - new Date(a + "T12:00:00Z").getTime();
  return Math.round(ms / 86_400_000);
}

function normKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 30);
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
    const next = new Date(dateStr.slice(0, 10) + "T12:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    anchor = toDateStr(next);
  }
  return results;
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
    ] = await Promise.all([
      getFinancialProfile(uid, db),
      db.collection(`users/${uid}/subscriptions`).get(),
      db.collection(`users/${uid}/events`).orderBy("createdAt", "desc").get(),
      db.collection(`users/${uid}/txTags`).get(),
      db.collection(`users/${uid}/cashCommitments`).get(),
      db.collection(`users/${uid}/sourceMappings`).get(),
    ]);

    const subscriptionRecords = subscriptionsSnap.docs.map((d) => d.data() as SubscriptionRecord);
    const subscriptionSlugs = new Set(subscriptionRecords.map((r) => r.merchantSlug));
    const sourceMappings = sourceMappingsSnap.docs.map((d) => d.data() as SourceMapping);

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

    const items: NearTermItemDTO[] = [];
    const seenMerchants = new Set<string>();

    const SUB_HORIZON: Partial<Record<SubscriptionFrequency, number>> = {
      weekly: HORIZON_DAYS,
      biweekly: HORIZON_DAYS,
      monthly: HORIZON_DAYS,
      quarterly: HORIZON_DAYS,
      annual: HORIZON_DAYS,
    };

    // ── Subscriptions (confirmed registry) ───────────────────────────────────
    for (const rec of subscriptionRecords) {
      if (!subscriptionEligibleForUpcoming(rec)) continue;
      const effAmt = effectiveSubscriptionAmount(rec);
      const effFreq = effectiveSubscriptionFrequency(rec);
      if (effAmt == null || !effFreq) continue;
      const nk = normKey(rec.name);
      if (seenMerchants.has(`sub-${nk}`)) continue;

      const anchor = (rec.lastSeenAt ?? rec.firstSeenAt ?? today).slice(0, 10);
      const horizonCap = SUB_HORIZON[effFreq] ?? HORIZON_DAYS;
      const occurrences = enumerateSubscriptionCharges(anchor, effFreq, today, Math.min(horizonCap, HORIZON_DAYS));
      if (occurrences.length === 0) continue;

      seenMerchants.add(`sub-${nk}`);
      let idx = 0;
      for (const occ of occurrences) {
        const amt = effAmt;
        const confLabel =
          rec.lockedFields?.includes("amount") || rec.status === "user_confirmed"
            ? "fixed"
            : "estimate";
        items.push({
          id: `sub-${rec.merchantSlug}-${occ.dateStr}-${idx++}`,
          kind: "pattern",
          title: rec.name,
          subtitle: `Detected · ${effFreq}${rec.occurrenceCount ? ` · ${rec.occurrenceCount} charges seen` : ""}`,
          date: occ.dateStr,
          daysFromNow: occ.daysFromNow,
          amount: Math.round(amt),
          isIncome: false,
          amountLabel: confLabel === "fixed" ? "fixed" : "estimate",
          href: `/account/spending/merchant/${rec.merchantSlug}`,
        });
      }
    }

    // ── AI subscriptions from consolidated (deduped) ───────────────────────
    const aiSubs = consolidated?.subscriptions ?? [];
    for (const sub of aiSubs) {
      const slug = merchantSlug(sub.name);
      if (slug && subscriptionSlugs.has(slug)) continue;
      const nk = normKey(sub.name);
      if (seenMerchants.has(`aisub-${nk}`)) continue;
      seenMerchants.add(`aisub-${nk}`);
      const freqRaw = (sub.frequency ?? "monthly").toLowerCase();
      let freq: SubscriptionFrequency = "monthly";
      if (freqRaw.includes("week") && !freqRaw.includes("bi")) freq = "weekly";
      else if (freqRaw.includes("bi") || freqRaw.includes("2 week")) freq = "biweekly";
      else if (freqRaw.includes("quarter")) freq = "quarterly";
      else if (freqRaw.includes("year") || freqRaw.includes("annual")) freq = "annual";

      const anchor = consolidated?.statementDate?.slice(0, 10) ?? `${thisMonth}-15`;
      const amount = sub.amount ?? 0;
      if (amount <= 0) continue;

      const occurrences = enumerateSubscriptionCharges(anchor, freq, today, HORIZON_DAYS);
      let j = 0;
      for (const occ of occurrences) {
        items.push({
          id: `aisub-${slug}-${occ.dateStr}-${j++}`,
          kind: "pattern",
          title: sub.name,
          subtitle: `Detected · ${freq}`,
          date: occ.dateStr,
          daysFromNow: occ.daysFromNow,
          amount: Math.round(amount),
          isIncome: false,
          amountLabel: "estimate",
          href: `/account/spending/merchant/${slug}`,
        });
      }
    }

    // ── Cash commitments (exclude tracker-sourced duplicates) ──────────────
    const cashItems = cashSnap.docs.map((d) => d.data() as {
      id: string;
      name: string;
      amount: number;
      frequency: string;
      category?: string;
      nextDate?: string;
      sourceVisitId?: string;
      sourceEventId?: string;
    });
    for (const c of cashItems) {
      if (c.sourceVisitId || c.sourceEventId) continue;
      if (!c.nextDate) continue;
      const diff = daysBetween(today, c.nextDate);
      if (diff > HORIZON_DAYS || diff < -3) continue;
      const nk = normKey(c.name);
      if (seenMerchants.has(`cash-${nk}`)) continue;
      seenMerchants.add(`cash-${nk}`);
      items.push({
        id: `cash-${c.id}`,
        kind: "cash",
        title: c.name,
        subtitle: c.frequency === "once" ? `Cash · ${c.category ?? "One-off"}` : `${c.frequency} · ${c.category ?? ""}`,
        date: c.nextDate,
        daysFromNow: diff,
        amount: Math.round(c.amount),
        isIncome: false,
        amountLabel: "scheduled",
        href: "/account/spending?tab=cash",
      });
    }

    // ── Expected income (frequency-aware) ───────────────────────────────────
    const incomeBySource = new Map<string, typeof incomeTxns>();
    for (const txn of incomeTxns) {
      const src = txn.source || txn.description || "income";
      if (INCOME_TRANSFER_RE.test(src)) continue;
      const canonical = resolveCanonical(src, sourceMappings);
      const key = normKey(canonical);
      const arr = incomeBySource.get(key) ?? [];
      arr.push(txn);
      incomeBySource.set(key, arr);
    }

    for (const [, txns] of incomeBySource) {
      if (txns.length < 2) continue;
      const sortedByDate = [...txns].sort((a, b) => b.date.localeCompare(a.date));
      const lastDate = sortedByDate[0].date;
      const allDates = txns.map((t) => t.date).filter(Boolean).sort();
      const freq = detectFrequency(allDates);
      const latestAmt = sortedByDate.find((t) => t.amount > 0)?.amount ?? 0;
      if (latestAmt <= 0) continue;

      const sourceName = resolveCanonical(
        txns[0].source || txns[0].description || "Income",
        sourceMappings,
      );

      if (freq.frequency !== "irregular" && freq.medianGap && freq.medianGap >= 5) {
        const projections = projectNextDates(lastDate, freq.medianGap, 24, true);
        let pi = 0;
        for (const p of projections) {
          if (p.daysFromToday > HORIZON_DAYS) break;
          if (p.daysFromToday < -3) continue;
          const cvHint =
            txns.length >= 6 ? "consistent pattern" : `${txns.length} deposits`;
          items.push({
            id: `income-${normKey(sourceName)}-${p.dateStr}-${pi++}`,
            kind: "income",
            title: sourceName,
            subtitle:
              p.daysFromToday < 0
                ? `May have landed · ${freq.medianGap}-day cadence · ${cvHint}`
                : `Detected · ${freq.frequency === "bi-weekly" ? "bi-weekly" : freq.frequency} · ${cvHint}`,
            date: p.dateStr,
            daysFromNow: p.daysFromToday,
            amount: Math.round(latestAmt),
            isIncome: true,
            amountLabel: txns.length >= 6 ? "high confidence" : "estimate",
            href: "/account/income",
          });
        }
      } else {
        const days = allDates.map((d) => parseInt(d.slice(8, 10)));
        const medianDay = [...days].sort((a, b) => a - b)[Math.floor(days.length / 2)];
        const daysInMo = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
        const targetDay = Math.min(medianDay, daysInMo);
        const mm = String(now.getMonth() + 1).padStart(2, "0");
        const expectedDate = `${now.getFullYear()}-${mm}-${String(targetDay).padStart(2, "0")}`;
        const diff = daysBetween(today, expectedDate);
        if (diff <= HORIZON_DAYS && diff >= -3) {
          items.push({
            id: `income-dom-${normKey(sourceName)}`,
            kind: "income",
            title: sourceName,
            subtitle: `Detected · monthly · ${txns.length} deposits`,
            date: expectedDate,
            daysFromNow: diff,
            amount: Math.round(latestAmt),
            isIncome: true,
            amountLabel: txns.length >= 6 ? "high confidence" : "estimate",
            href: "/account/income",
          });
        }
      }
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

    const outflows = items.filter((i) => !i.isIncome && i.daysFromNow >= 0 && i.daysFromNow <= HORIZON_DAYS);
    const inflows = items.filter((i) => i.isIncome && i.daysFromNow >= 0 && i.daysFromNow <= HORIZON_DAYS);

    const totalOutflow = outflows.reduce((s, i) => s + i.amount, 0);
    const totalIncome = inflows.reduce((s, i) => s + i.amount, 0);

    const alert = detectHeavyWeekAlert(items.filter((i) => i.daysFromNow >= -3), homeCurrency);

    function bucket(startDay: number, endDay: number): NearTermBucketDTO {
      const slice = items.filter((i) => i.daysFromNow >= startDay && i.daysFromNow <= endDay);
      const net =
        slice.filter((i) => i.isIncome).reduce((s, i) => s + i.amount, 0) -
        slice.filter((i) => !i.isIncome).reduce((s, i) => s + i.amount, 0);
      const d0 = new Date(today + "T12:00:00Z");
      d0.setUTCDate(d0.getUTCDate() + startDay);
      const d1 = new Date(today + "T12:00:00Z");
      d1.setUTCDate(d1.getUTCDate() + endDay);
      const rangeLabel = `${d0.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${d1.toLocaleDateString("en-US", { month: "short", day: "numeric" })}`;
      const label =
        startDay === 0 ? `NEXT 30 DAYS · ${slice.length} ITEMS` : `${startDay}–${endDay} DAYS · ${slice.length} ITEMS`;
      return { label, rangeLabel, netDisplay: net, items: slice };
    }

    const buckets: NearTermBucketDTO[] = [bucket(0, 30), bucket(31, 60), bucket(61, HORIZON_DAYS)];

    const timeline = items
      .filter((i) => i.daysFromNow >= 0 && i.daysFromNow <= HORIZON_DAYS)
      .slice(0, 40);

    return NextResponse.json({
      today,
      horizonDays: HORIZON_DAYS,
      homeCurrency,
      summary: {
        totalOutflow,
        totalIncome,
        net: totalIncome - totalOutflow,
        outflowCount: outflows.length,
        incomeCount: inflows.length,
      },
      alert,
      timeline,
      buckets,
      typicalMonthlyExpenses: profile.typicalMonthly?.median ?? 0,
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
