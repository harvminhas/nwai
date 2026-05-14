/**
 * Operator-only directory: Firebase Auth users + statement counts + account labels from statements.
 * GET — full scan of `statements` collection; intended for low-volume admin use.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { authBearerToken, requireAdminDecoded } from "@/lib/adminAuth";

export type AdminUserOverviewRow = {
  uid: string;
  email: string;
  /** Firebase Auth account creation time */
  createdAt: string;
  /** Last sign-in from Firebase Auth (null if never) */
  lastSignInAt: string | null;
  statementTotal: number;
  statementCompleted: number;
  /** Distinct "Bank · Account" strings from statement parsedData */
  accountNames: string[];
};

export async function GET(req: NextRequest) {
  const admin = await requireAdminDecoded(authBearerToken(req));
  if (!admin) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { auth, db } = getFirebaseAdmin();

  const agg = new Map<string, { total: number; completed: number; accounts: Set<string> }>();

  const stmtSnap = await db.collection("statements").get();
  for (const doc of stmtSnap.docs) {
    const d = doc.data();
    const uid = typeof d.userId === "string" ? d.userId : "";
    if (!uid) continue;

    let row = agg.get(uid);
    if (!row) {
      row = { total: 0, completed: 0, accounts: new Set<string>() };
      agg.set(uid, row);
    }
    row.total += 1;
    if (d.status === "completed") row.completed += 1;

    const pd = d.parsedData as Record<string, unknown> | undefined;
    if (pd && typeof pd === "object") {
      const bank = typeof pd.bankName === "string" ? pd.bankName.trim() : "";
      const acct = typeof pd.accountName === "string" ? pd.accountName.trim() : "";
      const aid = typeof pd.accountId === "string" ? pd.accountId.trim() : "";
      const label = [bank, acct].filter(Boolean).join(" · ") || aid || "";
      if (label) row.accounts.add(label);
    }
  }

  const rows: AdminUserOverviewRow[] = [];
  let pageToken: string | undefined;
  const maxUsers = 25000;
  do {
    const page = await auth.listUsers(1000, pageToken);
    for (const u of page.users) {
      const a = agg.get(u.uid);
      const email = u.email ?? "";
      const createdAt = u.metadata.creationTime;
      const lastSignInAt = u.metadata.lastSignInTime ?? null;
      rows.push({
        uid: u.uid,
        email,
        createdAt,
        lastSignInAt,
        statementTotal: a?.total ?? 0,
        statementCompleted: a?.completed ?? 0,
        accountNames: a ? [...a.accounts].sort((x, y) => x.localeCompare(y)) : [],
      });
      if (rows.length >= maxUsers) break;
    }
    pageToken = page.pageToken;
    if (rows.length >= maxUsers) break;
  } while (pageToken);

  rows.sort((x, y) => {
    const ax = x.lastSignInAt ? new Date(x.lastSignInAt).getTime() : 0;
    const ay = y.lastSignInAt ? new Date(y.lastSignInAt).getTime() : 0;
    return ay - ax;
  });

  console.log(`[admin/users-overview] ${rows.length} users, ${stmtSnap.size} statements by=${admin.email}`);

  return NextResponse.json({
    users: rows,
    statementDocsScanned: stmtSnap.size,
    generatedAt: new Date().toISOString(),
  });
}
