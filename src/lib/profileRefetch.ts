/**
 * Trigger profile data refetch after mutations that invalidate cached data.
 * 
 * Used after asset create/edit/delete, category rule changes, etc.
 * Fires the same event that causes layout to refetch net worth from
 * the server (which rebuilds profile cache on demand).
 * 
 * Does NOT run expensive insights generation - only triggers refetch
 * of already-invalidated cached data.
 */

export const PROFILE_REFRESHED_EVENT = "nw:profile-refreshed";

/**
 * Fire event that causes consumers to refetch profile-derived data.
 * Safe to call after server has already invalidated the cache.
 */
export function triggerProfileRefetch(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROFILE_REFRESHED_EVENT));
}
