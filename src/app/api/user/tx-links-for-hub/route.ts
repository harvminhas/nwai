/**
 * GET /api/user/tx-links-for-hub?hubId=xxx — get all transactions linked to a hub
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  const hubId = new URL(req.url).searchParams.get("hubId");
  if (!hubId) return NextResponse.json({ error: "hubId required" }, { status: 400 });

  try {
    const snap = await db.collection(`users/${targetUid}/txLinks`).get();
    const links: Array<{ fingerprint: string; role: string; amount?: number }> = [];

    for (const doc of snap.docs) {
      const data = doc.data();
      const txLinks = data.links ?? [];
      
      for (const link of txLinks) {
        if (link.hubId === hubId) {
          links.push({
            fingerprint: doc.id,
            role: link.role,
            amount: link.amount,
          });
        }
      }
    }

    return NextResponse.json({ links });
  } catch (err) {
    console.error("[tx-links-for-hub] GET error", err);
    return NextResponse.json({ error: "Failed to load links" }, { status: 500 });
  }
}
