import { NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { ExternalAccountLabel } from "@/lib/externalAccounts";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/external-accounts
 * Returns all labeled external accounts for the user
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const snapshot = await db.collection(`users/${decoded.uid}/externalAccounts`).get();
    const labels: ExternalAccountLabel[] = snapshot.docs.map(doc => doc.data() as ExternalAccountLabel);

    return Response.json({ labels });
  } catch (error) {
    console.error("Get external accounts error:", error);
    return Response.json({ error: "Failed to get external accounts" }, { status: 500 });
  }
}

/**
 * POST /api/user/external-accounts
 * Create or update a label for an external account
 */
export async function POST(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const body = await req.json();
    const { accountNumber, label } = body;

    if (!accountNumber || !label) {
      return Response.json({ error: "accountNumber and label required" }, { status: 400 });
    }

    // Get existing or create new
    const docRef = db.doc(`users/${decoded.uid}/externalAccounts/${accountNumber}`);
    const existing = await docRef.get();
    
    const now = new Date().toISOString();
    const data: ExternalAccountLabel = existing.exists
      ? {
          ...(existing.data() as ExternalAccountLabel),
          label,
          updatedAt: now,
          confirmed: true,
        }
      : {
          accountNumber,
          label,
          createdAt: now,
          updatedAt: now,
          transferCount: 0,
          confirmed: true,
        };

    await docRef.set(data);

    return Response.json({ success: true, data });
  } catch (error) {
    console.error("Save external account error:", error);
    return Response.json({ error: "Failed to save external account" }, { status: 500 });
  }
}

/**
 * DELETE /api/user/external-accounts/[accountNumber]
 * Delete a labeled external account
 */
export async function DELETE(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const url = new URL(req.url);
    const accountNumber = url.pathname.split('/').pop();

    if (!accountNumber) {
      return Response.json({ error: "accountNumber required" }, { status: 400 });
    }

    await db.doc(`users/${decoded.uid}/externalAccounts/${accountNumber}`).delete();

    return Response.json({ success: true });
  } catch (error) {
    console.error("Delete external account error:", error);
    return Response.json({ error: "Failed to delete external account" }, { status: 500 });
  }
}
