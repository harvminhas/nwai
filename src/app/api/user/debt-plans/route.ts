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

/**
 * Strip undefined fields from an object (Firestore doesn't accept undefined).
 * Recursively handles nested objects and arrays.
 */
function stripUndefined<T extends Record<string, any>>(obj: T): Partial<T> {
  const result: any = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) {
      // Skip undefined fields
      continue;
    } else if (Array.isArray(value)) {
      // Recursively strip arrays
      result[key] = value.map(item => 
        typeof item === 'object' && item !== null ? stripUndefined(item) : item
      );
    } else if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
      // Recursively strip nested objects (but not Dates)
      result[key] = stripUndefined(value);
    } else {
      result[key] = value;
    }
  }
  return result;
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

  // Strip undefined fields (Firestore doesn't accept them)
  const sanitized = stripUndefined(planDoc);

  await docRef.set(sanitized);

  return NextResponse.json({ ok: true, id: docRef.id });
}
