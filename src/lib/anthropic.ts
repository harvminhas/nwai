/**
 * Legacy re-export shim — kept so any existing imports of "@/lib/anthropic"
 * continue to work. New code should import from "@/lib/ai" instead.
 */
export { sendPdfRequest, sendVisionRequest, sendTextRequest } from "./ai";
