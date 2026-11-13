/**
 * GET /api/user/income/transactions
 *
 * Returns recent income transactions with computed fingerprints.
 * Used by asset pages to let users link income to an asset.
 *
 * Query params:
 *   months  — number of months of history to return (default 6, max 24)
 *   limit   — max results (default 2000, max 5000)
 *   q       — optional search string (source substring match)
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { txFingerprint } from "@/lib/txFingerprint";
import { displayNameFromProfileAccount } from "@/lib/accountListLabel";

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
    const profile = await getFinancialProfile(targetUid, db);

    const cutoff = (() => {
      const d = new Date();
      d.setMonth(d.getMonth() - months);
      return d.toISOString().slice(0, 7); // YYYY-MM
    })();

    const txns = profile.incomeTxns
      .filter((tx) => tx.txMonth >= cutoff)
      .filter((tx) => !q || tx.source.toLowerCase().includes(q))
      .map((tx) => ({
        fingerprint:  txFingerprint(tx.accountSlug, tx.date, tx.amount, tx.source),
        date:         tx.date,
        merchant:     tx.source,  // Map source to merchant for consistency
        amount:       Math.abs(tx.amount),
        category:     "Income",
        accountLabel: displayNameFromProfileAccount(tx.accountSlug, profile, tx.accountLabel),
        accountSlug:  tx.accountSlug,
        txMonth:      tx.txMonth,
      }))
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, limit);

    return NextResponse.json({ transactions: txns });
  } catch (err) {
    console.error("[income/transactions] GET error", err);
    return NextResponse.json({ error: "Failed to load transactions" }, { status: 500 });
  }
}
