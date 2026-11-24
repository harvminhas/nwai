/**
 * Display mapping for GET /api/user/spending/transactions.
 *
 * Fingerprints always use the raw statement merchant. `merchant` is the
 * saved display name when one exists; `rawMerchant` keeps the original.
 */

import { txFingerprint } from "@/lib/txFingerprint";
import {
  displayedMerchantName,
  type MerchantRenameContext,
} from "@/lib/merchantAliases";

export type SpendingListTxnInput = {
  merchant: string;
  date: string;
  amount: number;
  category: string;
  accountSlug: string;
  accountLabel?: string;
  txMonth: string;
};

export type SpendingListTxn = {
  fingerprint: string;
  date: string;
  merchant: string;
  rawMerchant: string;
  amount: number;
  category: string;
  accountLabel: string;
  accountSlug: string;
  txMonth: string;
};

export function spendingTransactionApiRow(
  tx: SpendingListTxnInput,
  renameCtx: MerchantRenameContext | null | undefined,
  accountLabel: string,
): SpendingListTxn {
  const rawMerchant = tx.merchant;
  return {
    fingerprint: txFingerprint(tx.accountSlug, tx.date, tx.amount, rawMerchant),
    date: tx.date,
    merchant: displayedMerchantName(rawMerchant, renameCtx?.aliasResolver, renameCtx?.displayNames),
    rawMerchant,
    amount: Math.abs(tx.amount),
    category: tx.category,
    accountLabel,
    accountSlug: tx.accountSlug,
    txMonth: tx.txMonth,
  };
}

export function spendingTransactionMatchesQuery(
  row: Pick<SpendingListTxn, "merchant" | "rawMerchant">,
  query: string,
): boolean {
  const q = query.toLowerCase().trim();
  if (!q) return true;
  return row.merchant.toLowerCase().includes(q) || row.rawMerchant.toLowerCase().includes(q);
}
