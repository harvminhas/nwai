/**
 * Unit test: Merchant normalization and merging
 * 
 * Verifies that merchant name variants (e.g. "AMAZON.CA" vs "AMZN MKTP CA")
 * are correctly merged into canonical names using merchantSlug + resolveMerchantAlias.
 */

import { describe, it, expect } from "vitest";
import { buildSpendingSummary } from "@/lib/spendingSummary";
import type { ExpenseTxnRecord } from "@/lib/extractTransactions";

describe("Merchant normalization and merging", () => {
  // Fixture with Amazon variants
  const expenseTxns: ExpenseTxnRecord[] = [
    {
      date: "2026-09-10",
      merchant: "AMAZON.CA",
      category: "Shopping",
      amount: -50,
      accountLabel: "TD Visa",
      accountSlug: "td-visa-1234",
      txMonth: "2026-09",
      txFingerprint: "amz-1",
      accountType: "credit_card",
    },
    {
      date: "2026-09-15",
      merchant: "AMZN MKTP CA",
      category: "Shopping",
      amount: -30,
      accountLabel: "TD Visa",
      accountSlug: "td-visa-1234",
      txMonth: "2026-09",
      txFingerprint: "amz-2",
      accountType: "credit_card",
    },
    {
      date: "2026-09-20",
      merchant: "Amazon.ca",
      category: "Shopping",
      amount: -70,
      accountLabel: "TD Visa",
      accountSlug: "td-visa-1234",
      txMonth: "2026-09",
      txFingerprint: "amz-3",
      accountType: "credit_card",
    },
    {
      date: "2026-09-25",
      merchant: "Walmart",
      category: "Shopping",
      amount: -40,
      accountLabel: "TD Visa",
      accountSlug: "td-visa-1234",
      txMonth: "2026-09",
      txFingerprint: "walmart-1",
      accountType: "credit_card",
    },
  ];

  it("merges Amazon variants into single canonical merchant", () => {
    const summary = buildSpendingSummary(
      expenseTxns,
      [],
      [],
      [],
      {},
      "CAD"
    );

    // Should have 2 merchants (Amazon + Walmart), not 4
    expect(summary.merchants.length).toBe(2);
    
    // Find Amazon merchant
    const amazon = summary.merchants.find(m => m.merchant === "Amazon");
    expect(amazon).toBeDefined();
    expect(amazon?.total).toBe(150); // 50 + 30 + 70
    expect(amazon?.count).toBe(3);
    
    // Find Walmart merchant
    const walmart = summary.merchants.find(m => m.merchant === "Walmart");
    expect(walmart).toBeDefined();
    expect(walmart?.total).toBe(40);
    expect(walmart?.count).toBe(1);
  });

  it("normalizes merchant names in transaction records", () => {
    const summary = buildSpendingSummary(
      expenseTxns,
      [],
      [],
      [],
      {},
      "CAD"
    );

    const amazon = summary.merchants.find(m => m.merchant === "Amazon");
    expect(amazon).toBeDefined();
    
    // All transactions should show canonical name
    amazon?.transactions.forEach(t => {
      expect(t.merchant).toBe("Amazon");
    });
  });

  it("reduces merchant count through normalization", () => {
    const summary = buildSpendingSummary(
      expenseTxns,
      [],
      [],
      [],
      {},
      "CAD"
    );

    // Raw transactions: 4 unique merchant strings
    const rawMerchants = new Set(expenseTxns.map(t => t.merchant)).size;
    expect(rawMerchants).toBe(4);
    
    // After normalization: 2 merchants
    expect(summary.merchants.length).toBe(2);
    
    // Reduction of 50%
    const reductionPct = (1 - summary.merchants.length / rawMerchants) * 100;
    expect(reductionPct).toBe(50);
  });
});
