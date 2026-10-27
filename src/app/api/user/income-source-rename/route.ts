import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * PUT /api/user/income-source-rename
 * 
 * Renames an income source by creating a source mapping.
 * All transactions from oldName will appear under newName.
 */
export async function PUT(req: NextRequest): Promise<NextResponse> {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const body = await req.json();
    const { oldName, newName } = body;

    if (!oldName || !newName) {
      return NextResponse.json({ error: "Missing oldName or newName" }, { status: 400 });
    }

    // Create a source mapping (alias → canonical)
    const pairKey = `${newName.toLowerCase()}|${oldName.toLowerCase()}`;
    const mappingId = pairKey.replace(/\|/g, "_");

    await db
      .collection(`users/${decoded.uid}/sourceMappings`)
      .doc(mappingId)
      .set({
        pairKey,
        type: "income",
        canonical: newName,
        alias: oldName,
        status: "confirmed",
        affectsCache: true, // This should trigger profile cache invalidation
        createdAt: new Date().toISOString(),
      });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Income source rename error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to rename source" },
      { status: 500 }
    );
  }
}
