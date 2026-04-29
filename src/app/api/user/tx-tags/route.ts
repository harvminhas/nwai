/**
 * GET    /api/user/tx-tags?fingerprint=xxx       — get tag overlay for a single tx
 * POST   /api/user/tx-tags                        — upsert tag overlay (add/remove eventIds, note)
 * DELETE /api/user/tx-tags?fingerprint=xxx        — remove all tags from a transaction
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { TxTag } from "@/lib/events/types";
import { FieldValue, type Firestore } from "firebase-admin/firestore";

function normalizeEventIds(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw as string[];
  if (typeof raw === "string") return [raw];
  return [];
}

/** Apply add/remove on a copy; report which ids actually change for paymentsByMonth */
function mergeEventIds(
  prev: string[],
  add: string[] | undefined,
  remove: string[] | undefined,
): { next: string[]; removalsThatCount: string[]; addsThatCount: string[] } {
  const addL = add ?? [];
  const remL = remove ?? [];
  const removalsThatCount = remL.filter((r) => prev.includes(r));
  const addsThatCount = addL.filter((a) => !prev.includes(a));
  let next = prev.filter((id) => !remL.includes(id));
  for (const a of addL) {
    if (!next.includes(a)) next.push(a);
  }
  return { next, removalsThatCount, addsThatCount };
}

async function applyPaymentsByMonthDeltas(
  db: Firestore,
  actorUid: string,
  ym: string,
  removalsThatCount: string[],
  addsThatCount: string[],
): Promise<void> {
  if (!ym || ym.length !== 7) return;
  const ops: Promise<unknown>[] = [];
  for (const evId of addsThatCount) {
    ops.push(
      db.doc(`users/${actorUid}/events/${evId}`).update({
        [`paymentsByMonth.${ym}`]: FieldValue.increment(1),
      }).catch(() => {}),
    );
  }
  for (const evId of removalsThatCount) {
    ops.push(
      db.doc(`users/${actorUid}/events/${evId}`).update({
        [`paymentsByMonth.${ym}`]: FieldValue.increment(-1),
      }).catch(() => {}),
    );
  }
  await Promise.all(ops);
}

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
      add?: string[];
      remove?: string[];
      note?: string | null;
      date?: string;
    };

    if (!body.fingerprint) return NextResponse.json({ error: "fingerprint required" }, { status: 400 });

    const ref = db.doc(`users/${actorUid}/txTags/${body.fingerprint}`);
    const now = new Date().toISOString();
    const ym  = body.date?.substring(0, 7);

    type Outcome =
      | { kind: "created"; tag: TxTag; addsThatCount: string[]; removalsThatCount: string[] }
      | { kind: "updated"; tag: TxTag; addsThatCount: string[]; removalsThatCount: string[] }
      | { kind: "deleted"; addsThatCount: string[]; removalsThatCount: string[] };

    let outcome: Outcome;

    try {
      outcome = await db.runTransaction(async (txn) => {
        const snap = await txn.get(ref);

        if (!snap.exists) {
          if (!body.add?.length) {
            throw Object.assign(new Error("NO_ADD_WHEN_MISSING_DOC"), { code: "NO_ADD" });
          }
          const distinctAdd = [...new Set(body.add)];
          const noteVal = body.note ?? undefined;
          const newTag: TxTag = {
            txFingerprint: body.fingerprint,
            eventIds: distinctAdd,
            taggedAt: now,
            updatedAt: now,
            ...(typeof noteVal === "string" && noteVal.length > 0 ? { note: noteVal } : {}),
          };
          txn.set(ref, newTag);
          return {
            kind: "created" as const,
            tag: newTag,
            addsThatCount: distinctAdd,
            removalsThatCount: [] as string[],
          };
        }

        const prev = normalizeEventIds(snap.get("eventIds"));
        const { next, removalsThatCount, addsThatCount } = mergeEventIds(prev, body.add, body.remove);

        if (next.length === 0) {
          txn.delete(ref);
          return { kind: "deleted" as const, addsThatCount: [], removalsThatCount };
        }

        const updatePayload: Record<string, unknown> = {
          txFingerprint: (snap.get("txFingerprint") as string) || body.fingerprint,
          updatedAt: now,
          eventIds: next,
        };
        if (body.note !== undefined) {
          updatePayload.note = body.note ?? FieldValue.delete();
        }
        txn.update(ref, updatePayload);

        const taggedAt = (snap.get("taggedAt") as string) || now;
        let noteOut: string | undefined;
        if (body.note !== undefined) {
          noteOut = body.note ?? undefined;
        } else {
          noteOut = snap.get("note") as string | undefined;
        }
        const tagOut: TxTag = {
          txFingerprint: (snap.get("txFingerprint") as string) || body.fingerprint,
          eventIds: next,
          taggedAt,
          updatedAt: now,
          ...(noteOut ? { note: noteOut } : {}),
        };
        return {
          kind: "updated" as const,
          tag: tagOut,
          addsThatCount,
          removalsThatCount,
        };
      });
    } catch (e: unknown) {
      if ((e as { code?: string })?.code === "NO_ADD" || (e as Error)?.message === "NO_ADD_WHEN_MISSING_DOC") {
        return NextResponse.json({ error: "No eventIds to add" }, { status: 400 });
      }
      throw e;
    }

    await applyPaymentsByMonthDeltas(db, actorUid, ym ?? "", outcome.removalsThatCount, outcome.addsThatCount);

    if (outcome.kind === "deleted") return NextResponse.json({ tag: null });
    return NextResponse.json({ tag: outcome.tag });
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
