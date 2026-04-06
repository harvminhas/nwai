import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

async function getDecodedToken(req: NextRequest) {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    return await auth.verifyIdToken(token);
  } catch { return null; }
}

/**
 * POST /api/user/ensure-profile
 *
 * Creates the users/{uid} document if it does not yet exist.
 * Safe to call on every sign-in — uses merge:true so it never overwrites
 * existing plan or other user-managed fields.
 */
export async function POST(req: NextRequest) {
  const decoded = await getDecodedToken(req);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const ref  = db.collection("users").doc(decoded.uid);
  const snap = await ref.get();
  const now  = new Date();

  await ref.set(
    {
      uid:         decoded.uid,
      email:       decoded.email ?? "",
      displayName: decoded.name  ?? decoded.email ?? "",
      plan:        "free",
      updatedAt:   now,
      ...(snap.exists ? {} : { createdAt: now }),
    },
    { merge: true },
  );

  return NextResponse.json({ ok: true, created: !snap.exists });
}
