/**
 * POST /api/user/chat
 *
 * AI chat with Gemini function calling.
 *
 * Flow:
 *   1. Load financial profile from cache (single Firestore read).
 *   2. Build compact system context (balances, monthly totals — no transaction list).
 *   3. Non-streaming round: send message to Gemini with tool declarations.
 *   4. If model returns function call(s): execute them in-memory (no extra DB reads),
 *      send results back, repeat up to MAX_TOOL_ROUNDS.
 *   5. Stream the final text response back to the client.
 *
 * Adding a new tool: add its FunctionDeclaration in src/lib/chat/tools.ts
 * and its execute* function + executeTool switch in src/lib/chat/executor.ts.
 */

import { NextRequest, NextResponse } from "next/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import type { Part } from "@google/generative-ai";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { resolvePlan } from "@/app/api/user/plan/route";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { CHAT_TOOLS } from "@/lib/chat/tools";
import { executeTool } from "@/lib/chat/executor";
import type { ToolParams } from "@/lib/chat/executor";
import { buildChatContext } from "@/lib/chat/context";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Max tool-call rounds per request (prevents runaway loops). */
const MAX_TOOL_ROUNDS = 4;

const STREAM_HEADERS = {
  "Content-Type": "text/plain; charset=utf-8",
  "X-Content-Type-Options": "nosniff",
  "Cache-Control": "no-cache",
};

// ── route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // ── 1. Auth ────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") ?? "";
  const idToken    = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { auth, db } = getFirebaseAdmin();
  let actorUid: string;
  try {
    const decoded = await auth.verifyIdToken(idToken);
    actorUid      = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // ── 2. Resolve active profile (own vs. shared partner) ────────────────────
  const access    = await resolveAccess(req, db);
  const targetUid = access?.targetUid ?? actorUid;

  // ── 3. Plan gate (actor must be Pro) ──────────────────────────────────────
  const actorDoc  = await db.collection("users").doc(actorUid).get();
  const actorPlan = resolvePlan(
    actorDoc.exists ? (actorDoc.data() as Record<string, unknown>) : undefined,
  ) ?? "free";
  if (actorPlan === "free") {
    return NextResponse.json(
      { error: "AI Chat is a Pro feature. Upgrade to access." },
      { status: 403 },
    );
  }

  // ── 4. Parse body ─────────────────────────────────────────────────────────
  let message: string;
  let history: ChatMessage[];
  try {
    const body = await req.json();
    message    = (body.message ?? "").trim();
    history    = Array.isArray(body.history) ? body.history : [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "AI not configured" }, { status: 500 });

  // ── 5. Load financial profile (uses cache — no per-request rebuild) ────────
  console.log(`[chat] POST uid=${targetUid} message="${message.slice(0, 60)}"`);
  const profile = await getFinancialProfile(targetUid, db);
  console.log(`[chat] profile loaded — expTxns=${profile.expenseTxns.length} months=${profile.allTxMonths.length} stale=${profile.cacheStale ?? false}`);

  // ── 6. Build compact system context ───────────────────────────────────────
  const systemContext = buildChatContext(profile);

  // ── 7. Set up Gemini model with tools ─────────────────────────────────────
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemContext,
    tools: CHAT_TOOLS,
  });

  // Convert history to Gemini format (max last 20 turns).
  // Gemini requires history to start with a 'user' turn — drop any leading model messages.
  const rawHistory = history.slice(-20).map((m) => ({
    role:  m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const firstUserIdx  = rawHistory.findIndex((m) => m.role === "user");
  const geminiHistory = firstUserIdx > 0 ? rawHistory.slice(firstUserIdx) : rawHistory;

  const chat = model.startChat({ history: geminiHistory });

  // ── 8. Tool call loop (non-streaming) ─────────────────────────────────────
  // We use non-streaming for rounds that may produce tool calls, then switch
  // to streaming for the final text response.

  let pendingParts: string | Part[] = message;
  let finalText: string | null      = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result   = await chat.sendMessage(pendingParts);
    const response = result.response;

    // Check for function calls in this round
    const functionCalls = response.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      // No tools requested — this IS the final answer
      finalText = response.text();
      break;
    }

    // Execute all tool calls (in-memory, parallel)
    console.log(`[chat] round=${round + 1} tools=${functionCalls.map((f) => `${f.name}(${JSON.stringify(f.args)})`).join(", ")}`);
    const functionResponseParts: Part[] = await Promise.all(
      functionCalls.map(async (fc) => {
        const toolResult = executeTool(fc.name, fc.args as ToolParams, profile);
        const rows = toolResult.data?.rows;
        console.log(`[chat] tool=${fc.name} rows=${Array.isArray(rows) ? rows.length : "n/a"}`);
        if (Array.isArray(rows)) {
          rows.forEach((r: Record<string, unknown>, i: number) =>
            console.log(`[chat]   row[${i}] ${r.date} | ${r.merchant} | ${r.amount} | cat=${r.category}`),
          );
        }
        return {
          functionResponse: {
            name:     fc.name,
            response: toolResult.ok
              ? toolResult.data
              : { error: toolResult.error ?? "Tool execution failed" },
          },
        } as Part;
      }),
    );

    pendingParts = functionResponseParts;

    // If this was the last allowed round, force a text response on the next iteration.
    // The loop will call sendMessage once more with the function responses,
    // and since we've hit MAX_TOOL_ROUNDS the model must answer in text.
  }

  // ── 9. If we used all rounds without a final text answer, do one last call ─
  if (finalText === null) {
    const lastResult = await chat.sendMessage(pendingParts);
    finalText        = lastResult.response.text();
  }

  // ── 10. Stream the final answer back ──────────────────────────────────────
  // We have the full text from the non-streaming calls above.
  // Write it to a ReadableStream so the client-side streaming reader works
  // identically to the previous implementation.
  const encoder    = new TextEncoder();
  const textToSend = finalText ?? "";

  const stream = new ReadableStream({
    start(controller) {
      // Emit in ~80-char chunks to give a streaming feel
      const CHUNK = 80;
      for (let i = 0; i < textToSend.length; i += CHUNK) {
        controller.enqueue(encoder.encode(textToSend.slice(i, i + CHUNK)));
      }
      controller.close();
    },
  });

  return new Response(stream, { headers: STREAM_HEADERS });
}
