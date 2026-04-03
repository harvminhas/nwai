import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { consolidateStatements } from "@/lib/consolidate";
import { applyRulesAndRecalculate, merchantSlug } from "@/lib/applyRules";
import { buildAccountSlug } from "@/lib/accountSlug";
import { docYearMonth, carryForwardStatements } from "@/lib/spendHistory";
import { getFinancialProfile } from "@/lib/financialProfile";
import { getNetWorth } from "@/lib/profileMetrics";
import type { ParsedStatementData, ManualAsset, AssetCategory } from "@/lib/types";
import type { BalanceSnapshot } from "@/app/api/user/balance-snapshots/route";
import type { AccountBackfill } from "@/app/api/user/account-backfills/route";

/** Subtract n months from a YYYY-MM string */
function subtractMonths(ym: string, n: number): string {
  const [y, m] = ym.split("-").map(Number);
  const date = new Date(y, m - 1 - n, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/** Human-readable label for a statement's account, e.g. "TD ••••7780" */
function accountDisplayLabel(parsed: ParsedStatementData): string {
  if (parsed.accountName) return parsed.accountName;
  const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
  const bank = (parsed.bankName ?? "").trim();
  if (slug === "unknown") return bank || "Unknown Account";
  const parts = [bank, `••••${slug}`].filter(Boolean);
  return parts.join(" ");
}

/** Tag every expense and income transaction in a statement with its account label.
 *  When the AI only populated income.sources (no individual transactions), synthesize
 *  one transaction per source so the account label is preserved through consolidation.
 */
function tagTransactions(stmt: ParsedStatementData): ParsedStatementData {
  const label = accountDisplayLabel(stmt);

  const existingIncomeTxns = stmt.income?.transactions ?? [];
  const incomeTxns = existingIncomeTxns.length > 0
    ? existingIncomeTxns.map((txn) => ({ ...txn, accountLabel: label }))
    : (stmt.income?.sources ?? []).map((src) => ({
        source: src.description,
        amount: src.amount,
        category: "Other" as const,
        accountLabel: label,
      }));

  return {
    ...stmt,
    expenses: {
      ...stmt.expenses,
      total: stmt.expenses?.total ?? 0,
      categories: stmt.expenses?.categories ?? [],
      transactions: (stmt.expenses?.transactions ?? []).map((txn) => ({ ...txn, accountLabel: label })),
    },
    income: {
      ...stmt.income,
      total: stmt.income?.total ?? 0,
      sources: stmt.income?.sources ?? [],
      transactions: incomeTxns,
    },
  };
}

function matchesBank(parsed: ParsedStatementData, bankFilter: string | null): boolean {
  if (!bankFilter) return true;
  return (parsed.bankName ?? "").toLowerCase().replace(/\s+/g, "-") === bankFilter;
}

function matchesAccount(parsed: ParsedStatementData, accountFilter: string | null): boolean {
  if (!accountFilter) return true;
  return buildAccountSlug(parsed.bankName, parsed.accountId) === accountFilter;
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
    // Still needed for applyRulesAndRecalculate on the consolidated statement view.
    const rulesSnap = await db.collection(`users/${uid}/categoryRules`).get();
    const categoryRulesMap = new Map<string, string>();
    for (const ruleDoc of rulesSnap.docs) {
      const r = ruleDoc.data();
      if (r.merchant && r.category) {
        categoryRulesMap.set(merchantSlug(r.merchant as string), r.category as string);
      }
    }

    // ── Financial profile cache — single source of truth for all spending data ─
    // Category rules are pre-applied. Numbers guaranteed to match insights route.
    const profile = await getFinancialProfile(uid, db);
    const { expenseTxns } = profile;

    // ── Current month: carry-forward balances for all accounts ──────────────
    const currentStatements = carryForwardStatements(allCompleted, month);
    const consolidated = consolidateStatements(currentStatements.map(tagTransactions), month);

    // Apply user category rules to transactions and recalculate aggregates
    const consolidatedWithRules = categoryRulesMap.size > 0
      ? applyRulesAndRecalculate(consolidated, categoryRulesMap)
      : consolidated;

    // Net worth:
    // - All-accounts view (no filter): use getNetWorth(profile) so the number
    //   matches exactly what the Today page shows (single source of truth).
    // - Per-account view (accountFilter set): use the statement-derived values
    //   directly — getNetWorth(profile) sums ALL accounts, which would produce
    //   the wrong total for a single-account detail page.
    let enrichedConsolidated: ParsedStatementData;
    if (accountFilter) {
      // Also carry through currency from the account's snapshot in the profile
      // (so the detail page can show it even if consolidateStatements dropped it)
      const snapCurrency = profile.accountSnapshots.find(
        (s) => s.slug === accountFilter
      )?.currency;
      enrichedConsolidated = {
        ...consolidatedWithRules,
        ...(snapCurrency && snapCurrency !== "CAD" ? { currency: snapCurrency } : {}),
      };
    } else {
      const nw = getNetWorth(profile);
      enrichedConsolidated = {
        ...consolidatedWithRules,
        assets:   nw.totalAssets,
        debts:    nw.totalDebts,
        netWorth: nw.total,
      };
    }

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
        const prevAssets = (prev.assets ?? Math.max(0, prev.netWorth ?? 0)) + prevManualTotal;
        const prevDebts = prev.debts ?? Math.max(0, -(prev.netWorth ?? 0));
        previousMonth = {
          netWorth: prevAssets - prevDebts,
          assets: prevAssets,
          debts: prevDebts,
          expenses: prev.expenses?.total ?? 0,
        };
      }
    }

    // ── History + income source history + recurring expense history ──────────
    const history: { yearMonth: string; netWorth: number; expensesTotal: number; coreExpensesTotal: number; incomeTotal: number; debtTotal: number; isEstimate?: boolean }[] = [];

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
        const hAssets = (c.assets ?? Math.max(0, c.netWorth ?? 0)) + manualAssetsTotal;
        const hNetWorth = hAssets - (c.debts ?? Math.max(0, -(c.netWorth ?? 0)));
        const hDebts = c.debts ?? Math.max(0, -(c.netWorth ?? 0));
        // Expenses: read from profile cache (transaction-date-based, category rules applied)
        // so the chart numbers are identical to what the insights route and Spending page show.
        const cached = profile.monthlyHistory.find((h) => h.yearMonth === ym);
        const txDateExpenses     = cached?.expensesTotal     ?? 0;
        const txDateCoreExpenses = cached?.coreExpensesTotal ?? 0;
        const txDateIncome       = cached?.incomeTotal       ?? c.income?.total ?? 0;
        history.push({ yearMonth: ym, netWorth: hNetWorth, expensesTotal: txDateExpenses, coreExpensesTotal: txDateCoreExpenses, incomeTotal: txDateIncome, debtTotal: hDebts });

        // Build per-source income history — only for months that had real statements
        const hasRealIncome = allCompleted.some((doc) => {
          const d = doc.data() as FirebaseFirestore.DocumentData;
          return docYearMonth(d) === ym && (d.parsedData as ParsedStatementData)?.income?.total > 0;
        });
        if (hasRealIncome) {
          for (const src of c.income?.sources ?? []) {
            if (!incomeSourceHistory[src.description]) incomeSourceHistory[src.description] = [];
            const srcTxns = (c.income?.transactions ?? [])
              .filter((t) => t.source === src.description)
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
      source?: "pdf" | "csv";
      isManualSnapshot?: boolean; snapshotId?: string; note?: string;
    }[]>();

    for (const ym of Array.from(yearMonths).sort()) {
      const carried = carryForwardStatements(allCompleted, ym);
      for (const parsed of carried) {
        const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
        const realForThisMonth = allCompleted.some((doc) => {
          const d = doc.data();
          return docYearMonth(d) === ym &&
            buildAccountSlug((d.parsedData as ParsedStatementData).bankName, (d.parsedData as ParsedStatementData).accountId) === slug;
        });
        const sourceDoc = allCompleted
          .filter((doc) => {
            const d = doc.data();
            return docYearMonth(d) === ym &&
              buildAccountSlug((d.parsedData as ParsedStatementData).bankName, (d.parsedData as ParsedStatementData).accountId) === slug;
          })
          .sort((a, b) => {
            const aIsCSV = (a.data().source as string | undefined) === "csv";
            const bIsCSV = (b.data().source as string | undefined) === "csv";
            if (!aIsCSV && bIsCSV) return -1; // PDF first
            if (aIsCSV && !bIsCSV) return 1;
            const aTime = a.data().uploadedAt?.toDate?.()?.getTime() ?? 0;
            const bTime = b.data().uploadedAt?.toDate?.()?.getTime() ?? 0;
            return bTime - aTime; // most recently uploaded first within same type
          })[0] ?? null;
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
          source: (sourceDoc?.data().source as "pdf" | "csv" | undefined) ?? "pdf",
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

    // ── Backfill injection ───────────────────────────────────────────────────
    // For accounts where the user told us they'd had the account longer than
    // the first uploaded statement, inject flat estimated balance entries into
    // history going back backfillMonths months. Shown as a dashed line on the chart.
    if (!accountFilter) {
      const backfillsSnap = await db
        .collection("users").doc(uid)
        .collection("accountBackfills")
        .get();
      const backfills: AccountBackfill[] = backfillsSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Omit<AccountBackfill, "id">),
      }));

      if (backfills.length > 0) {
        const historyIndex = new Map(history.map((h, i) => [h.yearMonth, i]));

        for (const bf of backfills) {
          if (bf.backfillMonths <= 0) continue;
          for (let mo = 1; mo <= bf.backfillMonths; mo++) {
            const ym  = subtractMonths(bf.firstStatementYearMonth, mo);
            const idx = historyIndex.get(ym);
            if (idx !== undefined) {
              history[idx].netWorth  += bf.firstBalance;
              history[idx].isEstimate = true;
            } else {
              const newIdx = history.length;
              history.push({
                yearMonth: ym, netWorth: bf.firstBalance,
                expensesTotal: 0, coreExpensesTotal: 0,
                incomeTotal: 0, debtTotal: 0, isEstimate: true,
              });
              historyIndex.set(ym, newIdx);
            }
          }

          // Inject into accountStatementHistory for the account detail page
          if (!accountStatementHistory.has(bf.accountSlug)) {
            accountStatementHistory.set(bf.accountSlug, []);
          }
          for (let mo = 1; mo <= bf.backfillMonths; mo++) {
            const ym = subtractMonths(bf.firstStatementYearMonth, mo);
            const already = accountStatementHistory.get(bf.accountSlug)!.some((e) => e.yearMonth === ym);
            if (!already) {
              accountStatementHistory.get(bf.accountSlug)!.push({
                yearMonth: ym, netWorth: bf.firstBalance,
                uploadedAt: bf.createdAt, statementId: "",
                isCarryForward: false, interestRate: null,
                isManualSnapshot: false,
                note: "Estimated (backfilled)",
              });
            }
          }

          // Re-sort the account's history after injection
          accountStatementHistory.get(bf.accountSlug)!
            .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
        }

        // Re-sort the global history after injecting backfill months
        history.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
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

    // Transaction-date-based expenses for the requested month — from extracted data.
    // When accountFilter is set (account detail page), also filter to that account's
    // slug so transactions from other accounts don't leak into this view.
    const monthExpTxns = expenseTxns.filter((t) =>
      t.txMonth === month && (!accountFilter || t.accountSlug === accountFilter)
    );
    const txMonthlyExpenses = monthExpTxns.reduce((s, t) => s + t.amount, 0);
    // Income uses the statement-level total: no double-counting risk for deposits,
    // and the AI parser correctly attributes income to the statement period.
    const txMonthlyIncome = enrichedConsolidated.income?.total ?? 0;

    // Override enrichedConsolidated.expenses.transactions with extracted data so the
    // spending page transaction list matches the insights route's transaction set.
    enrichedConsolidated = {
      ...enrichedConsolidated,
      expenses: {
        ...enrichedConsolidated.expenses,
        total: txMonthlyExpenses,
        transactions: monthExpTxns.map((t) => ({
          date: t.date,
          merchant: t.merchant,
          amount: t.amount,
          category: t.category,
          accountLabel: t.accountLabel,
          recurring: t.recurring,
        })),
      },
    };

    return NextResponse.json({
      data: enrichedConsolidated,
      /** Total payments made toward credit/loan/mortgage accounts this month.
       *  Shown separately alongside expenses — NOT netted from expenses. */
      paymentsMade: enrichedConsolidated.paymentsMade ?? 0,
      count: allCompleted.length,
      previousMonth,
      yearMonth: month,
      history,
      needsRefresh: profile.cacheStale ?? false,
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
      /** FX rates used for net worth: currency → CAD rate (e.g. { "USD": 1.42 }) */
      fxRates: profile.fxRates ?? {},
      /**
       * Latest balance snapshot per account — pre-processed with currency overrides,
       * balance-snapshot overrides, and FX metadata. Use instead of /api/user/statements.
       */
      accountSnapshots: profile.accountSnapshots ?? [],
      /**
       * Full per-account balance history across all statement months — native currency.
       * Use instead of /api/user/statements for sparklines / monthly series.
       */
      accountBalanceHistory: profile.accountBalanceHistory ?? [],
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
