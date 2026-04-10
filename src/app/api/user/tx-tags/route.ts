/**
 * GET    /api/user/tx-tags?fingerprint=xxx       — get tag overlay for a single tx
 * POST   /api/user/tx-tags                        — upsert tag overlay (add/remove eventIds, note)
 * DELETE /api/user/tx-tags?fingerprint=xxx        — remove all tags from a transaction
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { TxTag } from "@/lib/events/types";
import { FieldValue } from "firebase-admin/firestore";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  const fingerprint = new URL(req.url).searchParams.get("fingerprint");
  if (!fingerprint) return NextResponse.json({ error: "fingerprint required" }, { status: 400 });

  const snap = await db.doc(`users/${targetUid}/txTags/${fingerprint}`).get();
  return NextResponse.json({ tag: snap.exists ? (snap.data() as TxTag) : null });
}

export async function POST(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    const body = await req.json() as {
      fingerprint: string;
      /** eventIds to add */
      add?: string[];
      /** eventIds to remove */
      remove?: string[];
      /** optional note — pass null to clear */
      note?: string | null;
    };

    if (!body.fingerprint) return NextResponse.json({ error: "fingerprint required" }, { status: 400 });

    const ref = db.doc(`users/${actorUid}/txTags/${body.fingerprint}`);
    const snap = await ref.get();
    const now = new Date().toISOString();

    if (!snap.exists) {
      if (!body.add?.length) return NextResponse.json({ error: "No eventIds to add" }, { status: 400 });
      const tag: TxTag = {
        txFingerprint: body.fingerprint,
        eventIds: body.add,
        taggedAt: now,
        updatedAt: now,
        ...(body.note != null && body.note !== null ? { note: body.note } : {}),
      };
      await ref.set(tag);
      return NextResponse.json({ tag });
    }

    const updates: Record<string, unknown> = { updatedAt: now };
    if (body.add?.length)    updates.eventIds = FieldValue.arrayUnion(...body.add);
    if (body.remove?.length) updates.eventIds = FieldValue.arrayRemove(...body.remove);
    if (body.note !== undefined) updates.note = body.note ?? FieldValue.delete();

    await ref.update(updates);

    // If no eventIds remain after removal, clean up the doc
    const updated = await ref.get();
    const data = updated.data() as TxTag | undefined;
    if (data && (!data.eventIds || data.eventIds.length === 0)) {
      await ref.delete();
      return NextResponse.json({ tag: null });
    }

    return NextResponse.json({ tag: updated.data() ?? null });
  } catch (err) {
    console.error("[tx-tags] POST error", err);
    return NextResponse.json({ error: "Failed to update tag" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  const fingerprint = new URL(req.url).searchParams.get("fingerprint");
  if (!fingerprint) return NextResponse.json({ error: "fingerprint required" }, { status: 400 });

  await db.doc(`users/${actorUid}/txTags/${fingerprint}`).delete();
  return NextResponse.json({ ok: true });
}
