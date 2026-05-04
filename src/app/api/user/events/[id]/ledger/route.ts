/**
 * POST   /api/user/events/[id]/ledger — add ledger entry (projects only): cash/manual spend + note
 * GET    /api/user/events/[id]/ledger — list entries (newest first)
 * DELETE /api/user/events/[id]/ledger — body { entryId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { ProjectLedgerEntry } from "@/lib/events/types";
import { FieldValue } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

function isProjectEvent(kind: string | undefined): boolean {
  return kind !== "service";
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body = await req.json().catch(() => ({})) as {
      date?: string;
      amount?: number;
      note?: string;
      category?: string;
      entryType?: "cash" | "manual";
    };
    const date = body.date?.substring(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });

    const amt = Number(body.amount);
    if (!Number.isFinite(amt) || amt <= 0)
      return NextResponse.json({ error: "positive amount required" }, { status: 400 });

    const entryType: "cash" | "manual" = body.entryType === "cash" ? "cash" : "manual";

    const eventRef = db.doc(`users/${actorUid}/events/${id}`);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const ev = eventSnap.data()!;
    if (!isProjectEvent(ev.kind as string | undefined))
      return NextResponse.json({ error: "Ledger applies to projects only — use visits for recurring services." }, { status: 400 });

    const entryId = randomUUID();
    const now = new Date().toISOString();
    const entry: ProjectLedgerEntry = {
      id: entryId,
      date,
      amount: Math.round(amt * 100) / 100,
      entryType,
      createdAt: now,
      ...(body.note?.trim() ? { note: body.note.trim() } : {}),
      ...(body.category?.trim() ? { category: body.category.trim() } : {}),
    };

    await db.doc(`users/${actorUid}/events/${id}/ledger/${entryId}`).set(entry);

    await eventRef.update({
      ledgerTotal: FieldValue.increment(entry.amount),
      ledgerEntryCount: FieldValue.increment(1),
    });

    return NextResponse.json({ entry }, { status: 201 });
  } catch (err) {
    console.error("[ledger] POST error", err);
    return NextResponse.json({ error: "Failed to add ledger entry" }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const snap = await db
      .collection(`users/${targetUid}/events/${id}/ledger`)
      .orderBy("date", "desc")
      .get();

    const entries: ProjectLedgerEntry[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as ProjectLedgerEntry));
    return NextResponse.json({ entries });
  } catch (err) {
    console.error("[ledger] GET error", err);
    return NextResponse.json({ error: "Failed to load ledger" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body = await req.json().catch(() => ({}));
    const entryId = body.entryId as string | undefined;
    if (!entryId) return NextResponse.json({ error: "entryId required" }, { status: 400 });

    const entryRef = db.doc(`users/${actorUid}/events/${id}/ledger/${entryId}`);
    const entrySnap = await entryRef.get();
    if (!entrySnap.exists) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

    const amt = Number((entrySnap.data() as ProjectLedgerEntry).amount) || 0;

    await entryRef.delete();

    const eventRef = db.doc(`users/${actorUid}/events/${id}`);
    const updates: Record<string, unknown> = {
      ledgerEntryCount: FieldValue.increment(-1),
      ledgerTotal: FieldValue.increment(-amt),
    };
    await eventRef.update(updates);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[ledger] DELETE error", err);
    return NextResponse.json({ error: "Failed to remove ledger entry" }, { status: 500 });
  }
}
