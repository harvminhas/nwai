/**
 * Shared color helpers for consistent styling across components.
 */

import { formatCurrency } from "./currencyUtils";

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

/**
 * Format a change value with + or - prefix
 * 
 * @param value - The change amount
 * @param currency - Currency code
 * @returns Formatted string like "+$1,234" or "-$567"
 */
export function formatChange(value: number, currency?: string): string {
  if (value === 0) return formatCurrency(0, currency || "CAD");
  const prefix = value > 0 ? "+" : "";
  return prefix + formatCurrency(value, currency || "CAD");
}

/**
 * Get color class for a change value based on context.
 * 
 * @param value - The change amount
 * @param context - "positive" (increase good) or "negative" (decrease good)
 * @returns Tailwind color class
 */
export function getChangeColor(value: number, context: "positive" | "negative"): string {
  if (value === 0) return 'text-gray-600';
  
  if (context === "positive") {
    // Increase is good (assets, income), decrease is bad
    return value > 0 ? 'text-green-600' : 'text-red-600';
  } else {
    // Decrease is good (debt, expenses), increase is bad
    return value > 0 ? 'text-red-600' : 'text-green-600';
  }
}
