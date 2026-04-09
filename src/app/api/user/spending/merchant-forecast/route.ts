/**
 * GET  /api/user/spending/merchant-forecast?slug=...
 * PUT  /api/user/spending/merchant-forecast  (Pro only — forecast feature)
 *
 * Persists user assumptions for estimated yearly spend per merchant slug.
 * Collection: users/{uid}/merchantForecasts/{slug}
 */

import { NextRequest, NextResponse } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolvePlan } from "@/app/api/user/plan/route";
import { planHas, type PlanId } from "@/lib/plans";
import type {
  ForecastMode,
  MerchantForecastDoc,
  RecurringFrequency,
  VisitsPeriod,
} from "@/lib/merchantForecast";

function authUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return Promise.resolve(null);
  return getFirebaseAdmin()
    .auth.verifyIdToken(token)
    .then((d) => d.uid)
    .catch(() => null);
}

async function resolvedPlanId(uid: string, db: Firestore): Promise<PlanId> {
  const doc = await db.collection("users").doc(uid).get();
  const p = resolvePlan(doc.data() as Record<string, unknown> | undefined);
  return (p ?? "free") as PlanId;
}

function parseBody(body: Record<string, unknown>): MerchantForecastDoc | null {
  const mode = body.mode as ForecastMode | undefined;
  if (mode !== "recurring" && mode !== "estimated") return null;

  const recurringFrequency = (body.recurringFrequency as RecurringFrequency) ?? "monthly";
  const validFreq = ["weekly", "biweekly", "monthly", "quarterly", "yearly", "oneoff"].includes(
    recurringFrequency,
  );
  if (!validFreq) return null;

  const visitsPeriod = (body.visitsPeriod as VisitsPeriod) ?? "month";
  const validPeriod = ["week", "biweek", "month", "quarter", "year"].includes(visitsPeriod);
  if (!validPeriod) return null;

  const recurringAmount = Math.max(0, Number(body.recurringAmount) || 0);
  const perVisitAmount = Math.max(0, Number(body.perVisitAmount) || 0);
  const visitsPerPeriod = Math.max(0, Number(body.visitsPerPeriod) || 0);

  return {
    mode,
    recurringFrequency: recurringFrequency as RecurringFrequency,
    recurringAmount,
    perVisitAmount,
    visitsPerPeriod,
    visitsPeriod: visitsPeriod as VisitsPeriod,
    updatedAt: new Date().toISOString(),
  };
}

export async function GET(req: NextRequest) {
  const uid = await authUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const slug = new URL(req.url).searchParams.get("slug")?.trim();
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const { db } = getFirebaseAdmin();
  const ref = db.doc(`users/${uid}/merchantForecasts/${slug}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ forecast: null });
  }
  const data = snap.data() as MerchantForecastDoc;
  return NextResponse.json({ forecast: data });
}

export async function PUT(req: NextRequest) {
  const uid = await authUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const planId = await resolvedPlanId(uid, db);
  if (!planHas(planId, "forecast")) {
    return NextResponse.json({ error: "Pro feature" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const merchantSlug = typeof body.slug === "string" ? body.slug.trim() : "";
  if (!merchantSlug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  const { slug: _omit, ...rest } = body;
  const parsed = parseBody(rest);
  if (!parsed) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  await db.doc(`users/${uid}/merchantForecasts/${merchantSlug}`).set(parsed, { merge: true });
  return NextResponse.json({ ok: true, forecast: parsed });
}
