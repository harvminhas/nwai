/**
 * Format a transaction date as "as of Oct 5" or "as of Oct 5, 2025" (year only if not current year)
 */
export function formatLastTransactionDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null;
  
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    
    const now = new Date();
    const currentYear = now.getFullYear();
    const txYear = date.getFullYear();
    
    const month = date.toLocaleDateString("en-US", { month: "short" });
    const day = date.getDate();
    
    if (txYear === currentYear) {
      return `as of ${month} ${day}`;
    } else {
      return `as of ${month} ${day}, ${txYear}`;
    }
  } catch {
    return null;
  }
}
