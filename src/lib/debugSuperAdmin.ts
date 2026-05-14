/**
 * Client-safe super-admin check (no firebase-admin / Node built-ins).
 * Used by client components; server admin routes use {@link requireAdminDecoded}.
 */

import { ADMIN_EMAILS } from "@/lib/adminConstants";

/** @deprecated use ADMIN_EMAILS from adminConstants */
export const DEBUG_SUPER_ADMIN_EMAILS = ADMIN_EMAILS;

export function isDebugSuperAdmin(email: string | undefined): boolean {
  return !!email && (ADMIN_EMAILS as readonly string[]).includes(email);
}
