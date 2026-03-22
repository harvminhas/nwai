import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

function uuidv4(): string {
  return crypto.randomUUID();
}

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    return (await auth.verifyIdToken(token)).uid;
  } catch { return null; }
}

export type CashFrequency = "weekly" | "biweekly" | "monthly" | "quarterly" | "once";

export interface CashCommitment {
  id: string;
  name: string;
  amount: number;
  frequency: CashFrequency;
  category: string;
  notes?: string;
  nextDate?: string; // ISO date string, e.g. "2026-03-28"
  createdAt: string;
  updatedAt: string;
}

/** Monthly multiplier for each frequency */
export const FREQ_MONTHLY: Record<CashFrequency, number> = {
  weekly:    52 / 12,
  biweekly:  26 / 12,
  monthly:   1,
  quarterly: 1 / 3,
  once:      0,
};

/** Strip undefined values so Firestore doesn't throw */
function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

/** GET — list all cash commitments */
export async function GET(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/cashCommitments`).orderBy("createdAt", "asc").get();
  const items: CashCommitment[] = snap.docs.map((d) => d.data() as CashCommitment);
  return NextResponse.json({ items });
}

/** POST — create a cash commitment */
export async function POST(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { name, amount, frequency, category, notes, nextDate } = body as Partial<CashCommitment>;
  if (!name || amount === undefined || !frequency || !category) {
    return NextResponse.json({ error: "name, amount, frequency, and category are required" }, { status: 400 });
  }
  const { db } = getFirebaseAdmin();
  const id = uuidv4();
  const now = new Date().toISOString();
  const item = stripUndefined<CashCommitment>({ id, name, amount, frequency, category, notes, nextDate, createdAt: now, updatedAt: now });
  await db.doc(`users/${uid}/cashCommitments/${id}`).set(item);
  return NextResponse.json({ item });
}

/** PUT — update an existing cash commitment */
export async function PUT(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { id, name, amount, frequency, category, notes, nextDate } = body as Partial<CashCommitment>;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { db } = getFirebaseAdmin();
  const now = new Date().toISOString();
  const update = stripUndefined({ name, amount, frequency, category, notes, nextDate, updatedAt: now });
  await db.doc(`users/${uid}/cashCommitments/${id}`).update(update);
  return NextResponse.json({ ok: true });
}

/** DELETE — remove a cash commitment */
export async function DELETE(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { db } = getFirebaseAdmin();
  await db.doc(`users/${uid}/cashCommitments/${id}`).delete();
  return NextResponse.json({ ok: true });
}
