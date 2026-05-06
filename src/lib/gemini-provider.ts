import { GoogleGenerativeAI } from "@google/generative-ai";
import type { AiProvider } from "./ai";

// Model used for all parsing and text tasks.
// gemini-2.5-flash      → best extraction accuracy; dynamic thinking enabled by default (~15-45s)
// gemini-2.5-flash-lite → faster & cheaper but misses transactions on dense statements (~3-8s)
// Override at runtime with GEMINI_MODEL env var.
const DEFAULT_MODEL = "gemini-2.5-flash";

function getModel(systemPrompt: string) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not set. Add it to .env.local (get a free key at https://aistudio.google.com/)."
    );
  }
  const modelName = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const genAI     = new GoogleGenerativeAI(apiKey);

  return genAI.getGenerativeModel({
    model: modelName,
    systemInstruction: systemPrompt,
    // Cast to `any` so we can pass thinkingConfig, which the old SDK types
    // don't expose but the underlying REST API accepts.
    // thinkingBudget: 0   → no thinking, fastest (~5-10s), may miss transactions
    // thinkingBudget: 1024 → brief planning pass, good balance (~10-20s)
    // thinkingBudget: -1   → dynamic (default), slowest (~30-60s), most thorough
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: {
      maxOutputTokens: 65536,
      temperature: 0,
      thinkingConfig: { thinkingBudget: 1024 },
    } as any,
  });
}

/**
 * Thrown when all retry attempts are exhausted due to a transient AI error
 * (503 overloaded / 429 rate-limited). Lets callers show a "try again later"
 * message rather than prompting the user to enter data manually.
 */
export class TransientAiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientAiError";
  }
}

/**
 * Returns true for transient server-side errors that are safe to retry:
 * - 503 Service Unavailable (model overloaded)
 * - 429 Too Many Requests (rate limit)
 */
function isTransient(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message.toLowerCase();
  return msg.includes("503") || msg.includes("429") ||
         msg.includes("service unavailable") || msg.includes("rate limit") ||
         msg.includes("too many requests") || msg.includes("high demand");
}

/**
 * Wraps a Gemini call with up to `maxAttempts` retries for transient errors.
 * Delays: 2s, 4s, 8s (exponential backoff, capped at 8s).
 * Throws TransientAiError if all attempts fail with a transient error.
 */
async function withRetry<T>(fn: () => Promise<T>, maxAttempts = 4): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransient(err)) throw err;
      if (attempt === maxAttempts) {
        throw new TransientAiError(
          "AI is temporarily unavailable due to high demand. Please try again in a few minutes."
        );
      }
      const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 8000);
      console.warn(`[gemini] transient error on attempt ${attempt}/${maxAttempts}, retrying in ${delayMs}ms…`, (err as Error).message);
      await new Promise((res) => setTimeout(res, delayMs));
    }
  }
  throw lastErr;
}

export const geminiProvider: AiProvider = {
  async sendPdfRequest(systemPrompt: string, userPrompt: string, pdfBase64: string): Promise<string> {
    const model = getModel(systemPrompt);
    const result = await withRetry(() =>
      model.generateContent([
        { inlineData: { mimeType: "application/pdf", data: pdfBase64 } },
        userPrompt,
      ])
    );
    return result.response.text();
  },

  async sendVisionRequest(
    systemPrompt: string,
    userPrompt: string,
    imageBase64: string,
    mediaType: string
  ): Promise<string> {
    const model = getModel(systemPrompt);
    const result = await withRetry(() =>
      model.generateContent([
        {
          inlineData: {
            mimeType: mediaType as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
            data: imageBase64,
          },
        },
        userPrompt,
      ])
    );
    return result.response.text();
  },

  async sendTextRequest(systemPrompt: string, userPrompt: string): Promise<string> {
    const model = getModel(systemPrompt);
    const result = await withRetry(() => model.generateContent(userPrompt));
    return result.response.text();
  },
};
