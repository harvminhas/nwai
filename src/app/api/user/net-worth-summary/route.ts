/**
 * GET /api/user/net-worth-summary
 * 
 * Lightweight endpoint for nav bar net worth pill.
 * Uses shared getNetWorthForMonth (single authoritative source).
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { getNetWorthForMonth } from "@/lib/netWorthCalculation";

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // Parse explicit month/year from URL params
    const url = new URL(req.url);
    const monthParam = url.searchParams.get("month");
    const yearParam = url.searchParams.get("year");

    let options: { month?: number; year?: number } | undefined;

    if (monthParam !== null || yearParam !== null) {
      // Explicit period requested - validate paired month+year
      if (monthParam === null || yearParam === null) {
        return NextResponse.json(
          { error: "month and year must be provided together" },
          { status: 400 }
        );
      }

      const month = parseInt(monthParam, 10);
      const year = parseInt(yearParam, 10);

      if (isNaN(month) || month < 1 || month > 12) {
        return NextResponse.json(
          { error: "month must be an integer between 1 and 12" },
          { status: 400 }
        );
      }

      if (isNaN(year) || year < 1900 || year > 2100) {
        return NextResponse.json(
          { error: "year must be a valid 4-digit year" },
          { status: 400 }
        );
      }

      options = { month, year };
    }

    // Get financial profile for full history
    const profile = await getFinancialProfile(access.targetUid, db);
    
    // Get user's home currency
    const userDoc = await db.collection("users").doc(access.targetUid).get();
    const userData = userDoc.exists ? userDoc.data() ?? {} : {};
    const homeCurrency: string = userData.homeCurrency ?? userData.currency ?? "CAD";

    // Use shared authoritative function (defaults to latest if no options)
    const result = await getNetWorthForMonth(access.targetUid, db, options);

    if (!result && options) {
      // Explicit period requested but not available
      return NextResponse.json(
        { error: `No data available for ${options.year}-${String(options.month).padStart(2, "0")}` },
        { status: 404 }
      );
    }

    if (!result) {
      // No data available
      return NextResponse.json({
        netWorth: 0,
        monthlyChange: 0,
        currency: homeCurrency,
        current: 0,
        previousMonth: null,
        change: 0,
        changePercent: null,
        latestMonth: null,
        trend: null,
        monthlyHistory: [],
      });
    }

    const { netWorth, monthlyChange, currency, yearMonth, previousMonth } = result;

    // Calculate additional fields for badge count feature
    const changePercent = previousMonth && previousMonth.netWorth !== 0 && monthlyChange !== null
      ? (monthlyChange / Math.abs(previousMonth.netWorth)) * 100
      : null;

    let trend: "up" | "down" | "flat" | null = null;
    if (previousMonth && monthlyChange !== null) {
      if (Math.abs(monthlyChange) < 1) {
        trend = "flat";
      } else if (monthlyChange > 0) {
        trend = "up";
      } else {
        trend = "down";
      }
    }

    // Get last 12 months for detail page chart (preserve full API contract)
    const sortedHistory = [...profile.monthlyHistory].sort((a, b) => 
      b.yearMonth.localeCompare(a.yearMonth)
    );
    const last12Months = sortedHistory.slice(0, 12).reverse().map(m => ({
      yearMonth: m.yearMonth,
      netWorth: m.netWorth,
      byAccount: m.byAccount || [],
    }));

    return NextResponse.json({
      // Original fields (required by nav pill)
      netWorth,
      monthlyChange: monthlyChange ?? 0,
      currency,
      // Additional fields for badge functionality
      current: netWorth,
      previousMonth: previousMonth?.netWorth ?? null,
      change: monthlyChange ?? 0,
      changePercent,
      latestMonth: yearMonth,
      trend,
      // Monthly history for detail page chart (PRESERVED)
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
