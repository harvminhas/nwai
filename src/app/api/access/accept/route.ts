/**
 * GET  /api/access/accept?token=  — peek at invite info without accepting
 * POST /api/access/accept         — accept a partner invite by token
 * Body: { token: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { acceptInvite } from "@/lib/access/linkedPartner";
import type { PendingPartnerInvite } from "@/lib/access/types";

function authToken(req: NextRequest): string | null {
  return req.headers.get("authorization")?.replace("Bearer ", "").trim() ?? null;
}

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token");
  if (!token) return NextResponse.json({ error: "token required" }, { status: 400 });

  try {
    const { db } = getFirebaseAdmin();
    const snap = await db.doc(`linkedPartnerInvites/${token}`).get();
    if (!snap.exists) return NextResponse.json({ error: "Invite not found or already used" }, { status: 404 });

    const invite = snap.data() as PendingPartnerInvite;
    if (invite.status !== "pending") return NextResponse.json({ error: "Invite already used" }, { status: 410 });

    return NextResponse.json({
      initiatorName: invite.initiatorName,
      initiatorEmail: invite.initiatorEmail,
    });
  } catch (err) {
    console.error("[access/accept] GET error", err);
    return NextResponse.json({ error: "Failed to load invite" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);

    const body = (await req.json().catch(() => ({}))) as { token?: string };
    if (!body.token) return NextResponse.json({ error: "token required" }, { status: 400 });

    const userRecord = await auth.getUser(uid);
    const result = await acceptInvite(
      body.token,
      uid,
      userRecord.email ?? "",
      userRecord.displayName ?? userRecord.email ?? uid,
      db,
    );

    if (!result) {
      return NextResponse.json({ error: "Invalid or already used invite link" }, { status: 404 });
    }

    return NextResponse.json({ ok: true, partnerUid: result.initiatorUid });
  } catch (err) {
    console.error("[access/accept] POST error", err);
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 });
  }
}
