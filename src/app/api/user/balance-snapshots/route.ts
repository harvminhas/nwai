/**
 * GET  /api/user/balance-snapshots
 *   Returns all manual balance snapshots for the user, newest first.
 *
 * POST /api/user/balance-snapshots
 *   Body: { accountSlug, accountName, accountType, balance, yearMonth, note? }
 *   Saves a manual balance entry. Does NOT overwrite any statement data.
 *
 * DELETE /api/user/balance-snapshots?id=<snapshotId>
 *   Removes a snapshot.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { randomUUID } from "crypto";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export interface BalanceSnapshot {
  id: string;
  accountSlug: string;
  accountName: string;
  accountType: string;
  /** Positive for assets, negative for debts */
  balance: number;
  /** YYYY-MM */
  yearMonth: string;
  note?: string;
  createdAt: string;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);

    const snap = await db
      .collection("users").doc(uid)
      .collection("balanceSnapshots")
      .orderBy("yearMonth", "desc")
      .get();

    const snapshots: BalanceSnapshot[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<BalanceSnapshot, "id">),
    }));

    return NextResponse.json({ snapshots });
  } catch (e) {
    console.error("[balance-snapshots GET]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const body = await req.json() as Partial<BalanceSnapshot>;

    const { accountSlug, accountName, accountType, balance, yearMonth, note } = body;
    if (!accountSlug || !yearMonth || balance === undefined) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const id = randomUUID();
    const record: Omit<BalanceSnapshot, "id"> = {
      accountSlug,
      accountName: accountName ?? accountSlug,
      accountType: accountType ?? "other",
      balance,
      yearMonth,
      createdAt: new Date().toISOString(),
      ...(note ? { note } : {}),
    };

    await db.collection("users").doc(uid).collection("balanceSnapshots").doc(id).set(record);

    return NextResponse.json({ id, ...record });
  } catch (e) {
    console.error("[balance-snapshots POST]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    await db.collection("users").doc(uid).collection("balanceSnapshots").doc(id).delete();

    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[balance-snapshots DELETE]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
