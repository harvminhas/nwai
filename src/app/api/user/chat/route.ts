import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildFinancialBrief } from "@/lib/financialBrief";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

// ── system prompt ──────────────────────────────────────────────────────────────

function buildSystemPrompt(brief: string): string {
  return `You are a knowledgeable, friendly personal finance assistant. You have access to the user's real financial data shown below. 

CRITICAL RULES:
- Always ground your answers in the actual numbers from the data. Cite specific figures.
- Never invent numbers not present in the data.
- If asked something the data doesn't cover, say so clearly.
- Keep responses concise and actionable. Use bullet points for lists.
- Use plain language — no jargon unless the user uses it first.
- When you spot something worth flagging (low emergency fund, high debt cost, etc.), mention it once briefly.
- Always note which time period the data is from (e.g., "Based on your March 2025 data...").
- This is financial analysis only, not regulated financial advice.

USER'S FINANCIAL DATA:
${brief}`;
}

// ── route handler ──────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Auth
  const authHeader = req.headers.get("Authorization") ?? "";
  const idToken = authHeader.replace("Bearer ", "").trim();
  if (!idToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let uid: string;
  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(idToken);
    uid = decoded.uid;
  } catch {
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // Parse body
  let message: string;
  let history: ChatMessage[];
  try {
    const body = await req.json();
    message = (body.message ?? "").trim();
    history = Array.isArray(body.history) ? body.history : [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!message) return NextResponse.json({ error: "Message is required" }, { status: 400 });

  // Check plan
  const { db } = getFirebaseAdmin();
  const userDoc = await db.collection("users").doc(uid).get();
  const plan: string = userDoc.exists ? (userDoc.data()?.plan ?? "free") : "free";
  if (plan === "free") {
    return NextResponse.json({ error: "AI Chat is a Pro feature. Upgrade to access." }, { status: 403 });
  }

  // Build financial brief
  const brief = await buildFinancialBrief(uid);

  // Set up Gemini streaming
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "AI not configured" }, { status: 500 });

  const genAI  = new GoogleGenerativeAI(apiKey);
  const model  = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: buildSystemPrompt(brief),
  });

  // Convert history to Gemini format (max last 10 turns to save tokens)
  const recentHistory = history.slice(-20);
  const geminiHistory = recentHistory.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  const chat   = model.startChat({ history: geminiHistory });
  const result = await chat.sendMessageStream(message);

  // Stream response back
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const chunk of result.stream) {
          const text = chunk.text();
          if (text) controller.enqueue(new TextEncoder().encode(text));
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "no-cache",
    },
  });
}
