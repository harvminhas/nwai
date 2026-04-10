/**
 * Access Layer — resolveAccess()
 *
 * Resolves who is authenticated and whose data they are allowed to read.
 * If x-active-profile-uid differs from the actor's own uid, we verify
 * a linkedPartner relationship exists before granting access.
 *
 * Usage in any API route:
 *   const access = await resolveAccess(req, db);
 *   if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
 *   const profile = await getFinancialProfile(access.targetUid, db);
 */

import type { NextRequest } from "next/server";
import type { Firestore } from "firebase-admin/firestore";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { LinkedPartner } from "./types";

export interface ResolvedAccess {
  actorUid: string;
  targetUid: string;
  isOwn: boolean;
}

export async function resolveAccess(
  req: NextRequest,
  db: Firestore,
): Promise<ResolvedAccess | null> {
  const token = req.headers.get("authorization")?.replace("Bearer ", "").trim();
  if (!token) return null;

  try {
    const { auth } = getFirebaseAdmin();
    const { uid: actorUid } = await auth.verifyIdToken(token);

    // Prefer explicit header; fall back to cookie set by the switcher
    const cookieUid = parseCookie(req.headers.get("cookie") ?? "", "nwai_viewing_uid");
    const requestedUid =
      req.headers.get("x-active-profile-uid")?.trim() ||
      cookieUid ||
      actorUid;
    if (requestedUid === actorUid) {
      return { actorUid, targetUid: actorUid, isOwn: true };
    }

    // Verify the requested uid is actually the linked partner
    const snap = await db.doc(`users/${actorUid}/linkedPartner/data`).get();
    if (!snap.exists) return null;

    const partner = snap.data() as LinkedPartner;
    if (partner.partnerUid !== requestedUid) return null;

    return { actorUid, targetUid: requestedUid, isOwn: false };
  } catch {
    return null;
  }
}

function parseCookie(cookieHeader: string, name: string): string | null {
  const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}
