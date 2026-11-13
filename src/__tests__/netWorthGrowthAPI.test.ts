/**
 * GET /api/user/net-worth-growth — income classification prefs must be
 * loaded the same way incomeTotal is, so a rule-marked transfer deposit
 * (no TFR-style descriptor) is not stripped from income twice.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/user/net-worth-growth/route";
import * as financialProfile from "../lib/financialProfile";

const { mockDb } = vi.hoisted(() => ({
  mockDb: {
    doc: vi.fn(),
    collection: vi.fn(),
  },
}));

vi.mock("../lib/firebase-admin", () => ({
  getFirebaseAdmin: vi.fn(() => ({ db: mockDb })),
}));

vi.mock("../lib/access/resolveAccess", () => ({
  resolveAccess: vi.fn(() => Promise.resolve({ targetUid: "test-uid" })),
}));

vi.mock("../lib/financialProfile");

const mockGetFinancialProfile = vi.mocked(financialProfile.getFinancialProfile);

function monthEntry(partial: {
  yearMonth: string;
  netWorth: number;
  incomeTotal?: number;
  coreExpensesTotal?: number;
  byAccount: Array<{ slug: string; label: string; type: string; value: number }>;
}) {
  return {
    expensesTotal: 0,
    coreExpensesTotal: 0,
    incomeTotal: 0,
    incomeTotalAllCredits: 0,
    debtPaymentsTotal: 0,
    cardServicingPaymentsTotal: 0,
    minDebtPaymentsTotal: 0,
    totalAssets: Math.max(0, partial.netWorth),
    totalDebts: 0,
    ...partial,
  };
}

describe("GET /api/user/net-worth-growth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.doc.mockImplementation(() => ({
      get: async () => ({ exists: false, data: () => undefined }),
    }));
    mockDb.collection.mockImplementation(() => ({
      get: async () => ({ docs: [] }),
    }));
  });

  it("passes saved Transfer income rules so a non-TFR deposit is not stripped twice", async () => {
    mockDb.doc.mockImplementation((path: string) => ({
      get: async () => ({
        exists: path.includes("transferIncomeSources"),
        data: () => (path.includes("transferIncomeSources") ? { keys: [] } : undefined),
      }),
    }));
    mockDb.collection.mockImplementation((path: string) => ({
      get: async () => ({
        docs: path.includes("incomeCategoryRules")
          ? [{ data: () => ({ slug: "contribution", category: "Transfer" }) }]
          : [],
      }),
    }));

    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        monthEntry({
          yearMonth: "2026-09",
          netWorth: 14000,
          byAccount: [
            { slug: "chk", label: "Checking", type: "checking", value: 4000 },
            { slug: "tfsa", label: "TFSA", type: "investment", value: 10000 },
          ],
        }),
        monthEntry({
          yearMonth: "2026-10",
          netWorth: 15500,
          incomeTotal: 6000,
          coreExpensesTotal: 4000,
          byAccount: [
            { slug: "chk", label: "Checking", type: "checking", value: 5000 },
            { slug: "tfsa", label: "TFSA", type: "investment", value: 10500 },
          ],
        }),
      ],
      expenseTxns: [],
      incomeTxns: [{
        txMonth: "2026-10",
        amount: 500,
        accountSlug: "tfsa",
        category: "Salary",
        source: "CONTRIBUTION",
      }],
      debtPaymentHistory: [],
      homeCurrency: "CAD",
      fxRates: {},
    } as any);

    const request = new NextRequest("http://localhost:3000/api/user/net-worth-growth", {
      headers: { authorization: "Bearer mock-token" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    const oct = data.months.find((m: { yearMonth: string }) => m.yearMonth === "2026-10");
    expect(oct.income).toBe(6000);
    expect(oct.grossSavings).toBe(2000);
    expect(mockDb.doc).toHaveBeenCalledWith("users/test-uid/prefs/transferIncomeSources");
    expect(mockDb.collection).toHaveBeenCalledWith("users/test-uid/incomeCategoryRules");
  });
});
