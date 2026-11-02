/**
 * Shared tool-calling loop for gemini-3.5-flash-lite.
 * 
 * Uses manual contents array instead of startChat/sendMessage because
 * gemini-3.5-flash-lite rejects role 'function' (400 error).
 * 
 * Solution: Send function responses with role 'user' instead.
 */

import type { GenerativeModel, Content, Part } from "@google/generative-ai";
import type { FinancialProfileCache } from "@/lib/financialProfile";
import type { UserReviewContext } from "@/lib/userReviewContext";
import { executeTool } from "@/lib/chat/executor";
import type { ToolParams } from "@/lib/chat/executor";

const MAX_TOOL_ROUNDS = 4;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ToolLoopResult {
  finalText: string | null;
  lastRound: number;
}

/**
 * Execute tool-calling loop with manual contents management.
 * 
 * @param model - Gemini model
 * @param message - User's current message
 * @param history - Previous conversation history
 * @param profile - Financial profile for tool execution
 * @param reviewContext - Review context for tool execution
 * @param logPrefix - Prefix for console.log (e.g. '[chat]' or '[llmQuery]')
 * @returns Final text response and number of rounds executed
 */
export async function executeToolLoop(
  model: GenerativeModel,
  message: string,
  history: ChatMessage[],
  profile: FinancialProfileCache,
  reviewContext: UserReviewContext,
  logPrefix: string
): Promise<ToolLoopResult> {
  // Build initial contents array from history
  const contents: Content[] = history.slice(-20).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));

  // Add current user message
  contents.push({
    role: "user",
    parts: [{ text: message }],
  });

  let finalText: string | null = null;

  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const result = await model.generateContent({ contents });
    const response = result.response;

    // Log token usage for this round
    const usage = response.usageMetadata;
    if (usage) {
      console.log(
        `${logPrefix} round=${round + 1} tokens: ` +
        `prompt=${usage.promptTokenCount ?? 0} ` +
        `candidates=${usage.candidatesTokenCount ?? 0} ` +
        `thoughts=${(usage as any).thoughtsTokenCount ?? 0} ` +
        `total=${usage.totalTokenCount ?? 0}`
      );
    }

    const functionCalls = response.functionCalls();

    if (!functionCalls || functionCalls.length === 0) {
      // No tools requested — this IS the final answer
      finalText = response.text();
      break;
    }

    // Push the model's response (with function calls) to contents
    const candidate = response.candidates?.[0];
    if (candidate?.content) {
      contents.push(candidate.content);
    }

    // Execute all tool calls and build function response parts
    console.log(`${logPrefix} round=${round + 1} tools=${functionCalls.map((f) => `${f.name}(${JSON.stringify(f.args)})`).join(", ")}`);
    
    const functionResponseParts: Part[] = await Promise.all(
      functionCalls.map(async (fc) => {
        const toolResult = executeTool(fc.name, fc.args as ToolParams, profile, reviewContext);
        const rows = toolResult.data?.rows;
        
        if (logPrefix === "[chat]") {
          console.log(`${logPrefix} tool=${fc.name} rows=${Array.isArray(rows) ? rows.length : "n/a"}`);
          if (Array.isArray(rows)) {
            rows.forEach((r: Record<string, unknown>, i: number) =>
              console.log(`${logPrefix}   row[${i}] ${r.date} | ${r.merchant} | ${r.amount} | cat=${r.category}`),
            );
          }
        }
        
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

    // Send function responses as 'user' role (gemini-3.5-flash-lite requirement)
    contents.push({
      role: "user",
      parts: functionResponseParts,
    });

    // If this was the last allowed round, next iteration will force a text response
    if (round === MAX_TOOL_ROUNDS - 1) {
      console.log(`${logPrefix} MAX_TOOL_ROUNDS reached, forcing final answer`);
    }
  }

  return {
    finalText,
    lastRound: Math.min(MAX_TOOL_ROUNDS, contents.length),
  };
}
