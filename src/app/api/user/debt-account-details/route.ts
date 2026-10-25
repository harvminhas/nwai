import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { getFinancialProfile } from "@/lib/financialProfile";
import { computeScheduledDebtPayments } from "@/lib/debtPayments";
import type { DebtPaymentReview } from "@/lib/types";
import type { ExpenseTxnRecord } from "@/lib/extractTransactions";

export const dynamic = "force-dynamic";

export interface DebtTransactionDetail {
  date: string;
  description: string;
  amount: number;
  isAnomaly?: boolean;
  isReviewed?: boolean;
}

export interface DebtAccountDetails {
  accountName: string;
  accountSlug: string;
  method: string;
  scheduledAmount: number;
  countedAsFixed: {
    total: number;
    transactions: DebtTransactionDetail[];
  };
  extraPaydown: {
    total: number;
    transactions: DebtTransactionDetail[];
  };
}

/**
 * GET /api/user/debt-account-details?accountSlug=xxx&window=last3
 * Returns detailed transaction breakdown for a specific debt account.
 */
export async function GET(req: NextRequest) {
  try {
    const token = req.headers.get("authorization")?.replace("Bearer ", "");
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);

    const { searchParams } = new URL(req.url);
    const accountSlug = searchParams.get("accountSlug");
    const window = searchParams.get("window") || "last3";

    if (!accountSlug) {
      return NextResponse.json({ error: "Missing accountSlug parameter" }, { status: 400 });
    }

    // Load user debt payment reviews
    const reviewsSnap = await db.collection(`users/${decoded.uid}/debtPaymentReviews`).get();
    const userReviews: DebtPaymentReview[] = reviewsSnap.docs.map((doc) => ({
      txFingerprint: doc.id,
      accountSlug: doc.get("accountSlug"),
      classification: doc.get("classification"),
      date: doc.get("date"),
      amount: doc.get("amount"),
      reviewedAt: doc.get("reviewedAt"),
    }));

    const profile = await getFinancialProfile(decoded.uid, db);
    
    // Currency conversion helper
    const fxRates = profile.fxRates ?? {};
    const home = (profile.homeCurrency ?? "CAD").toUpperCase();
    function toHome(amount: number, currency?: string): number {
      const cur = (currency ?? home).toUpperCase();
      if (cur === home) return amount;
      const rate = fxRates[cur];
      return rate ? amount * rate : amount;
    }
    
    // Get scheduled payment info for this account
    const scheduledPayments = computeScheduledDebtPayments(
      profile.accountSnapshots,
      profile.expenseTxns,
      userReviews,
      fxRates,
      profile.homeCurrency
    );
    
    const accountPayment = scheduledPayments.find(p => p.accountSlug === accountSlug);
    if (!accountPayment) {
      return NextResponse.json({ error: "Account not found" }, { status: 404 });
    }

    // Filter transactions for this account
    const accountTxns = profile.expenseTxns.filter(
      (t: ExpenseTxnRecord) => t.accountSlug === accountSlug && t.category === "Debt Payments"
    );

    // Build review map by fingerprint for quick lookup
    const reviewMap = new Map(userReviews.map(r => [r.txFingerprint, r]));
    const anomalyMap = new Map(
      accountPayment.unreviewedAnomalies?.map(a => [a.txFingerprint, a]) || []
    );

    // Split transactions into counted as fixed vs extra paydown
    const countedAsFixed: DebtTransactionDetail[] = [];
    const extraPaydown: DebtTransactionDetail[] = [];

    for (const txn of accountTxns) {
      const { txFingerprint } = await import("@/lib/txFingerprint");
      const fingerprint = txFingerprint(txn.accountSlug, txn.date, txn.amount, txn.merchant);
      
      const review = reviewMap.get(fingerprint);
      const isAnomaly = anomalyMap.has(fingerprint);
      const isReviewed = !!review;

      const detail: DebtTransactionDetail = {
        date: txn.date,
        description: txn.merchant,
        amount: toHome(Math.abs(txn.amount), txn.currency),
        isAnomaly,
        isReviewed,
      };

      // Classify based on review status
      if (review?.classification === "ignore") {
        // Excluded - don't show anywhere
        continue;
      } else if (review?.classification === "new_regular_payment") {
        // Treated as regular payment
        countedAsFixed.push(detail);
      } else if (review?.classification === "extra_prepayment") {
        // Split: regular goes to fixed, excess to extra
        if (detail.amount > accountPayment.amount) {
          countedAsFixed.push({
            ...detail,
            amount: accountPayment.amount,
          });
          extraPaydown.push({
            ...detail,
            amount: detail.amount - accountPayment.amount,
          });
        } else {
          countedAsFixed.push(detail);
        }
      } else if (isAnomaly) {
        // Unreviewed anomaly - excluded from both
        continue;
      } else {
        // Regular payment within scheduled amount
        if (detail.amount <= accountPayment.amount) {
          countedAsFixed.push(detail);
        } else {
          countedAsFixed.push({
            ...detail,
            amount: accountPayment.amount,
          });
          extraPaydown.push({
            ...detail,
            amount: detail.amount - accountPayment.amount,
          });
        }
      }
    }

    const details: DebtAccountDetails = {
      accountName: accountPayment.accountName || accountSlug,
      accountSlug,
      method: accountPayment.method,
      scheduledAmount: accountPayment.amount,
      countedAsFixed: {
        total: countedAsFixed.reduce((sum, t) => sum + t.amount, 0),
        transactions: countedAsFixed.sort((a, b) => b.date.localeCompare(a.date)),
      },
      extraPaydown: {
        total: extraPaydown.reduce((sum, t) => sum + t.amount, 0),
        transactions: extraPaydown.sort((a, b) => b.date.localeCompare(a.date)),
      },
    };

    return NextResponse.json(details);
  } catch (error) {
    console.error("Debt account details error:", error);
    return NextResponse.json(
      { error: "Failed to load debt account details" },
      { status: 500 }
    );
  }
}
