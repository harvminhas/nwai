import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";

export const dynamic = "force-dynamic";

/**
 * PUT /api/user/income-source-exclude
 * 
 * Marks an income source as excluded (hidden from totals).
 * Implemented via category rule set to "Other" or a special excluded flag.
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
    const { source, excluded } = body;

    if (!source) {
      return NextResponse.json({ error: "Missing source" }, { status: 400 });
    }

    const sourceSlug = source.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);

    if (excluded) {
      // Mark as excluded by setting category to "Transfer" (which excludes from core income)
      const userDocRef = db.doc(`users/${decoded.uid}`);
      await userDocRef.update({
        [`incomeCategoryRules.${sourceSlug}`]: "Transfer",
      });
    } else {
      // Remove exclusion (delete the rule)
      const userDocRef = db.doc(`users/${decoded.uid}`);
      const userDoc = await userDocRef.get();
      const rules = userDoc.get("incomeCategoryRules") || {};
      delete rules[sourceSlug];
      await userDocRef.update({ incomeCategoryRules: rules });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Income source exclude error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to exclude source" },
      { status: 500 }
    );
  }
}
