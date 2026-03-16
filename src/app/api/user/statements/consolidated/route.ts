import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { consolidateStatements, getYearMonth } from "@/lib/consolidate";
import type { ParsedStatementData, ManualAsset, AssetCategory } from "@/lib/types";

function docYearMonth(d: FirebaseFirestore.DocumentData): string {
  const parsed = d.parsedData as ParsedStatementData | undefined;
  let ym = parsed?.statementDate ? getYearMonth(parsed.statementDate) : "";
  if (!ym) {
    const raw = d.uploadedAt?.toDate?.() ?? d.uploadedAt;
    if (raw) {
      const t =
        typeof raw === "object" && "toISOString" in raw
          ? (raw as Date).toISOString()
          : String(raw);
      ym = t.slice(0, 7);
    }
  }
  return ym;
}

function accountSlug(parsed: ParsedStatementData): string {
  const bank = (parsed.bankName ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  const acct = (parsed.accountId ?? "unknown").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return acct !== "unknown" ? `${bank}-${acct}` : bank;
}

function matchesBank(parsed: ParsedStatementData, bankFilter: string | null): boolean {
  if (!bankFilter) return true;
  return (parsed.bankName ?? "").toLowerCase().replace(/\s+/g, "-") === bankFilter;
}

function matchesAccount(parsed: ParsedStatementData, accountFilter: string | null): boolean {
  if (!accountFilter) return true;
  return accountSlug(parsed) === accountFilter;
}

/**
 * For a given target month, return the "best" statement for each account:
 * - If the account has a statement for that exact month → use it.
 * - Otherwise carry forward the most recent statement from any earlier month.
 *
 * This ensures a mortgage uploaded in Jan still appears in Feb/Mar totals
 * even if no new statement was uploaded.
 */
function carryForwardStatements(
  allDocs: FirebaseFirestore.QueryDocumentSnapshot[],
  targetMonth: string
): ParsedStatementData[] {
  // Build map: slug → latest doc whose yearMonth <= targetMonth
  const latestPerAccount = new Map<string, { ym: string; parsed: ParsedStatementData }>();

  for (const doc of allDocs) {
    const d = doc.data();
    const ym = docYearMonth(d);
    if (!ym || ym > targetMonth) continue; // ignore future statements

    const parsed = d.parsedData as ParsedStatementData;
    const slug = accountSlug(parsed);
    const existing = latestPerAccount.get(slug);

    if (!existing || ym > existing.ym) {
      latestPerAccount.set(slug, { ym, parsed });
    } else if (ym === existing.ym) {
      // Same month: prefer the one uploaded most recently
      const existingUpload = (allDocs.find(
        (x) => accountSlug(x.data().parsedData as ParsedStatementData) === slug &&
                docYearMonth(x.data()) === ym &&
                x.data().parsedData === existing.parsed
      )?.data().uploadedAt?.toDate?.()?.getTime() ?? 0);
      const thisUpload = d.uploadedAt?.toDate?.()?.getTime() ?? 0;
      if (thisUpload > existingUpload) {
        latestPerAccount.set(slug, { ym, parsed });
      }
    }
  }

  return Array.from(latestPerAccount.values()).map((v) => v.parsed);
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const monthParam = searchParams.get("month")?.trim();
  const bankFilter = searchParams.get("bank")?.trim().toLowerCase() ?? null;
  const accountFilter = searchParams.get("account")?.trim().toLowerCase() ?? null;
  const useCurrent = !monthParam || monthParam === "current";

  try {
    const { auth, db } = getFirebaseAdmin();
    const decoded = await auth.verifyIdToken(token);
    const uid = decoded.uid;

    const snapshot = await db.collection("statements").where("userId", "==", uid).get();

    // Load manual assets
    const manualAssetsSnap = await db
      .collection("users").doc(uid).collection("manualAssets").get();
    const allManualAssets: ManualAsset[] = manualAssetsSnap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        label: data.label ?? "",
        category: (data.category as AssetCategory) ?? "other",
        value: data.value ?? 0,
        linkedAccountSlug: data.linkedAccountSlug ?? undefined,
        updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
      };
    });

    const relevantManualAssets = accountFilter
      ? allManualAssets.filter((a) => a.linkedAccountSlug === accountFilter)
      : allManualAssets;
    const manualAssetsTotal = relevantManualAssets.reduce((sum, a) => sum + a.value, 0);

    // Filter to completed statements passing bank/account filters
    const allCompleted = snapshot.docs.filter((doc) => {
      const d = doc.data();
      if (d.status !== "completed" || !d.parsedData) return false;
      const parsed = d.parsedData as ParsedStatementData;
      if (!matchesBank(parsed, bankFilter)) return false;
      if (!matchesAccount(parsed, accountFilter)) return false;
      return true;
    });

    // All distinct yearMonths that actually have uploaded statements
    const yearMonths = new Set<string>();
    for (const doc of allCompleted) {
      const ym = docYearMonth(doc.data());
      if (ym) yearMonths.add(ym);
    }

    const month = useCurrent
      ? yearMonths.size > 0
        ? Array.from(yearMonths).sort().reverse()[0]!
        : null
      : monthParam!;

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      if (useCurrent) {
        const now = new Date();
        const currentYearMonth =
          now.getFullYear().toString() + "-" + String(now.getMonth() + 1).padStart(2, "0");
        return NextResponse.json({
          data: {
            netWorth: manualAssetsTotal,
            assets: manualAssetsTotal,
            debts: 0,
            statementDate: `${currentYearMonth}-01`,
            bankName: "",
            income: { total: 0, sources: [] },
            expenses: { total: 0, categories: [] },
            subscriptions: [],
            savingsRate: 0,
            insights: [],
          },
          count: 0,
          previousMonth: null,
          yearMonth: currentYearMonth,
          history: [],
        });
      }
      return NextResponse.json(
        { error: "Query param month must be YYYY-MM, e.g. month=2024-03" },
        { status: 400 }
      );
    }

    // ── Current month: carry-forward balances for all accounts ──────────────
    const currentStatements = carryForwardStatements(allCompleted, month);
    const consolidated = consolidateStatements(currentStatements, month);

    const totalAssets = (consolidated.assets ?? Math.max(0, consolidated.netWorth)) + manualAssetsTotal;
    const adjustedNetWorth = totalAssets - (consolidated.debts ?? Math.max(0, -consolidated.netWorth));
    const enrichedConsolidated: ParsedStatementData = {
      ...consolidated,
      assets: totalAssets,
      netWorth: adjustedNetWorth,
    };

    // ── Previous month (for delta calculations) ──────────────────────────────
    const priorMonths = Array.from(yearMonths)
      .filter((ym) => ym < month)
      .sort()
      .reverse();
    const prevMonth = priorMonths[0] ?? null;

    let previousMonth: { netWorth: number; assets: number; debts: number; expenses: number } | null = null;
    if (prevMonth) {
      const prevStatements = carryForwardStatements(allCompleted, prevMonth);
      if (prevStatements.length > 0) {
        const prev = consolidateStatements(prevStatements, prevMonth);
        const prevManualTotal = relevantManualAssets.reduce((sum, a) => sum + a.value, 0);
        const prevAssets = (prev.assets ?? Math.max(0, prev.netWorth)) + prevManualTotal;
        const prevDebts = prev.debts ?? Math.max(0, -prev.netWorth);
        previousMonth = {
          netWorth: prevAssets - prevDebts,
          assets: prevAssets,
          debts: prevDebts,
          expenses: prev.expenses?.total ?? 0,
        };
      }
    }

    // ── History: one entry per month that has at least one uploaded statement ─
    // Each month uses carry-forward so older accounts don't disappear.
    const history: { yearMonth: string; netWorth: number; expensesTotal: number }[] = [];
    for (const ym of Array.from(yearMonths).sort()) {
      const forMonth = carryForwardStatements(allCompleted, ym);
      if (forMonth.length > 0) {
        const c = consolidateStatements(forMonth, ym);
        const hAssets = (c.assets ?? Math.max(0, c.netWorth)) + manualAssetsTotal;
        const hNetWorth = hAssets - (c.debts ?? Math.max(0, -c.netWorth));
        history.push({ yearMonth: ym, netWorth: hNetWorth, expensesTotal: c.expenses?.total ?? 0 });
      }
    }

    // ── Per-account statement history (for account detail page) ─────────────
    // Map slug → sorted list of { yearMonth, netWorth, uploadedAt, statementId, isCarryForward }
    const accountStatementHistory = new Map<string, {
      yearMonth: string; netWorth: number; uploadedAt: string;
      statementId: string; isCarryForward: boolean;
    }[]>();

    for (const ym of Array.from(yearMonths).sort()) {
      const carried = carryForwardStatements(allCompleted, ym);
      for (const parsed of carried) {
        const slug = accountSlug(parsed);
        // Determine if this is a real upload for this month or carried from earlier
        const realForThisMonth = allCompleted.some((doc) => {
          const d = doc.data();
          return docYearMonth(d) === ym &&
            accountSlug(d.parsedData as ParsedStatementData) === slug;
        });
        const sourceDoc = allCompleted.find((doc) => {
          const d = doc.data();
          return (d.parsedData as ParsedStatementData) === parsed;
        });
        const uploadedAt = sourceDoc?.data().uploadedAt?.toDate?.()?.toISOString?.() ?? "";
        if (!accountStatementHistory.has(slug)) accountStatementHistory.set(slug, []);
        accountStatementHistory.get(slug)!.push({
          yearMonth: ym,
          netWorth: parsed.netWorth ?? 0,
          uploadedAt,
          statementId: sourceDoc?.id ?? "",
          isCarryForward: !realForThisMonth,
        });
      }
    }

    // ── Incomplete months detection ──────────────────────────────────────────
    // A month is "incomplete" if at least one account that exists today used
    // a carry-forward (i.e. had no real statement uploaded for that month).
    const allSlugs = new Set(Array.from(accountStatementHistory.keys()));
    const incompleteMonths: string[] = [];
    for (const ym of Array.from(yearMonths).sort()) {
      const hasCarryForward = Array.from(allSlugs).some((slug) => {
        const entry = accountStatementHistory.get(slug)?.find((e) => e.yearMonth === ym);
        return entry?.isCarryForward === true;
      });
      if (hasCarryForward) incompleteMonths.push(ym);
    }

    return NextResponse.json({
      data: enrichedConsolidated,
      count: currentStatements.length,
      previousMonth,
      yearMonth: month,
      history,
      manualAssets: relevantManualAssets,
      incompleteMonths,
      accountStatementHistory: Object.fromEntries(accountStatementHistory),
    });
  } catch (err) {
    console.error("Consolidated statements error:", err);
    if (
      err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code: string }).code === "auth/id-token-expired"
    ) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    return NextResponse.json({ error: "Failed to load consolidated data." }, { status: 500 });
  }
}
