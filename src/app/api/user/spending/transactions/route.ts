/**
 * GET /api/user/spending/transactions
 *
 * Returns recent expense transactions with computed fingerprints.
 * Used by the Events feature to let users tag transactions to an event.
 *
 * Query params:
 *   months  — number of months of history to return (default 6, max 24)
 *   q       — optional search string (merchant substring match)
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { displayNameFromProfileAccount } from "@/lib/accountListLabel";
import { loadMerchantRenameContext } from "@/app/api/user/merchantRenameContext";
import {
  spendingTransactionApiRow,
  spendingTransactionMatchesQuery,
} from "@/lib/spendingTransactions";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { targetUid } = access;

  const params  = new URL(req.url).searchParams;
  const months  = Math.min(24, Math.max(1, parseInt(params.get("months") ?? "6", 10)));
  const limit   = Math.min(5000, Math.max(1, parseInt(params.get("limit") ?? "2000", 10)));
  const q       = (params.get("q") ?? "").toLowerCase().trim();

  try {
    const [profile, renameCtx] = await Promise.all([
      getFinancialProfile(targetUid, db),
      loadMerchantRenameContext(targetUid, db),
    ]);

    const cutoff = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().slice(0, 7); // YYYY-MM
    })();

    const txns = profile.expenseTxns
      .filter((tx) => tx.txMonth >= cutoff)
      .map((tx) =>
        spendingTransactionApiRow(
          tx,
          renameCtx,
          displayNameFromProfileAccount(tx.accountSlug, profile, tx.accountLabel),
        ),
      )
      .filter((tx) => spendingTransactionMatchesQuery(tx, q))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);

    return NextResponse.json({ transactions: txns });
  } catch (err) {
    console.error("[spending/transactions] GET error", err);
    return NextResponse.json({ error: "Failed to load transactions" }, { status: 500 });
  }
}
