import { NextRequest } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { computeMoneyCoachBreakdown } from "@/lib/moneyCoach";

export const dynamic = "force-dynamic";

/**
 * GET /api/user/money-coach
 * Returns money coach breakdown: Fixed, Essentials, Discretionary, Savings buckets
 * with median monthly amounts, % of income, and plain-language advice.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const profile = await getFinancialProfile(decoded.uid, db);
    const breakdown = computeMoneyCoachBreakdown(profile);

    return Response.json({
      ...breakdown,
      homeCurrency: profile.homeCurrency,
    });
  } catch (error) {
    console.error("Money coach error:", error);
    return Response.json(
      { error: "Failed to compute money coach breakdown" },
      { status: 500 }
    );
  }
}
