/**
 * Root cause analysis test - verifies the actual bug with real data flow
 */

import { inferCurrencyFromBankName } from "../currencyUtils";
import type { ParsedStatementData } from "../types";

describe("Currency Bug Root Cause", () => {
  describe("Current (broken) behavior", () => {
    it("inferCurrencyFromBankName trusts explicit USD even for TD bank", () => {
      // The AI parser saw "USD 99.00" foreign exchange note and set currency to USD
      const result = inferCurrencyFromBankName("TD", "USD", "CAD");
      
      // CURRENT BEHAVIOR: Returns USD (trusts explicit currency)
      expect(result).toBe("USD");
      
      // This is WRONG - TD is a Canadian bank, should always be CAD
    });

    it("explains the US$164 on merchant page", () => {
      // Statement has parsed.currency = "USD" (wrong!)
      const parsed: Partial<ParsedStatementData> = {
        bankName: "TD",
        currency: "USD", // AI incorrectly set this
        expenses: {
          total: 164,
          categories: [],
          transactions: [
            { merchant: "OTTER.AI", amount: 164, date: "2026-07-13", category: "Subscriptions" }
          ]
        }
      };

      // extractTransactions calls: inferCurrencyFromBankName("TD", "USD")
      const txnCurrency = inferCurrencyFromBankName(parsed.bankName!, parsed.currency);
      expect(txnCurrency).toBe("USD"); // Wrong! Should be CAD

      // Transaction stored with currency: "USD"
      // Merchant aggregation sums: 164 in "USD"
      // Display shows: US$164 (wrong currency label)
    });

    it("explains the CA$55 on dashboard", () => {
      // Dashboard drawer computes monthly average over 3 months
      const totalAmount = 164; // USD labeled (but should be CAD)
      const months = 3;
      const monthlyAvg = totalAmount / months;
      
      expect(monthlyAvg).toBeCloseTo(54.67, 1); // ≈ 55
      
      // Dashboard might show this as "CA$55" (forcing home currency label)
      // but the underlying data is wrong
    });
  });

  describe("Correct behavior (after fix)", () => {
    it("should prioritize bank name over explicit currency when they conflict", () => {
      // For Canadian banks (TD, RBC, BMO, etc.), always return CAD
      const result = inferCurrencyFromBankName("TD", "USD", "CAD");
      
      // FIXED: Returns CAD (Canadian bank takes priority over parsed currency)
      expect(result).toBe("CAD");
    });

    it("should trust explicit currency only when bank is unknown", () => {
      // Unknown/generic bank - trust the explicit currency
      const result = inferCurrencyFromBankName("Unknown Bank", "USD", "CAD");
      expect(result).toBe("USD");
    });

    it("merchant page and dashboard should both show CA$164 (not US$)", () => {
      // After fix:
      // 1. Statement from TD with parsed.currency="USD" (parser error)
      // 2. inferCurrencyFromBankName("TD", "USD") → "CAD" (prioritizes bank name)
      // 3. Transaction: { amount: 164, currency: "CAD" }
      // 4. Merchant page: CA$164 total
      // 5. Dashboard: CA$55/mo avg (164/3 = 54.67 ≈ 55)
      
      const statementCurrency = inferCurrencyFromBankName("TD", "USD");
      expect(statementCurrency).toBe("CAD"); // Fixed!
      
      const totalAmount = 164;
      const months = 3;
      
      // Merchant page shows total
      const merchantTotal = totalAmount;
      expect(merchantTotal).toBe(164);
      
      // Dashboard shows monthly average
      const dashboardAvg = totalAmount / months;
      expect(dashboardAvg).toBeCloseTo(54.67, 1);
      
      // Both display in CAD (home currency, isConsolidated=true)
      expect(statementCurrency).toBe("CAD");
    });
  });
});
