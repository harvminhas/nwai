/**
 * GET    /api/user/chat-sessions/[id]   — load full messages for a session
 * PATCH  /api/user/chat-sessions/[id]   — save messages + title (caps at 100)
 * DELETE /api/user/chat-sessions/[id]   — delete the session
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { StoredMessage } from "@/app/api/user/chat-sessions/route";

const MAX_MESSAGES = 100;

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    const doc = await db.collection(`users/${uid}/chatSessions`).doc(id).get();
    if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
    const data = doc.data()!;
    return NextResponse.json({
      session: {
        id: doc.id,
        title: data.title ?? "Conversation",
        messages: (data.messages ?? []) as StoredMessage[],
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? "",
      },
    });
  } catch (err) {
    console.error("GET /api/user/chat-sessions/[id] error:", err);
    return NextResponse.json({ error: "Failed to load session" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    const body = await req.json();
    const messages: StoredMessage[] = (body.messages ?? []).slice(-MAX_MESSAGES);
    const title: string =
      body.title ??
      messages.find((m) => m.role === "user")?.content.slice(0, 60) ??
      "Conversation";
    await db.collection(`users/${uid}/chatSessions`).doc(id).set(
      { messages, title, updatedAt: new Date() },
      { merge: true },
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PATCH /api/user/chat-sessions/[id] error:", err);
    return NextResponse.json({ error: "Failed to save session" }, { status: 500 });
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const { id } = await params;
    await db.collection(`users/${uid}/chatSessions`).doc(id).delete();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("DELETE /api/user/chat-sessions/[id] error:", err);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
