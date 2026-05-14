import type { NextRequest } from "next/server";
import type { DecodedIdToken } from "firebase-admin/auth";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { ADMIN_EMAILS } from "@/lib/adminConstants";

const ADMIN_SET = new Set<string>(ADMIN_EMAILS);

export function authBearerToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Verifies Firebase ID token and checks email is in {@link ADMIN_EMAILS}. */
export async function requireAdminDecoded(token: string | null): Promise<DecodedIdToken | null> {
  if (!token) return null;
  const { auth } = getFirebaseAdmin();
  try {
    const decoded = await auth.verifyIdToken(token);
    const email = decoded.email ?? "";
    if (!ADMIN_SET.has(email)) return null;
    return decoded;
  } catch {
    return null;
  }
}
