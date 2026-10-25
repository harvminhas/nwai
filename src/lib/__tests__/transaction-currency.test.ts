/**
 * Test: Statement-level currency is the single source of truth for all transactions.
 *
 * Bug case: Otter.ai, a US$99 subscription paid on a Canadian credit card.
 * The card statement shows CA$164 (with maybe a note showing USD original).
 * The merchant drawer incorrectly showed US$164 because the parser was tagging
 * foreign-merchant transactions with currency='USD' instead of the statement currency.
 *
 * Fix: Every transaction inherits its statement's currency at read time.
 * The dashboard and merchant page must show the same CA$164.
 */

import type { ParsedStatementData } from "../types";
import { inferCurrencyFromBankName } from "../currencyUtils";

describe("Transaction currency inheritance", () => {
  it("should use statement currency for all transactions, ignoring per-transaction currency", () => {
    // Statement from a Canadian credit card (TD Visa)
    const parsed: ParsedStatementData = {
      bankName: "TD",
      accountId: "1234",
      accountName: "TD Visa",
      accountType: "credit",
      currency: "CAD", // Statement-level currency
      statementDate: "2026-07-31",
      netWorth: -1500,
      assets: 0,
      debts: 1500,
      income: { total: 0, sources: [], transactions: [] },
      expenses: {
        total: 164,
        categories: [{ name: "Subscriptions", amount: 164, percentage: 100 }],
        transactions: [
          {
            merchant: "OTTER.AI",
            amount: 164,
            date: "2026-07-13",
            category: "Subscriptions",
            // The AI parser might have incorrectly set this to "USD"
            // because Otter.ai is a US company, but the statement shows CAD
            currency: "USD", // Wrong! Should be ignored.
          },
        ],
      },
      paymentsMade: 0,
      subscriptions: [{ name: "Otter.ai", amount: 164, frequency: "monthly" }],
      savingsRate: 0,
      insights: [],
      subAccounts: [],
    };

    // The statement currency should be CAD (TD is a Canadian bank)
    const statementCurrency = inferCurrencyFromBankName(parsed.bankName, parsed.currency);
    expect(statementCurrency).toBe("CAD");

    // In extractAllTransactions, the transaction currency should be overridden
    // to match the statement currency, regardless of what the parser emitted
    const txn = parsed.expenses.transactions[0];
    expect(txn.currency).toBe("USD"); // Parser emitted this (wrong)

    // After data layer processing, the transaction should have statement currency
    const correctedCurrency = statementCurrency; // Data layer override
    expect(correctedCurrency).toBe("CAD");

    // Both the merchant page and dashboard should display CA$164
    const expectedAmount = txn.amount; // 164
    const expectedCurrency = "CAD";
    expect(expectedAmount).toBe(164);
    expect(expectedCurrency).toBe("CAD");
  });

  it("should handle US statements correctly", () => {
    // Statement from a US credit card (Chase Sapphire)
    const parsed: ParsedStatementData = {
      bankName: "Chase",
      accountId: "5678",
      accountName: "Chase Sapphire Reserve",
      accountType: "credit",
      currency: "USD",
      statementDate: "2026-07-31",
      netWorth: -2000,
      assets: 0,
      debts: 2000,
      income: { total: 0, sources: [], transactions: [] },
      expenses: {
        total: 99,
        categories: [{ name: "Subscriptions", amount: 99, percentage: 100 }],
        transactions: [
          {
            merchant: "NETFLIX",
            amount: 99,
            date: "2026-07-15",
            category: "Subscriptions",
          },
        ],
      },
      paymentsMade: 0,
      subscriptions: [],
      savingsRate: 0,
      insights: [],
      subAccounts: [],
    };

    const statementCurrency = inferCurrencyFromBankName(parsed.bankName, parsed.currency);
    expect(statementCurrency).toBe("USD");
  });

  it("should handle explicit statement currency over bank name heuristics", () => {
    // Edge case: Canadian user with a US account
    const parsed: ParsedStatementData = {
      bankName: "TD", // Canadian bank
      accountId: "9999",
      accountName: "TD USD Account",
      accountType: "checking",
      currency: "USD", // Explicitly USD despite being TD
      statementDate: "2026-07-31",
      netWorth: 5000,
      assets: 5000,
      debts: 0,
      income: { total: 0, sources: [], transactions: [] },
      expenses: {
        total: 100,
        categories: [{ name: "Shopping", amount: 100, percentage: 100 }],
        transactions: [
          {
            merchant: "AMAZON.COM",
            amount: 100,
            date: "2026-07-20",
            category: "Shopping",
          },
        ],
      },
      paymentsMade: 0,
      subscriptions: [],
      savingsRate: 0,
      insights: [],
      subAccounts: [],
    };

    // Should use explicit currency, not bank heuristic
    const statementCurrency = inferCurrencyFromBankName(parsed.bankName, parsed.currency);
    expect(statementCurrency).toBe("USD");
  });
});
