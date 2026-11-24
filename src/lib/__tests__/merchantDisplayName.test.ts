/**
 * Saved merchant renames must overlay on transaction-list payloads
 * without changing fingerprints or unrenamed statement names.
 */

import { describe, expect, it } from "vitest";
import { merchantSlug } from "@/lib/applyRules";
import { txFingerprint } from "@/lib/txFingerprint";
import {
  buildMerchantAliasResolver,
  displayedMerchantName,
  matchingMerchantName,
  merchantDisplayNamesFromRecords,
  merchantRenameContextFromRecords,
  overlayDisplayedMerchant,
  resolveSpendingMerchant,
} from "@/lib/merchantAliases";
import {
  spendingTransactionApiRow,
  spendingTransactionMatchesQuery,
} from "@/lib/spendingTransactions";

const RAW = "GC 1176-CASH WITHDRA";
const RENAMED = "Honda Downpayment";

function ctxForRename(slug: string, displayName: string, mappings: Array<{
  canonical: string;
  alias: string;
  status?: string;
  type?: string;
}> = []) {
  return merchantRenameContextFromRecords(mappings, [{ id: slug, displayName }]);
}

describe("displayedMerchantName / resolveSpendingMerchant", () => {
  it("returns Honda Downpayment for a GC 1176-CASH WITHDRA row when a rename exists", () => {
    const { slug } = resolveSpendingMerchant(RAW);
    const ctx = ctxForRename(slug, RENAMED);
    expect(displayedMerchantName(RAW, ctx.aliasResolver, ctx.displayNames)).toBe(RENAMED);
    expect(resolveSpendingMerchant(RAW, ctx.aliasResolver, ctx.displayNames).name).toBe(RENAMED);
  });

  it("leaves unrenamed merchants unchanged (raw statement spelling)", () => {
    const ctx = ctxForRename("honda-dealer", RENAMED);
    expect(displayedMerchantName("STARBUCKS #123", ctx.aliasResolver, ctx.displayNames)).toBe(
      "STARBUCKS #123",
    );
    expect(displayedMerchantName(RAW)).toBe(RAW);
  });

  it("applies a rename saved on one built-in alias slug to other variants", () => {
    const displayNames = merchantDisplayNamesFromRecords([
      { id: "amazon-ca", displayName: "Amazon (household)" },
    ]);
    expect(resolveSpendingMerchant("Amazon.com", null, displayNames).name).toBe("Amazon (household)");
    expect(resolveSpendingMerchant("Amazon.ca", null, displayNames).name).toBe("Amazon (household)");
    expect(displayedMerchantName("Amazon.com", null, displayNames)).toBe("Amazon (household)");
  });

  it("applies a rename saved on a merged canonical to all source-mapping aliases", () => {
    const ctx = ctxForRename("honda-dealer", RENAMED, [
      { alias: "GC 1176-cash Withdra", canonical: "Honda Dealer", status: "confirmed", type: "expense" },
      { alias: "GC 1177-cash Withdra", canonical: "Honda Dealer", status: "confirmed", type: "expense" },
    ]);
    expect(displayedMerchantName("GC 1176-cash Withdra", ctx.aliasResolver, ctx.displayNames)).toBe(RENAMED);
    expect(displayedMerchantName("GC 1177-cash Withdra", ctx.aliasResolver, ctx.displayNames)).toBe(RENAMED);
  });
});

describe("GET /api/user/spending/transactions mapping", () => {
  const accountSlug = "td-chequing-1234";
  const date = "2026-08-15";
  const amount = 18540;

  it("returns Honda Downpayment for a GC 1176-CASH WITHDRA row when a rename exists", () => {
    const { slug } = resolveSpendingMerchant(RAW);
    const ctx = ctxForRename(slug, RENAMED);
    const row = spendingTransactionApiRow(
      {
        merchant: RAW,
        date,
        amount,
        category: "Auto Service",
        accountSlug,
        accountLabel: "TD Chequing",
        txMonth: "2026-08",
      },
      ctx,
      "TD Chequing",
    );
    expect(row.merchant).toBe(RENAMED);
    expect(row.rawMerchant).toBe(RAW);
    expect(row.fingerprint).toBe(txFingerprint(accountSlug, date, amount, RAW));
    expect(row.fingerprint).not.toBe(txFingerprint(accountSlug, date, amount, RENAMED));
  });

  it("leaves unrenamed merchants unchanged on the transaction list", () => {
    const ctx = ctxForRename("honda-dealer", RENAMED);
    const raw = "COSTCO WHOLESALE";
    const row = spendingTransactionApiRow(
      {
        merchant: raw,
        date,
        amount: 87.12,
        category: "Groceries",
        accountSlug,
        txMonth: "2026-08",
      },
      ctx,
      "TD Chequing",
    );
    expect(row.merchant).toBe(raw);
    expect(row.rawMerchant).toBe(raw);
  });

  it("matches search queries on both the display name and the raw descriptor", () => {
    const { slug } = resolveSpendingMerchant(RAW);
    const ctx = ctxForRename(slug, RENAMED);
    const row = spendingTransactionApiRow(
      {
        merchant: RAW,
        date,
        amount,
        category: "Auto Service",
        accountSlug,
        txMonth: "2026-08",
      },
      ctx,
      "TD Chequing",
    );
    expect(spendingTransactionMatchesQuery(row, "honda")).toBe(true);
    expect(spendingTransactionMatchesQuery(row, "gc 1176")).toBe(true);
    expect(spendingTransactionMatchesQuery(row, "starbucks")).toBe(false);
  });
});

describe("overlayDisplayedMerchant / matchingMerchantName", () => {
  it("keeps the raw descriptor for category rules and fingerprints", () => {
    const { slug } = resolveSpendingMerchant(RAW);
    const ctx = ctxForRename(slug, RENAMED);
    const overlaid = overlayDisplayedMerchant({ merchant: RAW, category: "Auto Service" }, ctx);
    expect(overlaid.merchant).toBe(RENAMED);
    expect(overlaid.rawMerchant).toBe(RAW);
    expect(matchingMerchantName(overlaid)).toBe(RAW);
    expect(merchantSlug(matchingMerchantName(overlaid))).toBe(slug);
  });

  it("does not rewrite an unrenamed row", () => {
    const ctx = ctxForRename("honda-dealer", RENAMED);
    const overlaid = overlayDisplayedMerchant({ merchant: "TIM HORTONS" }, ctx);
    expect(overlaid.merchant).toBe("TIM HORTONS");
    expect(overlaid.rawMerchant).toBe("TIM HORTONS");
  });
});

describe("buildMerchantAliasResolver is unchanged by display-name overlay", () => {
  it("still resolves confirmed aliases independently of display names", () => {
    const resolver = buildMerchantAliasResolver([
      { alias: RAW, canonical: "Honda Dealer", status: "confirmed", type: "expense" },
    ]);
    expect(resolver.resolve(RAW)).toBe("Honda Dealer");
  });
});
