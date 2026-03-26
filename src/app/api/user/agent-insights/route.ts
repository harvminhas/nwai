/**
 * GET  /api/user/agent-insights        — load active (non-dismissed) cards
 * POST /api/user/agent-insights        — dismiss or complete a card
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { AgentCard } from "@/lib/agentTypes";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

// ── GET — load non-dismissed cards ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);

    const snap = await db
      .collection("users").doc(uid)
      .collection("agentInsights")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const cards: AgentCard[] = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as AgentCard))
      .filter((c) => !c.dismissed);

    return NextResponse.json({ cards });
  } catch (err) {
    console.error("GET /api/user/agent-insights error:", err);
    return NextResponse.json({ error: "Failed to load insights" }, { status: 500 });
  }
}

// ── POST — dismiss or mark complete ───────────────────────────────────────────

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const body = await req.json().catch(() => ({})) as {
      action?: "dismiss" | "complete";
      cardId?: string;
    };

    const { action, cardId } = body;
    if (!cardId || !action) {
      return NextResponse.json({ error: "cardId and action required" }, { status: 400 });
    }

    const ref = db.collection("users").doc(uid).collection("agentInsights").doc(cardId);
    const doc = await ref.get();
    if (!doc.exists) return NextResponse.json({ error: "Card not found" }, { status: 404 });

    if (action === "dismiss") {
      await ref.update({ dismissed: true });
    } else if (action === "complete") {
      await ref.update({ completedAt: new Date().toISOString(), dismissed: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("POST /api/user/agent-insights error:", err);
    return NextResponse.json({ error: "Failed to update insight" }, { status: 500 });
  }
}
