/**
 * GET /api/user/net-worth-growth — read-only start-vs-end balances.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "../app/api/user/net-worth-growth/route";
import * as financialProfile from "../lib/financialProfile";

vi.mock("../lib/firebase-admin", () => ({
  getFirebaseAdmin: vi.fn(() => ({
    db: {
      doc: vi.fn(),
      collection: vi.fn(),
    },
  })),
}));

vi.mock("../lib/access/resolveAccess", () => ({
  resolveAccess: vi.fn(() => Promise.resolve({ targetUid: "test-uid" })),
}));

vi.mock("../lib/financialProfile");

const mockGetFinancialProfile = vi.mocked(financialProfile.getFinancialProfile);

describe("GET /api/user/net-worth-growth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns cash, investments, and debts for a month and does not write", async () => {
    mockGetFinancialProfile.mockResolvedValue({
      monthlyHistory: [
        {
          yearMonth: "2026-09",
          netWorth: 18000,
          expensesTotal: 0,
          coreExpensesTotal: 0,
          incomeTotal: 0,
          incomeTotalAllCredits: 0,
          debtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          totalAssets: 20000,
          totalDebts: 2000,
          byAccount: [
            { slug: "chk", label: "Chequing", type: "checking", value: 4000 },
            { slug: "tfsa", label: "TFSA", type: "investment", value: 16000 },
            { slug: "visa", label: "Visa", type: "credit", value: -2000 },
          ],
        },
        {
          yearMonth: "2026-10",
          netWorth: 20100,
          expensesTotal: 0,
          coreExpensesTotal: 0,
          incomeTotal: 0,
          incomeTotalAllCredits: 0,
          debtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          totalAssets: 21900,
          totalDebts: 1800,
          byAccount: [
            { slug: "chk", label: "Chequing", type: "checking", value: 5000 },
            { slug: "tfsa", label: "TFSA", type: "investment", value: 16900 },
            { slug: "visa", label: "Visa", type: "credit", value: -1800 },
          ],
        },
      ],
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-10", amount: 500, accountSlug: "tfsa" }],
      debtPaymentHistory: [],
      homeCurrency: "CAD",
      fxRates: {},
    } as never);

    const request = new NextRequest("http://localhost:3000/api/user/net-worth-growth", {
      headers: { authorization: "Bearer mock-token" },
    });
    const response = await GET(request);
    expect(response.status).toBe(200);
    const data = await response.json();
    const oct = data.months.find((m: { yearMonth: string }) => m.yearMonth === "2026-10");
    expect(oct.cash.change).toBe(1000);
    expect(oct.investments.change).toBe(900);
    expect(oct.investments.putIn).toBe(500);
    expect(oct.debts.change).toBe(-200);
    expect(oct.grossSavings).toBeUndefined();
    expect(mockGetFinancialProfile).toHaveBeenCalledWith("test-uid", expect.anything());
  });
});
