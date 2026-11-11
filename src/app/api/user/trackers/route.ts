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
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(req, db);
    return access?.targetUid ?? null;
  } catch {
    return null;
  }
}

export type TrackerDefaultFilter = "all" | "income" | "spending";
export type TrackerTxKind = "income" | "expense";

export interface TrackerLinkedTransaction {
  txFingerprint: string;
  merchant: string;
  date: string;
  amount: number;
  category: string;
  kind: TrackerTxKind;
  /** Snapshot of the spending/income API `accountLabel` (e.g. "TD Chequing"). */
  accountLabel?: string;
}

export interface Tracker {
  id: string;
  name: string;
  description: string;
  defaultFilter: TrackerDefaultFilter;
  linkedTransactions: TrackerLinkedTransaction[];
  createdAt: string;
  updatedAt: string;
}

const DEFAULT_FILTERS: TrackerDefaultFilter[] = ["all", "income", "spending"];

function normalizeDefaultFilter(value: unknown): TrackerDefaultFilter | null {
  if (typeof value !== "string") return null;
  return DEFAULT_FILTERS.includes(value as TrackerDefaultFilter)
    ? (value as TrackerDefaultFilter)
    : null;
}

function normalizeLinkedTransactions(value: unknown): TrackerLinkedTransaction[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) return [];
  const items: TrackerLinkedTransaction[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const tx = raw as Partial<TrackerLinkedTransaction>;
    if (typeof tx.txFingerprint !== "string" || tx.txFingerprint.length === 0) continue;
    const accountLabel = typeof tx.accountLabel === "string" ? tx.accountLabel.trim() : "";
    items.push({
      txFingerprint: tx.txFingerprint,
      merchant: typeof tx.merchant === "string" ? tx.merchant : "",
      date: typeof tx.date === "string" ? tx.date : "",
      amount: typeof tx.amount === "number" ? tx.amount : 0,
      category: typeof tx.category === "string" && tx.category.length > 0 ? tx.category : "Other",
      kind: tx.kind === "income" ? "income" : "expense",
      ...(accountLabel ? { accountLabel } : {}),
    });
  }
  return items;
}

/** GET — list all trackers */
export async function GET(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/trackers`).get();
  const items: Tracker[] = snap.docs
    .map((d) => d.data() as Tracker)
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));

  return NextResponse.json({ items });
}

/** POST — create a tracker */
export async function POST(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { name, description, defaultFilter } = body as Partial<Tracker>;

  const trimmedName = typeof name === "string" ? name.trim() : "";
  if (!trimmedName) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const filter = defaultFilter === undefined
    ? "all"
    : normalizeDefaultFilter(defaultFilter);
  if (!filter) {
    return NextResponse.json({ error: "defaultFilter must be all, income, or spending" }, { status: 400 });
  }

  const { db } = getFirebaseAdmin();
  const id = uuidv4();
  const now = new Date().toISOString();

  const item: Tracker = {
    id,
    name: trimmedName,
    description: typeof description === "string" ? description.trim() : "",
    defaultFilter: filter,
    linkedTransactions: [],
    createdAt: now,
    updatedAt: now,
  };

  await db.doc(`users/${uid}/trackers/${id}`).set(item);
  return NextResponse.json({ item });
}

/** PUT — update a tracker */
export async function PUT(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const { id, name, description, defaultFilter, linkedTransactions } = body as Partial<Tracker>;

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { db } = getFirebaseAdmin();
  const now = new Date().toISOString();

  const update: Partial<Tracker> = { updatedAt: now };
  if (name !== undefined) {
    const trimmedName = typeof name === "string" ? name.trim() : "";
    if (!trimmedName) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    update.name = trimmedName;
  }
  if (description !== undefined) {
    update.description = typeof description === "string" ? description.trim() : "";
  }
  if (defaultFilter !== undefined) {
    const filter = normalizeDefaultFilter(defaultFilter);
    if (!filter) {
      return NextResponse.json({ error: "defaultFilter must be all, income, or spending" }, { status: 400 });
    }
    update.defaultFilter = filter;
  }
  if (linkedTransactions !== undefined) {
    update.linkedTransactions = normalizeLinkedTransactions(linkedTransactions) ?? [];
  }

  await db.doc(`users/${uid}/trackers/${id}`).update(update);
  return NextResponse.json({ ok: true });
}

/** DELETE — remove a tracker */
export async function DELETE(req: NextRequest) {
  const uid = await getUid(req);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const id = searchParams.get("id");

  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  const { db } = getFirebaseAdmin();
  await db.doc(`users/${uid}/trackers/${id}`).delete();

  return NextResponse.json({ ok: true });
}
