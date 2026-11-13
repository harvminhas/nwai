/**
 * GET /api/user/net-worth-growth
 *
 * Display-only growth decomposition for the Net Worth Growth tab.
 * Reads getFinancialProfile; does not write stored data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { computeNetWorthGrowth } from "@/lib/netWorthGrowth";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const profile = await getFinancialProfile(access.targetUid, db);
    const months = computeNetWorthGrowth({
      monthlyHistory: profile.monthlyHistory,
      expenseTxns: profile.expenseTxns,
      incomeTxns: profile.incomeTxns,
      debtPaymentHistory: profile.debtPaymentHistory,
      homeCurrency: profile.homeCurrency,
      fxRates: profile.fxRates,
    });

    return NextResponse.json({
      months,
      currency: profile.homeCurrency || "CAD",
    });
  } catch (err) {
    console.error("Net worth growth error:", err);
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "auth/id-token-expired") {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to load net worth growth" },
      { status: 500 },
    );
  }
}
