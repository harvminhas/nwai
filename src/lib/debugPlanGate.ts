/**
 * Server-only: uses Firestore + plan resolution. Do not import from Client Components.
 */
import type { Firestore } from "firebase-admin/firestore";
import { getResolvedPlanId } from "@/app/api/user/plan/route";
import { isDebugSuperAdmin } from "@/lib/debugSuperAdmin";

/** Pro subscribers (and super-admins) may use /account/debug and /api/debug/* helpers. */
export async function canUseDebugTools(
  uid: string,
  email: string | undefined,
  db: Firestore,
): Promise<boolean> {
  if (isDebugSuperAdmin(email)) return true;
  const plan = await getResolvedPlanId(uid, db);
  return plan === "pro";
}
