import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";

async function getUid(req: NextRequest): Promise<string | null> {
  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(req, db);
    return access?.targetUid ?? null;
  } catch { return null; }
}

export interface UpcomingConfirmation {
  itemId: string;
  answer: "confirmed" | "not-yet" | "stopped";
  expectedDate: string;
  confirmedAt: string;
}

/** GET — load all confirmations for upcoming items */
export async function GET(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/upcomingConfirmations`).get();
  const confirmations: UpcomingConfirmation[] = snap.docs.map((d) => d.data() as UpcomingConfirmation);
  return NextResponse.json({ confirmations });
}

/** POST — save or update a confirmation for an upcoming item */
export async function POST(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { itemId, answer, expectedDate } = body as { itemId?: string; answer?: string; expectedDate?: string };
  if (!itemId || !answer) return NextResponse.json({ error: "itemId and answer required" }, { status: 400 });

  const { db } = getFirebaseAdmin();
  const col = db.collection(`users/${uid}/upcomingConfirmations`);

  if (answer === "clear") {
    await col.doc(itemId).delete();
    return NextResponse.json({ ok: true });
  }

  const record: UpcomingConfirmation = {
    itemId,
    answer: answer as UpcomingConfirmation["answer"],
    expectedDate: expectedDate ?? "",
    confirmedAt: new Date().toISOString(),
  };
  await col.doc(itemId).set(record);

  // "stopped" also suppresses the subscription from future upcoming lists
  if (answer === "stopped") {
    const slug = itemId.replace(/^sub-/, "");
    const subsRef = db.collection(`users/${uid}/subscriptions`).doc(slug);
    await subsRef.set({ upcomingSuppressed: true, updatedAt: new Date().toISOString() }, { merge: true });
  }

  return NextResponse.json({ ok: true });
}
