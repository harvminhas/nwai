/**
 * GET  /api/user/chat-sessions
 *   Returns the most recent chat session (id, title, messages, updatedAt).
 *   Returns { session: null } when the user has no sessions yet.
 *
 * POST /api/user/chat-sessions
 *   Creates a new empty session. Returns { id }.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export interface StoredMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatSession {
  id: string;
  title: string;
  messages: StoredMessage[];
  createdAt: string;
  updatedAt: string;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const snap = await db
      .collection(`users/${uid}/chatSessions`)
      .orderBy("updatedAt", "desc")
      .limit(10)
      .get();
    if (snap.empty) return NextResponse.json({ sessions: [] });
    const sessions: ChatSession[] = snap.docs
      .filter((doc) => (doc.data().messages?.length ?? 0) > 0)
      .map((doc) => {
        const data = doc.data();
        return {
          id: doc.id,
          title: data.title ?? "Conversation",
          // Omit full messages from list response — only include message count
          messages: [] as StoredMessage[],
          messageCount: data.messages?.length ?? 0,
          createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? "",
          updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? "",
        };
      });
    return NextResponse.json({ sessions });
  } catch (err) {
    console.error("GET /api/user/chat-sessions error:", err);
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
  }
}

export async function GET_SESSION(uid: string, sessionId: string, db: import("firebase-admin/firestore").Firestore): Promise<ChatSession | null> {
  const doc = await db.collection(`users/${uid}/chatSessions`).doc(sessionId).get();
  if (!doc.exists) return null;
  const data = doc.data()!;
  return {
    id: doc.id,
    title: data.title ?? "Conversation",
    messages: (data.messages ?? []) as StoredMessage[],
    createdAt: data.createdAt?.toDate?.()?.toISOString?.() ?? data.createdAt ?? "",
    updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? data.updatedAt ?? "",
  };
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const ref = await db.collection(`users/${uid}/chatSessions`).add({
      title: "New conversation",
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return NextResponse.json({ id: ref.id });
  } catch (err) {
    console.error("POST /api/user/chat-sessions error:", err);
    return NextResponse.json({ error: "Failed to create session" }, { status: 500 });
  }
}
