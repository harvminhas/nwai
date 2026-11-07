/**
 * Test asset valuation net worth changes with PRODUCTION code paths.
 * Tests the actual generateNetWorthChanges function with mocked Firebase.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import type { FinancialProfileCache } from "../financialProfile";

// Mock Firestore
const mockBatch = {
  set: vi.fn(),
  commit: vi.fn(async () => {}),
};

const mockCollection = {
  get: vi.fn(async () => ({ docs: [] })),
  doc: vi.fn(() => mockCollection),
  listDocuments: vi.fn(async () => []),
};

const mockDb = {
  collection: vi.fn(() => mockCollection),
  doc: vi.fn(() => mockCollection),
  batch: vi.fn(() => mockBatch),
};

vi.mock("../financialProfile", () => ({
  getFinancialProfile: vi.fn(),
}));

describe("Asset Valuation Net Worth Changes - Production", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCollection.get.mockResolvedValue({ docs: [] });
  });

  test("Oct value 31000, Nov edit 29000: Oct new_asset shows 31000, Nov shows -2000 delta", async () => {
    const { getFinancialProfile } = await import("../financialProfile");
    const { generateNetWorthChanges } = await import("../netWorthChanges");
    
    const profile: FinancialProfileCache = {
      currency: "USD",
      monthlyHistory: [
        {
          yearMonth: "2026-10",
          netWorth: 31000,
          totalAssets: 31000,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Honda Civic", type: "manual-vehicle", value: 31000 }
          ],
        },
        {
          yearMonth: "2026-11",
          netWorth: 29000,
          totalAssets: 29000,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Honda Civic", type: "manual-vehicle", value: 29000 }
          ],
        },
      ],
      accountBalanceHistory: [],
      accountStatusRecords: [],
      manualAssets: [
        {
          id: "car-1",
          label: "Honda Civic",
          category: "vehicle",
          value: 29000,
          startDate: "2026-10-15",
          updatedAt: "2026-11-10T12:00:00Z",
          valuations: [
            { id: "val1", effectiveDate: "2026-10-15", valueCents: 3100000, createdAt: "2026-10-15T10:00:00Z" },
            { id: "val2", effectiveDate: "2026-11-10", valueCents: 2900000, createdAt: "2026-11-10T12:00:00Z" },
          ],
        },
      ],
      expenseTxns: [],
      categorizedTxns: [],
      recurringCharges: [],
      confirmedSubscriptions: [],
      statementHistory: [],
      hasMultiCurrency: false,
      missingMonthCoverage: [],
      fxToHome: (v: number) => v,
      schemaVersion: 3,
      cachedAt: new Date().toISOString(),
      homeCurrency: "USD",
    } as any;

    vi.mocked(getFinancialProfile).mockResolvedValue(profile);

    await generateNetWorthChanges("test-uid", mockDb as any);

    // Verify batch writes
    expect(mockBatch.set).toHaveBeenCalled();
    const writes = mockBatch.set.mock.calls;

    // Find Oct and Nov summaries
    const octWrite = writes.find((call: any) => call[1].month === "2026-10");
    const novWrite = writes.find((call: any) => call[1].month === "2026-11");

    expect(octWrite).toBeDefined();
    expect(novWrite).toBeDefined();

    const octItems = octWrite[1].items;
    const novItems = novWrite[1].items;

    // Oct: should have new_asset with 31000 (not 29000)
    const octNewAsset = octItems.find((item: any) => 
      item.type === "new_asset" && item.accountSlug === "manual-car-1"
    );
    expect(octNewAsset).toBeDefined();
    expect(octNewAsset.netWorthImpact).toBe(31000);
    expect(octNewAsset.currentBalance).toBe(31000);

    // Nov: should have balance_decrease with -2000
    const novChange = novItems.find((item: any) => 
      item.accountSlug === "manual-car-1" && 
      (item.type === "balance_decrease" || item.type === "balance_increase")
    );
    expect(novChange).toBeDefined();
    expect(novChange.type).toBe("balance_decrease");
    expect(novChange.netWorthImpact).toBe(-2000);
    expect(novChange.previousBalance).toBe(31000);
    expect(novChange.currentBalance).toBe(29000);

    // Nov: should NOT have another new_asset event
    const novNewAsset = novItems.find((item: any) => 
      item.type === "new_asset" && item.accountSlug === "manual-car-1"
    );
    expect(novNewAsset).toBeUndefined();
  });

  test("legacy asset without startDate shows in all months with correct values", async () => {
    const { getFinancialProfile } = await import("../financialProfile");
    const { generateNetWorthChanges } = await import("../netWorthChanges");
    
    const profile: FinancialProfileCache = {
      currency: "USD",
      monthlyHistory: [
        {
          yearMonth: "2026-10",
          netWorth: 31000,
          totalAssets: 31000,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Old Car", type: "manual-vehicle", value: 31000 }
          ],
        },
        {
          yearMonth: "2026-11",
          netWorth: 29000,
          totalAssets: 29000,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Old Car", type: "manual-vehicle", value: 29000 }
          ],
        },
      ],
      accountBalanceHistory: [],
      accountStatusRecords: [],
      manualAssets: [
        {
          id: "car-1",
          label: "Old Car",
          category: "vehicle",
          value: 29000,
          // No startDate - legacy asset
          updatedAt: "2026-09-01T00:00:00Z",
          valuations: [
            // First edit added baseline + new value
            { id: "val1", effectiveDate: "2026-10-01", valueCents: 3100000, createdAt: "2026-10-01T00:00:00Z" },
            { id: "val2", effectiveDate: "2026-11-10", valueCents: 2900000, createdAt: "2026-11-10T12:00:00Z" },
          ],
        },
      ],
      expenseTxns: [],
      categorizedTxns: [],
      recurringCharges: [],
      confirmedSubscriptions: [],
      statementHistory: [],
      hasMultiCurrency: false,
      missingMonthCoverage: [],
      fxToHome: (v: number) => v,
      schemaVersion: 3,
      cachedAt: new Date().toISOString(),
      homeCurrency: "USD",
    } as any;

    vi.mocked(getFinancialProfile).mockResolvedValue(profile);

    await generateNetWorthChanges("test-uid", mockDb as any);

    const writes = mockBatch.set.mock.calls;

    // Oct: should show new_asset with 31000 (baseline value)
    const octWrite = writes.find((call: any) => call[1].month === "2026-10");
    expect(octWrite).toBeDefined();
    
    const octNewAsset = octWrite[1].items.find((item: any) => 
      item.type === "new_asset" && item.accountSlug === "manual-car-1"
    );
    expect(octNewAsset).toBeDefined();
    expect(octNewAsset.netWorthImpact).toBe(31000); // Baseline value, NOT current 29000

    // Nov: should show decrease of -2000
    const novWrite = writes.find((call: any) => call[1].month === "2026-11");
    const novChange = novWrite[1].items.find((item: any) => 
      item.accountSlug === "manual-car-1" && item.type === "balance_decrease"
    );
    expect(novChange).toBeDefined();
    expect(novChange.netWorthImpact).toBe(-2000);
  });

  test("multiple valuations in same month: latest effective value wins", async () => {
    const { getFinancialProfile } = await import("../financialProfile");
    const { generateNetWorthChanges } = await import("../netWorthChanges");
    
    const profile: FinancialProfileCache = {
      currency: "USD",
      monthlyHistory: [
        {
          yearMonth: "2026-11",
          netWorth: 28500,
          totalAssets: 28500,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Car", type: "manual-vehicle", value: 28500 }
          ],
        },
      ],
      accountBalanceHistory: [],
      accountStatusRecords: [],
      manualAssets: [
        {
          id: "car-1",
          label: "Car",
          category: "vehicle",
          value: 28500,
          startDate: "2026-11-01",
          updatedAt: "2026-11-15T14:00:00Z",
          valuations: [
            // Multiple edits same day, ordered by createdAt
            { id: "val1", effectiveDate: "2026-11-15", valueCents: 3000000, createdAt: "2026-11-15T10:00:00.000Z" },
            { id: "val2", effectiveDate: "2026-11-15", valueCents: 2900000, createdAt: "2026-11-15T12:00:00.000Z" },
            { id: "val3", effectiveDate: "2026-11-15", valueCents: 2850000, createdAt: "2026-11-15T14:00:00.000Z" },
          ],
        },
      ],
      expenseTxns: [],
      categorizedTxns: [],
      recurringCharges: [],
      confirmedSubscriptions: [],
      statementHistory: [],
      hasMultiCurrency: false,
      missingMonthCoverage: [],
      fxToHome: (v: number) => v,
      schemaVersion: 3,
      cachedAt: new Date().toISOString(),
      homeCurrency: "USD",
    } as any;

    vi.mocked(getFinancialProfile).mockResolvedValue(profile);

    await generateNetWorthChanges("test-uid", mockDb as any);

    const writes = mockBatch.set.mock.calls;
    const novWrite = writes.find((call: any) => call[1].month === "2026-11");
    
    const novNewAsset = novWrite[1].items.find((item: any) => 
      item.type === "new_asset" && item.accountSlug === "manual-car-1"
    );
    
    // Should use the latest valuation by createdAt for same-day entries
    expect(novNewAsset.netWorthImpact).toBe(28500);
  });

  test("valuation cents precision preserved (no rounding errors)", async () => {
    const { getFinancialProfile } = await import("../financialProfile");
    const { generateNetWorthChanges } = await import("../netWorthChanges");
    
    const profile: FinancialProfileCache = {
      currency: "USD",
      monthlyHistory: [
        {
          yearMonth: "2026-10",
          netWorth: 24999.99,
          totalAssets: 24999.99,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Car", type: "manual-vehicle", value: 24999.99 }
          ],
        },
        {
          yearMonth: "2026-11",
          netWorth: 24500.50,
          totalAssets: 24500.50,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Car", type: "manual-vehicle", value: 24500.50 }
          ],
        },
      ],
      accountBalanceHistory: [],
      accountStatusRecords: [],
      manualAssets: [
        {
          id: "car-1",
          label: "Car",
          category: "vehicle",
          value: 24500.50,
          startDate: "2026-10-15",
          updatedAt: "2026-11-10T12:00:00Z",
          valuations: [
            { id: "val1", effectiveDate: "2026-10-15", valueCents: 2499999, createdAt: "2026-10-15T10:00:00Z" },
            { id: "val2", effectiveDate: "2026-11-10", valueCents: 2450050, createdAt: "2026-11-10T12:00:00Z" },
          ],
        },
      ],
      expenseTxns: [],
      categorizedTxns: [],
      recurringCharges: [],
      confirmedSubscriptions: [],
      statementHistory: [],
      hasMultiCurrency: false,
      missingMonthCoverage: [],
      fxToHome: (v: number) => v,
      schemaVersion: 3,
      cachedAt: new Date().toISOString(),
      homeCurrency: "USD",
    } as any;

    vi.mocked(getFinancialProfile).mockResolvedValue(profile);

    await generateNetWorthChanges("test-uid", mockDb as any);

    const writes = mockBatch.set.mock.calls;
    
    const octWrite = writes.find((call: any) => call[1].month === "2026-10");
    const novWrite = writes.find((call: any) => call[1].month === "2026-11");
    
    const octNewAsset = octWrite[1].items.find((item: any) => item.type === "new_asset");
    const novChange = novWrite[1].items.find((item: any) => item.type === "balance_decrease");
    
    // Exact cents preserved
    expect(octNewAsset.netWorthImpact).toBeCloseTo(24999.99, 2);
    expect(novChange.netWorthImpact).toBeCloseTo(-499.49, 2);
    expect(novChange.previousBalance).toBeCloseTo(24999.99, 2);
    expect(novChange.currentBalance).toBeCloseTo(24500.50, 2);
  });

  test("legacy no-startDate with Sept/Oct/Nov: retains Sept 31000, Oct 31000, Nov edit 29000", async () => {
    const { getFinancialProfile } = await import("../financialProfile");
    const { generateNetWorthChanges } = await import("../netWorthChanges");
    
    const profile: FinancialProfileCache = {
      currency: "USD",
      monthlyHistory: [
        {
          yearMonth: "2026-09",
          netWorth: 31000,
          totalAssets: 31000,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Old Car", type: "manual-vehicle", value: 31000 }
          ],
        },
        {
          yearMonth: "2026-10",
          netWorth: 31000,
          totalAssets: 31000,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Old Car", type: "manual-vehicle", value: 31000 }
          ],
        },
        {
          yearMonth: "2026-11",
          netWorth: 29000,
          totalAssets: 29000,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-car-1", label: "Old Car", type: "manual-vehicle", value: 29000 }
          ],
        },
      ],
      accountBalanceHistory: [],
      accountStatusRecords: [],
      manualAssets: [
        {
          id: "car-1",
          label: "Old Car",
          category: "vehicle",
          value: 29000,
          // No startDate - legacy asset
          updatedAt: "2026-11-10T12:00:00Z",
          valuations: [
            // First edit preserved baseline + new value
            { id: "val1", effectiveDate: "2026-10-01", valueCents: 3100000, createdAt: "2026-10-01T00:00:00Z" },
            { id: "val2", effectiveDate: "2026-11-10", valueCents: 2900000, createdAt: "2026-11-10T12:00:00Z" },
          ],
        },
      ],
      expenseTxns: [],
      categorizedTxns: [],
      recurringCharges: [],
      confirmedSubscriptions: [],
      statementHistory: [],
      hasMultiCurrency: false,
      missingMonthCoverage: [],
      fxToHome: (v: number) => v,
      schemaVersion: 3,
      cachedAt: new Date().toISOString(),
      homeCurrency: "USD",
    } as any;

    vi.mocked(getFinancialProfile).mockResolvedValue(profile);

    await generateNetWorthChanges("test-uid", mockDb as any);

    const writes = mockBatch.set.mock.calls;

    // Sept: should show new_asset with 31000 (legacy behavior - active in all months)
    const septWrite = writes.find((call: any) => call[1].month === "2026-09");
    expect(septWrite).toBeDefined();
    const septNewAsset = septWrite[1].items.find((item: any) => 
      item.type === "new_asset" && item.accountSlug === "manual-car-1"
    );
    expect(septNewAsset).toBeDefined();
    expect(septNewAsset.netWorthImpact).toBe(31000); // Sept uses Oct baseline valuation

    // Oct: no change event (value stayed at 31000)
    const octWrite = writes.find((call: any) => call[1].month === "2026-10");
    const octChange = octWrite[1].items.find((item: any) => 
      item.accountSlug === "manual-car-1" && 
      (item.type === "balance_decrease" || item.type === "balance_increase")
    );
    expect(octChange).toBeUndefined(); // No change in Oct

    // Nov: decrease of -2000
    const novWrite = writes.find((call: any) => call[1].month === "2026-11");
    const novChange = novWrite[1].items.find((item: any) => 
      item.accountSlug === "manual-car-1" && item.type === "balance_decrease"
    );
    expect(novChange).toBeDefined();
    expect(novChange.netWorthImpact).toBe(-2000);
    expect(novChange.previousBalance).toBe(31000);
    expect(novChange.currentBalance).toBe(29000);
  });

  test("appreciation shows positive change", async () => {
    const { getFinancialProfile } = await import("../financialProfile");
    const { generateNetWorthChanges } = await import("../netWorthChanges");
    
    const profile: FinancialProfileCache = {
      currency: "USD",
      monthlyHistory: [
        {
          yearMonth: "2026-10",
          netWorth: 500000,
          totalAssets: 500000,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-house-1", label: "House", type: "manual-property", value: 500000 }
          ],
        },
        {
          yearMonth: "2026-11",
          netWorth: 520000,
          totalAssets: 520000,
          totalDebts: 0,
          incomeTotal: 0,
          expensesTotal: 0,
          incomeTotalAllCredits: 0,
          coreExpensesTotal: 0,
          debtPaymentsTotal: 0,
          minDebtPaymentsTotal: 0,
          cardServicingPaymentsTotal: 0,
          byAccount: [
            { slug: "manual-house-1", label: "House", type: "manual-property", value: 520000 }
          ],
        },
      ],
      accountBalanceHistory: [],
      accountStatusRecords: [],
      manualAssets: [
        {
          id: "house-1",
          label: "House",
          category: "property",
          value: 520000,
          startDate: "2026-10-01",
          updatedAt: "2026-11-05T12:00:00Z",
          valuations: [
            { id: "val1", effectiveDate: "2026-10-01", valueCents: 50000000, createdAt: "2026-10-01T00:00:00Z" },
            { id: "val2", effectiveDate: "2026-11-05", valueCents: 52000000, createdAt: "2026-11-05T12:00:00Z" },
          ],
        },
      ],
      expenseTxns: [],
      categorizedTxns: [],
      recurringCharges: [],
      confirmedSubscriptions: [],
      statementHistory: [],
      hasMultiCurrency: false,
      missingMonthCoverage: [],
      fxToHome: (v: number) => v,
      schemaVersion: 3,
      cachedAt: new Date().toISOString(),
      homeCurrency: "USD",
    } as any;

    vi.mocked(getFinancialProfile).mockResolvedValue(profile);

    await generateNetWorthChanges("test-uid", mockDb as any);

    const writes = mockBatch.set.mock.calls;
    const novWrite = writes.find((call: any) => call[1].month === "2026-11");
    
    const novChange = novWrite[1].items.find((item: any) => 
      item.accountSlug === "manual-house-1" && item.type === "balance_increase"
    );
    
    expect(novChange).toBeDefined();
    expect(novChange.type).toBe("balance_increase");
    expect(novChange.netWorthImpact).toBe(20000);
  });
});
