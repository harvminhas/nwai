/**
 * AI provider abstraction.
 *
 * Set AI_PROVIDER=gemini (default) or AI_PROVIDER=anthropic in your env.
 * Gemini is used by default — cheaper and has a generous free tier.
 * Anthropic can be enabled per-request for premium features.
 */

export interface AiProvider {
  sendPdfRequest(systemPrompt: string, userPrompt: string, pdfBase64: string): Promise<string>;
  sendVisionRequest(systemPrompt: string, userPrompt: string, imageBase64: string, mediaType: string): Promise<string>;
  sendTextRequest(systemPrompt: string, userPrompt: string): Promise<string>;
}

export type ProviderName = "gemini" | "anthropic";

function resolveProviderName(override?: ProviderName): ProviderName {
  if (override) return override;
  const env = process.env.AI_PROVIDER?.toLowerCase().trim();
  if (env === "anthropic") return "anthropic";
  return "gemini"; // default
}

let geminiModule: AiProvider | null = null;
let anthropicModule: AiProvider | null = null;

async function loadProvider(name: ProviderName): Promise<AiProvider> {
  if (name === "anthropic") {
    if (!anthropicModule) {
      const mod = await import("./anthropic-provider");
      anthropicModule = mod.anthropicProvider;
    }
    return anthropicModule;
  }
  if (!geminiModule) {
    const mod = await import("./gemini-provider");
    geminiModule = mod.geminiProvider;
  }
  return geminiModule;
}

export async function getAiProvider(override?: ProviderName): Promise<AiProvider> {
  return loadProvider(resolveProviderName(override));
}

// Convenience pass-throughs (use default provider)
export async function sendPdfRequest(systemPrompt: string, userPrompt: string, pdfBase64: string): Promise<string> {
  const provider = await getAiProvider();
  return provider.sendPdfRequest(systemPrompt, userPrompt, pdfBase64);
}

export async function sendVisionRequest(
  systemPrompt: string,
  userPrompt: string,
  imageBase64: string,
  mediaType: string
): Promise<string> {
  const provider = await getAiProvider();
  return provider.sendVisionRequest(systemPrompt, userPrompt, imageBase64, mediaType);
}

export async function sendTextRequest(systemPrompt: string, userPrompt: string): Promise<string> {
  const provider = await getAiProvider();
  return provider.sendTextRequest(systemPrompt, userPrompt);
}
