/**
 * Financial Profile Cache — single source of truth for all spending data.
 *
 * Problem solved: multiple API routes (consolidated, insights, chat) were each
 * computing the same numbers from the same Firestore data via different code paths,
 * producing inconsistent results. This module provides ONE computation path that
 * every route calls. Consistency is guaranteed by construction.
 *
 * Cache document: users/{uid}/financialProfile
 *
 * Freshness strategy: Time + Version
 *   ≤ 5 min old   → return immediately (hot path — skip version check)
 *   5 min – 24 h  → fetch statement doc IDs, check version hash; rebuild only if changed
 *   > 24 h old    → always rebuild
 *
 * Rebuild triggers (in addition to the staleness check above):
 *   • statement.parsed event  → pipeline.ts calls buildAndCacheFinancialProfile
 *   • category rule saved     → category-rules/route.ts invalidates cache
 *   • manual "refresh"        → any caller can call buildAndCacheFinancialProfile
 */

import type * as Firestore from "firebase-admin/firestore";
import { extractAllTransactions } from "./extractTransactions";
import { computeTypicalSpend, CORE_EXCLUDE_RE, INCOME_TRANSFER_RE } from "./spendingMetrics";
import type { CashIncomeEntry } from "./cashIncome";
import { occurrencesInMonth } from "./cashIncome";
import type { CashCommitment } from "@/app/api/user/cash-commitments/route";
import { commitmentOccurrencesInMonth } from "@/app/api/user/cash-commitments/route";
import { merchantSlug } from "./applyRules";
import type { ExpenseTxnRecord, IncomeTxnRecord, AccountSnapshot } from "./extractTransactions";
import type { TypicalSpend } from "./spendingMetrics";
import type { ManualAsset, ManualLiability, InvestmentHolding, ParsedStatementData } from "./types";
import { buildAccountSlug } from "./accountSlug";
import { getFxRatesForCurrencies } from "./fxRates";
import { splitDebtPayments } from "./debtUtils";
import type { SubscriptionRecord } from "./insights/types";

// ── Balance snapshot shape (mirrors /api/user/balance-snapshots) ──────────────
export interface BalanceSnapshot {
  id: string;
  accountSlug: string;
  accountName: string;
  accountType: string;
  /** Positive for assets, negative for debts */
  balance: number;
  /** YYYY-MM */
  yearMonth: string;
  note?: string;
}

// ── constants ──────────────────────────────────────────────────────────────────
const HOT_WINDOW_MS  =  5 * 60 * 1000;   // 5 min — never re-check version this often
const MAX_CACHE_MS   = 24 * 60 * 60 * 1000; // 24 h — force full rebuild

/**
 * Bump this whenever filtering / computation logic changes so that all cached
 * profiles are rebuilt on the next request regardless of data version.
 */
const SCHEMA_VERSION = "24"; // manualLiabilities, accountRates, goals, confirmedSubscriptions, cashCommitmentEntries added to cache

// ── Per-account monthly balance history ───────────────────────────────────────
/**
 * Full balance history for a single account across all available statement months.
 * Balances are in the account's native currency (see `currency` field).
 * Use fxRates from the profile to convert to home currency for aggregates.
 */
export interface AccountBalanceHistory {
  slug:        string;
  label:       string;
  accountType: string;
  /** ISO 4217 currency code — native to this account (after user override applied) */
  currency:    string;
  /** One entry per uploaded statement month, sorted ascending */
  entries:     { yearMonth: string; balance: number }[];
}

// ── types ──────────────────────────────────────────────────────────────────────

export interface MonthlyHistoryEntry {
  yearMonth: string;
  /** Raw total of all expense transactions (no transfers filter) */
  expensesTotal: number;
  /** Core expenses = expensesTotal minus categories matching CORE_EXCLUDE_RE */
  coreExpensesTotal: number;
  /** Total income for this month */
  incomeTotal: number;
  /** Sum of all "Debt Payments" category transactions (min + extra) */
  debtPaymentsTotal: number;
  /** Minimum / scheduled debt payments only (excl. extra payments) */
  minDebtPaymentsTotal: number;
}

export interface FinancialProfileCache {
  /** ISO-8601 when this cache was last built */
  updatedAt: string;
  /** Deterministic hash of all completed statement IDs + upload timestamps */
  sourceVersion: string;
  /** Bumped in code when computation logic changes — triggers user-visible refresh prompt */
  schemaVersion?: string;
  /**
   * True when the cached data was built with an older schemaVersion.
   * API routes pass this to the frontend so it can show a "Refresh" toast.
   * The rebuild only happens when the user explicitly triggers a refresh.
   */
  cacheStale?: boolean;
  /** Per-month aggregated totals — ALL historical months */
  monthlyHistory: MonthlyHistoryEntry[];
  /** Pre-computed typical monthly spend (median + avg) */
  typicalMonthly: TypicalSpend;
  /**
   * Manually added assets (house, car, business, etc.) from users/{uid}/manualAssets.
   * Same data as /api/user/assets — included here so net worth is computed once.
   */
  manualAssets: ManualAsset[];
  /**
   * Manual balance snapshots (overrides for statement-derived balances).
   * Latest snapshot per account wins over the statement balance.
   * Same data as /api/user/balance-snapshots.
   */
  balanceSnapshots: BalanceSnapshot[];
  /**
   * Raw expense transactions — last 12 months, with user category rules applied.
   * Used for transaction-list queries (spending page) and current-month calculations.
   * For all-time typical spend use typicalMonthly (pre-computed from all months).
   *
   * Note: Firestore documents have a 1 MB limit. At ~150 bytes/txn this supports
   * ~6,000 transactions in 12 months. For power users with denser history a future
   * optimisation would move this to a subcollection.
   */
  expenseTxns: ExpenseTxnRecord[];
  /** Raw income transactions — last 6 months */
  incomeTxns: IncomeTxnRecord[];
  /** Latest balance snapshot per account */
  accountSnapshots: AccountSnapshot[];
  /** All distinct transaction months, sorted ascending (derived from monthlyHistory) */
  allTxMonths: string[];
  /** Latest month that has at least one transaction */
  latestTxMonth: string | null;
  /**
   * Investment holdings per account, from the most recent uploaded statement.
   * Only populated for investment-type accounts that have a holdings table.
   */
  portfolioHoldings: PortfolioAccountHoldings[];
  /**
   * FX rates used for net worth calculation.
   * Maps ISO 4217 currency code → rate to convert to CAD (e.g. { "USD": 1.42 }).
   * CAD is always 1.0 and is not stored here (it's implicit).
   * Refreshed at most once per 24 h via api.frankfurter.app.
   */
  fxRates: Record<string, number>;
  /**
   * Per-account balance history across all uploaded statement months.
   * Balances are in the account's native currency.
   * Use this instead of fetching /api/user/statements — single pipeline.
   */
  accountBalanceHistory: AccountBalanceHistory[];
  /**
   * Manual liabilities (mortgage, car loan, etc.) from users/{uid}/manualLiabilities.
   * Included so AI chat and brief builders need zero extra Firestore reads.
   */
  manualLiabilities: ManualLiability[];
  /**
   * User-stored APR and payment-frequency overrides, keyed by accountKey.
   */
  accountRates: CachedAccountRate[];
  /**
   * User goals from users/{uid}/goals.
   */
  goals: CachedGoal[];
  /**
   * Confirmed and user-confirmed subscription records from users/{uid}/subscriptions.
   */
  confirmedSubscriptions: SubscriptionRecord[];
  /**
   * Manual cash commitment entries already loaded during build — exposed here so
   * consumers (AI brief, etc.) don't need a separate Firestore read.
   */
  cashCommitmentEntries: CashCommitment[];
}

/** Stored APR / payment-frequency override for a single account. */
export interface CachedAccountRate {
  accountKey: string;
  rate?: number | null;
  paymentFrequency?: string | null;
}

/** Minimal goal shape stored in the profile cache. */
export interface CachedGoal {
  id: string;
  title: string;
  emoji: string;
  description?: string;
  targetAmount: number | null;
  currentAmount?: number;
  targetDate?: string | null;
}

export interface PortfolioAccountHoldings {
  accountSlug: string;
  accountName: string;
  statementMonth: string;
  holdings: InvestmentHolding[];
}

// ── version hash ──────────────────────────────────────────────────────────────

/**
 * Deterministic hash of completed statement doc IDs + upload timestamps.
 * Changes whenever any statement is added, re-parsed, or updated.
 */
export function computeSourceVersion(docs: Firestore.QueryDocumentSnapshot[]): string {
  const repr = docs
    .map((d) => {
      const data = d.data();
      // Include uploadedAt AND a re-parse signal so that re-parsing an existing
      // statement (same uploadedAt, new parsedData) invalidates the version hash.
      // We use the yearMonth + accountSlug from parsedData as a cheap proxy.
      const pd = data.parsedData as { statementDate?: string; bankName?: string; accountId?: string; currency?: string } | undefined;
      const reparse = [pd?.statementDate, pd?.bankName, pd?.accountId, pd?.currency ?? ""].join("~");
      return `${d.id}:${data.uploadedAt?.toMillis?.() ?? 0}:${reparse}`;
    })
    .sort()
    .join("|");
  let h = 0;
  for (let i = 0; i < repr.length; i++) {
    h = (Math.imul(31, h) + repr.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

// ── build ──────────────────────────────────────────────────────────────────────

/**
 * Compute the full financial profile from scratch and persist it to Firestore.
 * Call this when you know data has changed (new statement parsed, rules updated).
 */
export async function buildAndCacheFinancialProfile(
  uid: string,
  db: Firestore.Firestore,
): Promise<FinancialProfileCache> {
  // Fetch all data sources in parallel — same collections the assets page uses.
  const [txData, rulesSnap, completedSnap, manualAssetsSnap, balanceSnapshotsSnap, currencyOverridesSnap, transferPrefsSnap, cashIncomeSnap, incomeCatRulesSnap, debtTagsSnap, backfillsSnap, cashCommitmentsSnap, manualLiabSnap, accountRatesSnap, goalsSnap, confirmedSubsSnap] =
    await Promise.all([
      extractAllTransactions(uid, db),
      db.collection(`users/${uid}/categoryRules`).get(),
      db.collection("statements").where("userId", "==", uid).where("status", "==", "completed").get(),
      db.collection(`users/${uid}/manualAssets`).orderBy("updatedAt", "desc").get(),
      db.collection(`users/${uid}/balanceSnapshots`).orderBy("yearMonth", "desc").get(),
      db.collection(`users/${uid}/accountCurrencies`).get(),
      db.doc(`users/${uid}/prefs/transferIncomeSources`).get(),
      db.collection(`users/${uid}/cashIncome`).get(),
      db.collection(`users/${uid}/incomeCategoryRules`).get(),
      db.doc(`users/${uid}/prefs/debtPaymentTags`).get(),
      db.collection(`users/${uid}/accountBackfills`).get(),
      db.collection(`users/${uid}/cashCommitments`).get(),
      db.collection(`users/${uid}/manualLiabilities`).get(),
      db.collection(`users/${uid}/accountRates`).get(),
      db.collection(`users/${uid}/goals`).get(),
      db.collection(`users/${uid}/subscriptions`)
        .where("status", "in", ["confirmed", "user_confirmed"]).get(),
    ]);

  // Currency overrides: accountSlug → ISO currency code (e.g. "USD")
  const currencyOverrides = new Map<string, string>();
  for (const doc of currencyOverridesSnap.docs) {
    currencyOverrides.set(doc.id, (doc.data().currency as string).toUpperCase());
  }

  const { incomeTxns: allIncomeTxns, accountSnapshots, latestTxMonth, allTxMonths } = txData;

  // User-marked transfer sources — deposits that should NOT count as income
  const userTransferSources = new Set<string>(
    transferPrefsSnap.exists ? (transferPrefsSnap.data()?.keys ?? []) : []
  );

  /** Returns true when an income transaction is an inter-account transfer. */
  function isIncomeTransfer(txn: IncomeTxnRecord): boolean {
    const src = (txn.source ?? txn.description ?? "").trim();
    if (INCOME_TRANSFER_RE.test(src)) return true;
    if (userTransferSources.has(src)) return true;
    // Check income category rules — if user categorized as Transfer, exclude
    if (incomeCatRulesMap.get(sourceSlug(src)) === "Transfer") return true;
    return false;
  }

  // Cash income entries — manual/recurring income outside bank statements
  const cashIncomeEntries: CashIncomeEntry[] = cashIncomeSnap.docs.map((d) => d.data() as CashIncomeEntry);

  // Cash commitment entries — manual recurring expenses outside bank statements
  const cashCommitmentEntries: CashCommitment[] = cashCommitmentsSnap.docs.map((d) => d.data() as CashCommitment);

  // Income category rules — source slug → category (Transfer sources excluded from total)
  const incomeCatRulesMap = new Map<string, string>();
  for (const d of incomeCatRulesSnap.docs) {
    const r = d.data();
    if (r.slug && r.category) incomeCatRulesMap.set(r.slug as string, r.category as string);
  }
  function sourceSlug(s: string): string {
    return s.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 60);
  }

  // User debt payment tag overrides — debtTxKey → "minimum" | "extra" | "scheduled"
  const userDebtTags: Record<string, string> = debtTagsSnap.exists
    ? (debtTagsSnap.data()?.tags ?? {})
    : {};

  // Apply user category rules to expense transactions
  const rulesMap = new Map<string, string>();
  for (const doc of rulesSnap.docs) {
    const r = doc.data();
    if (r.merchant && r.category) rulesMap.set(merchantSlug(r.merchant as string), r.category as string);
  }
  const allExpenseTxns: ExpenseTxnRecord[] = txData.expenseTxns.map((t) => ({
    ...t,
    category: rulesMap.get(merchantSlug(t.merchant)) ?? t.category,
  }));

  // Manual assets — same shape as /api/user/assets response
  const manualAssets: ManualAsset[] = manualAssetsSnap.docs.map((d) => {
    const data = d.data();
    return {
      id: d.id,
      label: data.label ?? "",
      category: data.category ?? "other",
      value: data.value ?? 0,
      linkedAccountSlug: data.linkedAccountSlug ?? undefined,
      updatedAt: data.updatedAt?.toDate?.()?.toISOString?.() ?? new Date().toISOString(),
    };
  });

  // Balance snapshots — keep latest per account slug (same logic as assets page)
  const latestSnapBySlug = new Map<string, BalanceSnapshot>();
  for (const d of balanceSnapshotsSnap.docs) {
    const data = d.data();
    const snap: BalanceSnapshot = {
      id: d.id,
      accountSlug: data.accountSlug ?? "",
      accountName: data.accountName ?? "",
      accountType: data.accountType ?? "other",
      balance: data.balance ?? 0,
      yearMonth: data.yearMonth ?? "",
      note: data.note,
    };
    const existing = latestSnapBySlug.get(snap.accountSlug);
    if (!existing || snap.yearMonth > existing.yearMonth) {
      latestSnapBySlug.set(snap.accountSlug, snap);
    }
  }
  const balanceSnapshots = Array.from(latestSnapBySlug.values());

  // Apply snapshot overrides to accountSnapshots (same logic as assets page).
  // When overriding balance, also derive parsedAssets/parsedDebts from the new balance
  // so the net worth formula (mirror of consolidateStatements) stays consistent.
  const accountSnapshotsWithOverrides: AccountSnapshot[] = accountSnapshots.map((snap) => {
    const override = latestSnapBySlug.get(snap.slug);
    if (override && override.yearMonth > snap.statementMonth) {
      const b = override.balance;
      return {
        ...snap,
        balance:      b,
        parsedAssets: Math.max(0, b),
        parsedDebts:  Math.max(0, -b),
        statementMonth: override.yearMonth,
        accountName: override.accountName || snap.accountName,
      };
    }
    return snap;
  });
  // Also add snapshots for accounts that only exist in balance-snapshots (no statement)
  const slugsInSnapshots  = new Set(accountSnapshots.map((s) => s.slug));
  const snapshotOnlyAccts: AccountSnapshot[] = balanceSnapshots
    .filter((s) => !slugsInSnapshots.has(s.accountSlug))
    .map((s) => ({
      slug:         s.accountSlug,
      bankName:     s.accountName,
      accountId:    "",
      accountName:  s.accountName,
      accountType:  s.accountType,
      balance:      s.balance,
      parsedAssets: Math.max(0, s.balance),
      parsedDebts:  Math.max(0, -s.balance),
      statementMonth: s.yearMonth,
      interestRate: null,
    }));
  const mergedSnapshots = [...accountSnapshotsWithOverrides, ...snapshotOnlyAccts].map((s) => {
    const override = currencyOverrides.get(s.slug);
    return override ? { ...s, currency: override } : s;
  });

  // Compute per-month aggregated history from ALL months
  const monthlyHistory: MonthlyHistoryEntry[] = allTxMonths.map((ym) => {
    const monthExp = allExpenseTxns.filter((t) => t.txMonth === ym);
    const monthInc = allIncomeTxns.filter((t) => t.txMonth === ym);
    // Exclude inter-account transfers from income total (auto-detected + user-marked)
    const monthIncFiltered = monthInc.filter((t) => !isIncomeTransfer(t));
    // Add cash income entries that have an occurrence in this month
    const cashIncomeForMonth = cashIncomeEntries.reduce((sum, entry) => {
      const count = occurrencesInMonth(entry, ym);
      return sum + (count > 0 ? entry.amount * count : 0);
    }, 0);
    // Add cash commitment (manual expense) entries for this month
    const cashCommitmentsForMonth = cashCommitmentEntries.reduce((sum, entry) => {
      const count = commitmentOccurrencesInMonth(entry, ym);
      return sum + (count > 0 ? entry.amount * count : 0);
    }, 0);
    const debtTxns = monthExp.filter((t) => /^debt payments$/i.test((t.category ?? "").trim()));
    const { minPaymentsTotal } = splitDebtPayments(
      debtTxns as (import("./types").ExpenseTransaction & { debtType?: string })[],
      userDebtTags,
      ym,
    );
    return {
      yearMonth: ym,
      expensesTotal: monthExp.reduce((s, t) => s + t.amount, 0) + cashCommitmentsForMonth,
      coreExpensesTotal: monthExp
        .filter((t) => !CORE_EXCLUDE_RE.test((t.category ?? "").trim()))
        .reduce((s, t) => s + t.amount, 0) + cashCommitmentsForMonth,
      debtPaymentsTotal: debtTxns.reduce((s, t) => s + t.amount, 0),
      minDebtPaymentsTotal: minPaymentsTotal,
      incomeTotal: monthIncFiltered.reduce((s, t) => s + t.amount, 0) + cashIncomeForMonth,
    };
  });

  // Inject months that have cash income or cash commitments but no statement.
  // Walk from the earliest startDate across both collections to today.
  {
    const now0 = new Date();
    const todayYM = `${now0.getFullYear()}-${String(now0.getMonth() + 1).padStart(2, "0")}`;
    const historySet = new Set(monthlyHistory.map((h) => h.yearMonth));
    const allManualEntries = [
      ...cashIncomeEntries.map((e) => e.startDate?.slice(0, 7) ?? e.createdAt?.slice(0, 7) ?? todayYM),
      ...cashCommitmentEntries.map((e) => e.startDate?.slice(0, 7) ?? e.createdAt?.slice(0, 7) ?? todayYM),
    ];
    if (allManualEntries.length > 0) {
      const earliestYM = allManualEntries.reduce((min, s) => (s < min ? s : min), todayYM);
      let ym = earliestYM;
      while (ym <= todayYM) {
        const cashIncome = cashIncomeEntries.reduce((sum, entry) => {
          const count = occurrencesInMonth(entry, ym);
          return sum + (count > 0 ? entry.amount * count : 0);
        }, 0);
        const cashExpenses = cashCommitmentEntries.reduce((sum, entry) => {
          const count = commitmentOccurrencesInMonth(entry, ym);
          return sum + (count > 0 ? entry.amount * count : 0);
        }, 0);
        if (!historySet.has(ym) && (cashIncome > 0 || cashExpenses > 0)) {
          monthlyHistory.push({
            yearMonth: ym,
            expensesTotal: cashExpenses,
            coreExpensesTotal: cashExpenses,
            debtPaymentsTotal: 0,
            minDebtPaymentsTotal: 0,
            incomeTotal: cashIncome,
          });
          historySet.add(ym);
        } else if (historySet.has(ym) && cashExpenses > 0) {
          // Month already exists from a statement — cashCommitmentsForMonth already
          // added above in the allTxMonths.map pass, so nothing extra needed here.
        }
        const [y, mo] = ym.split("-").map(Number) as [number, number];
        const next = new Date(y, mo, 1);
        ym = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
      }
      monthlyHistory.sort((a, b) => a.yearMonth.localeCompare(b.yearMonth));
    }
  }

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const typicalMonthly = computeTypicalSpend(allExpenseTxns, thisMonth);
  const sourceVersion  = computeSourceVersion(completedSnap.docs);

  // Keep only last 12 months of raw transactions to stay well within 1 MB limit
  const cutoff12 = allTxMonths.slice(-12)[0] ?? thisMonth;
  const expenseTxns = allExpenseTxns.filter((t) => t.txMonth >= cutoff12);
  const cutoff6     = allTxMonths.slice(-6)[0] ?? thisMonth;
  const incomeTxns  = allIncomeTxns.filter((t) => t.txMonth >= cutoff6);

  // Collect holdings from the most recent investment statement per account slug
  const latestHoldingsBySlug = new Map<string, PortfolioAccountHoldings>();
  for (const doc of completedSnap.docs) {
    const d = doc.data();
    const parsed = d.parsedData as ParsedStatementData | undefined;
    if (!parsed || parsed.accountType !== "investment") continue;
    const holdings = parsed.holdings;
    if (!holdings || holdings.length === 0) continue;
    const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
    const ym   = d.yearMonth as string | undefined ?? "";
    const existing = latestHoldingsBySlug.get(slug);
    if (!existing || ym > existing.statementMonth) {
      latestHoldingsBySlug.set(slug, {
        accountSlug:   slug,
        accountName:   parsed.accountName ?? parsed.bankName ?? slug,
        statementMonth: ym,
        holdings,
      });
    }
  }
  const portfolioHoldings = Array.from(latestHoldingsBySlug.values());

  // Build per-account monthly balance history from ALL completed statement docs.
  // This replaces the need for pages to fetch /api/user/statements directly.
  const balanceHistoryMap = new Map<string, { label: string; accountType: string; entries: Map<string, number> }>();
  for (const doc of completedSnap.docs) {
    const d = doc.data();
    const parsed = d.parsedData as ParsedStatementData | undefined;
    if (!parsed || parsed.netWorth == null) continue;
    const slug = buildAccountSlug(parsed.bankName, parsed.accountId);
    const ym   = (d.yearMonth as string | undefined) ?? (parsed.statementDate ?? "").slice(0, 7);
    if (!ym) continue;
    if (!balanceHistoryMap.has(slug)) {
      balanceHistoryMap.set(slug, {
        label:       parsed.accountName ?? parsed.bankName ?? slug,
        accountType: parsed.accountType ?? "other",
        entries:     new Map(),
      });
    }
    // Keep the highest-date entry per yearMonth (handles multiple uploads same month)
    const entry = balanceHistoryMap.get(slug)!;
    const existingUploadedAt = entry.entries.get(ym);
    if (existingUploadedAt == null) entry.entries.set(ym, parsed.netWorth);
  }
  // Apply synthetic backfill entries — each doc is one pre-computed monthly record.
  // Real statement data (loaded above) takes priority: only fill months with no real data.
  // When the user uploads a real statement for a backfill month, it naturally wins.
  for (const doc of backfillsSnap.docs) {
    const bf = doc.data() as {
      accountSlug: string; accountName: string; accountType: string;
      yearMonth: string; balance: number;
    };
    if (!bf.accountSlug || !bf.yearMonth) continue;

    if (!balanceHistoryMap.has(bf.accountSlug)) {
      balanceHistoryMap.set(bf.accountSlug, {
        label:       bf.accountName ?? bf.accountSlug,
        accountType: bf.accountType ?? "other",
        entries:     new Map(),
      });
    }
    const entry = balanceHistoryMap.get(bf.accountSlug)!;
    if (!entry.entries.has(bf.yearMonth)) {
      entry.entries.set(bf.yearMonth, bf.balance);
    }
  }

  const accountBalanceHistory: AccountBalanceHistory[] = Array.from(balanceHistoryMap.entries()).map(([slug, e]) => {
    const currencyOverride = currencyOverrides.get(slug);
    // Derive currency: prefer user override, else look up from mergedSnapshots
    const snapCurrency = mergedSnapshots.find((s) => s.slug === slug)?.currency ?? "CAD";
    return {
      slug,
      label:       e.label,
      accountType: e.accountType,
      currency:    currencyOverride ?? snapCurrency,
      entries:     Array.from(e.entries.entries())
        .map(([yearMonth, balance]) => ({ yearMonth, balance }))
        .sort((a, b) => a.yearMonth.localeCompare(b.yearMonth)),
    };
  });

  // Fetch FX rates for any non-CAD account currencies present in the snapshots.
  const currencySet = new Set<string>(
    mergedSnapshots.map((s) => (s.currency ?? "CAD").toUpperCase())
  );
  const fxRateMap = await getFxRatesForCurrencies(currencySet, db);
  // Store as a plain object (excluding CAD=1 since it's implicit)
  const fxRates: Record<string, number> = {};
  for (const [currency, rate] of fxRateMap.entries()) {
    if (currency !== "CAD") fxRates[currency] = rate;
  }

  // Build new cache fields from the parallel reads
  const manualLiabilities: ManualLiability[] = manualLiabSnap.docs.map((d) => ({
    id: d.id,
    ...(d.data() as Omit<ManualLiability, "id">),
  }));

  const accountRates: CachedAccountRate[] = accountRatesSnap.docs.map((d) => ({
    accountKey: d.id,
    rate: d.data().rate ?? null,
    paymentFrequency: d.data().paymentFrequency ?? null,
  }));

  const goals: CachedGoal[] = goalsSnap.docs.map((d) => {
    const g = d.data();
    return {
      id: d.id,
      title: g.title ?? "Untitled goal",
      emoji: g.emoji ?? "🎯",
      description: g.description ?? "",
      targetAmount: g.targetAmount ?? null,
      currentAmount: g.currentAmount ?? 0,
      targetDate: g.targetDate ?? null,
    };
  });

  const confirmedSubscriptions: SubscriptionRecord[] = confirmedSubsSnap.docs.map(
    (d) => d.data() as SubscriptionRecord,
  );

  const profile: FinancialProfileCache = {
    updatedAt: now.toISOString(),
    sourceVersion,
    schemaVersion: SCHEMA_VERSION,
    monthlyHistory,
    typicalMonthly,
    expenseTxns,
    incomeTxns,
    accountSnapshots: mergedSnapshots,
    allTxMonths,
    latestTxMonth,
    manualAssets,
    balanceSnapshots,
    portfolioHoldings,
    fxRates,
    accountBalanceHistory,
    manualLiabilities,
    accountRates,
    goals,
    confirmedSubscriptions,
    cashCommitmentEntries,
  };

  // Persist — JSON round-trip strips `undefined` fields (Firestore rejects them)
  await db.collection("users").doc(uid).set(
    { financialProfile: JSON.parse(JSON.stringify(profile)) },
    { merge: true }
  );

  console.log(
    `[financialProfile] built uid=${uid} ` +
    `months=${monthlyHistory.length} expTxns=${expenseTxns.length} v=${sourceVersion}`
  );
  return profile;
}

// ── read (with freshness check) ────────────────────────────────────────────────

export interface GetFinancialProfileOpts {
  /**
   * When set, the returned profile's transaction arrays and monthly history are
   * sliced to the most recent N months. The full data is always cached; slicing
   * happens in memory before returning so callers get a smaller payload.
   * Useful for AI chat where recent data is all that's needed.
   */
  months?: number;
}

/**
 * Return the user's financial profile, rebuilding from Firestore if stale.
 *
 * Use this in every API route that needs spending/income/balance data.
 * All routes will see identical numbers because they all go through this function.
 */
export async function getFinancialProfile(
  uid: string,
  db: Firestore.Firestore,
  opts?: GetFinancialProfileOpts,
): Promise<FinancialProfileCache> {
  // Read cached document (lightweight — single doc read)
  const userDoc = await db.collection("users").doc(uid).get();
  const cached = userDoc.data()?.financialProfile as FinancialProfileCache | undefined;

  let full: FinancialProfileCache;

  if (cached?.updatedAt) {
    // Schema version mismatch: rebuild immediately so consumers never receive a
    // cache that's missing fields added in newer schema versions.
    if (cached.schemaVersion !== SCHEMA_VERSION) {
      full = await buildAndCacheFinancialProfile(uid, db);
    } else {
      const ageMs = Date.now() - new Date(cached.updatedAt).getTime();

      // Hot path: cache is < 5 min old — return immediately, no version check
      if (ageMs < HOT_WINDOW_MS) {
        full = cached;
      } else if (ageMs < MAX_CACHE_MS) {
        // Warm path: cache is between 5 min and 24 h — check data version
        const completedSnap = await db
          .collection("statements")
          .where("userId", "==", uid)
          .where("status", "==", "completed")
          .get();
        const currentVersion = computeSourceVersion(completedSnap.docs);
        full = currentVersion === cached.sourceVersion
          ? cached
          : await buildAndCacheFinancialProfile(uid, db);
      } else {
        // Expired — force rebuild
        full = await buildAndCacheFinancialProfile(uid, db);
      }
    }
  } else {
    full = await buildAndCacheFinancialProfile(uid, db);
  }

  // Apply months slice in memory — cache always stores full history
  if (opts?.months && opts.months > 0) {
    const n = opts.months;
    const trimmedMonths = full.allTxMonths.slice(-n);
    const monthSet = new Set(trimmedMonths);
    return {
      ...full,
      allTxMonths: trimmedMonths,
      monthlyHistory: full.monthlyHistory.filter((h) => monthSet.has(h.yearMonth)),
      expenseTxns: full.expenseTxns.filter((t) => monthSet.has(t.txMonth)),
      incomeTxns: full.incomeTxns.filter((t) => monthSet.has(t.txMonth)),
    };
  }

  return full;
}

/**
 * Invalidate the cache by clearing updatedAt so the next read triggers a rebuild.
 * Call this when you know data has changed but don't want to rebuild synchronously
 * (e.g. after saving a category rule where the API response doesn't need fresh data).
 */
export async function invalidateFinancialProfileCache(
  uid: string,
  db: Firestore.Firestore,
): Promise<void> {
  await db.collection("users").doc(uid).set(
    { financialProfile: { updatedAt: new Date(0).toISOString() } },
    { merge: true }
  );
}
