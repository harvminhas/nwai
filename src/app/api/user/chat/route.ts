import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildFinancialBrief } from "@/lib/financialBrief";
import { getFinancialProfile } from "@/lib/financialProfile";
import { resolvePlan } from "@/app/api/user/plan/route";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

const DEFAULT_MONTHS = 3;
const MAX_MONTHS = 24;

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

FORMATTING RULES:
- When your answer contains a key metric (savings rate, income, expenses, net worth, savings amount, debt total, etc.), lead with it on its own bolded line: e.g. **Savings Rate: -9.8%**
- Follow immediately with 1-2 supporting figures on the next line (e.g. Income: $7,276 | Expenses: $7,991)
- Then your explanation paragraph(s).
- For lists of items (e.g. top spending categories), use bullet points with bold merchant/category names.

USER'S FINANCIAL DATA:
${brief}`;
}

// ── pre-call: determine how many months this query needs ──────────────────────

/**
 * Ask the model how many months of history are needed to answer the query.
 * Returns a number between 1 and MAX_MONTHS. Falls back to DEFAULT_MONTHS on any error.
 */
async function resolveMonthsNeeded(
  apiKey: string,
  message: string,
  availableMonths: number,
): Promise<number> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const scout = genAI.getGenerativeModel({ model: "gemini-2.0-flash-lite" });
    const prompt =
      `The user is asking their personal finance assistant: "${message}"\n` +
      `The user has ${availableMonths} months of transaction history available.\n` +
      `How many months of data are needed to answer this question accurately?\n` +
      `Reply with ONLY a single integer between 1 and ${Math.min(availableMonths, MAX_MONTHS)}. No other text.`;
    const res = await scout.generateContent(prompt);
    const raw = res.response.text().trim();
    const n   = parseInt(raw, 10);
    if (!isNaN(n) && n >= 1) return Math.min(n, availableMonths, MAX_MONTHS);
  } catch { /* fall through to default */ }
  return Math.min(DEFAULT_MONTHS, availableMonths);
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

  // Check plan — use resolvePlan which honours manualPro and subscription.status
  const { db } = getFirebaseAdmin();
  const userDoc = await db.collection("users").doc(uid).get();
  const plan = resolvePlan(userDoc.exists ? (userDoc.data() as Record<string, unknown>) : undefined) ?? "free";
  if (plan === "free") {
    return NextResponse.json({ error: "AI Chat is a Pro feature. Upgrade to access." }, { status: 403 });
  }

  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) return NextResponse.json({ error: "AI not configured" }, { status: 500 });

  // Determine how many months this query actually needs.
  // Read just the profile header to know how many months of history exist,
  // then run a cheap scout call in parallel with nothing else.
  const fullProfile = await getFinancialProfile(uid, db);
  const availableMonths = fullProfile.allTxMonths.length;
  const monthsNeeded = await resolveMonthsNeeded(apiKey, message, availableMonths);

  // Build the brief sliced to exactly the months needed — all from the profile cache.
  const brief = await buildFinancialBrief(uid, "chat", monthsNeeded);

  // Set up Gemini streaming
  const genAI  = new GoogleGenerativeAI(apiKey);
  const model  = genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: buildSystemPrompt(brief),
  });

  // Convert history to Gemini format (max last 20 turns to save tokens)
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
