import { NextRequest, NextResponse } from "next/server";
import { getFirebaseAdmin } from "@/lib/firebase-admin";
import { resolveAccess } from "@/lib/access/resolveAccess";
import { consolidateStatements } from "@/lib/consolidate";
import { applyRulesAndRecalculate, merchantSlug } from "@/lib/applyRules";
import { buildAccountSlug } from "@/lib/accountSlug";
import { docYearMonth, carryForwardStatements } from "@/lib/spendHistory";
import { getFinancialProfile } from "@/lib/financialProfile";
import { getNetWorth, getTypicalMonthlySpend, getTypicalMonthlyIncome, getTypicalMonthlyDebtPayments } from "@/lib/profileMetrics";
import type { ParsedStatementData, ManualAsset, AssetCategory } from "@/lib/types";
import type { BalanceSnapshot } from "@/app/api/user/balance-snapshots/route";
import type { AccountBackfillEntry } from "@/app/api/user/account-backfills/route";
import { buildSuggestions, resolveCanonical } from "@/lib/sourceMappings";
import type { SourceMapping } from "@/lib/sourceMappings";
import { occurrencesInMonth, datesInMonth } from "@/lib/cashIncome";
import type { CashIncomeEntry } from "@/lib/cashIncome";

/** Human-readable label for a statement's account, e.g. "TD ••••7780" */
function accountDisplayLabel(parsed: ParsedStatementData): string {
  if (parsed.accountName) return parsed.accountName;
  const slug = buildAccountSlug(parsed.bankName, parsed.accountId, parsed.accountName, parsed.accountType);
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
  const acctSlug = buildAccountSlug(stmt.bankName, stmt.accountId, stmt.accountName, stmt.accountType);

  const existingIncomeTxns = stmt.income?.transactions ?? [];
  const incomeTxns = existingIncomeTxns.length > 0
    ? existingIncomeTxns.map((txn) => ({ ...txn, accountLabel: label, accountSlug: acctSlug }))
    : (stmt.income?.sources ?? []).map((src) => ({
        source: src.description,
        amount: src.amount,
        category: "Other" as const,
        accountLabel: label,
        accountSlug: acctSlug,
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

function matchesAccount(d: Record<string, unknown>, parsed: ParsedStatementData, accountFilter: string | null): boolean {
  if (!accountFilter) return true;
  const storedSlug = d.accountSlug as string | undefined;
  return (storedSlug || buildAccountSlug(parsed.bankName, parsed.accountId, parsed.accountName, parsed.accountType)) === accountFilter;
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
    const { db } = getFirebaseAdmin();
    const access = await resolveAccess(request, db);
    if (!access) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const uid = access.targetUid;

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
      if (!matchesAccount(d, parsed, accountFilter)) return false;
      return true;
    });

    // All distinct yearMonths that actually have uploaded statements
    const yearMonths = new Set<string>();
    for (const doc of allCompleted) {
      const ym = docYearMonth(doc.data());
      if (ym) yearMonths.add(ym);
    }

    // ── Load category rules + financial profile before resolving month ─────────
    // Profile is needed here to use latestTxMonth as the authoritative "latest
    // month with actual transactions" — statement dates can be in the future
    // (e.g. a March statement with a statementDate of April 1) and should not
    // override the month that genuinely has the most recent transaction data.
    const [rulesSnap, profile, sourceMappingsSnap, cashIncomeSnap, incomeCatRulesSnap, cashCommitmentsSnap, txnOverridesSnap, incomeTxnCatSnap] = await Promise.all([
      db.collection(`users/${uid}/categoryRules`).get(),
      getFinancialProfile(uid, db),
      db.collection(`users/${uid}/sourceMappings`).get(),
      db.collection(`users/${uid}/cashIncome`).get(),
      db.collection(`users/${uid}/incomeCategoryRules`).get(),
      db.collection(`users/${uid}/cashCommitments`).get(),
      db.collection(`users/${uid}/txnCategoryOverrides`).get(),
      db.collection(`users/${uid}/incomeTxnCategories`).get(),
    ]);
    const txnOverridesMap = new Map<string, string>();
    for (const doc of txnOverridesSnap.docs) {
      const d = doc.data() as { category: string };
      if (d.category) txnOverridesMap.set(doc.id, d.category);
    }
    // Income per-transaction splits: key → splits array
    // Supports both old format { category } and new format { splits: [] }.
    const incomeTxnSplits: Record<string, { category: string; amount: number }[]> = {};
    for (const doc of incomeTxnCatSnap.docs) {
      const d = doc.data() as { splits?: { category: string; amount: number }[]; category?: string; amount?: number };
      if (Array.isArray(d.splits) && d.splits.length > 0) {
        incomeTxnSplits[doc.id] = d.splits;
      } else if (d.category && d.amount != null) {
        // Migrate old single-category format: treat as a split that covers the whole amount
        incomeTxnSplits[doc.id] = [{ category: d.category, amount: d.amount }];
      }
    }
    const categoryRulesMap = new Map<string, string>();
    for (const ruleDoc of rulesSnap.docs) {
      const r = ruleDoc.data();
      if (r.merchant && r.category) {
        categoryRulesMap.set(merchantSlug(r.merchant as string), r.category as string);
      }
    }
    const existingMappings: SourceMapping[] = sourceMappingsSnap.docs.map((d) => ({
      id: d.id,
      ...(d.data() as Omit<SourceMapping, "id">),
    }));
    // Confirmed income mappings — applied when building incomeSourceHistory so
    // merged aliases are folded into the canonical name before suggestions run.
    const confirmedIncomeMappings = existingMappings.filter(
      (m) => m.type === "income" && m.status === "confirmed"
    );

    // Cash income entries and income category rules — passed to the income page
    const cashIncomeItems = cashIncomeSnap.docs.map((d) => d.data());
    // Cash commitment entries (manual recurring expenses) — passed to spending pages
    const cashCommitmentItems = cashCommitmentsSnap.docs.map((d) => d.data());
    const incomeCategoryRules = Object.fromEntries(
      incomeCatRulesSnap.docs
        .filter((d) => d.data().category)
        .map((d) => [d.data().slug as string, d.data().category as string])
    );
    const incomeFrequencyOverrides = Object.fromEntries(
      incomeCatRulesSnap.docs
        .filter((d) => d.data().frequencyOverride)
        .map((d) => [d.data().slug as string, d.data().frequencyOverride as string])
    );

    // Prefer the latest month that has real transaction data over the latest
    // statement date. This prevents landing on an empty "current" month when the
    // most recently uploaded statement's date has ticked into the next month.
    const latestStatementYM = yearMonths.size > 0
      ? Array.from(yearMonths).sort().reverse()[0]!
      : null;
    const latestTxYM = profile.latestTxMonth ?? null;
    const month = useCurrent
      ? (latestTxYM ?? latestStatementYM ?? null)
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

    // profile already loaded above — expose expenseTxns for use below
    const { expenseTxns } = profile;

    // ── Current month: carry-forward balances for all accounts ──────────────
    const currentStatements = carryForwardStatements(allCompleted, month);
    const consolidated = consolidateStatements(currentStatements.map((s) => tagTransactions(s)), month);

    // Apply category rules + per-transaction overrides
    const consolidatedWithRules = (categoryRulesMap.size > 0 || txnOverridesMap.size > 0)
      ? applyRulesAndRecalculate(consolidated, categoryRulesMap, txnOverridesMap)
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
        // Always carry the currency override through — even CAD, so a user who
        // changed from USD back to CAD sees the correct symbol immediately.
        ...(snapCurrency ? { currency: snapCurrency } : {}),
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
            // Apply confirmed income mappings: fold alias names into their canonical
            const canonicalName = resolveCanonical(src.description, confirmedIncomeMappings);
            if (!incomeSourceHistory[canonicalName]) incomeSourceHistory[canonicalName] = [];
            const srcTxns = (c.income?.transactions ?? [])
              .filter((t) => t.source === src.description)
              .map((t) => ({ date: t.date, amount: t.amount, accountSlug: t.accountSlug }));
            // Aggregate into existing month entry if canonical already has one (two aliases in same month)
            const existing = incomeSourceHistory[canonicalName].find((h) => h.yearMonth === ym);
            if (existing) {
              existing.amount += src.amount;
              existing.transactions.push(...srcTxns);
            } else {
              incomeSourceHistory[canonicalName].push({ yearMonth: ym, amount: src.amount, transactions: srcTxns });
            }
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

    // Pre-build a translation map so the history loop always uses the stored
    // d.accountSlug — carryForwardStatements returns ParsedStatementData which
    // doesn't carry the doc's accountSlug field.
    const parsedSlugToStored = new Map<string, string>();
    for (const doc of allCompleted) {
      const d  = doc.data();
      const pd = d.parsedData as ParsedStatementData | undefined;
      const stored = d.accountSlug as string | undefined;
      if (pd && stored) {
        const pSlug = buildAccountSlug(pd.bankName, pd.accountId, pd.accountName, pd.accountType);
        if (!parsedSlugToStored.has(pSlug)) parsedSlugToStored.set(pSlug, stored);
      }
    }

    for (const ym of Array.from(yearMonths).sort()) {
      const carried = carryForwardStatements(allCompleted, ym);
      for (const parsed of carried) {
        const pSlug = buildAccountSlug(parsed.bankName, parsed.accountId, parsed.accountName, parsed.accountType);
        // Use the stored accountSlug when available — it may differ from pSlug
        // when the user confirmed a custom nickname or merged accounts.
        const slug = parsedSlugToStored.get(pSlug) ?? pSlug;
        const realForThisMonth = allCompleted.some((doc) => {
          const d = doc.data();
          return docYearMonth(d) === ym &&
            ((d.accountSlug as string | undefined) || buildAccountSlug((d.parsedData as ParsedStatementData).bankName, (d.parsedData as ParsedStatementData).accountId, (d.parsedData as ParsedStatementData).accountName, (d.parsedData as ParsedStatementData).accountType)) === slug;
        });
        const sourceDoc = allCompleted
          .filter((doc) => {
            const d = doc.data();
            return docYearMonth(d) === ym &&
              ((d.accountSlug as string | undefined) || buildAccountSlug((d.parsedData as ParsedStatementData).bankName, (d.parsedData as ParsedStatementData).accountId, (d.parsedData as ParsedStatementData).accountName, (d.parsedData as ParsedStatementData).accountType)) === slug;
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
    // One Firestore doc per synthetic month (users/{uid}/accountBackfills/{slug_YYYY-MM}).
    // Skip when a real statement already exists for that account + month.
    if (!accountFilter) {
      const backfillsSnap = await db
        .collection("users").doc(uid)
        .collection("accountBackfills")
        .get();
      const backfills = backfillsSnap.docs.map((d) => d.data() as AccountBackfillEntry);

      if (backfills.length > 0) {
        const historyIndex = new Map(history.map((h, i) => [h.yearMonth, i]));

        // Build the set of account slugs that still have at least one real completed
        // statement. Backfill records for slugs outside this set are orphaned (their
        // statements were deleted) and must not be injected into history.
        const activeSlugs = new Set(
          allCompleted.map((doc) => doc.data().accountSlug as string | undefined).filter(Boolean)
        );

        for (const bf of backfills) {
          const ym = bf.yearMonth;
          if (!ym || !bf.accountSlug || bf.balance == null || !Number.isFinite(bf.balance)) continue;

          // Skip entirely if the account no longer has any real statements
          if (!activeSlugs.has(bf.accountSlug)) continue;

          const hasRealStatement = allCompleted.some((doc) => {
            const d = doc.data() as FirebaseFirestore.DocumentData;
            if (docYearMonth(d) !== ym) return false;
            const parsed = d.parsedData as ParsedStatementData | undefined;
            if (!parsed) return false;
            return buildAccountSlug(parsed.bankName, parsed.accountId, parsed.accountName, parsed.accountType) === bf.accountSlug;
          });
          if (hasRealStatement) continue;

          const debtDelta = bf.balance < 0 ? Math.abs(bf.balance) : 0;

          // Read cash income from the profile cache (already computed there)
          const cachedForYm = profile.monthlyHistory.find((h) => h.yearMonth === ym);

          const idx = historyIndex.get(ym);
          if (idx !== undefined) {
            history[idx].netWorth += bf.balance;
            if (debtDelta > 0) history[idx].debtTotal += debtDelta;
            history[idx].isEstimate = true;
            if (history[idx].incomeTotal === 0 && (cachedForYm?.incomeTotal ?? 0) > 0) {
              history[idx].incomeTotal = cachedForYm!.incomeTotal;
            }
          } else {
            const newIdx = history.length;
            history.push({
              yearMonth: ym,
              netWorth: bf.balance,
              expensesTotal: 0,
              coreExpensesTotal: 0,
              incomeTotal: cachedForYm?.incomeTotal ?? 0,
              debtTotal: debtDelta,
              isEstimate: true,
            });
            historyIndex.set(ym, newIdx);
          }

          if (!accountStatementHistory.has(bf.accountSlug)) {
            accountStatementHistory.set(bf.accountSlug, []);
          }
          const acctHist = accountStatementHistory.get(bf.accountSlug)!;
          const already = acctHist.some((e) => e.yearMonth === ym);
          if (!already) {
            acctHist.push({
              yearMonth: ym,
              netWorth: bf.balance,
              uploadedAt: bf.createdAt,
              statementId: "",
              isCarryForward: false,
              interestRate: null,
              isManualSnapshot: false,
              note: "Estimated (backfilled)",
            });
            acctHist.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
          }
        }

        history.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
      }
    }

    // ── Cash-income-only months (from profile cache) ────────────────────────
    // The profile cache already computed incomeTotal for every month that has
    // cash income (even months with no statement). Inject any such month that
    // is not yet in the history array.
    {
      const historyYMs = new Set(history.map((h) => h.yearMonth));
      for (const cached of profile.monthlyHistory) {
        if (!historyYMs.has(cached.yearMonth) && cached.incomeTotal > 0) {
          history.push({
            yearMonth: cached.yearMonth,
            netWorth: 0,
            expensesTotal: 0,
            coreExpensesTotal: 0,
            incomeTotal: cached.incomeTotal,
            debtTotal: 0,
            isEstimate: true,
          });
          historyYMs.add(cached.yearMonth);
        }
      }
      history.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    }

    // ── Inject cash income entries into incomeSourceHistory ──────────────────
    // Cash income is already folded into history[].incomeTotal via the profile
    // cache, but it was never represented as named sources. Adding it here means
    // the By Source tab (and any insight logic that reads incomeSourceHistory)
    // sees cash income alongside statement-detected sources.
    {
      const cashEntries = (cashIncomeItems as CashIncomeEntry[]).filter((e) => e.frequency !== "once");
      for (const entry of cashEntries) {
        for (const { yearMonth: ym } of history) {
          const occ = occurrencesInMonth(entry, ym);
          if (occ <= 0) continue;
          const amount = entry.amount * occ;
          if (!incomeSourceHistory[entry.name]) incomeSourceHistory[entry.name] = [];
          // Avoid duplicating if already present (e.g. from a statement with same description)
          if (!incomeSourceHistory[entry.name].some((h) => h.yearMonth === ym)) {
            const txDates = datesInMonth(entry, ym);
            incomeSourceHistory[entry.name].push({
              yearMonth: ym,
              amount,
              transactions: txDates.map((date) => ({ date, amount: entry.amount })),
            });
          }
        }
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
    // Convert each transaction to home currency before summing
    function txToHome(amount: number, currency?: string | null): number {
      if (!currency || currency.toUpperCase() === (profile.homeCurrency ?? "USD").toUpperCase()) return amount;
      const rate = (profile.fxRates ?? {})[currency.toUpperCase()];
      return rate != null ? amount * rate : amount;
    }
    const txMonthlyExpenses = monthExpTxns.reduce((s, t) => s + txToHome(t.amount, t.currency), 0);
    // Use cache's incomeTotal for the selected month — it excludes inter-account
    // transfers and user-marked transfer sources (same filter as the history chart).
    const cachedMonthHistory = profile.monthlyHistory.find((h) => h.yearMonth === month);
    const txMonthlyIncome = cachedMonthHistory?.incomeTotal ?? enrichedConsolidated.income?.total ?? 0;

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
          currency: t.currency,
          recurring: t.recurring,
          ...(t.debtType ? { debtType: t.debtType as import("@/lib/types").DebtType } : {}),
        })),
      },
    };

    // ── Income source suggestions (prefix-match dedup hints) ─────────────────
    // Only computed on the all-accounts view (not per-account detail pages) to
    // avoid partial data confusing the comparison.
    // Pass only income-typed mappings so expense mappings don't block income suggestions.
    const incomeSourceKeys = Object.keys(incomeSourceHistory);
    const incomeSuggestions = !accountFilter
      ? buildSuggestions(
          incomeSourceKeys,
          existingMappings.filter((m) => m.type === "income"),
          "income"
        )
      : [];

    // ── Expense merchant suggestions (prefix-match dedup hints) ───────────────
    // Compare merchant names across all expense transactions — catches AI naming
    // inconsistencies like "AMZN MKTP CA" vs "AMAZON.CA".
    // affectsCache is set to true when the two merchants have different categories
    // (a merge would change coreExpensesTotal for one of them).
    const expenseSuggestions = !accountFilter
      ? (() => {
          const merchantCategories = new Map<string, string>();
          for (const t of profile.expenseTxns) {
            if (t.merchant) merchantCategories.set(t.merchant, t.category ?? "Other");
          }
          const raw = buildSuggestions(
            Array.from(merchantCategories.keys()),
            existingMappings.filter((m) => m.type === "expense"),
            "expense"
          );
          // Flag pairs where categories differ — merging would affect spending totals
          return raw.map((s) => ({
            ...s,
            affectsCache:
              (merchantCategories.get(s.canonical) ?? "") !==
              (merchantCategories.get(s.alias)     ?? ""),
          }));
        })()
      : [];

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
      /**
       * Median core monthly expenses across all historical months — excludes
       * transfers, debt payments, and investments. Use this for FI/goals
       * projections instead of txMonthlyExpenses (which is a single month total
       * and includes all categories).
       */
      typicalMonthlyExpenses: getTypicalMonthlySpend(profile),
      /**
       * Median monthly income across historical months — more stable basis for
       * goals/FI projections than a single month's income figure.
       */
      typicalMonthlyIncome: getTypicalMonthlyIncome(profile),
      /**
       * Median monthly minimum debt payments — lets Goals page offer a
       * "include debt payments" toggle for a more conservative FI target.
       */
      typicalMonthlyDebtPayments: getTypicalMonthlyDebtPayments(profile),
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
      incomeSuggestions,
      expenseSuggestions,
      cashIncomeItems,
      cashCommitmentItems,
      incomeCategoryRules,
      incomeFrequencyOverrides,
      incomeTxnSplits,
      /** FX rates used for net worth: currency → home-currency rate (e.g. { "CAD": 0.72 } for a USD user) */
      fxRates: profile.fxRates ?? {},
      /** ISO-4217 home currency code for this user (e.g. "USD" or "CAD") */
      homeCurrency: profile.homeCurrency ?? "USD",
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

