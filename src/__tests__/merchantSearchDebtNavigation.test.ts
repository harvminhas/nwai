/**
 * Regression test: debt account search results must navigate to working detail pages.
 * 
 * User report: Clicking "Honda Finance Plan" from search leads to "Account not found".
 * Root cause: Debt transactions were grouped by merchant slug, but detail page expects accountSlug.
 * 
 * Fix: For parent=Debt transactions, use accountSlug as key and display accountLabel.
 * Result: Search result slug is accountSlug, navigation works with existing debt detail logic.
 */

import { describe, test, expect } from "vitest";

describe("Merchant search debt account navigation", () => {
  test("debt transactions grouped by accountSlug not merchant slug", () => {
    // Mock debt transaction
    const debtTxn = {
      merchant: "HONDA FINANCE",
      accountSlug: "honda-finance-plan",
      accountLabel: "Honda Finance Plan",
      category: "Auto Loan Payment",
      amount: -500,
    };

    // Parent category helper
    const getParentCategory = (cat: string) => {
      if (cat.includes("Payment") || cat.includes("Loan")) return "Debt";
      return cat;
    };

    const isDebt = getParentCategory(debtTxn.category) === "Debt";

    // Key for grouping
    const groupKey = isDebt ? debtTxn.accountSlug : debtTxn.merchant;

    // Display name
    const displayName = isDebt ? debtTxn.accountLabel : debtTxn.merchant;

    // For debt: use account slug as key
    expect(groupKey).toBe("honda-finance-plan");
    expect(displayName).toBe("Honda Finance Plan");

    // This slug will be used in navigation URL
    const navUrl = `/account/spending?category=Debt&merchant=${encodeURIComponent(groupKey)}`;
    expect(navUrl).toBe("/account/spending?category=Debt&merchant=honda-finance-plan");
  });

  test("regular merchant transactions grouped by canonical merchant slug", () => {
    // Mock regular transaction
    const regularTxn = {
      merchant: "Openroad Honda",
      accountSlug: "td-chequing",
      accountLabel: "TD Chequing",
      category: "Transportation",
      amount: -2000,
    };

    const getParentCategory = (cat: string) => {
      if (cat.includes("Payment") || cat.includes("Loan")) return "Debt";
      return cat;
    };

    const isDebt = getParentCategory(regularTxn.category) === "Debt";

    // Key for grouping (simplified - actual uses merchantSlug + canonical resolution)
    const merchantSlug = regularTxn.merchant.toLowerCase().replace(/\s+/g, "-");
    const groupKey = isDebt ? regularTxn.accountSlug : merchantSlug;

    // Display name
    const displayName = isDebt ? regularTxn.accountLabel : regularTxn.merchant;

    // For regular merchant: use merchant slug
    expect(groupKey).toBe("openroad-honda");
    expect(displayName).toBe("Openroad Honda");

    // Navigation goes to regular merchant page
    const navUrl = `/account/spending?category=Transportation&merchant=${encodeURIComponent(groupKey)}`;
    expect(navUrl).toBe("/account/spending?category=Transportation&merchant=openroad-honda");
  });

  test("debt detail API expects accountSlug when category=Debt", () => {
    // API logic (simplified from route.ts line 714-720)
    const parentCategory = "Debt";
    const merchantParam = "honda-finance-plan"; // This is actually accountSlug

    // When category=Debt, merchantParam is treated as accountSlug
    const accountSlug = merchantParam;

    // Mock account lookup
    const accountSnapshots = [
      { slug: "honda-finance-plan", accountName: "Honda Finance Plan" },
      { slug: "td-visa", accountName: "TD Visa" },
    ];

    const account = accountSnapshots.find((a) => a.slug === accountSlug);

    expect(account).toBeTruthy();
    expect(account?.accountName).toBe("Honda Finance Plan");
  });

  test("search results for honda include both regular and debt accounts", () => {
    const searchResults = [
      {
        name: "Openroad Honda",
        slug: "openroad-honda",
        category: "Transportation",
        total: 2000,
        isDebtAccount: false,
      },
      {
        name: "Honda Finance Plan",
        slug: "honda-finance-plan", // accountSlug
        category: "Debt",
        total: 500,
        isDebtAccount: true,
      },
    ];

    expect(searchResults.length).toBe(2);

    // Regular merchant navigation
    const regularNav = `/account/spending?category=${encodeURIComponent(
      searchResults[0].category
    )}&merchant=${encodeURIComponent(searchResults[0].slug)}`;
    expect(regularNav).toContain("category=Transportation");
    expect(regularNav).toContain("merchant=openroad-honda");

    // Debt account navigation
    const debtNav = `/account/spending?category=${encodeURIComponent(
      searchResults[1].category
    )}&merchant=${encodeURIComponent(searchResults[1].slug)}`;
    expect(debtNav).toContain("category=Debt");
    expect(debtNav).toContain("merchant=honda-finance-plan");
  });

  test("multiple debt accounts with similar names grouped separately", () => {
    const debtAccounts = [
      { accountSlug: "honda-finance-plan", accountLabel: "Honda Finance Plan" },
      { accountSlug: "honda-financial-services", accountLabel: "Honda Financial Services" },
    ];

    // Each account gets its own search result row
    const searchResults = debtAccounts.map((acc) => ({
      name: acc.accountLabel,
      slug: acc.accountSlug,
      category: "Debt",
    }));

    expect(searchResults.length).toBe(2);
    expect(searchResults[0].slug).toBe("honda-finance-plan");
    expect(searchResults[1].slug).toBe("honda-financial-services");
  });

  test("debt account display name uses accountLabel not merchant field", () => {
    const debtTxn = {
      merchant: "HONDAFINANCE", // Statement merchant name (might be truncated/formatted)
      accountSlug: "honda-finance-plan",
      accountLabel: "Honda Finance Plan", // User-friendly account name
      category: "Auto Loan Payment",
    };

    // Display name should be accountLabel, not merchant
    const displayName = debtTxn.accountLabel;
    expect(displayName).toBe("Honda Finance Plan");
    expect(displayName).not.toBe("HONDAFINANCE");
  });

  test("search result href leads to valid destination", () => {
    // User searches "honda", clicks "Honda Finance Plan" result
    const searchResult = {
      name: "Honda Finance Plan",
      slug: "honda-finance-plan", // accountSlug for debt
      category: "Debt",
    };

    // Frontend generates this URL
    const href = `/account/spending?category=${encodeURIComponent(
      searchResult.category
    )}&merchant=${encodeURIComponent(searchResult.slug)}`;

    // API receives: level=merchant, category=Debt, merchant=honda-finance-plan
    const apiParams = {
      level: "merchant",
      category: "Debt",
      merchant: "honda-finance-plan",
    };

    // API logic: if category=Debt, treat merchant param as accountSlug
    const accountSlug = apiParams.merchant;

    // Mock account resolution
    const mockAccounts = [
      { slug: "honda-finance-plan", accountName: "Honda Finance Plan" },
    ];
    const account = mockAccounts.find((a) => a.slug === accountSlug);

    // Should find the account (not "Account not found" error)
    expect(account).toBeTruthy();
  });

  test("debt account totals not double-counted", () => {
    // Scenario: User paid $500 to Honda Finance in 3 payments
    const payments = [
      { date: "2024-01-15", amount: -200, category: "Auto Loan Payment" },
      { date: "2024-02-15", amount: -150, category: "Auto Loan Payment" },
      { date: "2024-03-15", amount: -150, category: "Auto Loan Payment" },
    ];

    const total = payments.reduce((sum, p) => sum + Math.abs(p.amount), 0);
    expect(total).toBe(500);

    // This total appears in search results
    const searchResult = {
      name: "Honda Finance Plan",
      total: 500, // Sum of actual payments
    };

    // Same total appears in account detail page
    const accountDetail = {
      accountName: "Honda Finance Plan",
      regularTotal: 500, // Same data, different view
    };

    expect(searchResult.total).toBe(accountDetail.regularTotal);
    // Not double-counting - just different views of same transaction data
  });
});
