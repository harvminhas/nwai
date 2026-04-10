/**
 * GET   /api/access/grants  — returns current linked partner + any pending invite sent/received
 * POST  /api/access/grants  — send a partner invite (Pro only, max 1 link)
 * PATCH /api/access/grants  — save last-viewed-account preference { lastViewedAccount: "self"|"partner" }
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import {
  createInvite,
  getLinkedPartner,
  getPendingInviteSent,
  getPendingInviteByEmail,
} from "@/lib/access/linkedPartner";

function authToken(req: NextRequest): string | null {
  return req.headers.get("authorization")?.replace("Bearer ", "").trim() ?? null;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid, email } = await auth.verifyIdToken(token);

    const [partner, pendingSent, pendingReceived, userDoc] = await Promise.all([
      getLinkedPartner(uid, db),
      getPendingInviteSent(uid, db),
      email ? getPendingInviteByEmail(email, db) : Promise.resolve(null),
      db.collection("users").doc(uid).get(),
    ]);

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const lastViewedAccount = (userDoc.data()?.lastViewedAccount as "self" | "partner" | undefined) ?? "self";

    return NextResponse.json({
      partner,
      lastViewedAccount,
      pendingSent: pendingSent
        ? { ...pendingSent, inviteUrl: `${appUrl}/invite?token=${pendingSent.token}` }
        : null,
      // Only surface pendingReceived if it's from someone other than self
      pendingReceived: pendingReceived && pendingReceived.initiatorUid !== uid
        ? { ...pendingReceived, inviteUrl: `${appUrl}/invite?token=${pendingReceived.token}` }
        : null,
    });
  } catch (err) {
    console.error("[access/grants] GET error", err);
    return NextResponse.json({ error: "Failed to load" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);

    const body = (await req.json().catch(() => ({}))) as { inviteeEmail?: string };
    if (!body.inviteeEmail?.trim()) {
      return NextResponse.json({ error: "inviteeEmail required" }, { status: 400 });
    }

    const ownerRecord = await auth.getUser(uid);

    // Don't allow inviting yourself
    if (ownerRecord.email?.toLowerCase() === body.inviteeEmail.toLowerCase().trim()) {
      return NextResponse.json({ error: "Cannot invite yourself" }, { status: 400 });
    }

    // Already linked — must unlink first
    const existing = await getLinkedPartner(uid, db);
    if (existing) {
      return NextResponse.json({ error: "You already have a linked partner. Unlink first." }, { status: 409 });
    }

    // Reject if the invitee already has an account — linked accounts must be new users for now
    try {
      await auth.getUserByEmail(body.inviteeEmail.toLowerCase().trim());
      return NextResponse.json({
        error: "That email already has an account. For now, linked accounts must be new users — ask them to use a different email.",
      }, { status: 409 });
    } catch {
      // getUserByEmail throws if not found — that's the happy path (new user)
    }

    const invite = await createInvite(
      uid,
      ownerRecord.email ?? "",
      ownerRecord.displayName ?? ownerRecord.email ?? uid,
      body.inviteeEmail.trim(),
      db,
    );

    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
    const inviteUrl = `${appUrl}/invite?token=${invite.token}`;

    // TODO: wire email — send inviteUrl to body.inviteeEmail
    return NextResponse.json({ inviteUrl });
  } catch (err) {
    console.error("[access/grants] POST error", err);
    return NextResponse.json({ error: "Failed to create invite" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const body = (await req.json().catch(() => ({}))) as { lastViewedAccount?: string };
    if (body.lastViewedAccount !== "self" && body.lastViewedAccount !== "partner") {
      return NextResponse.json({ error: "Invalid value" }, { status: 400 });
    }
    await db.collection("users").doc(uid).set(
      { lastViewedAccount: body.lastViewedAccount },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[access/grants] PATCH error", err);
    return NextResponse.json({ error: "Failed to save preference" }, { status: 500 });
  }
}
