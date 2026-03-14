import Anthropic from "@anthropic-ai/sdk";

export class AnthropicConfigError extends Error {
  constructor() {
    super(
      "ANTHROPIC_API_KEY is not set. Add it to .env.local (get a key at https://console.anthropic.com/) and restart the dev server."
    );
    this.name = "AnthropicConfigError";
  }
}

function getClient(): Anthropic {
  const raw = process.env.ANTHROPIC_API_KEY;
  const apiKey = typeof raw === "string" ? raw.trim() : "";
  if (!apiKey || apiKey.length < 10) {
    throw new AnthropicConfigError();
  }
  return new Anthropic({ apiKey });
}

export interface VisionMessageInput {
  prompt: string;
  imageBase64: string;
  mediaType: "image/png" | "image/jpeg" | "image/gif" | "image/webp";
}

/**
 * Send image + prompt to Claude Vision and return raw text (expected JSON).
 */
export async function sendVisionRequest({
  prompt,
  imageBase64,
  mediaType,
}: VisionMessageInput): Promise<string> {
  const client = getClient();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType,
              data: imageBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Claude response");
  }
  return textBlock.text;
}

/**
 * Send PDF (base64) + prompt to Claude; PDF is read natively by the model.
 */
export async function sendPdfRequest(prompt: string, pdfBase64: string): Promise<string> {
  const client = getClient();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: pdfBase64,
            },
          },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Claude response");
  }
  return textBlock.text;
}

/**
 * Text-only prompt (e.g. CSV transaction export).
 */
export async function sendTextRequest(prompt: string): Promise<string> {
  const client = getClient();
  const response = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 8192,
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((block) => block.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("No text in Claude response");
  }
  return textBlock.text;
}
