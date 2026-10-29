import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildDebtsSummary, type DebtsSummary } from "@/lib/debtsSummary";

export async function GET(request: NextRequest) {
  try {
    const authHeader = request.headers.get("authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const token = authHeader.substring(7);
    const { auth, db } = getFirebaseAdmin();
    const decodedToken = await auth.verifyIdToken(token);
    const uid = decodedToken.uid;

    // Get financial profile
    const profile = await getFinancialProfile(uid, db);

    // Build debts summary
    const summary = buildDebtsSummary(
      profile.accountSnapshots,
      profile.accountBalanceHistory,
      profile.debtPaymentHistory,
      profile.manualLiabilities,
      profile.fxRates,
      profile.homeCurrency,
      profile.monthlyHistory,
      profile.expenseTxns,
      profile.incomeTxns
    );

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Debts summary error:", error);
    return NextResponse.json(
      { error: "Failed to load debts summary" },
      { status: 500 }
    );
  }
}
