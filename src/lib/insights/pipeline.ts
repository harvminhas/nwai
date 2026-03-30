/**
 * Insights pipeline orchestration.
 *
 * Flow:
 *   InsightEvent
 *     → look up detectors in registry
 *     → filter by minMonths gate
 *     → run detectors (may write subscription records, etc.)
 *     → collect DetectedSignals
 *     → run AI card generation with full financial context
 *     → persist AgentCards to users/{uid}/agentInsights
 *
 * The AI card generation currently uses the full context prompt (see agentInsights.ts).
 * Future: replace with per-signal code writers so AI is only called for complex cards.
 */

import type * as Firestore from "firebase-admin/firestore";
import { getYearMonth } from "@/lib/consolidate";
import { inferFinancialDNA } from "@/lib/financialDNA";
import { generateAgentInsights } from "@/lib/agentInsights";
import { buildFinancialBrief, type BriefMode } from "@/lib/financialBrief";
import { buildAndCacheFinancialProfile } from "@/lib/financialProfile";
import type { ParsedStatementData } from "@/lib/types";
import { getDetectorsForEvent } from "./registry";
import type { DetectorContext, InsightEvent } from "./types";
import { INSIGHTS_MAX_MONTHS } from "./types";

export async function runInsightsPipeline(
  uid: string,
  db: Firestore.Firestore,
  event: InsightEvent = { type: "full.refresh" }
): Promise<void> {
  // ── 1. Build (or refresh) the financial profile cache ──────────────────────
  // This is the single-source computation. All API routes that call
  // getFinancialProfile() will pick up the freshly built cache automatically.
  const profile = await buildAndCacheFinancialProfile(uid, db);
  const { expenseTxns, incomeTxns, accountSnapshots, latestTxMonth, allTxMonths } = profile;

  const relevantMonths = allTxMonths.slice(-INSIGHTS_MAX_MONTHS);

  // ── 2. Build Financial DNA from all completed statements ───────────────────
  const allSnap = await db
    .collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .get();

  type DocEntry = { yearMonth: string; parsed: ParsedStatementData };
  const allDocs: DocEntry[] = [];
  for (const doc of allSnap.docs) {
    const d = doc.data();
    const parsed = d.parsedData as ParsedStatementData | undefined;
    if (!parsed) continue;
    let ym = parsed.statementDate ? getYearMonth(parsed.statementDate) : "";
    if (!ym) {
      const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
      if (raw) {
        const t =
          typeof raw === "object" && "toISOString" in raw
            ? (raw as Date).toISOString()
            : String(raw);
        ym = t.slice(0, 7);
      }
    }
    if (ym) allDocs.push({ yearMonth: ym, parsed });
  }

  const dna = inferFinancialDNA(allDocs);
  await db.collection("users").doc(uid).set({ financialDNA: dna }, { merge: true });

  if (!latestTxMonth) {
    console.log(`[insights] No transactions for uid=${uid}; wrote Financial DNA only`);
    return;
  }

  // ── 3. Run code detectors for this event ───────────────────────────────────
  const detectorCtx: DetectorContext = {
    uid,
    db,
    expenseTxns,
    incomeTxns,
    accountSnapshots,
    allTxMonths,
    relevantMonths,
  };

  const detectors = getDetectorsForEvent(event.type);
  const signalResults = await Promise.allSettled(
    detectors
      .filter((d) => !d.minMonths || relevantMonths.length >= d.minMonths)
      .map((d) => d.run(detectorCtx, event).catch((err) => {
        console.error(`[insights] Detector "${d.name}" failed:`, err);
        return [];
      }))
  );

  const allSignals = signalResults.flatMap((r) =>
    r.status === "fulfilled" ? r.value : []
  );

  console.log(`[insights] Event=${event.type}, detectors=${detectors.length}, signals=${allSignals.length}`);

  // ── 4. Build the same financial brief used by AI Chat ─────────────────────
  // This ensures recommendations are grounded in individual transaction data,
  // real APRs, and cash commitments — not just aggregated category totals.
  const brief = await buildFinancialBrief(uid, "insights" as BriefMode);

  // ── 5. Generate and persist AI insight cards ───────────────────────────────
  const cards = await generateAgentInsights(brief, null);
  if (cards.length === 0) return;

  const userRef = db.collection("users").doc(uid);
  const existingSnap = await userRef
    .collection("agentInsights")
    .where("dismissed", "==", false)
    .get();

  const batch = db.batch();
  for (const doc of existingSnap.docs) batch.delete(doc.ref);
  for (const card of cards) {
    batch.set(userRef.collection("agentInsights").doc(card.id), card);
  }
  await batch.commit();

  console.log(`[insights] Generated ${cards.length} cards for uid=${uid}`);
}
