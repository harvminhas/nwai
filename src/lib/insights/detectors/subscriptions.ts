/**
 * Subscription detector.
 *
 * Reads expense transaction history, identifies recurring merchant patterns,
 * and maintains the users/{uid}/subscriptions collection:
 *   - suggested:       seen 1 time, pattern not yet confirmed
 *   - confirmed:       seen SUB_CONFIRM_THRESHOLD+ times with consistent interval
 *   - user_confirmed:  user has explicitly confirmed — never auto-updated
 *
 * Returns signals only when something actionable changes (new confirmation,
 * price increase). Signals drive card generation in the pipeline.
 */

import { merchantSlug as toSlug } from "@/lib/applyRules";
import type { InsightDetector, DetectorContext, DetectedSignal, InsightEvent, SubscriptionRecord, SubscriptionFrequency } from "../types";
import { SUB_CONFIRM_THRESHOLD } from "../types";

// ── frequency detection ───────────────────────────────────────────────────────

function detectFrequency(intervals: number[]): SubscriptionFrequency | null {
  if (intervals.length === 0) return null;
  const avg = intervals.reduce((s, v) => s + v, 0) / intervals.length;
  if (avg >= 5   && avg <= 9)   return "weekly";
  if (avg >= 12  && avg <= 16)  return "biweekly";
  if (avg >= 25  && avg <= 35)  return "monthly";
  if (avg >= 80  && avg <= 100) return "quarterly";
  if (avg >= 335 && avg <= 395) return "annual";
  return null;
}

// ── detector ──────────────────────────────────────────────────────────────────

const AMOUNT_CHANGE_THRESHOLD = 0.05; // 5% change triggers a price-change signal

export const subscriptionsDetector: InsightDetector = {
  name: "subscriptions",
  handles: ["statement.parsed", "full.refresh"],
  minMonths: 1,

  async run(ctx: DetectorContext, _event: InsightEvent): Promise<DetectedSignal[]> {
    const { uid, db, expenseTxns, relevantMonths } = ctx;
    const signals: DetectedSignal[] = [];
    const now = new Date().toISOString();
    const relevantSet = new Set(relevantMonths);

    // Group transactions by merchant slug within the relevant window.
    // Only process Subscriptions-category transactions — other recurring patterns
    // (groceries, gas, etc.) must be user-confirmed from the merchant page.
    const byMerchant = new Map<string, { name: string; dates: string[]; amounts: number[] }>();
    for (const txn of expenseTxns) {
      if (!relevantSet.has(txn.txMonth)) continue;
      if ((txn.category ?? "").toLowerCase() !== "subscriptions") continue;
      const slug = toSlug(txn.merchant);
      if (!slug) continue;
      const entry = byMerchant.get(slug);
      if (entry) {
        entry.dates.push(txn.date);
        entry.amounts.push(txn.amount);
      } else {
        byMerchant.set(slug, { name: txn.merchant, dates: [txn.date], amounts: [txn.amount] });
      }
    }

    const subsRef = db.collection("users").doc(uid).collection("subscriptions");

    for (const [slug, { name, dates, amounts }] of byMerchant) {
      if (dates.length < 1) continue;

      // Detect recurrence pattern
      const sorted = [...dates].sort();
      const intervals: number[] = [];
      for (let i = 1; i < sorted.length; i++) {
        const ms   = new Date(sorted[i]).getTime() - new Date(sorted[i - 1]).getTime();
        intervals.push(ms / (1000 * 60 * 60 * 24));
      }
      const frequency = detectFrequency(intervals);
      // Multiple occurrences without a matching interval pattern: skip (e.g. irregular)
      if (dates.length > 1 && !frequency) continue;
      // One transaction is not a recurrence — do not create a "monthly" placeholder row
      if (dates.length === 1) continue;

      const avgAmount  = amounts.reduce((s, v) => s + v, 0) / amounts.length;
      const firstSeen  = sorted[0];
      const lastSeen   = sorted[sorted.length - 1];
      const isConfirmed = dates.length >= SUB_CONFIRM_THRESHOLD && frequency !== null;

      const snap = await subsRef.doc(slug).get();

      if (!snap.exists) {
        // ── New merchant: create record ────────────────────────────────────
        const record: SubscriptionRecord = {
          merchantSlug:       slug,
          name,
          status:             isConfirmed ? "confirmed" : "suggested",
          suggestedAmount:    avgAmount,
          suggestedFrequency: frequency!,
          amount:             isConfirmed ? avgAmount : null,
          frequency:          isConfirmed ? frequency : null,
          lockedFields:       [],
          firstSeenAt:        firstSeen,
          lastSeenAt:         lastSeen,
          occurrenceCount:    dates.length,
          confirmedBy:        isConfirmed ? "insights" : null,
          confirmedAt:        isConfirmed ? now : null,
          createdAt:          now,
          updatedAt:          now,
        };
        await subsRef.doc(slug).set(record);

        if (isConfirmed) {
          signals.push({
            category: "subscriptions",
            key:      `sub-new-confirmed-${slug}`,
            priority: "medium",
            data:     { name, amount: avgAmount, frequency, slug, occurrenceCount: dates.length },
          });
        }

      } else {
        // ── Existing record: update if permitted ───────────────────────────
        const existing = snap.data() as SubscriptionRecord;

        // Never auto-update user_confirmed records
        if (existing.status === "user_confirmed") continue;

        const updates: Record<string, unknown> = {
          lastSeenAt:         lastSeen,
          occurrenceCount:    dates.length,
          suggestedAmount:    avgAmount,
          suggestedFrequency: frequency!,
          updatedAt:          now,
        };

        if (existing.status === "suggested" && isConfirmed) {
          // Promote to confirmed
          updates.status      = "confirmed";
          updates.confirmedBy = "insights";
          updates.confirmedAt = now;
          if (!existing.lockedFields.includes("amount"))    updates.amount    = avgAmount;
          if (!existing.lockedFields.includes("frequency")) updates.frequency = frequency;

          signals.push({
            category: "subscriptions",
            key:      `sub-confirmed-${slug}`,
            priority: "medium",
            data:     { name, amount: avgAmount, frequency, slug, occurrenceCount: dates.length },
          });

        } else if (existing.status === "confirmed") {
          // Check for amount change
          const prevAmount = existing.amount ?? existing.suggestedAmount;
          const changePct  = Math.abs(avgAmount - prevAmount) / (prevAmount || 1);

          if (!existing.lockedFields.includes("amount"))    updates.amount    = avgAmount;
          if (!existing.lockedFields.includes("frequency")) updates.frequency = frequency ?? existing.frequency;

          if (changePct > AMOUNT_CHANGE_THRESHOLD) {
            signals.push({
              category: "subscriptions",
              key:      `sub-price-change-${slug}`,
              priority: changePct > 0.2 ? "high" : "medium",
              data: {
                name,
                previousAmount: prevAmount,
                newAmount:      avgAmount,
                changePercent:  Math.round(changePct * 100),
                frequency:      frequency ?? existing.frequency,
                slug,
              },
            });
          }
        }

        await subsRef.doc(slug).update(updates);
      }
    }

    return signals;
  },
};
