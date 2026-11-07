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

    // Handle case where user has NO uploaded statements but HAS manual assets
    // (monthlyHistory is empty, but manualAssets should still count)
    let netWorth = currentMonth?.netWorth ?? 0;
    if (!currentMonth && profile.manualAssets.length > 0) {
      netWorth = profile.manualAssets.reduce((sum, a) => sum + a.value, 0);
    }

    const monthlyChange = previousMonth 
      ? (currentMonth?.netWorth ?? netWorth) - previousMonth.netWorth 
      : 0;

    // Calculate additional fields for badge count feature
    const changePercent = previousMonth && previousMonth.netWorth !== 0
      ? (monthlyChange / Math.abs(previousMonth.netWorth)) * 100
      : null;

    let trend: "up" | "down" | "flat" | null = null;
    if (previousMonth) {
      if (Math.abs(monthlyChange) < 1) {
        trend = "flat";
      } else if (monthlyChange > 0) {
        trend = "up";
      } else {
        trend = "down";
      }
    }

    // Get last 12 months for the net worth page chart and breakdown
    const last12Months = sortedHistory.slice(0, 12).reverse().map(m => ({
      yearMonth: m.yearMonth,
      netWorth: m.netWorth,
      byAccount: m.byAccount || [], // Per-account contributions for What moved it
    }));

    return NextResponse.json({
      // Original fields (required by nav pill)
      netWorth,
      monthlyChange,
      currency: homeCurrency,
      // Additional fields for badge functionality
      current: netWorth,
      previousMonth: previousMonth?.netWorth ?? null,
      change: monthlyChange,
      changePercent,
      latestMonth: currentMonth?.yearMonth ?? null,
      trend,
      // Monthly history for net worth page chart
      monthlyHistory: last12Months,
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
