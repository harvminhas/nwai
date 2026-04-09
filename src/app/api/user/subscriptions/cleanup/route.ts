/**
 * POST /api/user/subscriptions/cleanup
 *
 * Removes all Firestore subscription docs that were incorrectly created by the
 * pattern detector (e.g. groceries, gas stations flagged as weekly subscriptions).
 *
 * Preserves:
 *   - status === "user_confirmed"  (user explicitly marked recurring)
 *
 * Deletes:
 *   - status === "suggested"  (not yet confirmed by anyone)
 *   - status === "confirmed"  (auto-confirmed by detector — these are the bad ones)
 *
 * After calling this, the next insights pipeline run will rebuild the collection
 * correctly: only Subscriptions-category transactions create detector rows.
 * AI-tagged subs from parsedData.subscriptions are re-seeded by syncStatementAiSubscriptions.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    return (await auth.verifyIdToken(token)).uid;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const subsRef = db.collection("users").doc(uid).collection("subscriptions");
  const snap = await subsRef.get();

  const batch = db.batch();
  let deleted = 0;
  let kept = 0;

  for (const doc of snap.docs) {
    const status = doc.data().status as string | undefined;
    if (status === "user_confirmed") {
      kept++;
    } else {
      batch.delete(doc.ref);
      deleted++;
    }
  }

  if (deleted > 0) await batch.commit();

  return NextResponse.json({ ok: true, deleted, kept });
}
