import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { buildAccountSlug } from "@/lib/accountSlug";
import { getYearMonth } from "@/lib/consolidate";
import { inferCurrencyFromBankName } from "@/lib/currencyUtils";
import { invalidateFinancialProfileCache } from "@/lib/financialProfile";
import { fireInsightEvent } from "@/lib/insights/index";
import type { ParsedStatementData, AccountType } from "@/lib/types";

/**
 * POST /api/user/statements/:id/complete
 *
 * Manually completes a statement that is in "needs_review" status.
 * Accepts user-confirmed key fields, builds minimal parsedData, runs the
 * same accountSlug + backfill flag logic as /api/parse, then marks the
 * statement as "completed".
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const { id: statementId } = await params;
    const ref = db.collection("statements").doc(statementId);
    const snap = await ref.get();

    if (!snap.exists) return NextResponse.json({ error: "Statement not found" }, { status: 404 });
    const data = snap.data()!;
    if (data.userId !== uid) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

    if (data.status === "completed") {
      return NextResponse.json({ error: "Statement is already completed" }, { status: 409 });
    }

    const body = await request.json().catch(() => ({})) as {
      bankName?: string;
      accountType?: string;
      yearMonth?: string;
      currency?: string;
      closingBalance?: number;
      accountName?: string;
    };

    const { bankName, accountType, yearMonth, currency, closingBalance, accountName } = body;

    if (!bankName?.trim()) return NextResponse.json({ error: "bankName is required" }, { status: 400 });
    if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) return NextResponse.json({ error: "yearMonth must be YYYY-MM" }, { status: 400 });
    if (!currency?.trim()) return NextResponse.json({ error: "currency is required" }, { status: 400 });
    if (closingBalance === undefined || closingBalance === null || isNaN(Number(closingBalance))) {
      return NextResponse.json({ error: "closingBalance is required" }, { status: 400 });
    }

    // Merge user-entered fields with any partial data from the AI attempt
    const partial = (data.partialParsedData ?? {}) as Partial<ParsedStatementData>;

    const parsedData: ParsedStatementData = {
      ...partial,
      bankName: bankName.trim(),
      accountType: (accountType ?? partial.accountType ?? "checking") as AccountType,
      accountName: accountName?.trim() || partial.accountName,
      statementDate: `${yearMonth}-01`,
      currency: currency.trim(),
      netWorth: Number(closingBalance),
      income: partial.income ?? { total: 0, sources: [], transactions: [] },
      expenses: partial.expenses ?? { total: 0, categories: [], transactions: [] },
      subscriptions: partial.subscriptions ?? [],
      savingsRate: partial.savingsRate ?? 0,
    };

    // ── Account slug ─────────────────────────────────────────────────────────
    const slug = buildAccountSlug(parsedData.bankName, parsedData.accountId, parsedData.accountName, parsedData.accountType);
    const slugIsAccountNumber = /^\d{4}$/.test(slug ?? "");
    const inferredCurrency = inferCurrencyFromBankName(parsedData.bankName, parsedData.currency);

    // ── Synthetic account ID (no real account number extracted) ──────────────
    let accountConfirmNeeded = false;
    let existingAccounts: { slug: string; label: string }[] = [];
    let suggestedSlug: string | undefined;
    const bankTypeKey = buildAccountSlug(parsedData.bankName, undefined, parsedData.accountName, parsedData.accountType);
    const hasRealAccountId = !!parsedData.accountId;

    if (!hasRealAccountId) {
      const overrideRef = db.collection(`users/${uid}/accountSlugOverrides`).doc(bankTypeKey);
      const overrideDoc = await overrideRef.get();
      let syntheticId: string;
      if (overrideDoc.exists && overrideDoc.data()?.confirmedAccountId) {
        syntheticId = overrideDoc.data()!.confirmedAccountId as string;
        if (overrideDoc.data()?.confirmedSlug) suggestedSlug = overrideDoc.data()!.confirmedSlug as string;
      } else {
        syntheticId = "s" + Math.random().toString(36).slice(2, 5);
        await overrideRef.set({ confirmedAccountId: syntheticId }, { merge: true });
      }
      parsedData.accountId = syntheticId;
      accountConfirmNeeded = true;
    }

    const finalSlug = buildAccountSlug(parsedData.bankName, parsedData.accountId, parsedData.accountName, parsedData.accountType);

    // ── Backfill / new-account detection ─────────────────────────────────────
    let backfillPromptNeeded = false;
    let backfillOldestMonth: string | null = null;

    try {
      const allUserStmts = await db
        .collection("statements")
        .where("userId", "==", uid)
        .where("status", "==", "completed")
        .get();

      if (accountConfirmNeeded) {
        type Candidate = { slug: string; label: string; yearMonth: string; isAcctNum: boolean };
        const byNormLabel = new Map<string, Candidate>();
        for (const d of allUserStmts.docs) {
          const dd = d.data();
          const s = dd.accountSlug as string | undefined;
          if (!s) continue;
          const p = dd.parsedData as Record<string, unknown> | undefined;
          const label = (p?.accountName as string | undefined) || `${p?.bankName ?? ""} ${p?.accountType ?? ""}`.trim() || s;
          const normLabel = label.toLowerCase().replace(/[®™\s]+/g, " ").replace(/[^a-z0-9 ]/g, "").trim();
          const isAcctNum = /^\d{4}$/.test(s);
          const ym = (dd.yearMonth as string) ?? "";
          const existing = byNormLabel.get(normLabel);
          if (!existing) {
            byNormLabel.set(normLabel, { slug: s, label, yearMonth: ym, isAcctNum });
          } else {
            if ((isAcctNum && !existing.isAcctNum) || (isAcctNum === existing.isAcctNum && ym > existing.yearMonth))
              byNormLabel.set(normLabel, { slug: s, label, yearMonth: ym, isAcctNum });
          }
        }
        const bySlug = new Map<string, Candidate>();
        for (const c of byNormLabel.values()) {
          const prev = bySlug.get(c.slug);
          if (!prev) { bySlug.set(c.slug, c); continue; }
          if ((c.isAcctNum && !prev.isAcctNum) || (c.isAcctNum === prev.isAcctNum && c.yearMonth > prev.yearMonth))
            bySlug.set(c.slug, c);
        }
        existingAccounts = Array.from(bySlug.values())
          .map(({ slug: s, label }) => ({ slug: s, label }))
          .sort((a, b) => a.label.localeCompare(b.label));

        const bankNorm = (parsedData.bankName ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        const acctNorm = (parsedData.accountName ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
        const match = existingAccounts.find((a) => {
          const lbl = a.label.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
          return (bankNorm.length > 2 && lbl.includes(bankNorm)) || (acctNorm.length > 4 && (lbl.includes(acctNorm) || acctNorm.includes(lbl)));
        });
        if (!suggestedSlug && match) suggestedSlug = match.slug;
      }

      const existingSlugs = new Set(allUserStmts.docs.map((d) => d.data().accountSlug as string).filter(Boolean));
      const isFirstForSlug = !existingSlugs.has(finalSlug);
      if (isFirstForSlug) {
        backfillPromptNeeded = true;
        const allMonths = allUserStmts.docs.map((d) => d.data().yearMonth as string).filter(Boolean).sort();
        backfillOldestMonth = allMonths[0] ?? null;
      }
    } catch (e) {
      console.error("[complete] backfill detection failed:", e);
    }

    // ── Write completed statement ─────────────────────────────────────────────
    await ref.update({
      parsedData,
      partialParsedData: null,
      parseError: null,
      status: "completed",
      accountSlug: finalSlug,
      yearMonth,
      slugIsAccountNumber,
      ...(accountConfirmNeeded && {
        accountConfirmNeeded: true,
        bankTypeKey,
        existingAccounts,
        ...(suggestedSlug ? { suggestedSlug } : {}),
      }),
      ...(backfillPromptNeeded && {
        backfillPromptNeeded: true,
        backfillOldestMonth,
        inferredCurrency,
      }),
    });

    // Mark older statements for the same account+month as superseded
    const olderSnap = await db
      .collection("statements")
      .where("userId", "==", uid)
      .where("accountSlug", "==", finalSlug)
      .where("yearMonth", "==", yearMonth)
      .get();
    const batch = db.batch();
    let hasBatchOps = false;
    for (const doc of olderSnap.docs) {
      if (doc.id !== statementId) {
        batch.update(doc.ref, { superseded: true, supersededBy: statementId });
        hasBatchOps = true;
      }
    }
    if (hasBatchOps) await batch.commit();

    await invalidateFinancialProfileCache(uid, db);

    fireInsightEvent({ type: "statement.parsed", meta: { statementId } }, uid, db)
      .catch((e) => console.error("[complete] insights event failed:", e));

    return NextResponse.json({ ok: true, status: "completed", accountSlug: finalSlug });
  } catch (err) {
    console.error("[complete] error:", err);
    return NextResponse.json({ error: "Failed to complete statement" }, { status: 500 });
  }
}
