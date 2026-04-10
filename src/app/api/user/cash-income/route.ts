import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { CashIncomeEntry } from "@/lib/cashIncome";

// Re-export shared types and helpers so callers that historically imported from
// this route still work (avoids touching every consumer at once).
export type { CashIncomeFrequency, CashIncomeCategory, CashIncomeEntry } from "@/lib/cashIncome";
export { CASH_INCOME_FREQ_MONTHLY, occurrencesInMonth } from "@/lib/cashIncome";

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { db } = getFirebaseAdmin(); const access = await resolveAccess(req, db); return access?.targetUid ?? null;
  } catch { return null; }
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => v !== undefined)
  ) as Partial<T>;
}

export async function GET(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/cashIncome`).orderBy("createdAt", "asc").get();
  const items: CashIncomeEntry[] = snap.docs.map((d) => d.data() as CashIncomeEntry);
  return NextResponse.json({ items });
}

export async function POST(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { name, amount, frequency, category, notes, nextDate, startDate } = body as Partial<CashIncomeEntry>;
  if (!name || amount === undefined || !frequency || !category) {
    return NextResponse.json({ error: "name, amount, frequency, and category are required" }, { status: 400 });
  }
  const { db } = getFirebaseAdmin();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const item = stripUndefined<CashIncomeEntry>({ id, name, amount, frequency, category, notes, nextDate, startDate, createdAt: now, updatedAt: now });
  await db.doc(`users/${uid}/cashIncome/${id}`).set(item);
  return NextResponse.json({ item });
}

export async function PUT(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json().catch(() => ({}));
  const { id, name, amount, frequency, category, notes, nextDate, startDate } = body as Partial<CashIncomeEntry>;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { db } = getFirebaseAdmin();
  const now = new Date().toISOString();
  const update = stripUndefined({ name, amount, frequency, category, notes, nextDate, startDate, updatedAt: now });
  await db.doc(`users/${uid}/cashIncome/${id}`).update(update);
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { db } = getFirebaseAdmin();
  await db.doc(`users/${uid}/cashIncome/${id}`).delete();
  return NextResponse.json({ ok: true });
}
