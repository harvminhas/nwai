/** Shared transaction picker helpers for Planner and Trackers. */

export type TransactionPickerContext = "expenses" | "income" | "both";
export type TransactionPickerFilterMode = "all" | "income" | "spending";
export type LinkableTransactionKind = "income" | "expense";

/** Spending / income API payload. Fingerprints match `txFingerprint()`. */
export interface TxApiTransaction {
  fingerprint?: string;
  date?: string;
  merchant?: string;
  amount?: number;
  category?: string;
  accountLabel?: string;
  accountName?: string;
}

/** Alias used by Planner tests and call sites. */
export type SpendingApiTransaction = TxApiTransaction;

export interface LinkableTransaction {
  txFingerprint: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
  kind: LinkableTransactionKind;
  /** Display name from spending/income APIs (`accountLabel`, e.g. "TD Chequing"). */
  accountLabel?: string;
}

/** Alias used by Planner tests and call sites. */
export type PlannerLinkableTransaction = LinkableTransaction;

export const SPENDING_TXNS_URL = "/api/user/spending/transactions?months=24&limit=2000";
export const INCOME_TXNS_URL = "/api/user/income/transactions?months=24&limit=2000";
export const PLANNER_SPENDING_TXNS_URL = SPENDING_TXNS_URL;

/** Cap the picker list so the modal stays scrollable, matching Planner. */
export const PICKER_VISIBLE_LIMIT = 50;

export function transactionSourcesForContext(
  context: TransactionPickerContext
): Array<"spending" | "income"> {
  if (context === "expenses") return ["spending"];
  if (context === "income") return ["income"];
  return ["spending", "income"];
}

export function urlForTransactionSource(source: "spending" | "income"): string {
  return source === "income" ? INCOME_TXNS_URL : SPENDING_TXNS_URL;
}

export function kindForTransactionSource(source: "spending" | "income"): LinkableTransactionKind {
  return source === "income" ? "income" : "expense";
}

/** Prefer the spending/income API display label; fall back to accountName. Never use slug/id. */
export function accountLabelFromApi(tx: TxApiTransaction): string {
  if (typeof tx.accountLabel === "string" && tx.accountLabel.trim()) return tx.accountLabel.trim();
  if (typeof tx.accountName === "string" && tx.accountName.trim()) return tx.accountName.trim();
  return "";
}

/** Map API `fingerprint` onto `txFingerprint`. Drop rows with no fingerprint. */
export function mapApiTransactionsToLinkable(
  transactions: TxApiTransaction[] | null | undefined,
  kind: LinkableTransactionKind
): LinkableTransaction[] {
  if (!transactions?.length) return [];
  const mapped: LinkableTransaction[] = [];
  for (const tx of transactions) {
    if (typeof tx.fingerprint !== "string" || tx.fingerprint.length === 0) continue;
    const accountLabel = accountLabelFromApi(tx);
    mapped.push({
      txFingerprint: tx.fingerprint,
      date: tx.date ?? "",
      merchant: tx.merchant ?? "",
      amount: typeof tx.amount === "number" ? tx.amount : 0,
      category: tx.category || (kind === "income" ? "Income" : "Other"),
      kind,
      ...(accountLabel ? { accountLabel } : {}),
    });
  }
  return mapped;
}

/** Map spending-API `fingerprint` onto the plan field `txFingerprint`. Drop rows with no fingerprint. */
export function mapSpendingTransactionsToLinkable(
  transactions: SpendingApiTransaction[] | null | undefined
): LinkableTransaction[] {
  return mapApiTransactionsToLinkable(transactions, "expense");
}

export function mapIncomeTransactionsToLinkable(
  transactions: TxApiTransaction[] | null | undefined
): LinkableTransaction[] {
  return mapApiTransactionsToLinkable(transactions, "income");
}

function matchesSearch(tx: LinkableTransaction, query: string): boolean {
  if (!query) return true;
  return (
    tx.merchant.toLowerCase().includes(query) ||
    tx.date.includes(query) ||
    tx.amount.toString().includes(query) ||
    (tx.accountLabel ?? "").toLowerCase().includes(query)
  );
}

/** date · account · Spending · category — omit empty account labels. */
export function transactionMetaLine(
  tx: {
    date: string;
    accountLabel?: string;
    category: string;
    kind?: LinkableTransactionKind;
  },
  opts?: { includeKind?: boolean }
): string {
  const parts: string[] = [];
  if (tx.date) parts.push(tx.date);
  const account = (tx.accountLabel ?? "").trim();
  if (account) parts.push(account);
  if (opts?.includeKind && tx.kind) {
    parts.push(tx.kind === "income" ? "Income" : "Spending");
  }
  if (tx.category) parts.push(tx.category);
  return parts.join(" · ");
}

export function resolveAccountLabel(
  stored: string | undefined,
  txFingerprint: string,
  lookup: ReadonlyMap<string, string>
): string {
  const fromStore = (stored ?? "").trim();
  if (fromStore) return fromStore;
  return (lookup.get(txFingerprint) ?? "").trim();
}

export function accountLabelLookup(
  transactions: Array<{ txFingerprint: string; accountLabel?: string }>
): Map<string, string> {
  const map = new Map<string, string>();
  for (const tx of transactions) {
    const label = (tx.accountLabel ?? "").trim();
    if (label) map.set(tx.txFingerprint, label);
  }
  return map;
}

export async function fetchLinkableTransactions(
  token: string,
  context: TransactionPickerContext
): Promise<LinkableTransaction[]> {
  const sources = transactionSourcesForContext(context);
  const results = await Promise.all(
    sources.map(async (source) => {
      const res = await fetch(urlForTransactionSource(source), {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        throw new Error("Failed to load transactions. Please try again.");
      }
      const data = await res.json();
      return mapApiTransactionsToLinkable(data.transactions, kindForTransactionSource(source));
    })
  );
  return results.flat();
}

function matchesContextAndFilter(
  tx: LinkableTransaction,
  context: TransactionPickerContext,
  filterMode: TransactionPickerFilterMode
): boolean {
  if (context === "expenses") return tx.kind === "expense";
  if (context === "income") return tx.kind === "income";
  if (filterMode === "income") return tx.kind === "income";
  if (filterMode === "spending") return tx.kind === "expense";
  return true;
}

export function filterLinkableTransactions(
  transactions: LinkableTransaction[],
  opts: {
    linkedFingerprints: Iterable<string>;
    search?: string;
    context?: TransactionPickerContext;
    filterMode?: TransactionPickerFilterMode;
  }
): LinkableTransaction[] {
  const linked = new Set(
    [...opts.linkedFingerprints].filter((fp): fp is string => typeof fp === "string" && fp.length > 0)
  );
  const query = (opts.search ?? "").toLowerCase().trim();
  const context = opts.context ?? "expenses";
  const filterMode = opts.filterMode ?? "all";

  return transactions
    .filter((tx) => {
      if (linked.has(tx.txFingerprint)) return false;
      if (!matchesContextAndFilter(tx, context, filterMode)) return false;
      return matchesSearch(tx, query);
    })
    .sort((a, b) => b.date.localeCompare(a.date));
}

/** Planner-compatible wrapper: expenses context, no kind toggle. */
export function filterPlannerLinkableTransactions(
  transactions: LinkableTransaction[],
  opts: {
    linkedFingerprints: Iterable<string>;
    search?: string;
  }
): LinkableTransaction[] {
  return filterLinkableTransactions(transactions, {
    ...opts,
    context: "expenses",
  });
}

/** Independent per-row selection keyed by fingerprint — never by a shared undefined key. */
export function toggleTxSelection(
  selected: ReadonlySet<string>,
  txFingerprint: string,
  checked: boolean
): Set<string> {
  const next = new Set(selected);
  if (!txFingerprint) return next;
  if (checked) next.add(txFingerprint);
  else next.delete(txFingerprint);
  return next;
}

export const togglePlannerTxSelection = toggleTxSelection;

/** After reload, keep the same open item by id so handlers see fresh linkedTransactions. */
export function reselectById<T extends { id: string }>(
  fresh: T[],
  previous: T | null | undefined
): T | null {
  if (!previous) return null;
  return fresh.find((x) => x.id === previous.id) ?? null;
}

export const reselectPlanById = reselectById;
