/**
 * GET /api/user/net-worth-growth
 *
 * Display-only growth decomposition for the Net Worth Growth tab.
 * Reads getFinancialProfile plus the same income-classification prefs
 * `incomeTotal` uses. Does not write stored data.
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { getFinancialProfile } from "@/lib/financialProfile";
import { NET_WORTH_SUMMARY_MONTHS } from "@/lib/chartMonthSelection";
import { computeNetWorthGrowth } from "@/lib/netWorthGrowth";

export const dynamic = "force-dynamic";

/** Same prefs `getFinancialProfile` uses when building incomeTotal — read-only. */
async function loadIncomeClassificationOpts(
  uid: string,
  db: ReturnType<typeof getFirebaseAdmin>["db"],
) {
  const [transferPrefsSnap, incomeCatRulesSnap] = await Promise.all([
    db.doc(`users/${uid}/prefs/transferIncomeSources`).get(),
    db.collection(`users/${uid}/incomeCategoryRules`).get(),
  ]);
  const userTransferSources = new Set<string>(
    transferPrefsSnap.exists ? (transferPrefsSnap.data()?.keys ?? []) : [],
  );
  const incomeCategoryRules = new Map<string, string>();
  for (const d of incomeCatRulesSnap.docs) {
    const r = d.data() as { slug?: string; category?: string };
    if (r.slug && r.category) incomeCategoryRules.set(r.slug, r.category);
  }
  return { userTransferSources, incomeCategoryRules };
}

export async function GET(req: NextRequest) {
  const { db } = getFirebaseAdmin();
  const access = await resolveAccess(req, db);
  if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const [profile, incomeClassOpts] = await Promise.all([
      getFinancialProfile(access.targetUid, db),
      loadIncomeClassificationOpts(access.targetUid, db),
    ]);
    const months = computeNetWorthGrowth(
      {
        monthlyHistory: profile.monthlyHistory,
        expenseTxns: profile.expenseTxns,
        incomeTxns: profile.incomeTxns,
        debtPaymentHistory: profile.debtPaymentHistory,
        homeCurrency: profile.homeCurrency,
        fxRates: profile.fxRates,
        userTransferSources: incomeClassOpts.userTransferSources,
        incomeCategoryRules: incomeClassOpts.incomeCategoryRules,
      },
      { windowMonths: NET_WORTH_SUMMARY_MONTHS },
    );

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
