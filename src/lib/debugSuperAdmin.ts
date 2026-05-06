/**
 * Client-safe super-admin check (no firebase-admin / Node built-ins).
 * Used by client components and API routes.
 */

/** Emails with full operator tooling (global cron, promo manager). */
export const DEBUG_SUPER_ADMIN_EMAILS = ["harvminhas@gmail.com"] as const;

export function isDebugSuperAdmin(email: string | undefined): boolean {
  return !!email && DEBUG_SUPER_ADMIN_EMAILS.includes(email as typeof DEBUG_SUPER_ADMIN_EMAILS[number]);
}
