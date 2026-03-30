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
import { computeTypicalSpend, CORE_EXCLUDE_RE } from "./spendingMetrics";
import { merchantSlug } from "./applyRules";
import type { ExpenseTxnRecord, IncomeTxnRecord, AccountSnapshot } from "./extractTransactions";
import type { TypicalSpend } from "./spendingMetrics";

// ── constants ──────────────────────────────────────────────────────────────────
const HOT_WINDOW_MS  =  5 * 60 * 1000;   // 5 min — never re-check version this often
const MAX_CACHE_MS   = 24 * 60 * 60 * 1000; // 24 h — force full rebuild

/**
 * Bump this whenever filtering / computation logic changes so that all cached
 * profiles are rebuilt on the next request regardless of data version.
 */
const SCHEMA_VERSION = "3";

// ── types ──────────────────────────────────────────────────────────────────────

export interface MonthlyHistoryEntry {
  yearMonth: string;
  /** Raw total of all expense transactions (no transfers filter) */
  expensesTotal: number;
  /** Core expenses = expensesTotal minus categories matching CORE_EXCLUDE_RE */
  coreExpensesTotal: number;
  /** Total income for this month */
  incomeTotal: number;
}

export interface FinancialProfileCache {
  /** ISO-8601 when this cache was last built */
  updatedAt: string;
  /** Deterministic hash of all completed statement IDs + upload timestamps */
  sourceVersion: string;
  /** Bumped in code when computation logic changes — forces rebuild on mismatch */
  schemaVersion?: string;
  /** Per-month aggregated totals — ALL historical months */
  monthlyHistory: MonthlyHistoryEntry[];
  /** Pre-computed typical monthly spend (median + avg) */
  typicalMonthly: TypicalSpend;
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
}

// ── version hash ──────────────────────────────────────────────────────────────

/**
 * Deterministic hash of completed statement doc IDs + upload timestamps.
 * Changes whenever any statement is added, re-parsed, or updated.
 */
export function computeSourceVersion(docs: Firestore.QueryDocumentSnapshot[]): string {
  const repr = docs
    .map((d) => `${d.id}:${d.data().uploadedAt?.toMillis?.() ?? 0}`)
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
  // Single Firestore query for all transactions (extractAllTransactions fetches completed stmts)
  const txData = await extractAllTransactions(uid, db);
  const { incomeTxns: allIncomeTxns, accountSnapshots, latestTxMonth, allTxMonths } = txData;

  // Apply user category rules to expense transactions
  const rulesSnap = await db.collection(`users/${uid}/categoryRules`).get();
  const rulesMap = new Map<string, string>();
  for (const doc of rulesSnap.docs) {
    const r = doc.data();
    if (r.merchant && r.category) rulesMap.set(merchantSlug(r.merchant as string), r.category as string);
  }
  const allExpenseTxns: ExpenseTxnRecord[] = txData.expenseTxns.map((t) => ({
    ...t,
    category: rulesMap.get(merchantSlug(t.merchant)) ?? t.category,
  }));

  // Compute per-month aggregated history from ALL months
  const monthlyHistory: MonthlyHistoryEntry[] = allTxMonths.map((ym) => {
    const monthExp = allExpenseTxns.filter((t) => t.txMonth === ym);
    const monthInc = allIncomeTxns.filter((t) => t.txMonth === ym);
    return {
      yearMonth: ym,
      expensesTotal: monthExp.reduce((s, t) => s + t.amount, 0),
      coreExpensesTotal: monthExp
        .filter((t) => !CORE_EXCLUDE_RE.test((t.category ?? "").trim()))
        .reduce((s, t) => s + t.amount, 0),
      incomeTotal: monthInc.reduce((s, t) => s + t.amount, 0),
    };
  });

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const typicalMonthly = computeTypicalSpend(allExpenseTxns, thisMonth);

  // Compute source version
  const completedSnap = await db
    .collection("statements")
    .where("userId", "==", uid)
    .where("status", "==", "completed")
    .get();
  const sourceVersion = computeSourceVersion(completedSnap.docs);

  // Keep only last 12 months of raw transactions to stay well within 1 MB limit
  const cutoff12 = allTxMonths.slice(-12)[0] ?? thisMonth;
  const expenseTxns = allExpenseTxns.filter((t) => t.txMonth >= cutoff12);
  const cutoff6     = allTxMonths.slice(-6)[0] ?? thisMonth;
  const incomeTxns  = allIncomeTxns.filter((t) => t.txMonth >= cutoff6);

  const profile: FinancialProfileCache = {
    updatedAt: now.toISOString(),
    sourceVersion,
    schemaVersion: SCHEMA_VERSION,
    monthlyHistory,
    typicalMonthly,
    expenseTxns,
    incomeTxns,
    accountSnapshots,
    allTxMonths,
    latestTxMonth,
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

/**
 * Return the user's financial profile, rebuilding from Firestore if stale.
 *
 * Use this in every API route that needs spending/income/balance data.
 * All routes will see identical numbers because they all go through this function.
 */
export async function getFinancialProfile(
  uid: string,
  db: Firestore.Firestore,
): Promise<FinancialProfileCache> {
  // Read cached document (lightweight — single doc read)
  const userDoc = await db.collection("users").doc(uid).get();
  const cached = userDoc.data()?.financialProfile as FinancialProfileCache | undefined;

  if (cached?.updatedAt) {
    // Schema version mismatch means code logic changed — always rebuild
    if (cached.schemaVersion !== SCHEMA_VERSION) {
      return buildAndCacheFinancialProfile(uid, db);
    }

    const ageMs = Date.now() - new Date(cached.updatedAt).getTime();

    // Hot path: cache is < 5 min old — return immediately, no version check
    if (ageMs < HOT_WINDOW_MS) {
      return cached;
    }

    // Warm path: cache is between 5 min and 24 h — check data version
    if (ageMs < MAX_CACHE_MS) {
      const completedSnap = await db
        .collection("statements")
        .where("userId", "==", uid)
        .where("status", "==", "completed")
        .get();
      const currentVersion = computeSourceVersion(completedSnap.docs);
      if (currentVersion === cached.sourceVersion) {
        return cached; // data unchanged — return existing cache
      }
    }

    // Fall through: cache expired or data version mismatch → rebuild
  }

  return buildAndCacheFinancialProfile(uid, db);
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
