import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { DebtPlan, DebtPlanDocument } from "@/lib/debtPlanTypes";

async function getUid(request: NextRequest): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/** GET /api/user/debt-plans — list all debt plans for the current user */
export async function GET(request: NextRequest) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/debtPlans`).orderBy("createdAt", "desc").get();
  
  const plans: DebtPlan[] = snap.docs.map((doc) => {
    const data = doc.data() as DebtPlanDocument;
    return {
      id: doc.id,
      name: data.name,
      mode: data.mode,
      debtSlugs: data.debtSlugs,
      strategy: data.strategy,
      extraMonthly: data.extraMonthly,
      targetDate: data.targetDate,
      monthlyBudget: data.monthlyBudget,
      baseline: data.baseline,
      createdAt: data.createdAt,
    };
  });

  return NextResponse.json({ plans });
}

/** POST /api/user/debt-plans — create a new debt plan */
export async function POST(request: NextRequest) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const {
    name,
    mode,
    debtSlugs,
    strategy,
    extraMonthly,
    targetDate,
    monthlyBudget,
    baseline,
  } = body as Partial<DebtPlan>;

  // Validate required fields
  if (!name || !mode || !debtSlugs || !Array.isArray(debtSlugs) || !strategy || !monthlyBudget || !baseline) {
    return NextResponse.json(
      { error: "Missing required fields: name, mode, debtSlugs, strategy, monthlyBudget, baseline" },
      { status: 400 }
    );
  }

  if (mode === "extra" && extraMonthly === undefined) {
    return NextResponse.json({ error: "extraMonthly is required for 'extra' mode" }, { status: 400 });
  }

  if (mode === "targetDate" && !targetDate) {
    return NextResponse.json({ error: "targetDate is required for 'targetDate' mode" }, { status: 400 });
  }

  const { db } = getFirebaseAdmin();
  const docRef = db.collection(`users/${uid}/debtPlans`).doc();
  
  const planDoc: DebtPlanDocument = {
    name,
    mode,
    debtSlugs,
    strategy,
    extraMonthly,
    targetDate,
    monthlyBudget,
    baseline,
    createdAt: new Date(),
  };

  await docRef.set(planDoc);

  return NextResponse.json({ ok: true, id: docRef.id });
}
