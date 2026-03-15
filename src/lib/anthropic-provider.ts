import Anthropic from "@anthropic-ai/sdk";
import type { AiProvider } from "./ai";

function getClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim() ?? "";
  if (!apiKey || apiKey.length < 10) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (get a key at https://console.anthropic.com/)."
    );
  }
  return new Anthropic({ apiKey });
}

const MODEL = "claude-3-5-sonnet-20241022";

export const anthropicProvider: AiProvider = {
  async sendPdfRequest(systemPrompt: string, userPrompt: string, pdfBase64: string): Promise<string> {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "document",
              source: { type: "base64", media_type: "application/pdf", data: pdfBase64 },
            },
            { type: "text", text: userPrompt },
          ],
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text in Claude response");
    return block.text;
  },

  async sendVisionRequest(
    systemPrompt: string,
    userPrompt: string,
    imageBase64: string,
    mediaType: string
  ): Promise<string> {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
                data: imageBase64,
              },
            },
            { type: "text", text: userPrompt },
          ],
        },
      ],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text in Claude response");
    return block.text;
  },

  async sendTextRequest(systemPrompt: string, userPrompt: string): Promise<string> {
    const client = getClient();
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 8192,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    });
    const block = response.content.find((b) => b.type === "text");
    if (!block || block.type !== "text") throw new Error("No text in Claude response");
    return block.text;
  },
};
