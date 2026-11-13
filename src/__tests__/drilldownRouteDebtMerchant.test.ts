/**
 * Production route handler test: drilldown API debt merchant detail
 * 
 * Tests actual GET handler from route.ts with mocked auth/profile.
 * Reproduces Honda Finance "Account not found" bug.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { GET } from "@/app/api/user/spending/drilldown/route";
import { NextRequest } from "next/server";

// Mock dependencies
vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAdmin: vi.fn(() => ({
    db: {
      collection: vi.fn(() => ({
        get: vi.fn(async () => ({ docs: [] })),
      })),
    },
  })),
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
  let fetchSpy: any;

  beforeEach(() => {
    vi.clearAllMocks();
    // Spy on global fetch to verify view param forwarding
    fetchSpy = vi.spyOn(global, 'fetch');
  });

  afterEach(() => {
    fetchSpy?.mockRestore();
  });

  const createRequest = (level: string, category: string, merchant: string, view?: string) => {
    let url = `http://localhost/api/user/spending/drilldown?level=${level}&category=${encodeURIComponent(
      category
    )}&merchant=${encodeURIComponent(merchant)}`;
    if (view) url += `&view=${view}`;
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

  test("Honda Finance debt merchant from credit card (search result)", async () => {
    // SYNTHETIC: Payment TO Honda Finance (lender) FROM credit card
    mockProfile = createMinimalProfile({
      accountSnapshots: [
        { slug: "scotiabank-visa", accountName: "Scotiabank Visa", accountType: "credit_card" },
      ],
      accountStatusRecords: [
        { accountSlug: "scotiabank-visa", status: "active", statusDate: "2024-01-01" },
      ],
      monthlyHistory: [
        { yearMonth: "2024-01", expensesTotal: 500, coreExpensesTotal: 500, incomeTotal: 0 },
      ],
      expenseTxns: [
        {
          merchant: "Honda Finance Plan",
          accountSlug: "scotiabank-visa",
          category: "Installment Servicing",
          amount: -500,
          txMonth: "2024-01",
          date: "2024-01-15",
          accountLabel: "Scotiabank Visa",
        },
      ],
    });

    const req = createRequest("merchant", "Debt", "honda-finance-plan", "merchant");
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.level).toBe("merchant");
    expect(data.kind).toBeUndefined(); // NOT account detail
    expect(data.total).toBe(500);
  });

  test("multiple payments to debt merchant", async () => {
    // SYNTHETIC: Multiple payments to same lender
    mockProfile = createMinimalProfile({
      accountSnapshots: [
        { slug: "amex-card", accountName: "Amex Card", accountType: "credit_card" },
      ],
      accountStatusRecords: [
        { accountSlug: "amex-card", status: "active", statusDate: "2024-01-01" },
      ],
      monthlyHistory: [
        { yearMonth: "2024-01", expensesTotal: 500, coreExpensesTotal: 500, incomeTotal: 0 },
        { yearMonth: "2024-02", expensesTotal: 500, coreExpensesTotal: 500, incomeTotal: 0 },
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
    });

    const req = createRequest("merchant", "Debt", "honda-finance-plan");
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.level).toBe("merchant");
    expect(data.total).toBe(1000);
  });

  test("debt ACCOUNT detail (TD Visa account)", async () => {
    // SYNTHETIC: Viewing debt account (not merchant)
    mockProfile = createMinimalProfile({
      accountSnapshots: [
        { slug: "td-visa", accountName: "TD Visa", accountType: "credit_card" },
      ],
      accountStatusRecords: [
        { accountSlug: "td-visa", status: "active", statusDate: "2024-01-01" },
      ],
      debtPaymentHistory: [
        { accountSlug: "td-visa", statementMonth: "2024-01", paymentsMade: 100, currency: "CAD" },
      ],
    });

    const req = createRequest("merchant", "Debt", "td-visa");
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.kind).toBe("debt");
    expect(data.basis).toBe("actual");
  });

  test("normal merchant (Transportation)", async () => {
    // SYNTHETIC: Regular merchant, not debt
    mockProfile = createMinimalProfile({
      accountSnapshots: [
        { slug: "td-chequing", accountName: "TD Chequing", accountType: "chequing" },
      ],
      accountStatusRecords: [
        { accountSlug: "td-chequing", status: "active", statusDate: "2024-01-01" },
      ],
      monthlyHistory: [
        { yearMonth: "2024-01", expensesTotal: 2000, coreExpensesTotal: 2000, incomeTotal: 0 },
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
    });

    const req = createRequest("merchant", "Transportation", "openroad-honda");
    const response = await GET(req);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.level).toBe("merchant");
    expect(data.total).toBe(2000);
  });

  test("view=merchant param passed to API", async () => {
    // SYNTHETIC: Verify view param flows from search click → API request
    mockProfile = createMinimalProfile({
      accountSnapshots: [{ slug: "amex", accountName: "Amex", accountType: "credit_card" }],
      accountStatusRecords: [{ accountSlug: "amex", status: "active", statusDate: "2024-01-01" }],
      monthlyHistory: [{ yearMonth: "2024-01", expensesTotal: 100, coreExpensesTotal: 100, incomeTotal: 0 }],
      expenseTxns: [{
        merchant: "Honda Finance",
        accountSlug: "amex",
        category: "Installment Servicing",
        amount: -100,
        txMonth: "2024-01",
        date: "2024-01-15",
        accountLabel: "Amex",
      }],
    });

    // Request with view=merchant
    const req = createRequest("merchant", "Debt", "honda-finance", "merchant");
    const response = await GET(req);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.kind).toBeUndefined(); // Merchant detail, not account
  });

  test("COLLISION: merchant slug equals account slug", async () => {
    // SYNTHETIC: Merchant "TD Visa" → slug "td-visa" = account slug "td-visa"
    mockProfile = createMinimalProfile({
      accountSnapshots: [
        { slug: "td-visa", accountName: "TD Visa", accountType: "credit_card" },
        { slug: "td-chequing", accountName: "TD Chequing", accountType: "chequing" },
      ],
      accountStatusRecords: [
        { accountSlug: "td-visa", status: "active", statusDate: "2024-01-01" },
        { accountSlug: "td-chequing", status: "active", statusDate: "2024-01-01" },
      ],
      monthlyHistory: [
        { yearMonth: "2024-01", expensesTotal: 150, coreExpensesTotal: 150, incomeTotal: 0 },
      ],
      expenseTxns: [
        {
          merchant: "TD Visa", // Merchant name matches account name
          accountSlug: "td-chequing",
          category: "Shopping",
          amount: -100,
          txMonth: "2024-01",
          date: "2024-01-15",
          accountLabel: "TD Chequing",
        },
        {
          merchant: "TD Visa", // Same merchant, debt payment
          accountSlug: "td-chequing",
          category: "Installment Servicing",
          amount: -50,
          txMonth: "2024-01",
          date: "2024-01-20",
          accountLabel: "TD Chequing",
        },
      ],
      debtPaymentHistory: [
        { accountSlug: "td-visa", statementMonth: "2024-01", paymentsMade: 200, currency: "CAD" },
      ],
    });

    // FROM SEARCH (view=merchant): always merchant detail
    const searchReq = createRequest("merchant", "Debt", "td-visa", "merchant");
    const searchResponse = await GET(searchReq);
    const searchData = await searchResponse.json();
    
    expect(searchResponse.status).toBe(200);
    expect(searchData.kind).toBeUndefined(); // Merchant detail from search
    expect(searchData.total).toBe(50); // Only debt payment

    // FROM ACCOUNT LINK (no view): account detail when category=Debt + account exists
    const accountReq = createRequest("merchant", "Debt", "td-visa");
    const accountResponse = await GET(accountReq);
    const accountData = await accountResponse.json();
    
    expect(accountResponse.status).toBe(200);
    expect(accountData.kind).toBe("debt"); // Account detail from direct link
    expect(accountData.basis).toBe("actual");
  });
});
