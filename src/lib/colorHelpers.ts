/**
 * Shared color helpers for consistent styling across components.
 */

/**
 * Get Tailwind color class based on value sign.
 * Used for Net savings and other financial metrics.
 * 
 * @param value - The numeric value to colorize
 * @returns Tailwind color class (text-green-600, text-red-600, or text-gray-600)
 */
export function getSignColor(value: number): string {
  if (value > 0) return 'text-green-600';
  if (value < 0) return 'text-red-600';
  return 'text-gray-600';
}

/**
 * Get background color class based on value sign (for bars, badges, etc.)
 * 
 * @param value - The numeric value
 * @returns Tailwind background color class
 */
export function getSignBgColor(value: number): string {
  if (value > 0) return 'bg-green-500';
  if (value < 0) return 'bg-red-500';
  return 'bg-gray-400';
}
