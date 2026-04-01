/**
 * GET  /api/user/account-backfills
 *   Returns all backfill records for the user.
 *
 * POST /api/user/account-backfills
 *   Body: { accountSlug, accountName, accountType, backfillMonths, firstBalance, firstStatementYearMonth }
 *   Saves a backfill record and clears the backfillPromptNeeded flag from the statement.
 *
 * DELETE /api/user/account-backfills?id=<backfillId>
 *   Removes a backfill record.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { randomUUID } from "crypto";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

export interface AccountBackfill {
  id: string;
  accountSlug: string;
  accountName: string;
  accountType: string;
  /**
   * Number of months before firstStatementYearMonth to synthesise as flat
   * estimated entries. Derived from the age bucket the user chose:
   *   <1 mo  → 0   (no backfill — genuinely new)
   *   1–3 mo → 2
   *   3–6 mo → 4
   *   >6 mo  → number of months back to the oldest statement in the system
   */
  backfillMonths: number;
  /** Balance from the first real uploaded statement — used as the flat estimate */
  firstBalance: number;
  /** YYYY-MM of the first real uploaded statement for this account */
  firstStatementYearMonth: string;
  createdAt: string;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const snap = await db
      .collection("users").doc(uid)
      .collection("accountBackfills")
      .orderBy("createdAt", "desc")
      .get();
    const backfills: AccountBackfill[] = snap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<AccountBackfill, "id">),
    }));
    return NextResponse.json({ backfills });
  } catch (e) {
    console.error("[account-backfills GET]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const body = await req.json() as Partial<AccountBackfill> & { statementId?: string };

    const { accountSlug, accountName, accountType, backfillMonths,
            firstBalance, firstStatementYearMonth, statementId } = body;

    if (!accountSlug || backfillMonths === undefined || firstBalance === undefined || !firstStatementYearMonth) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    const id = randomUUID();
    const record: Omit<AccountBackfill, "id"> = {
      accountSlug,
      accountName: accountName ?? accountSlug,
      accountType: accountType ?? "other",
      backfillMonths,
      firstBalance,
      firstStatementYearMonth,
      createdAt: new Date().toISOString(),
    };

    await db.collection("users").doc(uid)
      .collection("accountBackfills").doc(id).set(record);

    // Clear the prompt flag from the statement that triggered this
    if (statementId) {
      await db.collection("statements").doc(statementId)
        .update({ backfillPromptNeeded: false });
    }

    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ id, ...record });
  } catch (e) {
    console.error("[account-backfills POST]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const id = new URL(req.url).searchParams.get("id");
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });
    await db.collection("users").doc(uid)
      .collection("accountBackfills").doc(id).delete();
    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[account-backfills DELETE]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
