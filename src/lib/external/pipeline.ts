/**
 * External Data Pipeline.
 *
 * Two independent concerns:
 *
 * 1. refreshExternalData(db, options)
 *    - Fetches all registered sources that are due
 *    - Stores results globally in externalData/{dataType}
 *    - Called by the scheduled cron job (once for all users)
 *
 * 2. generateExternalCardsForUser(uid, db)
 *    - Reads whatever external data is already stored
 *    - Applies personalization against that user's FinancialProfile
 *    - Writes cards to users/{uid}/agentInsights
 *    - Called from the insights pipeline after every statement parse
 *
 * The ONLY dependency on other layers is getFinancialProfile().
 */

import type * as Firestore from "firebase-admin/firestore";
import { getFinancialProfile } from "@/lib/financialProfile";
import type { FinancialProfileCache } from "@/lib/financialProfile";
import { EXTERNAL_DATA_REGISTRY, detectCountry } from "./registry";
import { getExternalData, setExternalData, isDueForRefresh } from "./store";
import type { ExternalDataPoint, ExternalSignal } from "./types";
import { personalizeRateSignal } from "./signals/rateSignal";
import { personalizeCpiSignal } from "./signals/cpiSignal";
import { personalizeFoodCpiSignal } from "./signals/foodCpiSignal";

// ── Signal generation ──────────────────────────────────────────────────────────

function buildSignal(
  point: ExternalDataPoint,
  profile: FinancialProfileCache,
): ExternalSignal | null {
  const direction =
    point.previousValue !== null
      ? point.value > point.previousValue
        ? "up"
        : point.value < point.previousValue
          ? "down"
          : "unchanged"
      : "unchanged";

  switch (point.dataType) {
    case "canada-overnight-rate":
    case "canada-prime-rate":
    case "us-federal-funds-rate": {
      const ctx = personalizeRateSignal(profile, point);
      // Always surface the rate — even if unchanged it gives useful context.
      const priority =
        Math.abs(ctx.delta) >= 0.5 ? "high"
        : ctx.delta !== 0          ? "medium"
        :                            "low";
      return {
        dataType: point.dataType,
        key: `${point.dataType}-${point.releaseDate}`,
        priority,
        data: {
          label: point.label,
          value: point.value,
          previousValue: point.previousValue,
          displayValue: point.displayValue,
          delta: ctx.delta,
          direction: ctx.direction,
          releaseDate: point.releaseDate,
          description: point.description,
          sourceUrl: point.sourceUrl,
          variableBalanceTotal: ctx.variableBalanceTotal,
          accountCount: ctx.accountCount,
          monthlyImpact: ctx.monthlyImpact,
          accounts: ctx.accounts,
        },
      };
    }

    case "canada-cpi":
    case "us-cpi": {
      const ctx = personalizeCpiSignal(profile, point);
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
          userSpendChange: ctx.userSpendChange,
          spendVsInflation: ctx.spendVsInflation,
          recentMonthlySpend: ctx.recentMonthlySpend,
          hasYoyHistory: ctx.hasYoyHistory,
        },
      };
    }

    case "canada-food-cpi":
    case "us-food-cpi": {
      const ctx = personalizeFoodCpiSignal(profile, point);
      return {
        dataType: point.dataType,
        key: `${point.dataType}-${point.releaseDate}`,
        priority: (ctx.spendVsInflation ?? 0) > 5 ? "high" : (ctx.spendVsInflation ?? 0) > 0 ? "medium" : "low",
        data: {
          label: point.label,
          value: point.value,
          previousValue: point.previousValue,
          displayValue: point.displayValue,
          direction,
          releaseDate: point.releaseDate,
          description: point.description,
          sourceUrl: point.sourceUrl,
          foodInflationPct:       ctx.foodInflationPct,
          userGroceryChangePct:   ctx.userGroceryChangePct,
          spendVsInflation:       ctx.spendVsInflation,
          recentMonthlyGroceries: ctx.recentMonthlyGroceries,
          monthlyGap:             ctx.monthlyGap,
          hasYoyHistory:          ctx.hasYoyHistory,
        },
      };
    }

    default:
      return null;
  }
}

// ── Insight card writer ────────────────────────────────────────────────────────

function dataSourceLabel(dataType: string): string {
  switch (dataType) {
    case "canada-overnight-rate":
    case "canada-prime-rate":   return "Bank of Canada";
    case "canada-cpi":          return "Statistics Canada";
    case "us-federal-funds-rate": return "Federal Reserve";
    case "us-cpi":              return "BLS";
    default:                    return "External";
  }
}

function dataPeriodLabel(releaseDate: string): string {
  const d = new Date(releaseDate + "T12:00:00Z");
  if (isNaN(d.getTime())) return releaseDate;
  return d.toLocaleDateString("en-CA", { month: "short", year: "numeric" }).toUpperCase();
}

function signalToInsightCard(signal: ExternalSignal, point: ExternalDataPoint) {
  const d = signal.data as Record<string, unknown>;
  const direction = d.direction as string;
  const directionEmoji = direction === "up" ? "📈" : direction === "down" ? "📉" : "📊";
  const delta = typeof d.delta === "number" ? d.delta : null;

  const dataSource = dataSourceLabel(point.dataType);
  const dataPeriod = dataPeriodLabel(point.releaseDate);

  let title = `${d.label}: ${d.displayValue}`;
  let body = d.description as string;
  let dollarImpact: number | null = null;
  let impactLabel: string | null = null;

  // Extra structured fields for rich card rendering
  const extra: Record<string, unknown> = { dataSource, dataPeriod };

  // ── Rate signals ──────────────────────────────────────────────────────────
  if (delta !== null) {
    const balTotal = typeof d.variableBalanceTotal === "number" ? d.variableBalanceTotal : 0;
    const monthly  = typeof d.monthlyImpact === "number" ? d.monthlyImpact : 0;

      extra.rateCurrent   = d.value;
      extra.ratePrevious  = d.previousValue;
      extra.rateDelta     = delta;
      extra.rateDirection = direction;
      extra.variableBalanceTotal = balTotal;
      extra.monthlyImpact = monthly;
      // Per-account breakdown from rateSignal
      extra.rateAccounts  = d.accounts;

    if (delta !== 0) {
      const sign = delta > 0 ? "+" : "";
      const verb = direction === "up" ? "raised" : "cut";
      const rateAuthority = point.dataType.startsWith("canada") ? "Bank of Canada" : "Federal Reserve";
      const currency = point.dataType.startsWith("canada") ? "CAD" : "USD";
      const locale   = point.dataType.startsWith("canada") ? "en-CA" : "en-US";
      title = `${rateAuthority} ${verb} rates to ${d.displayValue}`;

      if (balTotal > 0 && monthly > 0) {
        const formatted = new Intl.NumberFormat(locale, {
          style: "currency", currency, maximumFractionDigits: 0,
        }).format(balTotal);
        body = `${sign}${delta}% change. Based on your ~${formatted} in variable-rate debt, your monthly interest cost could ${direction === "up" ? "rise" : "fall"} by ~$${monthly}.`;
        dollarImpact = direction === "up" ? monthly : -monthly;
        impactLabel = "per month";
      } else {
        body = `${sign}${delta}% change from ${d.previousValue}%. ${d.description}`;
      }
    } else {
      const currency = point.dataType.startsWith("canada") ? "CAD" : "USD";
      const locale   = point.dataType.startsWith("canada") ? "en-CA" : "en-US";
      title = `${d.label} holding at ${d.displayValue}`;
      body = balTotal > 0
        ? `No change this cycle. Your variable-rate debt of ${new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: 0 }).format(balTotal)} is unaffected.`
        : `No change this cycle. ${d.description}`;
    }
  }

  // ── CPI signals (all-items) ────────────────────────────────────────────────
  if (point.dataType === "canada-cpi" || point.dataType === "us-cpi") {
    const inflationPct  = typeof d.value === "number" ? d.value : null;
    const userSpendPct  = typeof d.userSpendChange === "number" ? d.userSpendChange : null;
    const vsInflation   = typeof d.spendVsInflation === "number" ? d.spendVsInflation : null;
    const monthlySpend  = typeof d.recentMonthlySpend === "number" ? d.recentMonthlySpend : 0;
    const hasHistory    = !!d.hasYoyHistory;

    extra.inflationPct  = inflationPct;
    extra.userSpendPct  = userSpendPct;
    extra.vsInflation   = vsInflation;
    extra.monthlySpend  = monthlySpend;

    if (inflationPct !== null && userSpendPct !== null && vsInflation !== null && hasHistory) {
      const ratio  = inflationPct > 0 ? Math.round(userSpendPct / inflationPct) : null;
      if (vsInflation > 0 && ratio && ratio > 1) {
        title = `Your spending is outpacing inflation by ${ratio}×`;
      } else if (vsInflation > 0) {
        title = `Your spending is growing faster than inflation`;
      } else {
        title = `Your spending is tracking below inflation`;
      }
      body = `Inflation is ${inflationPct}% YoY. Your core spending grew ${userSpendPct > 0 ? "+" : ""}${userSpendPct}% — ${Math.abs(vsInflation).toFixed(1)}% ${vsInflation > 0 ? "above" : "below"} the official rate.`;
      if (vsInflation > 0 && monthlySpend > 0) {
        dollarImpact = Math.round(monthlySpend * (vsInflation / 100));
        impactLabel  = "mo above inflation";
      }
    } else {
      title = `Inflation at ${d.displayValue}`;
      body  = d.description as string;
    }
  }

  // ── Food CPI signals (grocery-linked) ──────────────────────────────────────
  if (point.dataType === "canada-food-cpi" || point.dataType === "us-food-cpi") {
    const foodPct   = typeof d.foodInflationPct   === "number" ? d.foodInflationPct   : null;
    const grocPct   = typeof d.userGroceryChangePct === "number" ? d.userGroceryChangePct : null;
    const vs        = typeof d.spendVsInflation   === "number" ? d.spendVsInflation   : null;
    const gap       = typeof d.monthlyGap         === "number" ? d.monthlyGap         : null;
    const monthly   = typeof d.recentMonthlyGroceries === "number" ? d.recentMonthlyGroceries : 0;
    const hasHist   = !!d.hasYoyHistory;

    extra.inflationPct  = foodPct;
    extra.userSpendPct  = grocPct;
    extra.vsInflation   = vs;
    extra.monthlySpend  = monthly;
    extra.linkedCategory = "Groceries";

    if (foodPct !== null && grocPct !== null && vs !== null && hasHist) {
      const ratio = foodPct > 0 ? Math.round(grocPct / foodPct) : null;
      if (vs > 0 && ratio && ratio > 1) {
        title = `Your grocery spend is outpacing food inflation by ${ratio}×`;
      } else if (vs > 0) {
        title = `Your grocery spend is growing faster than food prices`;
      } else {
        title = `Your grocery spend is in line with food inflation`;
      }
      body = `Food inflation is ${foodPct}% YoY. Your grocery spend grew ${grocPct > 0 ? "+" : ""}${grocPct}% — ${Math.abs(vs).toFixed(1)}% ${vs > 0 ? "above" : "below"} food price increases.`;
      if (gap !== null && gap > 0) {
        dollarImpact = gap;
        impactLabel  = "mo above food inflation";
      }
    } else if (foodPct !== null) {
      const fmt = new Intl.NumberFormat("en-CA", { style: "currency", currency: "CA" === point.country ? "CAD" : "USD", maximumFractionDigits: 0 });
      title = `Food prices are up ${foodPct}% — your groceries ~${fmt.format(monthly)}/mo`;
      body  = d.description as string;
    }
  }

  return {
    id: signal.key,
    category: "external",
    title,
    body,
    emoji: directionEmoji,
    priority: signal.priority,
    dollarImpact,
    impactLabel,
    href: (d.sourceUrl as string) ?? null,
    dismissed: false,
    createdAt: new Date().toISOString(),
    source: "external" as const,
    dataType: signal.dataType,
    releaseDate: point.releaseDate,
    // Structured fields for rich card rendering
    ...extra,
  };
}

// ── Step 1: Global data refresh (cron only) ────────────────────────────────────

/**
 * Fetch all registered external data sources that are due for refresh and
 * store them globally in externalData/{dataType}.
 *
 * This is the ONLY function the cron job calls. It does NOT touch any
 * per-user data — no agentInsights, no financialProfile reads.
 */
export async function refreshExternalData(
  db: Firestore.Firestore,
  options: { force?: boolean } = {},
): Promise<{ refreshed: string[]; skipped: string[]; fetchErrors: string[] }> {
  const refreshed: string[] = [];
  const skipped: string[] = [];
  const fetchErrors: string[] = [];

  for (const descriptor of EXTERNAL_DATA_REGISTRY) {
    const existing = await getExternalData(descriptor.dataType, db);

    if (!options.force && existing && !isDueForRefresh(existing)) {
      skipped.push(descriptor.dataType);
      continue;
    }

    try {
      const point = await descriptor.fetch();
      await setExternalData(point, db);
      refreshed.push(descriptor.dataType);
      console.log(`[external] refreshed ${descriptor.dataType} = ${point.displayValue}`);
    } catch (err) {
      const msg = `${descriptor.dataType}: ${err instanceof Error ? err.message : String(err)}`;
      console.error(`[external] failed to fetch ${descriptor.dataType}:`, err);
      fetchErrors.push(msg);
    }
  }

  return { refreshed, skipped, fetchErrors };
}

// ── Step 2: Per-user card generation (called from agent-insights GET) ─────────

/**
 * Read all stored external data points and write personalized insight cards
 * for one user. Called on every GET /api/user/agent-insights so users see
 * fresh signals whenever the global data has been updated — no statement
 * upload required.
 *
 * Staleness check: only regenerates if any global data point was updated
 * after the user's newest existing external card. This keeps the hot path
 * (no new data) to a handful of cheap Firestore reads.
 */
export async function generateExternalCardsForUser(
  uid: string,
  db: Firestore.Firestore,
): Promise<{ country: string | null; skipped: boolean; signals: { dataType: string; relevant: boolean; signalGenerated: boolean; skipReason: string | null }[] }> {
  // Load all available external data points from global store
  const points: ExternalDataPoint[] = (
    await Promise.all(
      EXTERNAL_DATA_REGISTRY.map((d) => getExternalData(d.dataType, db)),
    )
  ).filter((p): p is ExternalDataPoint => p !== null);

  if (points.length === 0) {
    return { country: null, skipped: true, signals: [] };
  }

  // Most recent global update across all data types
  const latestGlobalUpdate = points.reduce(
    (max, p) => (p.updatedAt > max ? p.updatedAt : max),
    "",
  );

  // Staleness check using a single metadata doc — no composite index needed
  const metaRef = db.doc(`users/${uid}/externalCardsMeta/v1`);
  const metaSnap = await metaRef.get();
  const lastGenerated = metaSnap.data()?.lastGeneratedAt as string | undefined;

  console.log(`[external] uid=${uid} latestGlobalUpdate=${latestGlobalUpdate} lastGenerated=${lastGenerated ?? "never"}`);

  if (lastGenerated && lastGenerated >= latestGlobalUpdate) {
    console.log(`[external] uid=${uid} skipping — already up to date`);
    return { country: null, skipped: true, signals: [] };
  }

  const [profile, userDoc] = await Promise.all([
    getFinancialProfile(uid, db),
    db.collection("users").doc(uid).get(),
  ]);

  // Stored user-confirmed country takes precedence over bank-name auto-detection
  const storedCountry = userDoc.data()?.country as "CA" | "US" | undefined;
  const country: "CA" | "US" = storedCountry ?? detectCountry(profile);

  const cards: ReturnType<typeof signalToInsightCard>[] = [];
  const signals: { dataType: string; relevant: boolean; signalGenerated: boolean; skipReason: string | null }[] = [];

  for (const point of points) {
    const descriptor = EXTERNAL_DATA_REGISTRY.find((d) => d.dataType === point.dataType);
    if (!descriptor) continue;

    const relevant = descriptor.relevant(profile, country);
    const signal = relevant ? buildSignal(point, profile) : null;

    signals.push({
      dataType: point.dataType,
      relevant,
      signalGenerated: !!signal,
      skipReason: !relevant ? "not relevant to profile" : !signal ? "buildSignal returned null" : null,
    });

    if (!relevant || !signal) continue;
    cards.push(signalToInsightCard(signal, point));
  }

  // Always write: even if cards.length === 0 we need to delete stale wrong-country cards
  const batch = db.batch();
  const insightsRef = db.collection(`users/${uid}/agentInsights`);

  // Delete any existing external cards that belong to the wrong country so
  // switching CA → US (or vice versa) immediately removes the old signals.
  const wrongCountry = country === "CA" ? "us" : "canada";
  const existingExternal = await insightsRef
    .where("source", "==", "external")
    .get();
  for (const doc of existingExternal.docs) {
    const dataType = (doc.data().dataType as string | undefined) ?? "";
    if (dataType.startsWith(wrongCountry)) {
      batch.delete(doc.ref);
    }
  }

  for (const card of cards) {
    batch.set(insightsRef.doc(card.id), card);
  }
  // Update metadata so the next visit skips regeneration if data hasn't changed
  batch.set(metaRef, { lastGeneratedAt: latestGlobalUpdate });
  await batch.commit();
  console.log(`[external] wrote ${cards.length} card(s) for uid=${uid}, deleted wrong-country cards`);

  return { country, skipped: false, signals };
}

// ── Legacy combined entry point (used by debug page) ──────────────────────────

/**
 * @deprecated Use refreshExternalData + generateExternalCardsForUser separately.
 * Kept for the debug page which wants both steps + full diagnostics in one call.
 */
export async function runExternalDataPipeline(
  allUids: string[],
  db: Firestore.Firestore,
  options: { force?: boolean } = {},
): Promise<{ refreshed: string[]; skipped: string[]; fetchErrors: string[]; usersNotified: number; diagnostics: Record<string, unknown>[] }> {
  const { refreshed, skipped, fetchErrors } = await refreshExternalData(db, options);

  let usersNotified = 0;
  const diagnostics: Record<string, unknown>[] = [];

  for (const uid of allUids) {
    try {
      const diag = await generateExternalCardsForUser(uid, db);
      diagnostics.push({ uid, country: diag.country, signals: diag.signals });
      if (diag.signals.some((s) => s.signalGenerated)) usersNotified++;
    } catch (err) {
      console.error(`[external] failed for uid=${uid}:`, err);
    }
  }

  return { refreshed, skipped, fetchErrors, usersNotified, diagnostics };
}
