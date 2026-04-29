/**
 * POST /api/user/events/[id]/visits
 *   Log an event for a recurring service.
 *   Body: { date: string (YYYY-MM-DD), note?: string,
 *           paymentMethod?: "cash" | "statement", amount?: number }
 *
 * GET  /api/user/events/[id]/visits
 *   List all event logs for an event (newest first).
 *
 * DELETE /api/user/events/[id]/visits
 *   Body: { visitId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { FieldValue } from "firebase-admin/firestore";
import type { VisitLog } from "@/lib/events/types";
import { randomUUID } from "crypto";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { db }  = getFirebaseAdmin();
  const access  = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body = await req.json().catch(() => ({}));
    const date = (body.date as string | undefined)?.substring(0, 10);
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
      return NextResponse.json({ error: "date required (YYYY-MM-DD)" }, { status: 400 });

    const paymentMethod = body.paymentMethod as "cash" | "statement" | undefined;
    const rawAmount     = paymentMethod === "cash" ? Number(body.amount) : undefined;
    const amount        = rawAmount && rawAmount > 0 ? rawAmount : undefined;

    const eventRef  = db.doc(`users/${actorUid}/events/${id}`);
    const eventSnap = await eventRef.get();
    if (!eventSnap.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const evKind = (eventSnap.data()!.kind as string | undefined) ?? "project";
    if (evKind !== "service") {
      return NextResponse.json(
        { error: "Visit logs are only for recurring services. Use project ledger for off-statement spend on projects." },
        { status: 400 },
      );
    }

    const now     = new Date().toISOString();
    const visitId = randomUUID();
    const ym      = date.substring(0, 7); // YYYY-MM

    const visit: VisitLog = {
      id: visitId,
      date,
      ...(body.note ? { note: String(body.note).trim() } : {}),
      ...(paymentMethod ? { paymentMethod } : {}),
      ...(amount !== undefined ? { amount } : {}),
      createdAt: now,
    };

    await db.doc(`users/${actorUid}/events/${id}/visits/${visitId}`).set(visit);

    // Atomically update denormalized event fields
    const currentLast = eventSnap.data()!.lastVisitDate as string | undefined;
    const updates: Record<string, unknown> = {
      visitCount: FieldValue.increment(1),
      [`visitsByMonth.${ym}`]: FieldValue.increment(1),
    };
    if (!currentLast || date > currentLast) updates.lastVisitDate = date;
    if (paymentMethod === "cash") {
      updates.cashVisitCount = FieldValue.increment(1);
      if (amount) updates.cashTotal = FieldValue.increment(amount);
      updates[`paymentsByMonth.${ym}`] = FieldValue.increment(1);
    }
    await eventRef.update(updates);

    return NextResponse.json({ visit }, { status: 201 });
  } catch (err) {
    console.error("[visits] POST error", err);
    return NextResponse.json({ error: "Failed to log event" }, { status: 500 });
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { db }  = getFirebaseAdmin();
  const access  = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const snap = await db
      .collection(`users/${targetUid}/events/${id}/visits`)
      .orderBy("date", "desc")
      .get();

    const visits: VisitLog[] = snap.docs.map((d) => ({ id: d.id, ...d.data() } as VisitLog));
    return NextResponse.json({ visits });
  } catch (err) {
    console.error("[visits] GET error", err);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const { db }  = getFirebaseAdmin();
  const access  = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body    = await req.json().catch(() => ({}));
    const visitId = body.visitId as string | undefined;
    if (!visitId) return NextResponse.json({ error: "visitId required" }, { status: 400 });

    const visitRef  = db.doc(`users/${actorUid}/events/${id}/visits/${visitId}`);
    const visitSnap = await visitRef.get();
    if (!visitSnap.exists) return NextResponse.json({ error: "Visit not found" }, { status: 404 });

    const vData         = visitSnap.data()!;
    const visitYm       = (vData.date as string).substring(0, 7); // YYYY-MM
    const wasCash       = vData.paymentMethod === "cash";
    const cashAmount    = wasCash && vData.amount ? Number(vData.amount) : 0;

    await visitRef.delete();

    const eventRef  = db.doc(`users/${actorUid}/events/${id}`);
    const eventSnap = await eventRef.get();
    if (eventSnap.exists) {
      const updates: Record<string, unknown> = {
        visitCount: FieldValue.increment(-1),
        [`visitsByMonth.${visitYm}`]: FieldValue.increment(-1),
      };
      if (wasCash) {
        updates.cashVisitCount = FieldValue.increment(-1);
        if (cashAmount > 0) updates.cashTotal = FieldValue.increment(-cashAmount);
        updates[`paymentsByMonth.${visitYm}`] = FieldValue.increment(-1);
      }
      // Recompute lastVisitDate if this was the most recent
      const currentLast = eventSnap.data()!.lastVisitDate as string | undefined;
      if (currentLast && currentLast === (vData.date as string)) {
        const nextSnap = await db
          .collection(`users/${actorUid}/events/${id}/visits`)
          .orderBy("date", "desc")
          .limit(1)
          .get();
        updates.lastVisitDate = nextSnap.empty
          ? FieldValue.delete()
          : (nextSnap.docs[0].data().date as string);
      }
      await eventRef.update(updates);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[visits] DELETE error", err);
    return NextResponse.json({ error: "Failed to remove event" }, { status: 500 });
  }
}
