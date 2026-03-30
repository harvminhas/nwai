/**
 * External Data Pipeline.
 *
 * Called by the scheduled cron job. Orchestrates:
 *   1. Fetch fresh external data (only if due)
 *   2. Store globally in externalData/{dataType}
 *   3. For each user with relevant profile → generate a personalized insight card
 *
 * The ONLY dependency on other layers is getFinancialProfile().
 */

import type * as Firestore from "firebase-admin/firestore";
import { getFinancialProfile } from "@/lib/financialProfile";
import { EXTERNAL_DATA_REGISTRY } from "./registry";
import { getExternalData, setExternalData, isDueForRefresh } from "./store";
import type { ExternalDataPoint, ExternalSignal } from "./types";

// ── Signal generation ──────────────────────────────────────────────────────────

function buildSignal(point: ExternalDataPoint): ExternalSignal | null {
  const changed = point.previousValue !== null && point.value !== point.previousValue;
  const direction = point.previousValue !== null
    ? point.value > point.previousValue ? "up" : "down"
    : "unchanged";

  switch (point.dataType) {
    case "canada-overnight-rate":
    case "canada-prime-rate": {
      if (!changed) return null; // no insight if rate didn't change
      const delta = point.previousValue !== null
        ? +(point.value - point.previousValue).toFixed(2)
        : 0;
      return {
        dataType: point.dataType,
        key: `${point.dataType}-${point.releaseDate}`,
        priority: Math.abs(delta) >= 0.5 ? "high" : "medium",
        data: {
          label: point.label,
          value: point.value,
          previousValue: point.previousValue,
          displayValue: point.displayValue,
          delta,
          direction,
          releaseDate: point.releaseDate,
          description: point.description,
          sourceUrl: point.sourceUrl,
        },
      };
    }

    case "canada-cpi":
    case "us-cpi": {
      // Always surface CPI — context is always useful even without change
      return {
        dataType: point.dataType,
        key: `${point.dataType}-${point.releaseDate}`,
        priority: point.value > 4 ? "high" : point.value > 2.5 ? "medium" : "low",
        data: {
          label: point.label,
          value: point.value,
          previousValue: point.previousValue,
          displayValue: point.displayValue,
          direction,
          releaseDate: point.releaseDate,
          description: point.description,
          sourceUrl: point.sourceUrl,
        },
      };
    }

    default:
      return null;
  }
}

// ── Insight card writer ────────────────────────────────────────────────────────

function signalToInsightCard(signal: ExternalSignal, point: ExternalDataPoint) {
  const data = signal.data as Record<string, unknown>;
  const direction = data.direction as string;
  const directionEmoji = direction === "up" ? "📈" : direction === "down" ? "📉" : "📊";
  const delta = typeof data.delta === "number" ? data.delta : null;

  let title = `${data.label}: ${data.displayValue}`;
  let body = data.description as string;

  if (delta !== null && delta !== 0) {
    const sign = delta > 0 ? "+" : "";
    title = `${data.label} ${direction === "up" ? "raised" : "cut"} to ${data.displayValue}`;
    body = `${sign}${delta}% change from ${data.previousValue}%. ${data.description}`;
  }

  return {
    id: signal.key,
    category: "external",
    title,
    body,
    emoji: directionEmoji,
    priority: signal.priority,
    dollarImpact: null,
    impactLabel: null,
    href: data.sourceUrl as string | null ?? null,
    dismissed: false,
    createdAt: new Date().toISOString(),
    source: "external" as const,
    dataType: signal.dataType,
    releaseDate: point.releaseDate,
  };
}

// ── Main pipeline ──────────────────────────────────────────────────────────────

/**
 * Refresh all external data sources that are due, then push personalized
 * insight cards to all relevant users.
 *
 * @param allUids  List of user IDs to check for relevance. Pass all active users.
 */
export async function runExternalDataPipeline(
  allUids: string[],
  db: Firestore.Firestore,
): Promise<{ refreshed: string[]; skipped: string[]; fetchErrors: string[]; usersNotified: number }> {
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const fetchErrors: string[] = [];
  const freshPoints: ExternalDataPoint[] = [];

  // ── 1. Fetch all data sources that are due for refresh ──────────────────────
  for (const descriptor of EXTERNAL_DATA_REGISTRY) {
    const existing = await getExternalData(descriptor.dataType, db);

    if (existing && !isDueForRefresh(existing)) {
      skipped.push(descriptor.dataType);
      freshPoints.push(existing); // use cached version for signal generation
      continue;
    }

    try {
      const point = await descriptor.fetch();
      await setExternalData(point, db);
      freshPoints.push(point);
      refreshed.push(descriptor.dataType);
      console.log(`[external] refreshed ${descriptor.dataType} = ${point.displayValue}`);
    } catch (err) {
      const msg = `${descriptor.dataType}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[external] failed to fetch ${descriptor.dataType}:`, err);
      fetchErrors.push(msg);
      if (existing) freshPoints.push(existing); // fall back to stale data
    }
  }

  if (freshPoints.length === 0) {
    return { refreshed, skipped, fetchErrors, usersNotified: 0 };
  }

  // ── 2. For each user, check relevance and write insight cards ───────────────
  let usersNotified = 0;

  for (const uid of allUids) {
    try {
      const profile = await getFinancialProfile(uid, db);
      const cards: ReturnType<typeof signalToInsightCard>[] = [];

      for (const point of freshPoints) {
        const descriptor = EXTERNAL_DATA_REGISTRY.find((d) => d.dataType === point.dataType);
        if (!descriptor) continue;
        if (!descriptor.relevant(profile)) continue;

        const signal = buildSignal(point);
        if (!signal) continue;

        cards.push(signalToInsightCard(signal, point));
      }

      if (cards.length === 0) continue;

      // Write cards — use set (not add) so re-runs are idempotent
      const batch = db.batch();
      const insightsRef = db.collection(`users/${uid}/agentInsights`);
      for (const card of cards) {
        batch.set(insightsRef.doc(card.id), card);
      }
      await batch.commit();
      usersNotified++;

      console.log(`[external] wrote ${cards.length} card(s) for uid=${uid}`);
    } catch (err) {
      console.error(`[external] failed for uid=${uid}:`, err);
    }
  }

  return { refreshed, skipped, fetchErrors, usersNotified };
}
