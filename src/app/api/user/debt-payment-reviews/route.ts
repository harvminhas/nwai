import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import type { DebtPaymentClassification } from "@/lib/types";

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

/** GET /api/user/debt-payment-reviews — list all reviews for the current user */
export async function GET(request: NextRequest) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { db } = getFirebaseAdmin();
  const snap = await db.collection(`users/${uid}/debtPaymentReviews`).get();
  const reviews = snap.docs.map((d) => ({
    txFingerprint: d.id,
    ...d.data(),
  }));
  return NextResponse.json({ reviews });
}

/** PUT /api/user/debt-payment-reviews — save a classification for one transaction */
export async function PUT(request: NextRequest) {
  const uid = await getUid(request);
  if (!uid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { txFingerprint, accountSlug, classification, date, amount } = body as {
    txFingerprint?: string;
    accountSlug?: string;
    classification?: DebtPaymentClassification;
    date?: string;
    amount?: number;
  };

  if (!txFingerprint || !accountSlug || !classification || !date || amount === undefined) {
    return NextResponse.json(
      { error: "txFingerprint, accountSlug, classification, date, and amount are required" },
      { status: 400 }
    );
  }

  const validClassifications: DebtPaymentClassification[] = [
    "extra_prepayment",
    "new_regular_payment",
    "ignore",
  ];
  if (!validClassifications.includes(classification)) {
    return NextResponse.json(
      { error: `classification must be one of: ${validClassifications.join(", ")}` },
      { status: 400 }
    );
  }

  const { db } = getFirebaseAdmin();
  await db.doc(`users/${uid}/debtPaymentReviews/${txFingerprint}`).set({
    accountSlug,
    classification,
    date,
    amount,
    reviewedAt: new Date(),
  });

  // Invalidate the financial profile cache so the next request
  // rebuilds with the new classification applied.
  await invalidateFinancialProfileCache(uid, db);

  return NextResponse.json({ ok: true, txFingerprint });
}
