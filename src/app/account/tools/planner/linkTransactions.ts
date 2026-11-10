/** Spending API payload used by Hubs and Planner. Fingerprints match `txFingerprint()`. */
export interface SpendingApiTransaction {
  fingerprint?: string;
  date?: string;
  merchant?: string;
  amount?: number;
  category?: string;
}

export interface PlannerLinkableTransaction {
  txFingerprint: string;
  date: string;
  merchant: string;
  amount: number;
  category: string;
}

export const PLANNER_SPENDING_TXNS_URL =
  "/api/user/spending/transactions?months=24&limit=2000";

/** Map spending-API `fingerprint` onto the plan field `txFingerprint`. Drop rows with no fingerprint. */
export function mapSpendingTransactionsToLinkable(
  transactions: SpendingApiTransaction[] | null | undefined
): PlannerLinkableTransaction[] {
  if (!transactions?.length) return [];
  const mapped: PlannerLinkableTransaction[] = [];
  for (const tx of transactions) {
    if (typeof tx.fingerprint !== "string" || tx.fingerprint.length === 0) continue;
    mapped.push({
      txFingerprint: tx.fingerprint,
      date: tx.date ?? "",
      merchant: tx.merchant ?? "",
      amount: typeof tx.amount === "number" ? tx.amount : 0,
      category: tx.category || "Other",
    });
  }
  return mapped;
}

export function filterPlannerLinkableTransactions(
  transactions: PlannerLinkableTransaction[],
  opts: {
    linkedFingerprints: Iterable<string>;
    search?: string;
  }
): PlannerLinkableTransaction[] {
  const linked = new Set(
    [...opts.linkedFingerprints].filter((fp): fp is string => typeof fp === "string" && fp.length > 0)
  );
  const query = (opts.search ?? "").toLowerCase().trim();

  return transactions.filter((tx) => {
    if (linked.has(tx.txFingerprint)) return false;
    if (!query) return true;
    return (
      tx.merchant.toLowerCase().includes(query) ||
      tx.date.includes(query) ||
      tx.amount.toString().includes(query)
    );
  });
}

/** Independent per-row selection keyed by fingerprint — never by a shared undefined key. */
export function togglePlannerTxSelection(
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

/** After reload, keep the same open plan by id so handlers see fresh linkedTransactions. */
export function reselectPlanById<T extends { id: string }>(
  fresh: T[],
  previous: T | null | undefined
): T | null {
  if (!previous) return null;
  return fresh.find((x) => x.id === previous.id) ?? null;
}
