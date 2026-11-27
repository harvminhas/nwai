/**
 * GET    /api/user/daily-spend/tracker
 * PUT    /api/user/daily-spend/tracker  { targetDaily, range?, trackedThemes? }
 * DELETE /api/user/daily-spend/tracker
 *
 * Thin adapter: auth → users/{uid}/dailySpendTracker/current + financial
 * profile → {@link buildDailySpendTrackerView}. Start tracking freezes
 * usualDailyAtStart from the current Daily spend window, over the What-if
 * chips selected at start (Housing never tracked). Later edits change only
 * the target.
 */

import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { loadUserReviewContext } from "@/lib/userReviewContext";
import { buildDailySpend, parseDailySpendRange } from "@/lib/dailySpend";
import {
  applyTargetEdit,
  buildDailySpendTrackerView,
  createTrackerRecord,
  parseTrackerRecord,
  trackableThemeIds,
  usualFromDailySpend,
  type DailySpendTrackerView,
} from "@/lib/dailySpendTracker";
import { getCurrentMonth } from "@/lib/monthAnchor";

export const dynamic = "force-dynamic";

function trackerDoc(db: Firestore, uid: string) {
  return db.doc(`users/${uid}/dailySpendTracker/current`);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const uid = access.targetUid;
    const [snap, profile] = await Promise.all([
      trackerDoc(db, uid).get(),
      getFinancialProfile(uid, db),
    ]);
    const record = parseTrackerRecord(snap.data());
    const tracker: DailySpendTrackerView | null = record
      ? buildDailySpendTrackerView(record, {
          expenseTxns: profile.expenseTxns,
          fxRates: profile.fxRates || {},
          currency: profile.homeCurrency,
        })
      : null;
    return NextResponse.json({ tracker, currency: profile.homeCurrency });
  } catch (error) {
    console.error("Daily spend tracker GET error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to load tracker" },
      { status: 500 },
    );
  }
}

export async function PUT(req: NextRequest): Promise<NextResponse> {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  try {
    const body = (await req.json().catch(() => ({}))) as {
      targetDaily?: unknown;
      range?: unknown;
      trackedThemes?: unknown;
    };
    const targetDaily = Number(body.targetDaily);
    if (!Number.isFinite(targetDaily) || targetDaily < 0) {
      return NextResponse.json({ error: "targetDaily must be a number ≥ 0" }, { status: 400 });
    }

    const range = parseDailySpendRange(
      typeof body.range === "string"
        ? body.range
        : new URL(req.url).searchParams.get("range"),
    );

    const [snap, profile, reviews] = await Promise.all([
      trackerDoc(db, uid).get(),
      getFinancialProfile(uid, db),
      loadUserReviewContext(uid, db),
    ]);

    const existing = parseTrackerRecord(snap.data());
    const currentYm = getCurrentMonth();
    let record;
    if (!existing) {
      const spend = buildDailySpend({
        expenseTxns: profile.expenseTxns,
        accountSnapshots: profile.accountSnapshots,
        debtPaymentHistory: profile.debtPaymentHistory,
        userReviews: reviews.debtPaymentReviews,
        fxRates: profile.fxRates || {},
        currency: profile.homeCurrency,
        range,
      });
      const picked = Array.isArray(body.trackedThemes)
        ? trackableThemeIds(body.trackedThemes)
        : [];
      const themes = picked.length > 0 ? picked : undefined;
      const usual = usualFromDailySpend(spend, themes);
      record = createTrackerRecord({
        targetDaily,
        usualDailyAtStart: usual.usualDaily,
        usualByThemeAtStart: usual.usualByTheme,
        currentYm,
        trackedThemes: themes,
      });
    } else {
      record = applyTargetEdit(existing, targetDaily, currentYm);
    }

    await trackerDoc(db, uid).set(record);
    const tracker = buildDailySpendTrackerView(record, {
      expenseTxns: profile.expenseTxns,
      fxRates: profile.fxRates || {},
      currency: profile.homeCurrency,
    });
    return NextResponse.json({ tracker });
  } catch (error) {
    console.error("Daily spend tracker PUT error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to save tracker" },
      { status: 500 },
    );
  }
}

export async function DELETE(req: NextRequest): Promise<NextResponse> {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    await trackerDoc(db, access.targetUid).delete();
    return NextResponse.json({ tracker: null });
  } catch (error) {
    console.error("Daily spend tracker DELETE error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to stop tracking" },
      { status: 500 },
    );
  }
}
