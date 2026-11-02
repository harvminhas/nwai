/**
 * Shared configuration for the Ask (chat) feature model.
 * 
 * Uses gemini-3.5-flash-lite (2.5 Flash-Lite is closed to new API users) to reduce costs.
 * Statement extraction (gemini-provider.ts) uses a different model.
 */

import { GoogleGenerativeAI, type GenerativeModel } from "@google/generative-ai";
import { CHAT_TOOLS } from "./tools";

/**
 * Get the configured chat model with cost-optimized settings.
 * 
 * @param apiKey - Google API key
 * @param systemContext - System instruction for the chat
 * @returns Configured Gemini model
 */
export function getChatModel(apiKey: string, systemContext: string): GenerativeModel {
  const genAI = new GoogleGenerativeAI(apiKey);
  
  return genAI.getGenerativeModel({
    model: "gemini-3.5-flash-lite",
    systemInstruction: systemContext,
    tools: CHAT_TOOLS,
  });
}
