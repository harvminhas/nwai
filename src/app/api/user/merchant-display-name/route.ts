import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";

/**
 * PUT /api/user/merchant-display-name
 * Save a user-friendly display name for a merchant (keyed by slug).
 * The underlying slug and statement name are preserved for matching.
 * Body: { slug, displayName }
 */
export async function PUT(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  const body = await req.json().catch(() => ({})) as { slug?: string; displayName?: string };
  const { slug, displayName } = body;
  if (!slug || !displayName?.trim()) {
    return NextResponse.json({ error: "slug and displayName are required" }, { status: 400 });
  }

  await db.doc(`users/${uid}/merchantDisplayNames/${slug}`).set({
    displayName: displayName.trim(),
    updatedAt: new Date().toISOString(),
  });

  return NextResponse.json({ ok: true });
}

/**
 * DELETE /api/user/merchant-display-name
 * Remove a custom display name, reverting to the auto-derived statement name.
 * Body: { slug }
 */
export async function DELETE(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const uid = access.targetUid;

  const body = await req.json().catch(() => ({})) as { slug?: string };
  if (!body.slug) return NextResponse.json({ error: "slug required" }, { status: 400 });

  await db.doc(`users/${uid}/merchantDisplayNames/${body.slug}`).delete();

  return NextResponse.json({ ok: true });
}
