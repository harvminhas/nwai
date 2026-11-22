import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { validatePlanDates } from "@/app/account/tools/planner/planList";

function uuidv4(): string {
  return crypto.randomUUID();
}

async function getUid(req: NextRequest): Promise<string | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { db } = getFirebaseAdmin(); 
    const access = await resolveAccess(req, db); 
    return access?.targetUid ?? null;
  } catch { 
    return null; 
  }
}

export interface PlanLinkedTransaction {
  txFingerprint: string;
  merchant: string;
  date: string;
  amount: number;
  category: string;
}

export interface PlanCashEntry {
  id: string;
  amount: number;
  note: string;
  date: string;
  createdAt: string;
}

export interface Plan {
  id: string;
  name: string;
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
  budget: number;
  linkedTransactions: PlanLinkedTransaction[];
  cashEntries: PlanCashEntry[];
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp when the user marked the plan complete. Absent on legacy plans. */
  completedAt?: string | null;
}

function dateRangeErrorResponse(startDate: string, endDate: string): NextResponse | null {
  const message = validatePlanDates(startDate, endDate);
  if (!message) return null;
  return NextResponse.json({ error: message }, { status: 400 });
}

/** GET — list all plans */
export async function GET(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/plans`).orderBy("startDate", "desc").get();
  const items: Plan[] = snap.docs.map((d) => d.data() as Plan);
  
  return NextResponse.json({ items });
}

/** POST — create a plan */
export async function POST(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const body = await req.json().catch(() => ({}));
  const { name, startDate, endDate, budget } = body as Partial<Plan>;
  
  if (!name || !startDate || !endDate || budget === undefined) {
    return NextResponse.json({ error: "name, startDate, endDate, and budget are required" }, { status: 400 });
  }

  const dateError = dateRangeErrorResponse(startDate, endDate);
  if (dateError) return dateError;
  
  const { db } = getFirebaseAdmin();
  const id = uuidv4();
  const now = new Date().toISOString();
  
  const item: Plan = {
    id,
    name,
    startDate,
    endDate,
    budget,
    linkedTransactions: [],
    cashEntries: [],
    createdAt: now,
    updatedAt: now,
  };
  
  await db.doc(`users/${uid}/plans/${id}`).set(item);
  return NextResponse.json({ item });
}

/** PUT — update a plan */
export async function PUT(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const body = await req.json().catch(() => ({}));
  const { id, name, startDate, endDate, budget, linkedTransactions, cashEntries } = body as Partial<Plan>;
  
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  
  const { db } = getFirebaseAdmin();
  const now = new Date().toISOString();
  
  const update: Partial<Plan> = { updatedAt: now };
  if (name !== undefined) update.name = name;
  if (startDate !== undefined) update.startDate = startDate;
  if (endDate !== undefined) update.endDate = endDate;
  if (budget !== undefined) update.budget = budget;
  if (linkedTransactions !== undefined) update.linkedTransactions = linkedTransactions;
  if (cashEntries !== undefined) update.cashEntries = cashEntries;
  
  await db.doc(`users/${uid}/plans/${id}`).update(update);
  return NextResponse.json({ ok: true });
}

/** PATCH — partial update (dates, budget, completion). Owner-scoped via getUid. */
export async function PATCH(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id, name, startDate, endDate, budget, completedAt } = body as Partial<Plan> & {
    id?: unknown;
    completedAt?: unknown;
  };

  if (!id || typeof id !== "string") {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  if ("completedAt" in body && completedAt !== null && typeof completedAt !== "string") {
    return NextResponse.json(
      { error: "completedAt must be a timestamp or empty" },
      { status: 400 },
    );
  }
  if (typeof completedAt === "string" && completedAt.length === 0) {
    return NextResponse.json(
      { error: "completedAt must be a timestamp or empty" },
      { status: 400 },
    );
  }

  const { db } = getFirebaseAdmin();
  const ref = db.doc(`users/${uid}/plans/${id}`);
  const snap = await ref.get();
  if (!snap.exists) {
    return NextResponse.json({ error: "Plan not found" }, { status: 404 });
  }

  const existing = snap.data() as Plan;
  const now = new Date().toISOString();
  const update: Partial<Plan> = { updatedAt: now };

  if (name !== undefined) update.name = name;
  if (startDate !== undefined) update.startDate = startDate;
  if (endDate !== undefined) update.endDate = endDate;
  if (budget !== undefined) update.budget = budget;
  if ("completedAt" in body) {
    update.completedAt = (completedAt as string | null) ?? null;
  }

  const fieldCount = Object.keys(update).length;
  if (fieldCount <= 1) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const nextStart = startDate !== undefined ? startDate : existing.startDate;
  const nextEnd = endDate !== undefined ? endDate : existing.endDate;
  const datesChanged =
    nextStart !== existing.startDate || nextEnd !== existing.endDate;
  if (datesChanged) {
    const dateError = dateRangeErrorResponse(nextStart, nextEnd);
    if (dateError) return dateError;
  }

  await ref.update(update);
  return NextResponse.json({ ok: true });
}

/** DELETE — remove a plan */
export async function DELETE(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  
  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");
  
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  
  const { db } = getFirebaseAdmin();
  await db.doc(`users/${uid}/plans/${id}`).delete();
  
  return NextResponse.json({ ok: true });
}
