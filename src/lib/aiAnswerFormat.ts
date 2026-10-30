/**
 * Shared AI answer formatting instruction appended to all Gemini answer prompts.
 * 
 * Used across:
 * - Dashboard Ask panel (ai-ask route)
 * - Chat page (chat route)
 * - Money coach insights
 * - All AI-generated answer endpoints
 */

export const AI_ANSWER_FORMAT = `

FORMAT YOUR ANSWER:
- Start with ONE direct sentence that answers the question immediately
- Then provide up to ~5 concise bullet points with specific CA$ amounts where relevant
- Optional: end with ONE short "Next step" suggestion line if actionable
- Use markdown only: **bold** for key figures, simple lists, compact tables
- NO preambles, NO code blocks, NO "Here's what I found" intros
- Keep CA$ amounts with whitespace-nowrap including the minus sign (e.g. CA$−1,234)
- Compact paragraphs and bullets — avoid verbose explanations`;
