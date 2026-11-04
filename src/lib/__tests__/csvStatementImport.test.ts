import { describe, it, expect } from "vitest";
import type * as FirebaseFirestore from "firebase-admin/firestore";
import {
  buildCsvCoverage,
  monthEndBalance,
  planCsvImport,
  statementDocSlug,
  statementDocYearMonth,
} from "../csvStatementImport";
import type { ParsedRow } from "../csvParser";
import type { ParsedStatementData } from "../types";

type Doc = FirebaseFirestore.QueryDocumentSnapshot;

function doc(data: Record<string, unknown>): Doc {
  return { id: "x", data: () => data } as unknown as Doc;
}

function row(date: string, amount: number, isExpense: boolean, balance: number | null): ParsedRow {
  return {
    date,
    description: "Test Merchant",
    amount,
    isExpense,
    rawAmount: isExpense ? -amount : amount,
    category: isExpense ? "Groceries" : "Income",
    balance,
  };
}

/** A checking account with a September PDF statement and nothing after it. */
function septemberPdf(): Doc {
  return doc({
    source: "pdf",
    uploadedAt: { toDate: () => new Date("2026-10-25T18:38:47Z") },
    parsedData: {
      statementDate: "2026-09-29",
      bankName: "TD Canada Trust",
      accountId: "3156",
      accountType: "checking",
      accountSlug: "3156",
      expenses: { total: 10, categories: [], transactions: [{ merchant: "A", amount: 10, date: "2026-09-29", category: "Groceries" }] },
      income: { total: 0, sources: [], transactions: [] },
    } as unknown as ParsedStatementData,
  });
}

const account = { slug: "3156", bankName: "TD Canada Trust", accountId: "3156", accountType: "checking", lastMonth: "2026-09" };

describe("csvStatementImport", () => {
  it("reads the slug and month off a statement doc", () => {
    const d = septemberPdf();
    expect(statementDocSlug(d.data())).toBe("3156");
    expect(statementDocYearMonth(d.data())).toBe("2026-09");
  });

  it("uses the PDF's last transaction date as the gap cutoff", () => {
    const { coverageBySlug, knownAccounts } = buildCsvCoverage([septemberPdf()]);
    expect(coverageBySlug.get("3156")).toBe("2026-09-29");
    expect(knownAccounts.map((a) => a.slug)).toEqual(["3156"]);
  });

  it("takes the closing balance from the last row of each month", () => {
    expect(monthEndBalance([row("2026-10-05", 5, true, 100), row("2026-10-30", 5, true, 80)])).toBe(80);
    expect(monthEndBalance([row("2026-10-05", 5, true, null)])).toBeNull();
  });

  it("creates one document per gap month, each with its own month-end balance", () => {
    const parsed = {
      rows: [
        row("2026-09-15", 20, true, 900),
        row("2026-10-02", 30, true, 870),
        row("2026-10-31", 40, true, 830),
        row("2026-11-04", 50, true, 780),
      ],
      detectedFormat: "ai-parsed",
      dateRange: { from: "2026-09-15", to: "2026-11-04" },
      closingBalance: 780,
      errors: [],
    };

    const plan = planCsvImport({ parsed, account, docs: [septemberPdf()] });

    expect(plan.months.map((m) => m.ym)).toEqual(["2026-10", "2026-11"]);
    expect(plan.months.map((m) => m.parsedData.netWorth)).toEqual([830, 780]);
    expect(plan.skippedByGapFilter).toBe(1);
    // Rows already covered by the September PDF are dropped before any month is written.
    expect(plan.months[0].parsedData.expenses.transactions.map((t) => t.date)).toEqual(["2026-10-02", "2026-10-31"]);
  });

  it("does not re-import a row that is already saved for the account", () => {
    const parsed = {
      rows: [row("2026-10-02", 30, true, 870)],
      detectedFormat: "ai-parsed",
      dateRange: { from: "2026-10-02", to: "2026-10-02" },
      closingBalance: 870,
      errors: [],
    };

    // First run plans and writes October.
    const first = planCsvImport({ parsed, account, docs: [septemberPdf()] });
    expect(first.months).toHaveLength(1);

    // A saved October statement means the same row is now a duplicate.
    const saved = doc({
      source: "csv",
      accountSlug: "3156",
      uploadedAt: { toDate: () => new Date("2026-11-01T00:00:00Z") },
      parsedData: first.months[0].parsedData,
    });
    const second = planCsvImport({ parsed, account, docs: [septemberPdf(), saved] });
    expect(second.months).toHaveLength(0);
    expect(second.skippedByDuplicate).toBe(1);
  });
});
