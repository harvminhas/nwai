/**
 * POST /api/user/migrate-asset-links
 * 
 * Migrate legacy ManualAsset.linkedAccountSlug to the new accountLinks structure.
 * 
 * For each asset with linkedAccountSlug:
 * - If the account type is mortgage/FlexLine → role = "secures"
 * - Otherwise → role = "finances"
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { ManualAsset, AccountLinks, HubLink } from "@/lib/types";

export async function POST(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { actorUid } = access;

  try {
    // Load all manual assets
    const assetsSnap = await db.collection(`users/${actorUid}/manualAssets`).get();
    
    // Load all statements to determine account types
    const statementsSnap = await db.collection("statements")
      .where("userId", "==", actorUid)
      .get();
    
    const accountTypes = new Map<string, string>();
    for (const doc of statementsSnap.docs) {
      const data = doc.data();
      const accountSlug = data.parsedData?.accountSlug;
      const accountType = data.parsedData?.accountType;
      if (accountSlug && accountType) {
        accountTypes.set(accountSlug, accountType);
      }
    }

    let migratedCount = 0;
    const batch = db.batch();

    for (const assetDoc of assetsSnap.docs) {
      const asset = assetDoc.data() as ManualAsset;
      const linkedSlug = asset.linkedAccountSlug;
      
      if (!linkedSlug) continue;

      // Check if migration already exists
      const linksRef = db.doc(`users/${actorUid}/accountLinks/${linkedSlug}`);
      const linksSnap = await linksRef.get();
      const existing = linksSnap.exists ? (linksSnap.data() as AccountLinks) : null;
      
      const alreadyLinked = existing?.links?.some(
        (l) => l.hubId === assetDoc.id && (l.role === "finances" || l.role === "secures")
      );
      
      if (alreadyLinked) continue;

      // Determine role based on account type
      const accountType = accountTypes.get(linkedSlug);
      const role: "finances" | "secures" = 
        accountType === "line_of_credit" || accountType === "mortgage" 
          ? "secures" 
          : "finances";

      const newLink: HubLink = {
        hubId: assetDoc.id,
        role,
        createdAt: new Date().toISOString(),
      };

      const links = existing?.links ?? [];
      const updated: AccountLinks = {
        accountSlug: linkedSlug,
        links: [...links, newLink],
        updatedAt: new Date().toISOString(),
      };

      batch.set(linksRef, updated);
      migratedCount++;
    }

    await batch.commit();

    return NextResponse.json({
      ok: true,
      migratedCount,
      message: `Migrated ${migratedCount} asset link(s)`,
    });
  } catch (err) {
    console.error("[migrate-asset-links] error", err);
    return NextResponse.json({ error: "Migration failed" }, { status: 500 });
  }
}
