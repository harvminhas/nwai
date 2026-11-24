/**
 * GET /api/user/daily-spend?range=3m
 *
 * Thin adapter: auth → financial profile + the same review context,
 * source mappings, and merchant display names Spending uses →
 * {@link buildDailySpend}. Each theme includes subcategory, merchant,
 * and 6-month series detail. Also attaches the signed-in user's daily
 * target tracker view when one is stored. Read-only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { loadUserReviewContext } from "@/lib/userReviewContext";
import { buildDailySpend, parseDailySpendRange } from "@/lib/dailySpend";
import { buildDailySpendTrackerView, parseTrackerRecord } from "@/lib/dailySpendTracker";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const range = parseDailySpendRange(new URL(req.url).searchParams.get("range"));
    const [profile, reviews, mappingsSnap, displayNamesSnap, trackerSnap] = await Promise.all([
      getFinancialProfile(access.targetUid, db),
      loadUserReviewContext(access.targetUid, db),
      db.collection(`users/${access.targetUid}/sourceMappings`).get(),
      db.collection(`users/${access.targetUid}/merchantDisplayNames`).get(),
      db.doc(`users/${access.targetUid}/dailySpendTracker/current`).get(),
    ]);
    const sourceMappings = mappingsSnap.docs.map((doc) => {
      const data = doc.data() as {
        canonical?: string;
        alias?: string;
        status?: string;
        type?: string;
      };
      return {
        canonical: data.canonical ?? "",
        alias: data.alias ?? "",
        status: data.status,
        type: data.type,
      };
    });
    const merchantDisplayNames = displayNamesSnap.docs.map((doc) => ({
      slug: doc.id,
      displayName: (doc.data() as { displayName?: string }).displayName ?? "",
    }));
    const result = buildDailySpend({
      expenseTxns: profile.expenseTxns,
      accountSnapshots: profile.accountSnapshots,
      debtPaymentHistory: profile.debtPaymentHistory,
      userReviews: reviews.debtPaymentReviews,
      fxRates: profile.fxRates || {},
      currency: profile.homeCurrency,
      range,
      sourceMappings,
      merchantDisplayNames,
    });
    const record = parseTrackerRecord(trackerSnap.data());
    const tracker = record
      ? buildDailySpendTrackerView(record, {
          expenseTxns: profile.expenseTxns,
          fxRates: profile.fxRates || {},
          currency: profile.homeCurrency,
        })
      : null;
    return NextResponse.json({ ...result, tracker });
  } catch (error) {
    console.error("Daily spend error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load daily spend" },
      { status: 500 },
    );
  }
}
