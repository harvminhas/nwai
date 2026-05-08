/**
 * GET  /api/user/account-backfills
 *   Returns all backfill records for the user (one doc per month per account).
 *
 * POST /api/user/account-backfills
 *   Body: { accountSlug, accountName, accountType, backfillMonths, firstBalance, firstStatementYearMonth }
 *   Writes one Firestore doc per backfill month (ID: {slug}_{YYYY-MM}).
 *   If the user later uploads a real statement for that month, the real balance
 *   naturally overwrites the synthetic one in the profile build.
 *
 * DELETE /api/user/account-backfills?slug=<accountSlug>
 *   Removes all synthetic monthly records for a given account slug.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { buildAndCacheFinancialProfile, invalidateFinancialProfileCache } from "@/lib/financialProfile";

export const maxDuration = 60;

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

/** Shape of each individual monthly backfill doc. */
export interface AccountBackfillEntry {
  /** Account slug this entry belongs to */
  accountSlug: string;
  accountName: string;
  accountType: string;
  /** YYYY-MM this synthetic entry covers */
  yearMonth: string;
  /** Estimated balance — same value for every backfill month (flat estimate) */
  balance: number;
  /** Always true — lets profile build skip it when real data is present */
  synthetic: true;
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
    const entries = snap.docs.map((d) => ({ id: d.id, ...(d.data() as AccountBackfillEntry) }));
    return NextResponse.json({ entries });
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
    const body = await req.json() as {
      accountSlug?: string;
      accountName?: string;
      accountType?: string;
      backfillMonths?: number;
      firstBalance?: number;
      firstStatementYearMonth?: string;
      statementId?: string;
    };

    const { accountSlug, accountName, accountType, backfillMonths,
            firstBalance, firstStatementYearMonth, statementId } = body;

    if (!accountSlug || backfillMonths === undefined || firstBalance === undefined || !firstStatementYearMonth) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    // No backfill needed (user said account is brand new) — clear the flag and save name/type
    if (backfillMonths === 0) {
      const zeroUpdates: Record<string, unknown> = { backfillPromptNeeded: false };
      if (accountName) zeroUpdates["parsedData.accountName"] = accountName;
      if (accountType) zeroUpdates["parsedData.accountType"] = accountType;
      if (statementId) {
        try {
          await db.collection("statements").doc(statementId).update(zeroUpdates);
        } catch { /* statement may be gone */ }
      }
      // Also update sibling statements for the same slug
      if ((accountName || accountType) && accountSlug) {
        try {
          const siblingsSnap = await db
            .collection("statements")
            .where("userId", "==", uid)
            .where("accountSlug", "==", accountSlug)
            .where("status", "==", "completed")
            .get();
          const nb = db.batch();
          for (const doc of siblingsSnap.docs) {
            if (doc.id === statementId) continue;
            const u: Record<string, unknown> = {};
            if (accountName) u["parsedData.accountName"] = accountName;
            if (accountType) u["parsedData.accountType"] = accountType;
            nb.update(doc.ref, u);
          }
          await nb.commit();
        } catch { /* best-effort */ }
      }
      return NextResponse.json({ ok: true, count: 0 });
    }

    const batch = db.batch();
    const backfillsRef = db.collection("users").doc(uid).collection("accountBackfills");
    const [fy, fm] = firstStatementYearMonth.split("-").map(Number);
    const createdAt = new Date().toISOString();

    // Write one doc per backfill month — doc ID is deterministic so re-running is idempotent
    for (let i = 1; i <= backfillMonths; i++) {
      let month = fm - i;
      let year  = fy;
      while (month <= 0) { month += 12; year -= 1; }
      const ym = `${year}-${String(month).padStart(2, "0")}`;
      const entry: AccountBackfillEntry = {
        accountSlug,
        accountName: accountName ?? accountSlug,
        accountType: accountType ?? "other",
        yearMonth: ym,
        balance: firstBalance,
        synthetic: true,
        createdAt,
      };
      batch.set(backfillsRef.doc(`${accountSlug}_${ym}`), entry);
    }

    // Commit backfill docs first — this must not fail due to statement issues
    await batch.commit();
    console.log(`[account-backfills POST] wrote ${backfillMonths} monthly docs for slug=${accountSlug}`);

    // Persist the user-confirmed account name and type on every completed statement
    // for this slug. parsedData.accountName is the source of truth for the display name
    // throughout the financial profile, so all sibling statements need the same value.
    if (accountName || accountType) {
      try {
        const siblingsSnap = await db
          .collection("statements")
          .where("userId", "==", uid)
          .where("accountSlug", "==", accountSlug)
          .where("status", "==", "completed")
          .get();
        const nameBatch = db.batch();
        for (const doc of siblingsSnap.docs) {
          const updates: Record<string, unknown> = {};
          if (accountName) updates["parsedData.accountName"] = accountName;
          if (accountType) updates["parsedData.accountType"] = accountType;
          nameBatch.update(doc.ref, updates);
        }
        await nameBatch.commit();
      } catch (e) {
        console.warn("[account-backfills POST] could not update statement names:", e);
      }
    }

    // Clear the prompt flag separately so a missing/deleted statement doesn't roll back the batch
    if (statementId) {
      try {
        await db.collection("statements").doc(statementId).update({ backfillPromptNeeded: false });
      } catch {
        // Statement may have been deleted (e.g. user deleted account and re-uploaded) — not fatal
        console.warn(`[account-backfills POST] could not clear backfillPromptNeeded on ${statementId} — doc may not exist`);
      }
    }

    // Rebuild profile synchronously so charts reflect the backfill immediately
    await buildAndCacheFinancialProfile(uid, db);
    return NextResponse.json({ ok: true, count: backfillMonths });
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
    const slug = new URL(req.url).searchParams.get("slug");
    if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 });

    // Delete all monthly docs for this account slug
    const snap = await db.collection("users").doc(uid)
      .collection("accountBackfills")
      .where("accountSlug", "==", slug)
      .get();
    const batch = db.batch();
    for (const doc of snap.docs) batch.delete(doc.ref);
    await batch.commit();

    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true, deleted: snap.size });
  } catch (e) {
    console.error("[account-backfills DELETE]", e);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
