/**
 * Test: CAD user with no explicit homeCurrency set should see CAD amounts everywhere
 * 
 * Scenario: User has Scotia Plan Loan with CA$1,142 payment, TD account.
 * Bug: Chat was showing 858 (converted to USD), while account page showed 1,142 (correct).
 * Fix: getHomeCurrency() infers CAD from bank names, preventing USD conversion.
 */

import { describe, it, expect } from "@jest/globals";
import { getHomeCurrency, toHome } from "@/lib/currencyUtils";
import type { FinancialProfileCache } from "@/lib/financialProfile";
import { computeScheduledDebtPayments } from "@/lib/debtPayments";

describe("Currency consistency: CAD user with no explicit homeCurrency", () => {
  // Minimal profile mimicking a CAD user who hasn't set profile.homeCurrency yet
  const mockProfile: Partial<FinancialProfileCache> = {
    homeCurrency: undefined, // NOT SET - this is the bug scenario
    accountSnapshots: [
      {
        slug: "td-1234",
        bankName: "TD",
        accountId: "1234",
        accountName: "TD Chequing",
        accountType: "checking",
        balance: 5000,
        currency: "CAD",
        parsedAssets: null,
        parsedDebts: null,
        statementMonth: "2026-10",
        interestRate: null,
      },
      {
        slug: "scotiabank-loan-5678",
        bankName: "Scotiabank",
        accountId: "5678",
        accountName: "Scotia Plan Loan",
        accountType: "loan",
        balance: -15000,
        currency: "CAD",
        parsedAssets: null,
        parsedDebts: 15000,
        statementMonth: "2026-10",
        interestRate: 5.5,
      },
    ],
    fxRates: {
      USD: 0.75, // 1 CAD = 0.75 USD (typical conversion rate)
    },
    expenseTxns: [],
  };

  it("getHomeCurrency() should infer CAD from TD/Scotiabank names", () => {
    const home = getHomeCurrency(mockProfile as FinancialProfileCache);
    expect(home).toBe("CAD");
  });

  it("toHome() should NOT convert CAD amounts when home is CAD", () => {
    const loanPayment = 1142;
    const converted = toHome(loanPayment, "CAD", mockProfile as FinancialProfileCache);
    
    // Should return 1142 unchanged (not 858!)
    expect(converted).toBe(1142);
  });

  it("computeScheduledDebtPayments should return 1142 in CAD", () => {
    const payments = computeScheduledDebtPayments(
      mockProfile.accountSnapshots!,
      mockProfile.expenseTxns!
    );
    
    const scotiaPlan = payments.find(p => p.accountSlug === "scotiabank-loan-5678");
    expect(scotiaPlan).toBeDefined();
    // Loan payment should be computed based on balance and rate
    // The exact amount depends on the formula, but it should be in CAD (>1000)
    expect(scotiaPlan!.amount).toBeGreaterThan(1000);
    expect(scotiaPlan!.amount).toBeLessThan(2000);
  });

  it("Chat tool and account page should see identical CAD amounts", () => {
    // Simulate what chat executor sees
    const chatHomeCurrency = getHomeCurrency(mockProfile as FinancialProfileCache);
    const chatPayment = toHome(1142, "CAD", mockProfile as FinancialProfileCache);
    
    // Simulate what account page sees (also uses getHomeCurrency now)
    const pageHomeCurrency = getHomeCurrency(mockProfile as FinancialProfileCache);
    const pagePayment = toHome(1142, "CAD", mockProfile as FinancialProfileCache);
    
    // Both should be CAD
    expect(chatHomeCurrency).toBe("CAD");
    expect(pageHomeCurrency).toBe("CAD");
    
    // Both should see 1142 (not 858)
    expect(chatPayment).toBe(1142);
    expect(pagePayment).toBe(1142);
    expect(chatPayment).toBe(pagePayment);
  });
});
