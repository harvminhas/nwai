import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";

function uuidv4(): string {
  return crypto.randomUUID();
}

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { db } = getFirebaseAdmin(); const access = await resolveAccess(req, db); return access?.targetUid ?? null;
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
  nextDate?: string;  // ISO date string, e.g. "2026-03-28"
  startDate?: string; // ISO year-month or date, e.g. "2026-01" — backfill floor
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

/**
 * How many times a commitment occurs in a given yearMonth ("YYYY-MM").
 * Returns 0 for months before startDate (or createdAt if no startDate).
 * "once" always returns 0 — treated as a one-off, not recurring.
 */
export function commitmentOccurrencesInMonth(entry: CashCommitment, yearMonth: string): number {
  if (entry.frequency === "once") return 0;
  const floor = entry.startDate?.slice(0, 7) ?? entry.createdAt?.slice(0, 7);
  if (floor && yearMonth < floor) return 0;
  switch (entry.frequency) {
    case "weekly":    return 52 / 12;
    case "biweekly":  return 26 / 12;
    case "monthly":   return 1;
    case "quarterly": return 1 / 3;
    default:          return 0;
  }
}

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
  const { name, amount, frequency, category, notes, nextDate, startDate } = body as Partial<CashCommitment>;
  if (!name || amount === undefined || !frequency || !category) {
    return NextResponse.json({ error: "name, amount, frequency, and category are required" }, { status: 400 });
  }
  const { db } = getFirebaseAdmin();
  const id = uuidv4();
  const now = new Date().toISOString();
  const item = stripUndefined<CashCommitment>({ id, name, amount, frequency, category, notes, nextDate, startDate, createdAt: now, updatedAt: now });
  await db.doc(`users/${uid}/cashCommitments/${id}`).set(item);
  return NextResponse.json({ item });
}

/** PUT — update an existing cash commitment */
export async function PUT(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { id, name, amount, frequency, category, notes, nextDate, startDate } = body as Partial<CashCommitment>;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { db } = getFirebaseAdmin();
  const now = new Date().toISOString();
  const update = stripUndefined({ name, amount, frequency, category, notes, nextDate, startDate, updatedAt: now });
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
