import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getAuth } from "firebase-admin/auth";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

export async function POST(request: NextRequest) {
  try {
    const authHeader = request.headers.get("Authorization") ?? "";
    const idToken    = authHeader.replace("Bearer ", "").trim();
    if (!idToken) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { db } = getFirebaseAdmin();
    const decoded = await getAuth().verifyIdToken(idToken);
    const uid     = decoded.uid;

    const body = await request.json() as {
      statementId: string;
      bankTypeKey: string;
      confirmedSlug: string;
      isExistingAccount?: boolean;
      nickname?: string; // display label for new accounts
    };
    const { statementId, bankTypeKey, confirmedSlug, isExistingAccount, nickname } = body;

    if (!statementId || !bankTypeKey || !confirmedSlug) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // Verify statement belongs to this user
    const stmtRef  = db.collection("statements").doc(statementId);
    const stmtSnap = await stmtRef.get();
    if (!stmtSnap.exists || stmtSnap.data()?.userId !== uid) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // Find the confirmed account's parsedData.accountId so we can patch it into
    // this statement — that way buildAccountSlug(parsedData) returns the right
    // slug everywhere without any changes to data builders.
    let confirmedAccountId: string | undefined;
    if (isExistingAccount) {
      const existingSnap = await db
        .collection("statements")
        .where("userId", "==", uid)
        .where("accountSlug", "==", confirmedSlug)
        .limit(1)
        .get();
      confirmedAccountId = existingSnap.docs[0]?.data()?.parsedData?.accountId as string | undefined;
    } else {
      // For new account: the synthetic ID is already stored in accountSlugOverrides
      const overrideDoc = await db.collection(`users/${uid}/accountSlugOverrides`).doc(bankTypeKey).get();
      confirmedAccountId = overrideDoc.data()?.confirmedAccountId as string | undefined;
    }

    // Persist the confirmed mapping for future uploads of this bank+type
    await db
      .collection(`users/${uid}/accountSlugOverrides`)
      .doc(bankTypeKey)
      .set({
        confirmedAccountId: confirmedAccountId ?? confirmedSlug,
        confirmedSlug,
        updatedAt: new Date().toISOString(),
      }, { merge: true });

    // Patch parsedData.accountId so buildAccountSlug always returns the right slug,
    // and update accountSlug + clear confirmation flags.
    await stmtRef.update({
      ...(confirmedAccountId ? { "parsedData.accountId": confirmedAccountId } : {}),
      // Save nickname as the display name when user created a new account
      ...(nickname ? { "parsedData.accountName": nickname } : {}),
      accountSlug:           confirmedSlug,
      accountConfirmNeeded:  false,
      ...(isExistingAccount && {
        backfillPromptNeeded: false,
        inferredCurrency:     null,
        backfillOldestMonth:  null,
      }),
    });

    // Bust the financial profile cache so the next data fetch sees the updated
    // accountSlug rather than stale cached data with the old fallback slug.
    await invalidateFinancialProfileCache(uid, db);

    return NextResponse.json({ ok: true, confirmedSlug });
  } catch (err) {
    console.error("[account-slug-confirm]", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
