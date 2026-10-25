/**
 * GET /api/user/net-worth-summary
 * 
 * Lightweight endpoint for nav bar net worth pill.
 * Returns current net worth, monthly change, and home currency.
 * Uses getFinancialProfile (single source of truth) so it matches
 * the dashboard and Net worth pages exactly.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Get user's home currency
    const userDoc = await db.collection("users").doc(access.targetUid).get();
    const userData = userDoc.exists ? userDoc.data() ?? {} : {};
    const homeCurrency: string = userData.homeCurrency ?? userData.currency ?? "CAD";

    // Get financial profile (single source of truth)
    const profile = await getFinancialProfile(access.targetUid, db);

    // Get the latest two months from history to calculate change
    const sortedHistory = [...profile.monthlyHistory].sort((a, b) => 
      b.yearMonth.localeCompare(a.yearMonth)
    );

    const currentMonth = sortedHistory[0];
    const previousMonth = sortedHistory[1];

    const netWorth = currentMonth?.netWorth ?? 0;
    const monthlyChange = previousMonth 
      ? (currentMonth?.netWorth ?? 0) - previousMonth.netWorth 
      : 0;

    return NextResponse.json({
      netWorth,
      monthlyChange,
      currency: homeCurrency,
    });
  } catch (err) {
    console.error("Net worth summary error:", err);
    if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "auth/id-token-expired") {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    return NextResponse.json(
      { error: "Failed to load net worth summary" },
      { status: 500 }
    );
  }
}
