/**
 * GET    /api/user/events/[id]  — event detail with tagged transactions
 * PUT    /api/user/events/[id]  — update event
 * DELETE /api/user/events/[id]  — archive event (soft delete)
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import type { UserEvent, TxTag, TaggedTransaction } from "@/lib/events/types";
import { txFingerprint } from "@/lib/txFingerprint";
import { FieldValue } from "firebase-admin/firestore";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const [eventSnap, tagsSnap, profile] = await Promise.all([
      db.doc(`users/${targetUid}/events/${id}`).get(),
      db.collection(`users/${targetUid}/txTags`).get(),
      getFinancialProfile(targetUid, db),
    ]);

    if (!eventSnap.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });
    const event = { id: eventSnap.id, ...eventSnap.data() } as UserEvent;

    // Annual events only show the current year's transactions
    const currentYear = new Date().getFullYear().toString();

    // Build fingerprint → tag map
    const tagByFingerprint = new Map<string, TxTag>();
    for (const d of tagsSnap.docs) {
      const tag = d.data() as TxTag;
      if (tag.eventIds.includes(id)) tagByFingerprint.set(tag.txFingerprint, tag);
    }

    // Join with actual transactions from the profile
    const tagged: TaggedTransaction[] = [];
    for (const tx of profile.expenseTxns) {
      // Annual events: only count transactions from the current calendar year
      if (event.type === "annual" && !tx.date.startsWith(currentYear)) continue;
      const fp = txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.merchant);
      const tag = tagByFingerprint.get(fp);
      if (!tag) continue;
      tagged.push({
        fingerprint: fp,
        date: tx.date,
        description: tx.merchant,
        amount: Math.abs(tx.amount),
        category: tx.category ?? "Other",
        accountLabel: tx.accountLabel ?? "",
        eventIds: tag.eventIds,
        note: tag.note,
      });
    }

    tagged.sort((a, b) => b.date.localeCompare(a.date));
    const totalSpent = tagged.reduce((s, t) => s + t.amount, 0);

    return NextResponse.json({ event, transactions: tagged, totalSpent, currentYear });
  } catch (err) {
    console.error("[events/id] GET error", err);
    return NextResponse.json({ error: "Failed to load event" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body = await req.json().catch(() => ({})) as Partial<UserEvent>;
    const ref = db.doc(`users/${actorUid}/events/${id}`);
    const snap = await ref.get();
    if (!snap.exists) return NextResponse.json({ error: "Event not found" }, { status: 404 });

    const updates: Record<string, unknown> = {};
    if (body.name != null)   updates.name   = body.name.trim();
    if (body.type != null)   updates.type   = body.type;
    if (body.color != null)  updates.color  = body.color;
    if (body.date !== undefined)   updates.date   = body.date || FieldValue.delete();
    if (body.budget !== undefined) updates.budget = body.budget ? Number(body.budget) : FieldValue.delete();

    await ref.update(updates);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[events/id] PUT error", err);
    return NextResponse.json({ error: "Failed to update event" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    await db.doc(`users/${actorUid}/events/${id}`).update({
      archivedAt: new Date().toISOString(),
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[events/id] DELETE error", err);
    return NextResponse.json({ error: "Failed to archive event" }, { status: 500 });
  }
}
