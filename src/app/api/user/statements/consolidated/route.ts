import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { consolidateStatements, getYearMonth } from "@/lib/consolidate";
import { applyRulesAndRecalculate, merchantSlug } from "@/lib/applyRules";
import { buildAccountSlug } from "@/lib/accountSlug";
import type { ParsedStatementData, ManualAsset, AssetCategory } from "@/lib/types";
import type { BalanceSnapshot } from "@/app/api/user/balance-snapshots/route";

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
  return buildAccountSlug(parsed.bankName, parsed.accountId);
}

/** Human-readable label for a statement's account, e.g. "TD ••••7780" */
function accountDisplayLabel(parsed: ParsedStatementData): string {
  if (parsed.accountName) return parsed.accountName;
  const slug = accountSlug(parsed);
  const bank = (parsed.bankName ?? "").trim();
  if (slug === "unknown") return bank || "Unknown Account";
  const parts = [bank, `••••${slug}`].filter(Boolean);
  return parts.join(" ");
}

/** Tag every expense transaction in a statement with its account label. */
function tagTransactions(stmt: ParsedStatementData): ParsedStatementData {
  const label = accountDisplayLabel(stmt);
  return {
    ...stmt,
    expenses: {
      ...stmt.expenses,
      total: stmt.expenses?.total ?? 0,
      categories: stmt.expenses?.categories ?? [],
      transactions: (stmt.expenses?.transactions ?? []).map((txn) => ({ ...txn, accountLabel: label })),
    },
  };
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

  return Array.from(latestPerAccount.values()).map(({ ym, parsed }) => {
    // When carrying a statement forward to a different month, strip transaction-level
    // data so October's transactions don't pollute March's spending view.
    // Only the balance / net-worth is meaningful when carried forward.
    if (ym !== targetMonth) {
      return {
        ...parsed,
        income:        { total: 0, sources: [], transactions: [] },
        expenses:      { total: 0, categories: [], transactions: [] },
        subscriptions: [],
        savingsRate:   0,
      };
    }
    return parsed;
  });
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

    // Load balance snapshots
    const snapshotsSnap = await db
      .collection("users").doc(uid)
      .collection("balanceSnapshots")
      .get();
    const allSnapshots: BalanceSnapshot[] = snapshotsSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<BalanceSnapshot, "id">),
    }));
    // Filter to account if needed
    const relevantSnapshots = accountFilter
      ? allSnapshots.filter((s) => s.accountSlug === accountFilter)
      : allSnapshots;

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

    // ── Load category rules for this user ────────────────────────────────────
    const rulesSnap = await db.collection(`users/${uid}/categoryRules`).get();
    const categoryRulesMap = new Map<string, string>();
    for (const ruleDoc of rulesSnap.docs) {
      const r = ruleDoc.data();
      if (r.merchant && r.category) {
        categoryRulesMap.set(merchantSlug(r.merchant as string), r.category as string);
      }
    }

    // ── Current month: carry-forward balances for all accounts ──────────────
    const currentStatements = carryForwardStatements(allCompleted, month);
    const consolidated = consolidateStatements(currentStatements.map(tagTransactions), month);

    // Apply user category rules to transactions and recalculate aggregates
    const consolidatedWithRules = categoryRulesMap.size > 0
      ? applyRulesAndRecalculate(consolidated, categoryRulesMap)
      : consolidated;

    const totalAssets = (consolidatedWithRules.assets ?? Math.max(0, consolidatedWithRules.netWorth)) + manualAssetsTotal;
    const adjustedNetWorth = totalAssets - (consolidatedWithRules.debts ?? Math.max(0, -consolidatedWithRules.netWorth));

    let enrichedConsolidated: ParsedStatementData = {
      ...consolidatedWithRules,
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

    // ── History + income source history + recurring expense history ──────────
    const history: { yearMonth: string; netWorth: number; expensesTotal: number; incomeTotal: number; debtTotal: number }[] = [];

    // incomeSourceHistory: source description → per-month amounts + transaction dates
    const incomeSourceHistory: Record<string, {
      yearMonth: string;
      amount: number;
      transactions: { date?: string; amount: number }[];
    }[]> = {};

    // recurringHistory: merchantSlug → per-month transaction dates
    // Used by the spending page to auto-detect subscription frequency via gap analysis.
    // Only populated for months with real expense data (not carry-forwarded).
    const recurringHistory: Record<string, { yearMonth: string; dates: string[] }[]> = {};

    for (const ym of Array.from(yearMonths).sort()) {
      const forMonth = carryForwardStatements(allCompleted, ym);
      if (forMonth.length > 0) {
        const c = consolidateStatements(forMonth, ym);
        const hAssets = (c.assets ?? Math.max(0, c.netWorth)) + manualAssetsTotal;
        const hNetWorth = hAssets - (c.debts ?? Math.max(0, -c.netWorth));
        const hDebts = c.debts ?? Math.max(0, -c.netWorth);
        // Expenses use transaction-date filtering to avoid billing-period double-counting.
        // Income uses the statement-level aggregate (see below).
        const txDateExpenses = (c.expenses?.transactions ?? [])
          .filter((t) => (t.date ?? `${ym}-15`).slice(0, 7) === ym && !/transfer|payment/i.test(t.category ?? ""))
          .reduce((s, t) => s + t.amount, 0);
        // Income uses the statement-level total: the AI parser correctly attributes income
        // to its statement period. Unlike expenses (billing periods can span months),
        // income has no double-counting risk — use the aggregate directly.
        const txDateIncome = c.income?.total ?? 0;
        history.push({ yearMonth: ym, netWorth: hNetWorth, expensesTotal: txDateExpenses, incomeTotal: txDateIncome, debtTotal: hDebts });

        // Build per-source income history — only for months that had real statements
        const hasRealIncome = allCompleted.some((doc) => {
          const d = doc.data() as FirebaseFirestore.DocumentData;
          return docYearMonth(d) === ym && (d.parsedData as ParsedStatementData)?.income?.total > 0;
        });
        if (hasRealIncome) {
          for (const src of c.income?.sources ?? []) {
            if (!incomeSourceHistory[src.description]) incomeSourceHistory[src.description] = [];
            const srcTxns = (c.income?.transactions ?? [])
              .filter((t) => t.source === src.description || t.description === src.description)
              .map((t) => ({ date: t.date, amount: t.amount }));
            incomeSourceHistory[src.description].push({ yearMonth: ym, amount: src.amount, transactions: srcTxns });
          }
        }

        // Build per-merchant expense history — only for months with real expense data
        const hasRealExpenses = allCompleted.some((doc) => {
          const d = doc.data() as FirebaseFirestore.DocumentData;
          return docYearMonth(d) === ym && (d.parsedData as ParsedStatementData)?.expenses?.total > 0;
        });
        if (hasRealExpenses) {
          for (const txn of c.expenses?.transactions ?? []) {
            if (!txn.date) continue; // need dates for gap analysis
            const slug = merchantSlug(txn.merchant);
            if (!recurringHistory[slug]) recurringHistory[slug] = [];
            const existing = recurringHistory[slug].find((h) => h.yearMonth === ym);
            if (existing) {
              existing.dates.push(txn.date);
            } else {
              recurringHistory[slug].push({ yearMonth: ym, dates: [txn.date] });
            }
          }
        }
      }
    }

    // ── Per-account statement history (for account detail page) ─────────────
    // Map slug → sorted list of balance entries (statements + manual snapshots)
    const accountStatementHistory = new Map<string, {
      yearMonth: string; netWorth: number; uploadedAt: string;
      statementId: string; isCarryForward: boolean; interestRate: number | null;
      isManualSnapshot?: boolean; snapshotId?: string; note?: string;
    }[]>();

    for (const ym of Array.from(yearMonths).sort()) {
      const carried = carryForwardStatements(allCompleted, ym);
      for (const parsed of carried) {
        const slug = accountSlug(parsed);
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
        // Only include interestRate for real uploads (not carry-forward copies)
        const interestRate = realForThisMonth && typeof parsed.interestRate === "number"
          ? parsed.interestRate
          : null;
        if (!accountStatementHistory.has(slug)) accountStatementHistory.set(slug, []);
        accountStatementHistory.get(slug)!.push({
          yearMonth: ym,
          netWorth: parsed.netWorth ?? 0,
          uploadedAt,
          statementId: sourceDoc?.id ?? "",
          isCarryForward: !realForThisMonth,
          interestRate,
        });
      }
    }

    // ── Merge manual balance snapshots into account history ─────────────────
    // Snapshots are additive — they never overwrite statement rows.
    // If a snapshot yearMonth conflicts with a statement row, both are kept;
    // the snapshot appears as a distinct "manual" row.
    for (const snap of relevantSnapshots) {
      if (!accountStatementHistory.has(snap.accountSlug)) {
        accountStatementHistory.set(snap.accountSlug, []);
      }
      accountStatementHistory.get(snap.accountSlug)!.push({
        yearMonth:          snap.yearMonth,
        netWorth:           snap.balance,
        uploadedAt:         snap.createdAt,
        statementId:        "",
        isCarryForward:     false,
        interestRate:       null,
        isManualSnapshot:   true,
        snapshotId:         snap.id,
        note:               snap.note,
      });
    }
    // Re-sort each account's history chronologically after merging
    for (const [, entries] of accountStatementHistory) {
      entries.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    }

    // ── Apply snapshot overrides to consolidated net worth ───────────────────
    // If any account has a snapshot more recent than its latest statement,
    // replace that account's contribution to net worth with the snapshot balance.
    // This keeps the dashboard accurate without mutating any statement document.
    let snapshotNetWorthDelta = 0;
    for (const [slug, entries] of accountStatementHistory) {
      const latestStatement = [...entries].reverse().find((e) => !e.isManualSnapshot);
      const latestSnapshot  = [...entries].reverse().find((e) =>  e.isManualSnapshot);
      if (
        latestSnapshot && latestStatement &&
        latestSnapshot.yearMonth > latestStatement.yearMonth
      ) {
        snapshotNetWorthDelta += latestSnapshot.netWorth - latestStatement.netWorth;
      } else if (latestSnapshot && !latestStatement) {
        // Account known only via snapshots (no statement ever uploaded)
        snapshotNetWorthDelta += latestSnapshot.netWorth;
      }
    }
    if (snapshotNetWorthDelta !== 0) {
      const adjAssets = Math.max(0, (enrichedConsolidated.assets ?? 0) + Math.max(0, snapshotNetWorthDelta));
      const adjDebts  = Math.max(0, (enrichedConsolidated.debts  ?? 0) - Math.min(0, snapshotNetWorthDelta));
      enrichedConsolidated = {
        ...enrichedConsolidated,
        netWorth: (enrichedConsolidated.netWorth ?? 0) + snapshotNetWorthDelta,
        assets:   adjAssets,
        debts:    adjDebts,
      };
    }

    // ── Incomplete months detection ──────────────────────────────────────────    // A month is "incomplete" if at least one account that exists today used
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

    // ── Liquid assets (checking + savings account balances only) ────────────
    let liquidAssets = 0;
    for (const stmt of currentStatements) {
      const t = (stmt.accountType ?? "").toLowerCase();
      if (t === "checking" || t === "savings") {
        liquidAssets += Math.max(0, stmt.netWorth ?? stmt.assets ?? 0);
      }
    }

    // ── Asset / debt sub-labels for dashboard KPI cards ─────────────────────
    const assetLabelSet = new Set<string>();
    const debtLabelSet  = new Set<string>();
    for (const stmt of currentStatements) {
      const t = (stmt.accountType ?? "").toLowerCase();
      if (t === "checking" || t === "savings") assetLabelSet.add("savings");
      if (t === "investment")                  assetLabelSet.add("investments");
      if (t === "mortgage") { assetLabelSet.add("property"); debtLabelSet.add("mortgage"); }
      if (t === "credit")   debtLabelSet.add("CC");
      if (t === "loan")     debtLabelSet.add("loan");
    }
    for (const asset of relevantManualAssets) {
      const t = (asset.category ?? "").toLowerCase();
      if (t.includes("real") || t.includes("property") || t.includes("home")) assetLabelSet.add("property");
      else if (t.includes("rrsp") || t.includes("tfsa")) assetLabelSet.add("RRSP");
      else if (t.includes("invest")) assetLabelSet.add("investments");
    }

    // ── Account count + last upload date ────────────────────────────────────
    const uniqueAccountIds = new Set(
      allCompleted.map((d) => (d.data() as FirebaseFirestore.DocumentData).accountId).filter(Boolean)
    );
    const sortedByCreated = allCompleted
      .filter((d) => (d.data() as FirebaseFirestore.DocumentData).createdAt)
      .sort((a, b) => {
        const aT = (a.data() as FirebaseFirestore.DocumentData).createdAt?.toDate?.()?.getTime() ?? 0;
        const bT = (b.data() as FirebaseFirestore.DocumentData).createdAt?.toDate?.()?.getTime() ?? 0;
        return bT - aT;
      });
    const lastUploadedAt: string | null = sortedByCreated[0]
      ? ((sortedByCreated[0].data() as FirebaseFirestore.DocumentData).createdAt?.toDate?.()?.toISOString() ?? null)
      : null;

    // Transaction-date-based income/expense for the requested month.
    // Use these instead of data.income?.total / data.expenses?.total in all pages.
    const txMonthlyExpenses = (enrichedConsolidated.expenses?.transactions ?? [])
      .filter((t) => (t.date ?? `${month}-15`).slice(0, 7) === month && !/transfer|payment/i.test(t.category ?? ""))
      .reduce((s, t) => s + t.amount, 0);
    // Income uses the statement-level total: no double-counting risk for deposits,
    // and the AI parser correctly attributes income to the statement period.
    const txMonthlyIncome = enrichedConsolidated.income?.total ?? 0;

    return NextResponse.json({
      data: enrichedConsolidated,
      /** Total payments made toward credit/loan/mortgage accounts this month.
       *  Shown separately alongside expenses — NOT netted from expenses. */
      paymentsMade: enrichedConsolidated.paymentsMade ?? 0,
      count: allCompleted.length,
      previousMonth,
      yearMonth: month,
      history,
      txMonthlyIncome,
      txMonthlyExpenses,
      manualAssets: relevantManualAssets,
      incompleteMonths,
      accountStatementHistory: Object.fromEntries(accountStatementHistory),
      incomeSourceHistory,
      recurringHistory,
      totalMonthsTracked: history.length,
      assetLabels: Array.from(assetLabelSet),
      debtLabels: Array.from(debtLabelSet),
      accountCount: uniqueAccountIds.size,
      lastUploadedAt,
      liquidAssets,
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
