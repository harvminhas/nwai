import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AiProvider } from "./ai";

function getModel(systemPrompt: string) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local (get a free key at https://aistudio.google.com/)."
    );
  }
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({
    model: "gemini-2.5-flash",
    systemInstruction: systemPrompt,
  });
}

export const geminiProvider: AiProvider = {
  async sendPdfRequest(systemPrompt: string, userPrompt: string, pdfBase64: string): Promise<string> {
    const model = getModel(systemPrompt);
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
    const model = getModel(systemPrompt);
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
    const model = getModel(systemPrompt);
    const result = await model.generateContent(userPrompt);
    return result.response.text();
  },
};
