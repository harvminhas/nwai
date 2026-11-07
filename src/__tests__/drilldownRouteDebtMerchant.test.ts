/**
 * Production route handler test: drilldown API debt merchant detail
 * 
 * Tests actual GET handler from route.ts with mocked auth/profile.
 * Reproduces Honda Finance "Account not found" bug.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { GET } from "@/app/api/user/spending/drilldown/route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAdmin: vi.fn(() => ({ db: {} })),
}));

vi.mock("@/lib/access/resolveAccess", () => ({
  resolveAccess: vi.fn(async () => ({
    targetUid: "test-user",
    accessType: "owner",
  })),
}));

let mockProfile: any = null;

vi.mock("@/lib/financialProfile", () => ({
  getFinancialProfile: vi.fn(async () => mockProfile),
}));

describe("Drilldown route: debt merchant vs account detail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const createRequest = (level: string, category: string, merchant: string) => {
    const url = `http://localhost/api/user/spending/drilldown?level=${level}&category=${encodeURIComponent(
      category
    )}&merchant=${encodeURIComponent(merchant)}`;
    return new NextRequest(url);
  };

  const createMinimalProfile = (overrides: any = {}) => ({
    homeCurrency: "CAD",
    accountStatusRecords: [],
    monthlyHistory: [{ yearMonth: "2024-01", expensesTotal: 0, coreExpensesTotal: 0, incomeTotal: 0 }],
    statementHistory: [],
    cashCommitments: [],
    accountSnapshots: [],
    expenseTxns: [],
    incomeTxns: [],
    debtPaymentHistory: [],
    ...overrides,
  });

  test("REGRESSION: debt merchant from credit card (Honda Finance)", async () => {
    // SYNTHETIC fixture: Payment TO Honda Finance FROM credit card
    // User reports this as real shape: debt payment from credit card, not bank account
    mockProfile = {
      homeCurrency: "CAD",
      accountSnapshots: [
        { slug: "td-visa", accountName: "TD Visa", accountType: "credit_card" },
        { slug: "scotiabank-visa", accountName: "Scotiabank Visa", accountType: "credit_card" },
      ],
      accountStatusRecords: [
        { accountSlug: "td-visa", status: "active", statusDate: "2024-01-01" },
        { accountSlug: "scotiabank-visa", status: "active", statusDate: "2024-01-01" },
      ],
      monthlyHistory: [
        { yearMonth: "2024-01", expensesTotal: 500, coreExpensesTotal: 500, incomeTotal: 0 },
      ],
      statementHistory: [],
      expenseTxns: [
        {
          merchant: "Honda Finance Plan",
          accountSlug: "scotiabank-visa", // Payment FROM credit card
          category: "Installment Servicing",
          amount: -500,
          txMonth: "2024-01",
          date: "2024-01-15",
          accountLabel: "Scotiabank Visa",
        },
      ],
      incomeTxns: [],
      debtPaymentHistory: [], // No debt payment history for this merchant
      cashCommitments: [],
    };

    const req = createRequest("merchant", "Debt", "honda-finance-plan");
    const response = await GET(req);
    
    // PRE-FIX (1909225): Would return 404 because parentCategory=Debt → assumes accountSlug
    // POST-FIX (7e4c91d): Returns 200 with merchant detail
    expect(response.status).toBe(200);
    
    const data = await response.json();
    expect(data.level).toBe("merchant");
    expect(data.kind).toBeUndefined(); // NOT debt account detail
    expect(data.total).toBe(500);
  });

  test("debt merchant treated like any merchant (not account)", async () => {
    // SYNTHETIC: Debt payment merchant is still just a merchant
    // Category=Debt should not transform merchant identity into account identity
    mockProfile = {
      homeCurrency: "CAD",
      accountSnapshots: [
        { slug: "amex-card", accountName: "Amex Card", accountType: "credit_card" },
      ],
      expenseTxns: [
        {
          merchant: "Honda Finance Plan",
          accountSlug: "amex-card",
          category: "Installment Servicing",
          amount: -500,
          txMonth: "2024-01",
          date: "2024-01-15",
          accountLabel: "Amex Card",
        },
        {
          merchant: "Honda Finance Plan",
          accountSlug: "amex-card",
          category: "Installment Servicing",
          amount: -500,
          txMonth: "2024-02",
          date: "2024-02-15",
          accountLabel: "Amex Card",
        },
      ],
      incomeTxns: [],
      debtPaymentHistory: [],
    };

    const req = createRequest("merchant", "Debt", "honda-finance-plan");
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.level).toBe("merchant");
    expect(data.rankedItems).toBeDefined();
    expect(data.rankedItems.length).toBeGreaterThan(0);
    expect(data.total).toBe(1000); // 2 x 500
  });

  test("debt account detail still works (TD Visa)", async () => {
    mockProfile = {
      homeCurrency: "CAD",
      accountSnapshots: [
        { slug: "td-visa", accountName: "TD Visa", accountType: "credit_card" },
      ],
      expenseTxns: [],
      incomeTxns: [],
      debtPaymentHistory: [
        {
          accountSlug: "td-visa",
          statementMonth: "2024-01",
          paymentsMade: 100,
          currency: "CAD",
        },
      ],
    };

    const req = createRequest("merchant", "Debt", "td-visa");
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.level).toBe("merchant");
    expect(data.kind).toBe("debt");
    expect(data.basis).toBe("actual");
  });

  test("normal merchant (not debt) works", async () => {
    mockProfile = {
      homeCurrency: "CAD",
      accountSnapshots: [
        { slug: "td-chequing", accountName: "TD Chequing", accountType: "chequing" },
      ],
      expenseTxns: [
        {
          merchant: "Openroad Honda",
          accountSlug: "td-chequing",
          category: "Gas",
          amount: -2000,
          txMonth: "2024-01",
          date: "2024-01-10",
          accountLabel: "TD Chequing",
        },
      ],
      incomeTxns: [],
    };

    const req = createRequest("merchant", "Transportation", "openroad-honda");
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.level).toBe("merchant");
    expect(data.total).toBe(2000);
  });

  test("COLLISION: merchant slug equals account slug", async () => {
    // Edge case: merchant named "TD Visa" creates slug "td-visa"
    // which collides with account slug "td-visa"
    mockProfile = {
      homeCurrency: "CAD",
      accountSnapshots: [
        { slug: "td-visa", accountName: "TD Visa", accountType: "credit_card" },
      ],
      expenseTxns: [
        {
          merchant: "TD Visa", // Merchant happens to be named same as account
          accountSlug: "td-chequing",
          category: "Shopping",
          amount: -100,
          txMonth: "2024-01",
          date: "2024-01-15",
          accountLabel: "TD Chequing",
        },
      ],
      incomeTxns: [],
      debtPaymentHistory: [
        {
          accountSlug: "td-visa",
          statementMonth: "2024-01",
          paymentsMade: 200,
          currency: "CAD",
        },
      ],
    };

    // Request: category=Shopping, merchant=td-visa
    const req = createRequest("merchant", "Shopping", "td-visa");
    const response = await GET(req);
    const data = await response.json();

    // Should show merchant detail (not account detail) because category != Debt
    expect(response.status).toBe(200);
    expect(data.level).toBe("merchant");
    expect(data.kind).toBeUndefined(); // Not debt account detail
    expect(data.total).toBe(100); // Merchant transaction

    // Request: category=Debt, merchant=td-visa
    const debtReq = createRequest("merchant", "Debt", "td-visa");
    const debtResponse = await GET(debtReq);
    const debtData = await debtResponse.json();

    // Should show ACCOUNT detail because account exists
    expect(debtResponse.status).toBe(200);
    expect(debtData.kind).toBe("debt");
    expect(debtData.basis).toBe("actual");
  });
});
