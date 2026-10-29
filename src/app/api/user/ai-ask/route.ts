import { NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { loadUserReviewContext } from "@/lib/userReviewContext";
import { answerQuestion, getSuggestedQuestions } from "@/lib/questionTemplates";
import { queryLLMWithTools } from "@/lib/chat/llmQuery";
import { cleanAIAnswer } from "@/lib/chat/answerPostProcessor";
import { checkAIUsageLimit, incrementAIUsage, getLimitReachedMessage } from "@/lib/aiUsageLimit";
import { resolvePlan } from "../plan/route";

export const dynamic = "force-dynamic";

/**
 * POST /api/user/ai-ask
 * Answers user questions about their finances.
 * 
 * Flow:
 *   1. Try template-based response first (fast path)
 *   2. If no template matches, fall through to LLM with tool calling
 *   3. Never return "not enough information" - tools can answer most questions
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
    
    // Get user's plan
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    const userData = userDoc.exists ? userDoc.data() : undefined;
    const plan = resolvePlan(userData as Record<string, unknown> | undefined) ?? "free";
    
    // Fast path: try template matching first (doesn't count against limit)
    const templateAnswer = answerQuestion(question, profile);

    if (templateAnswer) {
      return Response.json({
        answer: cleanAIAnswer(templateAnswer),
        suggestedFollowUps: getSuggestedQuestions().slice(0, 3),
        usedAI: false,
      });
    }

    // Check AI usage limit before calling LLM
    const usageCheck = await checkAIUsageLimit(decoded.uid, db, plan);
    
    if (!usageCheck.allowed) {
      return Response.json({
        answer: getLimitReachedMessage(),
        suggestedFollowUps: [],
        limitReached: true,
        remaining: 0,
        limit: usageCheck.limit,
      });
    }

    // Fall through: use LLM with tool calling
    const apiKey = process.env.GEMINI_API_KEY?.trim();
    if (!apiKey) {
      return Response.json({
        answer: "I don't have enough information to answer that question yet. Try asking about your spending, savings rate, or subscriptions, or upload more statements for better insights.",
        suggestedFollowUps: getSuggestedQuestions().slice(0, 3),
      });
    }

    try {
      const reviewContext = await loadUserReviewContext(decoded.uid, db);
      const llmAnswer = await queryLLMWithTools(apiKey, question, profile, reviewContext);

      // Increment usage counter after successful LLM response
      const newCount = await incrementAIUsage(decoded.uid, db);
      const remaining = Math.max(0, usageCheck.limit - newCount);

      return Response.json({
        answer: cleanAIAnswer(llmAnswer),
        suggestedFollowUps: getSuggestedQuestions().slice(0, 3),
        usedAI: true,
        remaining: plan === "free" ? remaining : -1,
        limit: plan === "free" ? usageCheck.limit : -1,
      });
    } catch (llmError: any) {
      // Handle LLM-specific errors gracefully
      const status = llmError?.status || llmError?.response?.status;
      console.error(`[ai-ask] LLM error (status=${status}):`, llmError.message || llmError);
      
      // Return user-friendly error instead of canned "not enough information"
      return Response.json({
        answer: "The AI assistant is unavailable right now. Please try again later, or ask in the Chat page for more detailed help.",
        suggestedFollowUps: getSuggestedQuestions().slice(0, 3),
      });
    }
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
 * Returns suggested questions and usage stats for the UI.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    
    // Get user's plan and usage
    const userDoc = await db.collection("users").doc(decoded.uid).get();
    const userData = userDoc.exists ? userDoc.data() : undefined;
    const plan = resolvePlan(userData as Record<string, unknown> | undefined) ?? "free";
    
    const usageCheck = await checkAIUsageLimit(decoded.uid, db, plan);

    return Response.json({
      suggestions: getSuggestedQuestions(),
      remaining: plan === "free" ? usageCheck.remaining : -1,
      limit: plan === "free" ? usageCheck.limit : -1,
    });
  } catch (error) {
    console.error("AI ask suggestions error:", error);
    return Response.json(
      { error: "Failed to get suggestions" },
      { status: 500 }
    );
  }
}
