import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(req, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.actorUid;
    const snap = await db
      .collection("users").doc(uid).collection("goals")
      .orderBy("createdAt", "asc")
      .get();
    const goals = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return NextResponse.json({ goals });
  } catch (err) {
    console.error("GET /api/user/goals error:", err);
    return NextResponse.json({ error: "Failed to load goals" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(req, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.actorUid;
    const body = await req.json();
    /** Auto-debt singleton: reuse existing Firestore doc if user already has one */
    if (body.isAutoDebtGoal === true) {
      const autoSnap = await db
        .collection("users")
        .doc(uid)
        .collection("goals")
        .where("isAutoDebtGoal", "==", true)
        .limit(1)
        .get();
      if (!autoSnap.empty) {
        const docRef = autoSnap.docs[0];
        const cur = docRef.data();
        const update: Record<string, unknown> = { updatedAt: new Date() };
        if (
          (cur.targetDate == null || cur.targetDate === "") &&
          typeof body.targetDate === "string" &&
          body.targetDate
        ) {
          update.targetDate = body.targetDate;
        }
        if (Object.keys(update).length > 1) await docRef.ref.update(update);
        await invalidateFinancialProfileCache(uid, db);
        const after = (await docRef.ref.get()).data();
        return NextResponse.json({ id: docRef.id, ...after });
      }
    }
    const doc = {
      title: body.title ?? "Untitled goal",
      description: body.description ?? "",
      goalType: body.goalType ?? "savings",
      targetAmount: body.targetAmount ?? null,
      targetDate: body.targetDate ?? null,
      currentAmount: body.currentAmount ?? null,
      linkedAccountSlugs: body.linkedAccountSlugs ?? null,
      linkedLiabilitySlugs: body.linkedLiabilitySlugs ?? null,
      emoji: body.emoji ?? "🎯",
      ...(body.isAutoDebtGoal === true ? { isAutoDebtGoal: true } : {}),
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    const ref = await db.collection("users").doc(uid).collection("goals").add(doc);
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ id: ref.id, ...doc });
  } catch (err) {
    console.error("POST /api/user/goals error:", err);
    return NextResponse.json({ error: "Failed to create goal" }, { status: 500 });
  }
}
