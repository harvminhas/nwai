import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AiProvider } from "./ai";

// Model used for all parsing and text tasks.
// gemini-2.5-flash-lite    → fastest & cheapest stable model, great for structured extraction (~3-8s)
// gemini-2.5-flash         → smarter but slower due to internal "thinking" (~30-60s)
// gemini-3.1-flash-lite-preview → next-gen, preview only (not yet stable)
// Override at runtime with GEMINI_MODEL env var.
const DEFAULT_MODEL = "gemini-2.5-flash-lite";

function getModel(systemPrompt: string) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local (get a free key at https://aistudio.google.com/)."
    );
  }
  const modelName = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const genAI     = new GoogleGenerativeAI(apiKey);

  // If a 2.5-x model is chosen, disable thinking to keep latency low.
  // Structured extraction does not benefit from extended reasoning.
  const is25 = modelName.startsWith("gemini-2.5");
  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    ...(is25 && {
      generationConfig: {
        // @ts-expect-error thinkingConfig is a preview field not yet in the type defs
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
}

export const geminiProvider: AiProvider = {
  async sendPdfRequest(systemPrompt: string, userPrompt: string, pdfBase64: string): Promise<string> {
    const model  = getModel(systemPrompt);
    const result = await model.generateContent([
      { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
      userPrompt,
    ]);
    return result.response.text();
  },

  async sendVisionRequest(
    systemPrompt: string,
    userPrompt: string,
    imageBase64: string,
    mediaType: string
  ): Promise<string> {
    const model  = getModel(systemPrompt);
    const result = await model.generateContent([
      {
        inlineData: {
          mimeType: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data: imageBase64,
        },
      },
      userPrompt,
    ]);
    return result.response.text();
  },

  async sendTextRequest(systemPrompt: string, userPrompt: string): Promise<string> {
    const model  = getModel(systemPrompt);
    const result = await model.generateContent(userPrompt);
    return result.response.text();
  },
};
