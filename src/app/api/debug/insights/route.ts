import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { buildFinancialBrief, type BriefMode } from "@/lib/financialBrief";
import { SYSTEM_PROMPT } from "@/lib/agentInsights";
import { sendTextRequest } from "@/lib/ai";

export const maxDuration = 120;

/**
 * POST /api/debug/insights
 *
 * Returns the full financial brief sent to the AI AND the raw AI response,
 * without persisting anything to Firestore. Use this to verify:
 *   - The context being sent is correct and complete
 *   - The AI response is valid JSON and internally consistent
 *   - Dollar figures in the brief match what the AI cites in cards
 *
 * Body: {} (no params — always runs for the authenticated user)
 */
export async function POST(request: NextRequest) {
  const token = request.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    // 1. Build the brief (same as what the pipeline sends)
    const brief = await buildFinancialBrief(uid, "insights" as BriefMode);

    // 2. Call AI (no Firestore writes — dry run)
    let rawResponse: string;
    let parseError: string | null = null;
    let parsedCards: unknown = null;

    try {
      rawResponse = await sendTextRequest(SYSTEM_PROMPT, brief);
    } catch (err) {
      return NextResponse.json({
        brief,
        systemPrompt: SYSTEM_PROMPT,
        rawResponse: null,
        parsedCards: null,
        error: `AI call failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    // 3. Try to parse the response
    const jsonMatch = rawResponse.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        parsedCards = JSON.parse(jsonMatch[0]);
      } catch (err) {
        parseError = `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`;
      }
    } else {
      parseError = "No JSON array found in response";
    }

    return NextResponse.json({
      brief,
      systemPrompt: SYSTEM_PROMPT,
      rawResponse,
      parsedCards,
      parseError,
    });
  } catch (err) {
    console.error("[debug/insights]", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
