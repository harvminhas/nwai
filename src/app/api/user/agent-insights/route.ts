/**
 * GET  /api/user/agent-insights        — load active (non-dismissed) cards
 * POST /api/user/agent-insights        — dismiss or complete a card
 *
 * On GET: silently refreshes external data cards if global data is newer
 * than what the user already has. This means users see fresh market signals
 * on every visit — no statement upload required.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { AgentCard } from "@/lib/agentTypes";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { generateExternalCardsForUser } from "@/lib/external/pipeline";

// ── GET — load non-dismissed cards ────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Refresh external cards if global data has been updated since last visit.
  // Fire-and-forget — we await it so the response includes any new cards,
  // but a failure here never blocks the user from seeing their existing cards.
  try {
    await generateExternalCardsForUser(access.targetUid, db);
  } catch (err) {
    console.error("[agent-insights] external card refresh failed:", err);
  }

  try {
    const snap = await db
      .collection("users").doc(access.targetUid)
      .collection("agentInsights")
      .orderBy("createdAt", "desc")
      .limit(20)
      .get();

    const cards: AgentCard[] = snap.docs
      .map((d) => ({ id: d.id, ...d.data() } as AgentCard))
      .filter((c) => !c.dismissed);

    console.log(`[agent-insights] uid=${access.targetUid} returning ${cards.length} card(s) (${snap.docs.length} total in collection)`);

    return NextResponse.json({ cards });
  } catch (err) {
    console.error("GET /api/user/agent-insights error:", err);
    return NextResponse.json({ error: "Failed to load insights" }, { status: 500 });
  }
}

// ── POST — dismiss or mark complete ───────────────────────────────────────────

export async function POST(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Dismissals always apply to the actor's own insights, not the shared account
  const uid = access.actorUid;

  try {
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
