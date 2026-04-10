/**
 * GET  /api/user/account-rates
 *   Returns one rate entry per account, merging AI-extracted rates from the most
 *   recent completed statement with any manual overrides.  Manual overrides win.
 *
 * PUT  /api/user/account-rates
 *   Body: { accountKey, rate, paymentFrequency? }
 *   Saves a manual override.  Pass rate: null to clear (falls back to AI value).
 */

import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import type { ParsedStatementData } from "@/lib/types";
import { buildAccountSlug } from "@/lib/accountSlug";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";

export type PaymentFrequency = "weekly" | "biweekly" | "semi-monthly" | "monthly";

function authToken(req: NextRequest): string | null {
  const h = req.headers.get("authorization");
  return h?.startsWith("Bearer ") ? h.slice(7) : null;
}

function toAccountKey(p: ParsedStatementData): string {
  return buildAccountSlug(p.bankName, p.accountId);
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
  /** Payment frequency for this account (null = not set, default to monthly). */
  paymentFrequency: PaymentFrequency | null;
}

export async function GET(req: NextRequest) {
  const token = authToken(req);
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(req, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.actorUid;

    // ── Fetch all completed statements (root collection, filtered by userId) ──
    const stmtSnap = await db
      .collection("statements")
      .where("userId", "==", uid)
      .where("status", "==", "completed")
      .get();

    // Build map: accountKey → latest parsed data by statementDate
    const latestByAccount = new Map<string, ParsedStatementData & { statementDate: string }>();
    for (const doc of stmtSnap.docs) {
      const d = doc.data();
      const parsed = d.parsedData as ParsedStatementData | undefined;
      if (!parsed?.bankName) continue;
      const key = toAccountKey(parsed);
      const existing = latestByAccount.get(key);
      if (!existing || (parsed.statementDate ?? "") > (existing.statementDate ?? "")) {
        latestByAccount.set(key, parsed as ParsedStatementData & { statementDate: string });
      }
    }

    // ── Fetch manual overrides from users/{uid}/accountRates ──────────────────
    const overridesSnap = await db
      .collection("users").doc(uid).collection("accountRates")
      .get();

    const overrides = new Map<string, { rate: number | null; paymentFrequency: PaymentFrequency | null }>();
    for (const doc of overridesSnap.docs) {
      const d = doc.data();
      overrides.set(doc.id, {
        rate: typeof d.rate === "number" ? d.rate : null,
        paymentFrequency: (d.paymentFrequency as PaymentFrequency) ?? null,
      });
    }

    // ── Merge statements + overrides ──────────────────────────────────────────
    // Include accounts that have overrides even if no statement found
    const allKeys = new Set([...latestByAccount.keys(), ...overrides.keys()]);
    const entries: AccountRateEntry[] = [];

    for (const key of allKeys) {
      const parsed   = latestByAccount.get(key);
      const override = overrides.get(key);

      const extractedRate    = parsed ? (typeof parsed.interestRate === "number" ? parsed.interestRate : null) : null;
      const manualRate       = override?.rate ?? null;
      const paymentFrequency = override?.paymentFrequency ?? null;

      entries.push({
        accountKey: key,
        bankName:   parsed?.bankName ?? key,
        accountName: parsed?.accountName ?? parsed?.bankName ?? key,
        accountType: parsed?.accountType ?? "other",
        extractedRate,
        manualRate,
        effectiveRate: manualRate ?? extractedRate,
        paymentFrequency,
      });
    }

    // Sort: debts first, then assets
    const ORDER = ["mortgage", "loan", "credit", "savings", "checking", "investment", "other"];
    entries.sort((a, b) => ORDER.indexOf(a.accountType) - ORDER.indexOf(b.accountType));

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
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(req, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.actorUid;
    const body = await req.json();
    const { accountKey: key, rate, paymentFrequency, note } =
      body as { accountKey: string; rate?: number | null; paymentFrequency?: PaymentFrequency | null; note?: string };

    if (!key) return NextResponse.json({ error: "accountKey required" }, { status: 400 });

    const ref = db.collection("users").doc(uid).collection("accountRates").doc(key);

    // Build the update payload — only include fields that were explicitly sent
    const update: Record<string, unknown> = { updatedAt: new Date() };
    if (rate !== undefined)             update.rate = rate;
    if (paymentFrequency !== undefined) update.paymentFrequency = paymentFrequency;

    if (Object.keys(update).length > 1) { // more than just updatedAt
      await ref.set(update, { merge: true });
    }

    // Log rate change to history (only when rate explicitly changes)
    if (rate !== undefined && rate !== null) {
      await ref.collection("history").add({
        rate,
        source: "user",
        changedAt: new Date(),
        note: note ?? null,
      });
    }

    await invalidateFinancialProfileCache(uid, db);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("PUT /api/user/account-rates error:", err);
    return NextResponse.json({ error: "Failed to save rate" }, { status: 500 });
  }
}
