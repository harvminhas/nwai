/**
 * POST /api/user/agent-actions — execute a Tier-2 tool action
 *
 * Supported tools:
 *   create_goal               — creates a goal in users/{uid}/goals
 *   mark_subscription_cancelled — marks subscription + updates budget note
 *   set_budget_limit          — stores a category budget limit
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { AgentActionTool } from "@/lib/agentTypes";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);

    const body = await req.json().catch(() => ({})) as {
      tool?: AgentActionTool;
      params?: Record<string, unknown>;
      insightId?: string;
    };

    const { tool, params = {}, insightId } = body;
    if (!tool) return NextResponse.json({ error: "tool is required" }, { status: 400 });

    const userRef = db.collection("users").doc(uid);
    const now = new Date().toISOString();
    let resultMessage = "";

    // ── Tool handlers ──────────────────────────────────────────────────────

    if (tool === "create_goal") {
      const { title, targetAmount, emoji } = params as {
        title?: string; targetAmount?: number; emoji?: string;
      };
      if (!title) return NextResponse.json({ error: "title required for create_goal" }, { status: 400 });
      await userRef.collection("goals").add({
        title,
        targetAmount: targetAmount ?? null,
        emoji: emoji ?? "🎯",
        description: "Created by AI agent",
        createdAt: new Date(),
        source: "agent",
      });
      resultMessage = `Goal "${title}" created.`;
    }

    else if (tool === "mark_subscription_cancelled") {
      const { merchantSlug, merchantName } = params as {
        merchantSlug?: string; merchantName?: string;
      };
      if (!merchantSlug) return NextResponse.json({ error: "merchantSlug required" }, { status: 400 });
      // Store a cancellation note in the recurring rules collection
      await userRef.collection("recurringRules").doc(merchantSlug).set({
        merchant: merchantName ?? merchantSlug,
        slug: merchantSlug,
        frequency: "never",
        category: "Cancelled",
        cancelledAt: now,
        cancelledBy: "agent",
        amount: 0,
      }, { merge: true });
      resultMessage = `${merchantName ?? merchantSlug} marked as cancelled.`;
    }

    else if (tool === "set_budget_limit") {
      const { category, limit } = params as { category?: string; limit?: number };
      if (!category || limit == null) {
        return NextResponse.json({ error: "category and limit required" }, { status: 400 });
      }
      await userRef.collection("budgetLimits").doc(
        category.toLowerCase().replace(/\s+/g, "-")
      ).set({
        category, limit, updatedAt: now, source: "agent",
      });
      resultMessage = `Budget limit of $${limit}/mo set for ${category}.`;
    }

    else {
      return NextResponse.json({ error: `Unknown tool: ${tool}` }, { status: 400 });
    }

    // ── Log to action queue ────────────────────────────────────────────────
    await userRef.collection("agentActions").add({
      tool, params, status: "completed",
      createdAt: now, completedAt: now,
      insightId: insightId ?? null,
      source: "agent", resultMessage,
    });

    // ── Mark insight as completed ──────────────────────────────────────────
    if (insightId) {
      const insightRef = userRef.collection("agentInsights").doc(insightId);
      const insightDoc = await insightRef.get();
      if (insightDoc.exists) {
        await insightRef.update({ completedAt: now, dismissed: true });
      }
    }

    return NextResponse.json({ ok: true, resultMessage });
  } catch (err) {
    console.error("POST /api/user/agent-actions error:", err);
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
