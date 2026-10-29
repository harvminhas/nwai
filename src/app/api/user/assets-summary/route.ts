import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { buildAssetsSummary, type AssetsSummary } from "@/lib/assetsSummary";

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

    // Build assets summary
    const summary = buildAssetsSummary(
      profile.accountSnapshots,
      profile.accountBalanceHistory,
      profile.manualAssets,
      profile.fxRates,
      profile.homeCurrency,
      profile.monthlyHistory,
      profile.expenseTxns,
      profile.incomeTxns
    );

    return NextResponse.json(summary);
  } catch (error) {
    console.error("Assets summary error:", error);
    return NextResponse.json(
      { error: "Failed to load assets summary" },
      { status: 500 }
    );
  }
}
