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

/** PATCH /api/user/debt-plans/[id] — update an existing debt plan */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  const { db } = getFirebaseAdmin();
  const docRef = db.doc(`users/${uid}/debtPlans/${id}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  // Only allow updating specific fields
  const updates: Partial<DebtPlanDocument> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.mode !== undefined) updates.mode = body.mode;
  if (body.debtSlugs !== undefined) updates.debtSlugs = body.debtSlugs;
  if (body.strategy !== undefined) updates.strategy = body.strategy;
  if (body.extraMonthly !== undefined) updates.extraMonthly = body.extraMonthly;
  if (body.targetDate !== undefined) updates.targetDate = body.targetDate;
  if (body.monthlyBudget !== undefined) updates.monthlyBudget = body.monthlyBudget;
  if (body.baseline !== undefined) updates.baseline = body.baseline;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  // Strip undefined fields (Firestore doesn't accept them)
  const sanitized = stripUndefined(updates);

  await docRef.update(sanitized);

  return NextResponse.json({ ok: true });
}

/** DELETE /api/user/debt-plans/[id] — delete a debt plan */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;

  const { db } = getFirebaseAdmin();
  const docRef = db.doc(`users/${uid}/debtPlans/${id}`);
  const doc = await docRef.get();

  if (!doc.exists) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  await docRef.delete();

  return NextResponse.json({ ok: true });
}
