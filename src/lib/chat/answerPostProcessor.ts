/**
 * Post-process AI answers before showing them to users.
 * 
 * - Strip tool names (get_*, list_*, rollup_*, search_*)
 * - Strip attribution phrases like "(same as X page/drawer)"
 * - Never mention internal tool names to the user
 */

const TOOL_NAME_PATTERN = /\b(?:get|list|rollup|search|execute)_[a-z_]+\b/gi;

// Match "From/Uses X (same as Y page/drawer)" or just "(same as Y page/drawer)"
const ATTRIBUTION_PATTERN = /(?:^|\s)(?:from|uses?)\s+[a-z_\s]*\(?\s*same\s+as\s+[^)]*(?:page|drawer|card)\s*\)?[.:,]?|(?:^|\s)\(?\s*same\s+as\s+[^)]*(?:page|drawer|card)\s*\)?[.:,]?/gi;

/**
 * Clean an AI answer by removing tool names and attribution text.
 * 
 * Examples:
 *   "From get_income_summary (same as Income page): CA$5,234"
 *     → "CA$5,234"
 *   
 *   "Your savings rate is 17.3% (From get_savings_summary (same as Savings drawer))."
 *     → "Your savings rate is 17.3%."
 *   
 *   "Uses buildIncomeSummary (same as Income page). Typical monthly = average..."
 *     → "Typical monthly = average..."
 */
export function cleanAIAnswer(text: string): string {
  let cleaned = text;

  // Remove tool names first
  cleaned = cleaned.replace(TOOL_NAME_PATTERN, "");

  // Remove attribution phrases (catches both full and partial forms)
  cleaned = cleaned.replace(ATTRIBUTION_PATTERN, " ");

  // Clean up extra whitespace and punctuation
  cleaned = cleaned.replace(/\s+/g, " ");
  cleaned = cleaned.replace(/\s+([.,;:])/g, "$1");
  cleaned = cleaned.replace(/\(\s*\)/g, ""); // Empty parens
  cleaned = cleaned.replace(/\(\s*(?:from|uses?)\s*\)/gi, ""); // "(from )" or "(uses )"
  cleaned = cleaned.replace(/:\s+([.,;])/g, "$1"); // ": ," → ","
  cleaned = cleaned.replace(/\s+\./g, "."); // " ." → "."
  cleaned = cleaned.replace(/^\s*(?:from|uses?)\s*:\s*/i, ""); // Leading "From:"
  cleaned = cleaned.trim();

  return cleaned;
}
