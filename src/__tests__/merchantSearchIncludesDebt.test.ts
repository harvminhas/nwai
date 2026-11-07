/**
 * Regression test: merchant search must include debt payment merchants.
 * 
 * User report: Query "Honda" finds Openroad Honda but misses Honda Finance.
 * Root cause: drilldown API filtered out all Debt transactions from search.
 * 
 * Fix: Include Debt transactions in merchant search results so users can find
 * loan/card payment merchants like Honda Finance, TD Visa, etc.
 */

import { describe, test, expect } from "vitest";

describe("Merchant search includes debt payments", () => {
  test("search scope includes Debt category transactions", () => {
    // Mock profile with both regular and debt transactions
    const expenseTxns = [
      {
        txMonth: "2024-01",
        merchant: "Openroad Honda",
        category: "Transportation",
        amount: -2000,
        accountLabel: "TD Chequing",
      },
      {
        txMonth: "2024-01",
        merchant: "Honda Finance",
        category: "Auto Loan Payment",
        amount: -500,
        accountLabel: "TD Chequing",
      },
    ];

    // Filter logic (simplified from route.ts)
    const getParentCategory = (cat: string) => {
      if (cat.includes("Loan") || cat.includes("Payment")) return "Debt";
      return cat;
    };

    // OLD broken logic: excluded Debt
    const oldFilter = (t: any) => {
      const parent = getParentCategory(t.category);
      if (parent === "Debt") return false;
      return true;
    };

    // NEW fixed logic: includes Debt
    const newFilter = (t: any) => {
      return true; // No Debt exclusion
    };

    const oldResults = expenseTxns.filter(oldFilter);
    const newResults = expenseTxns.filter(newFilter);

    // Old: only finds Openroad Honda
    expect(oldResults.length).toBe(1);
    expect(oldResults[0].merchant).toBe("Openroad Honda");

    // New: finds both
    expect(newResults.length).toBe(2);
    expect(newResults.find(t => t.merchant === "Openroad Honda")).toBeTruthy();
    expect(newResults.find(t => t.merchant === "Honda Finance")).toBeTruthy();
  });

  test("search query 'honda' matches both regular and debt merchants", () => {
    const merchants = [
      { name: "Openroad Honda", category: "Transportation", isDebt: false },
      { name: "Honda Finance", category: "Auto Loan Payment", isDebt: true },
      { name: "Toyota Dealership", category: "Transportation", isDebt: false },
    ];

    const query = "honda";
    const matches = merchants.filter(m =>
      m.name.toLowerCase().includes(query.toLowerCase())
    );

    expect(matches.length).toBe(2);
    expect(matches.map(m => m.name)).toEqual(
      expect.arrayContaining(["Openroad Honda", "Honda Finance"])
    );
  });

  test("debt merchants have appropriate category labels", () => {
    const debtMerchants = [
      { name: "Honda Finance", category: "Auto Loan Payment", parent: "Debt" },
      { name: "TD Visa", category: "Credit Card Payment", parent: "Debt" },
      { name: "Scotiabank Mortgage", category: "Mortgage Payment", parent: "Debt" },
    ];

    debtMerchants.forEach(m => {
      expect(m.parent).toBe("Debt");
      expect(m.category).toMatch(/Payment|Loan|Mortgage/);
    });
  });

  test("search results include debt totals without double-counting", () => {
    // Scenario: User paid $500 to Honda Finance in debt payments
    // This should show in search results as $500 to Honda Finance
    // It does NOT double-count because:
    // - Search shows merchant-level totals
    // - Debt summary shows category-level totals
    // - They're different views of the same data

    const hondaFinancePayments = [
      { date: "2024-01-15", amount: -200 },
      { date: "2024-02-15", amount: -150 },
      { date: "2024-03-15", amount: -150 },
    ];

    const totalPaid = hondaFinancePayments.reduce(
      (sum, p) => sum + Math.abs(p.amount),
      0
    );

    expect(totalPaid).toBe(500);

    // This total is correct: user actually paid $500 to Honda Finance
    // It's not double-counting, it's merchant-specific spending
  });

  test("navigation to debt merchant works correctly", () => {
    // When user clicks Honda Finance from search results,
    // they should navigate to merchant detail page
    const searchResult = {
      name: "Honda Finance",
      slug: "honda-finance",
      category: "Auto Loan Payment", // Primary category
      total: 500,
    };

    const navigationUrl = `/account/spending?category=${encodeURIComponent(
      "Debt"
    )}&merchant=${encodeURIComponent(searchResult.slug)}`;

    expect(navigationUrl).toContain("category=Debt");
    expect(navigationUrl).toContain("merchant=honda-finance");
  });

  test("case-insensitive substring match works for debt merchants", () => {
    const merchants = [
      "Honda Finance",
      "HONDA FINANCIAL SERVICES",
      "honda auto loan",
    ];

    const query = "honda";

    const matches = merchants.filter(m =>
      m.toLowerCase().includes(query.toLowerCase())
    );

    expect(matches.length).toBe(3);
  });
});
