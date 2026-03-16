/**
 * GET  /api/user/account-rates
 *   Returns one rate entry per account, merging AI-extracted rates from the most
 *   recent completed statement for each account with any manual overrides the user
 *   has saved.  Manual overrides always win.
 *
 * PUT  /api/user/account-rates
 *   Body: { accountKey, rate }
 *   Saves a manual override for that account.  Pass rate: null to clear override
 *   (falls back to AI-extracted value).
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import type { ParsedStatementData } from "@/lib/types";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

function accountKey(p: ParsedStatementData): string {
  const bank = (p.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  const acct = (p.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return acct !== "unknown" ? `${bank}__${acct}` : bank;
}

export interface AccountRateEntry {
  accountKey: string;
  bankName: string;
  accountName: string;
  accountType: string;
  /** Rate extracted by AI from latest statement (null if not found). */
  extractedRate: number | null;
  /** Rate manually set by user (null if not overridden). */
  manualRate: number | null;
  /** The effective rate to use: manualRate ?? extractedRate ?? null */
  effectiveRate: number | null;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);

    // Fetch all completed statements
    const stmtSnap = await db
      .collection("users").doc(uid).collection("statements")
      .where("status", "==", "completed")
      .get();

    // Build map: accountKey → latest statement parsed data
    const latestByAccount = new Map<string, ParsedStatementData & { statementDate: string }>();
    for (const doc of stmtSnap.docs) {
      const d = doc.data();
      const parsed = d.parsedData as ParsedStatementData | undefined;
      if (!parsed?.bankName) continue;
      const key = accountKey(parsed);
      const existing = latestByAccount.get(key);
      if (!existing || (parsed.statementDate ?? "") > (existing.statementDate ?? "")) {
        latestByAccount.set(key, parsed as ParsedStatementData & { statementDate: string });
      }
    }

    // Fetch manual overrides
    const overridesSnap = await db
      .collection("users").doc(uid).collection("accountRates")
      .get();
    const overrides = new Map<string, number | null>();
    for (const doc of overridesSnap.docs) {
      const d = doc.data();
      overrides.set(doc.id, typeof d.rate === "number" ? d.rate : null);
    }

    // Merge
    const entries: AccountRateEntry[] = [];
    for (const [key, parsed] of latestByAccount) {
      const extractedRate = typeof parsed.interestRate === "number" ? parsed.interestRate : null;
      const manualRate = overrides.has(key) ? (overrides.get(key) ?? null) : null;
      entries.push({
        accountKey: key,
        bankName: parsed.bankName,
        accountName: parsed.accountName ?? parsed.bankName,
        accountType: parsed.accountType ?? "other",
        extractedRate,
        manualRate,
        effectiveRate: manualRate ?? extractedRate,
      });
    }

    // Sort: debts first (mortgage, loan, credit), then assets
    const ORDER = ["mortgage", "loan", "credit", "savings", "checking", "investment", "other"];
    entries.sort((a, b) => (ORDER.indexOf(a.accountType) - ORDER.indexOf(b.accountType)));

    return NextResponse.json({ rates: entries });
  } catch (err) {
    console.error("GET /api/user/account-rates error:", err);
    return NextResponse.json({ error: "Failed to load rates" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const { uid } = await auth.verifyIdToken(token);
    const body = await req.json();
    const { accountKey: key, rate } = body as { accountKey: string; rate: number | null };

    if (!key) return NextResponse.json({ error: "accountKey required" }, { status: 400 });

    const ref = db.collection("users").doc(uid).collection("accountRates").doc(key);
    if (rate === null) {
      await ref.delete();
    } else {
      await ref.set({ rate, updatedAt: new Date() }, { merge: true });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/user/account-rates error:", err);
    return NextResponse.json({ error: "Failed to save rate" }, { status: 500 });
  }
}
