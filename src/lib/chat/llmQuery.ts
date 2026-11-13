/**
 * Shared LLM query logic for AI chat with tool calling.
 * 
 * Used by:
 * - /api/user/chat (streaming multi-turn conversation)
 * - /api/user/ai-ask (single-turn question answering)
 */

import type { Part } from "@google/generative-ai";
import type { FinancialProfileCache } from "@/lib/financialProfile";
import type { UserReviewContext } from "@/lib/userReviewContext";
import { executeTool } from "@/lib/chat/executor";
import type { ToolParams } from "@/lib/chat/executor";
import { buildChatContext } from "@/lib/chat/context";
import { getChatModel } from "@/lib/chat/chatModel";

const MAX_TOOL_ROUNDS = 4;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * Query the LLM with tool calling support.
 * Returns the final text response after executing any tool calls.
 * 
 * @param apiKey - Gemini API key
 * @param message - User's question
 * @param profile - Financial profile cache
 * @param reviewContext - User review context (income/debt/savings classifications)
 * @param history - Previous conversation history (optional)
 * @returns Final text response
 */
export async function queryLLMWithTools(
  apiKey: string,
  message: string,
  profile: FinancialProfileCache,
  reviewContext: UserReviewContext,
  history: ChatMessage[] = []
): Promise<string> {
  const systemContext = buildChatContext(profile);

  // Use cost-optimized lite model
  const model = getChatModel(apiKey, systemContext);

  // Convert history to Gemini format
  const rawHistory = history.slice(-20).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const firstUserIdx = rawHistory.findIndex((m) => m.role === "user");
  const geminiHistory = firstUserIdx > 0 ? rawHistory.slice(firstUserIdx) : rawHistory;

  const chat = model.startChat({ history: geminiHistory });

  let pendingParts: string | Part[] = message;
  let finalText: string | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await chat.sendMessage(pendingParts);
    const response = result.response;

    // Log token usage for this round
    const usage = response.usageMetadata;
    if (usage) {
      console.log(
        `[llmQuery] round=${round + 1} tokens: ` +
        `prompt=${usage.promptTokenCount ?? 0} ` +
        `candidates=${usage.candidatesTokenCount ?? 0} ` +
        `thoughts=${(usage as any).thoughtsTokenCount ?? 0} ` +
        `total=${usage.totalTokenCount ?? 0}`
      );
    }

    const functionCalls = response.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      finalText = response.text();
      break;
    }

    // Execute all tool calls
    const functionResponseParts: Part[] = await Promise.all(
      functionCalls.map(async (fc) => {
        const toolResult = executeTool(fc.name, fc.args as ToolParams, profile, reviewContext);
        return {
          functionResponse: {
            name: fc.name,
            response: toolResult.ok
              ? toolResult.data
              : { error: toolResult.error ?? "Tool execution failed" },
          },
        } as Part;
      })
    );

    pendingParts = functionResponseParts;
  }

  if (finalText === null) {
    const lastResult = await chat.sendMessage(pendingParts);
    finalText = lastResult.response.text();
  }

  return finalText ?? "";
}
