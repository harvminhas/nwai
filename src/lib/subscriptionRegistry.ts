/**
 * Firestore-backed subscription / recurring registry (users/{uid}/subscriptions).
 *
 * - Statement AI subs are merged here by the insights pipeline (no parsedData writes from detectors).
 * - User recurring marks (recurringRules API) promote to user_confirmed + locked fields.
 * - Insights / upcoming read this collection as the source of truth (with fallbacks for legacy gaps).
 */

import type * as Firestore from "firebase-admin/firestore";
import { merchantSlug } from "@/lib/applyRules";
import type { ParsedStatementData } from "@/lib/types";
import type { SubscriptionRecord, SubscriptionFrequency, SubscriptionStatus } from "@/lib/insights/types";
import { toDateStr } from "@/lib/projectionEngine";

export type RecurringRulePayload = {
  merchant: string;
  amount: number;
  frequency: string;
  category?: string | null;
  slug: string;
};

/** Map AI / rule strings to canonical subscription frequency. */
export function mapToSubscriptionFrequency(raw: string | undefined | null): SubscriptionFrequency {
  const s = (raw ?? "monthly").toLowerCase().trim();
  if (s.includes("week") && !s.includes("bi") && !s.includes("2")) return "weekly";
  if (s.includes("bi") || s.includes("2 week") || s === "biweekly" || s === "bi-weekly") return "biweekly";
  if (s.includes("year") || s.includes("annual")) return "annual";
  if (s.includes("quarter")) return "quarterly";
  return "monthly";
}

function addCalendarMonths(d: Date, n: number): Date {
  const r = new Date(d);
  r.setUTCMonth(r.getUTCMonth() + n);
  return r;
}

/**
 * Next charge on or after (today - 3d), stepping from anchor by calendar-aware cadence.
 */
export function nextSubscriptionOccurrence(
  anchorYmd: string,
  freq: SubscriptionFrequency,
  todayYmd: string,
): { dateStr: string; daysFromNow: number } {
  let d = new Date(anchorYmd.slice(0, 10) + "T12:00:00Z");
  const today = new Date(todayYmd.slice(0, 10) + "T12:00:00Z");
  const horizon = new Date(today);
  horizon.setUTCDate(horizon.getUTCDate() - 3);

  let guard = 0;
  while (d < horizon && guard < 200) {
    switch (freq) {
      case "weekly":
        d = new Date(d.getTime() + 7 * 86400000);
        break;
      case "biweekly":
        d = new Date(d.getTime() + 14 * 86400000);
        break;
      case "monthly":
        d = addCalendarMonths(d, 1);
        break;
      case "quarterly":
        d = addCalendarMonths(d, 3);
        break;
      case "annual":
        d = addCalendarMonths(d, 12);
        break;
      default:
        d = addCalendarMonths(d, 1);
    }
    guard++;
  }

  const dateStr = toDateStr(d);
  const daysFromNow = Math.round((d.getTime() - today.getTime()) / 86400000);
  return { dateStr, daysFromNow };
}

export function effectiveSubscriptionAmount(rec: SubscriptionRecord): number | null {
  const lockedAmt = rec.lockedFields?.includes("amount") || rec.status === "user_confirmed";
  const v = lockedAmt ? rec.amount : (rec.amount ?? rec.suggestedAmount);
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

export function effectiveSubscriptionFrequency(rec: SubscriptionRecord): SubscriptionFrequency | null {
  const lockedFreq = rec.lockedFields?.includes("frequency") || rec.status === "user_confirmed";
  const f = lockedFreq ? rec.frequency : (rec.frequency ?? rec.suggestedFrequency);
  return f ?? null;
}

/**
 * Merge AI-extracted subscriptions from completed statements into Firestore.
 * Does not touch user_confirmed docs. Respects lockedFields on amount/frequency.
 */
export async function syncStatementAiSubscriptions(
  uid: string,
  db: Firestore.Firestore,
  docs: { yearMonth: string; parsed: ParsedStatementData }[],
): Promise<void> {
  const bySlug = new Map<string, { name: string; amount: number; frequency: string; anchorYmd: string }>();
  const sorted = [...docs].sort((a, b) => b.yearMonth.localeCompare(a.yearMonth));

  for (const { yearMonth, parsed } of sorted) {
    const anchorYmd = parsed.statementDate?.slice(0, 10) ?? `${yearMonth}-15`;
    for (const sub of parsed.subscriptions ?? []) {
      const slug = merchantSlug(sub.name);
      if (!slug || bySlug.has(slug)) continue;
      bySlug.set(slug, {
        name: sub.name,
        amount: sub.amount,
        frequency: sub.frequency,
        anchorYmd,
      });
    }
  }

  const subsRef = db.collection("users").doc(uid).collection("subscriptions");
  const now = new Date().toISOString();

  for (const [slug, { name, amount, frequency, anchorYmd }] of bySlug) {
    const snap = await subsRef.doc(slug).get();
    const freqNorm = mapToSubscriptionFrequency(frequency);

    if (!snap.exists) {
      const record: SubscriptionRecord = {
        merchantSlug: slug,
        name,
        status: "suggested",
        suggestedAmount: amount,
        suggestedFrequency: freqNorm,
        amount: null,
        frequency: null,
        lockedFields: [],
        statementAiTagged: true,
        firstSeenAt: anchorYmd,
        lastSeenAt: anchorYmd,
        occurrenceCount: 0,
        confirmedBy: null,
        confirmedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      await subsRef.doc(slug).set(record);
      continue;
    }

    const existing = snap.data() as SubscriptionRecord;
    if (existing.status === "user_confirmed") continue;
    if ((existing as { upcomingSuppressed?: boolean }).upcomingSuppressed) continue;

    const updates: Record<string, unknown> = {
      statementAiTagged: true,
      updatedAt: now,
      name,
    };
    if (!existing.lockedFields?.includes("amount")) {
      updates.suggestedAmount = amount;
    }
    if (!existing.lockedFields?.includes("frequency")) {
      updates.suggestedFrequency = freqNorm;
    }
    const lastSeen = existing.lastSeenAt && existing.lastSeenAt > anchorYmd ? existing.lastSeenAt : anchorYmd;
    updates.lastSeenAt = lastSeen;
    await subsRef.doc(slug).update(updates);
  }
}

/** Upsert users/{uid}/subscriptions/{slug} from a spending-page recurring rule. */
export async function applyRecurringRuleToSubscriptionDoc(
  uid: string,
  db: Firestore.Firestore,
  rule: RecurringRulePayload,
): Promise<void> {
  const subsRef = db.collection("users").doc(uid).collection("subscriptions");
  const now = new Date().toISOString();
  const slug = rule.slug;

  if (rule.frequency === "never") {
    await subsRef.doc(slug).set(
      { upcomingSuppressed: true, updatedAt: now, merchantSlug: slug },
      { merge: true },
    );
    return;
  }

  const freq = mapToSubscriptionFrequency(rule.frequency);
  const snap = await subsRef.doc(slug).get();

  const common = {
    merchantSlug: slug,
    name: rule.merchant,
    status: "user_confirmed" as SubscriptionStatus,
    amount: rule.amount,
    frequency: freq,
    suggestedAmount: rule.amount,
    suggestedFrequency: freq,
    lockedFields: ["amount", "frequency"],
    confirmedBy: "user" as const,
    confirmedAt: now,
    updatedAt: now,
    upcomingSuppressed: false,
  };

  if (!snap.exists) {
    const record: SubscriptionRecord = {
      ...common,
      firstSeenAt: now.slice(0, 10),
      lastSeenAt: now.slice(0, 10),
      occurrenceCount: 0,
      createdAt: now,
      statementAiTagged: false,
    };
    await subsRef.doc(slug).set(record);
    return;
  }

  const ex = snap.data() as SubscriptionRecord;
  await subsRef.doc(slug).set(
    {
      ...ex,
      ...common,
      firstSeenAt: ex.firstSeenAt ?? now.slice(0, 10),
      lastSeenAt: ex.lastSeenAt ?? now.slice(0, 10),
      occurrenceCount: ex.occurrenceCount ?? 0,
      createdAt: ex.createdAt ?? now,
    },
    { merge: true },
  );
}

/** User removed recurring mark — allow insights pipeline to manage the row again. */
export async function releaseSubscriptionUserLock(uid: string, db: Firestore.Firestore, slug: string): Promise<void> {
  const ref = db.collection("users").doc(uid).collection("subscriptions").doc(slug);
  const snap = await ref.get();
  if (!snap.exists) return;
  const ex = snap.data() as SubscriptionRecord;
  const now = new Date().toISOString();
  await ref.set(
    {
      ...ex,
      status: (ex.occurrenceCount ?? 0) >= 2 ? "confirmed" : "suggested",
      lockedFields: [],
      confirmedBy: null,
      confirmedAt: null,
      frequency: null,
      amount: null,
      upcomingSuppressed: false,
      updatedAt: now,
    },
    { merge: true },
  );
}
