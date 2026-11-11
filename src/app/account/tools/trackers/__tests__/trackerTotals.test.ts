import { describe, expect, it } from "vitest";
import type { TrackerLinkedTransaction } from "@/app/api/user/trackers/route";
import {
  computeTrackerTotals,
  trackerCsvFilename,
  trackerTransactionsToCsv,
} from "../trackerTotals";

const tx = (
  overrides: Partial<TrackerLinkedTransaction> & Pick<TrackerLinkedTransaction, "txFingerprint" | "kind" | "amount">
): TrackerLinkedTransaction => ({
  merchant: "Item",
  date: "2026-06-15",
  category: "Other",
  ...overrides,
});

describe("computeTrackerTotals", () => {
  it("sums income in, spending out, and net", () => {
    const totals = computeTrackerTotals([
      tx({ txFingerprint: "pay", kind: "income", amount: 3000, merchant: "Payroll" }),
      tx({ txFingerprint: "refund", kind: "income", amount: 250, merchant: "CRA" }),
      tx({ txFingerprint: "lunch", kind: "expense", amount: 40, merchant: "Cafe" }),
      tx({ txFingerprint: "gas", kind: "expense", amount: 80, merchant: "Shell" }),
    ]);
    expect(totals).toEqual({ incomeIn: 3250, spendingOut: 120, net: 3130 });
  });

  it("treats a spending-only tracker as negative net", () => {
    const totals = computeTrackerTotals([
      tx({ txFingerprint: "lunch", kind: "expense", amount: 18 }),
      tx({ txFingerprint: "gas", kind: "expense", amount: 60 }),
    ]);
    expect(totals).toEqual({ incomeIn: 0, spendingOut: 78, net: -78 });
  });

  it("returns zeros for no linked transactions", () => {
    expect(computeTrackerTotals([])).toEqual({ incomeIn: 0, spendingOut: 0, net: 0 });
    expect(computeTrackerTotals(undefined)).toEqual({ incomeIn: 0, spendingOut: 0, net: 0 });
  });
});

describe("trackerTransactionsToCsv", () => {
  it("exports newest first with type and escaped merchants", () => {
    const csv = trackerTransactionsToCsv([
      tx({
        txFingerprint: "old",
        kind: "expense",
        amount: 12.5,
        date: "2026-01-01",
        merchant: 'Cafe, "Main"',
        category: "Dining",
      }),
      tx({
        txFingerprint: "new",
        kind: "income",
        amount: 400,
        date: "2026-06-01",
        merchant: "CRA",
        category: "Income",
        accountLabel: "TD Chequing",
      }),
    ]);
    expect(csv).toBe(
      [
        "Date,Type,Merchant,Account,Category,Amount",
        "2026-06-01,Income,CRA,TD Chequing,Income,400",
        '2026-01-01,Spending,"Cafe, ""Main""",,Dining,12.5',
      ].join("\n")
    );
  });

  it("builds a safe csv filename from the tracker name", () => {
    expect(trackerCsvFilename("Taxes 2027")).toBe("taxes-2027-transactions.csv");
    expect(trackerCsvFilename("  ")).toBe("tracker-transactions.csv");
  });
});
