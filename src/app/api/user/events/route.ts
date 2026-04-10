/**
 * GET  /api/user/events  — list all active events with spent totals
 * POST /api/user/events  — create a new event
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import type { UserEvent, TxTag, EventSummary } from "@/lib/events/types";
import { txFingerprint } from "@/lib/txFingerprint";
import { randomUUID } from "crypto";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const [eventsSnap, tagsSnap, profile] = await Promise.all([
      db.collection(`users/${targetUid}/events`).orderBy("createdAt", "desc").get(),
      db.collection(`users/${targetUid}/txTags`).get(),
      getFinancialProfile(targetUid, db),
    ]);

    // Build fingerprint → { amount, date } for quick lookup, keyed by txMonth for annual filtering
    const currentYear = new Date().getFullYear().toString();
    const txByFingerprint = new Map<string, { amount: number; date: string }>();
    for (const tx of profile.expenseTxns) {
      const fp = txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.merchant);
      txByFingerprint.set(fp, { amount: Math.abs(tx.amount), date: tx.date });
    }

    // Build a map of eventId → { totalSpent, txCount }
    // Annual events only count transactions from the current calendar year
    const eventsById = new Map(eventsSnap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as UserEvent]));
    const totals = new Map<string, { totalSpent: number; txCount: number }>();
    for (const tagDoc of tagsSnap.docs) {
      const tag = tagDoc.data() as TxTag;
      const tx = txByFingerprint.get(tag.txFingerprint);
      if (!tx) continue;
      for (const eventId of tag.eventIds) {
        const ev = eventsById.get(eventId);
        if (ev?.type === "annual" && !tx.date.startsWith(currentYear)) continue;
        const prev = totals.get(eventId) ?? { totalSpent: 0, txCount: 0 };
        totals.set(eventId, { totalSpent: prev.totalSpent + tx.amount, txCount: prev.txCount + 1 });
      }
    }

    const events: EventSummary[] = eventsSnap.docs
      .map((d) => {
        const ev = { id: d.id, ...d.data() } as UserEvent;
        const { totalSpent, txCount } = totals.get(ev.id) ?? { totalSpent: 0, txCount: 0 };
        return { ...ev, totalSpent, txCount };
      })
      .filter((ev) => !ev.archivedAt);

    return NextResponse.json({ events });
  } catch (err) {
    console.error("[events] GET error", err);
    return NextResponse.json({ error: "Failed to load events" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body = await req.json().catch(() => ({})) as Partial<UserEvent>;
    if (!body.name?.trim()) return NextResponse.json({ error: "name required" }, { status: 400 });

    const now = new Date().toISOString();
    const id = randomUUID();
    const event: UserEvent = {
      id,
      name: body.name.trim(),
      type: body.type ?? "one-off",
      color: body.color ?? "purple",
      createdAt: now,
      ...(body.budget != null && { budget: Number(body.budget) }),
      ...(body.date && { date: body.date }),
    };

    await db.doc(`users/${actorUid}/events/${id}`).set(event);
    return NextResponse.json({ event }, { status: 201 });
  } catch (err) {
    console.error("[events] POST error", err);
    return NextResponse.json({ error: "Failed to create event" }, { status: 500 });
  }
}
