/**
 * POST /api/user/events/[id]/visits
 *   Log an event for a recurring service.
 *   Body: { date: string (YYYY-MM-DD), note?: string,
 *           paymentMethod?: "cash" | "card" | "statement", amount?: number }
 *
 *   When paymentMethod === "cash", a one-off cashCommitment is also written
 *   so the payment appears in the spending profile immediately.
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

    const paymentMethod = body.paymentMethod as "cash" | "card" | "statement" | undefined;
    const rawAmount     = (paymentMethod === "cash" || paymentMethod === "card") ? Number(body.amount) : undefined;
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
    const evName      = (eventSnap.data()!.name as string | undefined) ?? "Service";
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
    if (paymentMethod === "card") {
      updates.cardVisitCount = FieldValue.increment(1);
      updates[`paymentsByMonth.${ym}`] = FieldValue.increment(1);
    }
    await eventRef.update(updates);

    // Cash payments → write a one-off cashCommitment so it appears in spending profile
    if (paymentMethod === "cash" && amount) {
      const commitmentId = randomUUID();
      const now = new Date().toISOString();
      await db.doc(`users/${actorUid}/cashCommitments/${commitmentId}`).set({
        id: commitmentId,
        name: evName,
        amount,
        frequency: "once",
        category: "Services",
        notes: `Logged via tracker · visit ${visitId}`,
        nextDate: date,
        startDate: date,
        createdAt: now,
        updatedAt: now,
        // Back-reference so we can clean up if the visit is deleted
        sourceVisitId: visitId,
        sourceEventId: id,
      });
    }

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
    const wasCard       = vData.paymentMethod === "card";
    const cashAmount    = wasCash && vData.amount ? Number(vData.amount) : 0;

    await visitRef.delete();

    // If this was a cash visit, remove the linked cashCommitment from spending
    if (wasCash && vData.sourceVisitId) {
      const commitSnap = await db
        .collection(`users/${actorUid}/cashCommitments`)
        .where("sourceVisitId", "==", visitId)
        .limit(1)
        .get();
      if (!commitSnap.empty) await commitSnap.docs[0].ref.delete();
    }

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
      if (wasCard) {
        updates.cardVisitCount = FieldValue.increment(-1);
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
