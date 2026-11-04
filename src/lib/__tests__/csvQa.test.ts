import { describe, it, expect } from "vitest";
import { detectColumns, runCsvQualityCheck } from "../csvQa";
import type { CsvParseResult } from "../csvParser";

function emptyParse(errors: string[] = []): CsvParseResult {
  return { rows: [], detectedFormat: "ai-parsed", dateRange: null, closingBalance: null, errors };
}

function parseOf(rows: CsvParseResult["rows"], errors: string[] = []): CsvParseResult {
  const dates = rows.map((r) => r.date).sort();
  return {
    rows,
    detectedFormat: "ai-parsed",
    dateRange: { from: dates[0], to: dates[dates.length - 1] },
    closingBalance: rows[rows.length - 1]?.balance ?? null,
    errors,
  };
}

describe("csvQa", () => {
  it("reads a headerless TD export: date, description, debit, credit, balance", () => {
    const csv = [
      '"2026-10-01","COFFEE SHOP","4.50",,"100.00"',
      '"2026-10-02","PAYROLL",,"2000","2100.00"',
      '"2026-10-03","GROCERY","50.00",,"2050.00"',
    ].join("\n");
    const columns = detectColumns({
      header: null,
      rows: [
        ["2026-10-01", "COFFEE SHOP", "4.50", "", "100.00"],
        ["2026-10-02", "PAYROLL", "", "2000", "2100.00"],
        ["2026-10-03", "GROCERY", "50.00", "", "2050.00"],
      ],
      dataLineCount: 3,
    });
    expect(columns.map((c) => c.role)).toEqual(["date", "description", "debit", "credit", "balance"]);

    const qa = runCsvQualityCheck({
      csvText: csv,
      parsed: parseOf([
        { date: "2026-10-01", description: "COFFEE SHOP", amount: 4.5, isExpense: true, rawAmount: -4.5, category: "Dining", balance: 100 },
        { date: "2026-10-02", description: "PAYROLL", amount: 2000, isExpense: false, rawAmount: 2000, category: "Income", balance: 2100 },
        { date: "2026-10-03", description: "GROCERY", amount: 50, isExpense: true, rawAmount: -50, category: "Groceries", balance: 2050 },
      ]),
    });
    expect(qa.status).toBe("ok");
    expect(qa.checks.find((c) => c.id === "columns")?.status).toBe("ok");
  });

  it("names columns from a header row", () => {
    const csv = "Date,Description,Amount,Balance\n2026-10-01,Coffee,-4.50,100.00\n";
    const columns = detectColumns({
      header: ["Date", "Description", "Amount", "Balance"],
      rows: [["2026-10-01", "Coffee", "-4.50", "100.00"]],
      dataLineCount: 1,
    });
    expect(columns.map((c) => c.role)).toEqual(["date", "description", "amount", "balance"]);
    expect(runCsvQualityCheck({ csvText: csv, parsed: emptyParse() }).status).toBe("block");
  });

  it("blocks a file whose columns can't be understood", () => {
    const qa = runCsvQualityCheck({ csvText: "hello,world\n1,2\n", parsed: emptyParse(["No transactions found in the CSV."]) });
    expect(qa.status).toBe("block");
    expect(qa.checks.find((c) => c.id === "columns")?.status).toBe("block");
  });

  it("warns, but does not block, a file over the row limit", () => {
    const lines = ["\"2026-10-01\",\"MERCHANT\",\"1.00\",,\"100.00\""];
    for (let i = 0; i < 650; i++) {
      lines.push(`"2026-10-${String((i % 28) + 1).padStart(2, "0")}","MERCHANT ${i}","1.00",,"${100 + i}.00"`);
    }
    const csv = lines.join("\n");
    const qa = runCsvQualityCheck({
      csvText: csv,
      parsed: parseOf(lines.slice(1).map((l, i) => {
        const cells = l.split(",");
        return {
          date: cells[0].replace(/"/g, ""),
          description: `MERCHANT ${i}`,
          amount: 1,
          isExpense: true as const,
          rawAmount: -1,
          category: "Other",
          balance: 100 + i,
        };
      })),
    });
    expect(qa.checks.find((c) => c.id === "rows")?.status).toBe("warn");
    expect(qa.status).toBe("warn");
  });

  it("flags a file where every row reads as money out", () => {
    const csv = '"2026-10-01","A","5.00",,"95.00"\n"2026-10-02","B","5.00",,"90.00"\n';
    const qa = runCsvQualityCheck({
      csvText: csv,
      parsed: parseOf([
        { date: "2026-10-01", description: "A", amount: 5, isExpense: true, rawAmount: -5, category: "Other", balance: 95 },
        { date: "2026-10-02", description: "B", amount: 5, isExpense: true, rawAmount: -5, category: "Other", balance: 90 },
      ]),
    });
    expect(qa.checks.find((c) => c.id === "direction")?.status).toBe("warn");
  });

  it("blocks when the balance column doesn't reconcile with the amounts", () => {
    const csv = '"2026-10-01","A","5.00",,"95.00"\n"2026-10-02","B","5.00",,"70.00"\n"2026-10-03","C","5.00",,"40.00"\n';
    const qa = runCsvQualityCheck({
      csvText: csv,
      parsed: parseOf([
        { date: "2026-10-01", description: "A", amount: 5, isExpense: true, rawAmount: -5, category: "Other", balance: 95 },
        { date: "2026-10-02", description: "B", amount: 5, isExpense: true, rawAmount: -5, category: "Other", balance: 70 },
        { date: "2026-10-03", description: "C", amount: 5, isExpense: true, rawAmount: -5, category: "Other", balance: 40 },
      ]),
    });
    expect(qa.checks.find((c) => c.id === "balance")?.status).toBe("block");
  });
});
