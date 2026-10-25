import { NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { answerQuestion, getSuggestedQuestions } from "@/lib/questionTemplates";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/ai-ask
 * Answers user questions about their finances using template-based responses
 * grounded in FinancialProfileCache data.
 *
 * Body: { question: string }
 * Returns: { answer: string, suggestedFollowUps?: string[] }
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const body = await req.json();
    const question = body.question?.trim();

    if (!question) {
      return Response.json({ error: "Question is required" }, { status: 400 });
    }

    const profile = await getFinancialProfile(decoded.uid, db);
    const answer = answerQuestion(question, profile);

    if (!answer) {
      return Response.json({
        answer: "I don't have enough information to answer that question yet. Try asking about your spending, savings rate, or subscriptions, or upload more statements for better insights.",
        suggestedFollowUps: getSuggestedQuestions().slice(0, 3),
      });
    }

    return Response.json({
      answer,
      suggestedFollowUps: getSuggestedQuestions().slice(0, 3),
    });
  } catch (error) {
    console.error("AI ask error:", error);
    return Response.json(
      { error: "Failed to answer question" },
      { status: 500 }
    );
  }
}

/**
 * GET /api/user/ai-ask
 * Returns suggested questions for the UI.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    return Response.json({
      suggestions: getSuggestedQuestions(),
    });
  } catch (error) {
    console.error("AI ask suggestions error:", error);
    return Response.json(
      { error: "Failed to get suggestions" },
      { status: 500 }
    );
  }
}
