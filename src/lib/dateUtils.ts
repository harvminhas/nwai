/**
 * Date utilities for manual asset valuations.
 * All dates use America/New_York timezone per user requirements.
 */

/**
 * Get current date in America/New_York timezone as YYYY-MM-DD string.
 */
export function getTodayInNewYork(): string {
  const now = new Date();
  // Convert to America/New_York timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value ?? '';
  const month = parts.find(p => p.type === 'month')?.value ?? '';
  const day = parts.find(p => p.type === 'day')?.value ?? '';
  
  return `${year}-${month}-${day}`;
}

/**
 * Validate that a date string is in YYYY-MM-DD format and represents a valid calendar date.
 */
export function isValidDateString(dateStr: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return false;
  }
  
  const date = new Date(dateStr + 'T00:00:00Z'); // Parse as UTC midnight
  if (isNaN(date.getTime())) {
    return false;
  }
  
  // Verify it round-trips correctly (catches invalid dates like 2024-02-30)
  return date.toISOString().slice(0, 10) === dateStr;
}

/**
 * Compare two YYYY-MM-DD date strings.
 * Returns: negative if a < b, 0 if equal, positive if a > b
 */
export function compareDates(a: string, b: string): number {
  return a.localeCompare(b);
}
