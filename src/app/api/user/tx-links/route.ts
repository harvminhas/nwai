/**
 * GET    /api/user/tx-links?fingerprint=xxx       — get links for one transaction
 * POST   /api/user/tx-links                        — add link to a transaction
 * DELETE /api/user/tx-links                        — remove a link from a transaction
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { TransactionLinks, HubLink } from "@/lib/types";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  const fingerprint = new URL(req.url).searchParams.get("fingerprint");
  if (!fingerprint) return NextResponse.json({ error: "fingerprint required" }, { status: 400 });

  const snap = await db.doc(`users/${targetUid}/txLinks/${fingerprint}`).get();
  const data = snap.exists ? (snap.data() as TransactionLinks) : null;
  return NextResponse.json({ links: data?.links ?? [] });
}

export async function POST(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const body = await req.json() as {
      fingerprint: string;
      hubId: string;
      role: string;
      amount?: number;
    };

    if (!body.fingerprint || !body.hubId || !body.role) {
      return NextResponse.json({ error: "fingerprint, hubId, and role are required" }, { status: 400 });
    }

    const validRoles = ["finances", "secures", "funds", "spend_on", "grouped_under", "income_from"];
    if (!validRoles.includes(body.role)) {
      return NextResponse.json({ error: `Invalid role. Must be one of: ${validRoles.join(", ")}` }, { status: 400 });
    }

    // Only funds role can have partial amount
    if (body.amount !== undefined && body.role !== "funds") {
      return NextResponse.json({ error: "Only 'funds' role can have partial amount" }, { status: 400 });
    }

    const ref = db.doc(`users/${targetUid}/txLinks/${body.fingerprint}`);
    const now = new Date().toISOString();

    const snap = await ref.get();
    const existing = snap.exists ? (snap.data() as TransactionLinks) : null;
    const links = existing?.links ?? [];

    // Check if this link already exists (same hub + role)
    const alreadyLinked = links.some((l) => l.hubId === body.hubId && l.role === body.role);
    if (alreadyLinked) {
      return NextResponse.json({ error: "This link already exists" }, { status: 400 });
    }

    const newLink: HubLink = {
      hubId: body.hubId,
      role: body.role as HubLink["role"],
      createdAt: now,
    };

    if (body.amount !== undefined) {
      newLink.amount = body.amount;
    }

    const updated: TransactionLinks = {
      txFingerprint: body.fingerprint,
      links: [...links, newLink],
      updatedAt: now,
    };

    await ref.set(updated);

    return NextResponse.json({ ok: true, links: updated.links });
  } catch (err) {
    console.error("[tx-links] POST error", err);
    return NextResponse.json({ error: "Failed to create link" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  try {
    const body = await req.json() as {
      fingerprint: string;
      hubId: string;
      role: string;
    };

    if (!body.fingerprint || !body.hubId || !body.role) {
      return NextResponse.json({ error: "fingerprint, hubId, and role are required" }, { status: 400 });
    }

    const ref = db.doc(`users/${targetUid}/txLinks/${body.fingerprint}`);
    const snap = await ref.get();
    
    if (!snap.exists) {
      return NextResponse.json({ error: "No links found for this transaction" }, { status: 404 });
    }

    const data = snap.data() as TransactionLinks;
    const filtered = data.links.filter((l) => !(l.hubId === body.hubId && l.role === body.role));

    if (filtered.length === data.links.length) {
      return NextResponse.json({ error: "Link not found" }, { status: 404 });
    }

    if (filtered.length === 0) {
      await ref.delete();
    } else {
      await ref.update({
        links: filtered,
        updatedAt: new Date().toISOString(),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[tx-links] DELETE error", err);
    return NextResponse.json({ error: "Failed to delete link" }, { status: 500 });
  }
}
