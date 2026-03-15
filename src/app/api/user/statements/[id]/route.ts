import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { merchantSlug, applyRulesAndRecalculate } from "@/lib/applyRules";
import type { ParsedStatementData } from "@/lib/types";

async function getUid(request: NextRequest): Promise<string | null> {
  const token = request.headers.get("authorization")?.replace("Bearer ", "");
  if (!token) return null;
  try {
    const { auth } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    return decoded.uid;
  } catch {
    return null;
  }
}

/**
 * PATCH /api/user/statements/[id]
 * Body: { merchant: string; category: string }
 *
 * 1. Re-categorizes all transactions for this merchant in the statement.
 * 2. Re-aggregates expense categories + totals.
 * 3. Saves a category rule to users/{uid}/categoryRules so future parses apply it.
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const { merchant, category } = body as { merchant?: string; category?: string };
  if (!merchant || !category) {
    return NextResponse.json({ error: "merchant and category are required" }, { status: 400 });
  }

  const { db } = getFirebaseAdmin();
  const statementRef = db.collection("statements").doc(id);
  const doc = await statementRef.get();

  if (!doc.exists) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const data = doc.data();
  if (data?.userId !== uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const parsedData = data?.parsedData as ParsedStatementData | undefined;
  if (!parsedData) return NextResponse.json({ error: "Statement has no parsed data" }, { status: 400 });

  // Apply the new rule to this statement
  const slug = merchantSlug(merchant);
  const rules = new Map([[slug, category]]);
  const updated = applyRulesAndRecalculate(parsedData, rules);

  // Persist updated parsedData
  await statementRef.update({ parsedData: updated });

  // Persist the rule for future parses
  await db.doc(`users/${uid}/categoryRules/${slug}`).set({
    merchant,
    category,
    slug,
    updatedAt: new Date(),
  });

  return NextResponse.json({ ok: true, parsedData: updated });
}
