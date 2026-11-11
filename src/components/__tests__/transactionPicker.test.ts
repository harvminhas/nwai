import { describe, expect, it } from "vitest";
import {
  accountLabelFromApi,
  accountLabelLookup,
  filterLinkableTransactions,
  mapIncomeTransactionsToLinkable,
  mapSpendingTransactionsToLinkable,
  resolveAccountLabel,
  transactionMetaLine,
  transactionSourcesForContext,
  type LinkableTransaction,
} from "@/components/transactions/linkTransactions";

const expense = (
  txFingerprint: string,
  overrides: Partial<LinkableTransaction> = {}
): LinkableTransaction => ({
  txFingerprint,
  date: "2026-06-15",
  merchant: "Cafe",
  amount: 12.5,
  category: "Dining",
  kind: "expense",
  ...overrides,
});

const income = (
  txFingerprint: string,
  overrides: Partial<LinkableTransaction> = {}
): LinkableTransaction => ({
  txFingerprint,
  date: "2026-06-20",
  merchant: "Payroll",
  amount: 2000,
  category: "Income",
  kind: "income",
  ...overrides,
});

const mixed: LinkableTransaction[] = [
  expense("lunch", { date: "2026-03-01", merchant: "Lunch", amount: 18 }),
  income("pay", { date: "2026-04-15", merchant: "Payroll", amount: 3000 }),
  expense("gas", { date: "2026-05-20", merchant: "Gas", amount: 60 }),
  income("refund", { date: "2026-02-01", merchant: "Tax refund", amount: 400 }),
];

describe("transactionSourcesForContext", () => {
  it("loads only spending for expenses context", () => {
    expect(transactionSourcesForContext("expenses")).toEqual(["spending"]);
  });

  it("loads only income for income context", () => {
    expect(transactionSourcesForContext("income")).toEqual(["income"]);
  });

  it("loads both sources for both context", () => {
    expect(transactionSourcesForContext("both")).toEqual(["spending", "income"]);
  });
});

describe("filterLinkableTransactions context", () => {
  it("expenses context keeps spending rows and excludes linked fingerprints", () => {
    const result = filterLinkableTransactions(mixed, {
      linkedFingerprints: ["gas"],
      context: "expenses",
    });
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["lunch"]);
    expect(result.every((tx) => tx.kind === "expense")).toBe(true);
  });

  it("income context keeps income rows", () => {
    const result = filterLinkableTransactions(mixed, {
      linkedFingerprints: [],
      context: "income",
    });
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["pay", "refund"]);
    expect(result.every((tx) => tx.kind === "income")).toBe(true);
  });

  it("both mode defaults to All and returns newest first", () => {
    const result = filterLinkableTransactions(
      [
        expense("old", { date: "2026-01-01" }),
        income("new", { date: "2026-11-01" }),
        expense("mid", { date: "2026-06-15" }),
      ],
      { linkedFingerprints: [], context: "both", filterMode: "all" }
    );
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["new", "mid", "old"]);
  });

  it("both + income toggle keeps income only", () => {
    const result = filterLinkableTransactions(mixed, {
      linkedFingerprints: [],
      context: "both",
      filterMode: "income",
    });
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["pay", "refund"]);
  });

  it("both + spending toggle keeps spending only", () => {
    const result = filterLinkableTransactions(mixed, {
      linkedFingerprints: [],
      context: "both",
      filterMode: "spending",
    });
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["gas", "lunch"]);
  });

  it("does not apply a date-window filter — past rows stay visible", () => {
    const result = filterLinkableTransactions(
      [
        expense("tickets", { date: "2026-03-01", merchant: "Airline" }),
        expense("hotel", { date: "2026-04-15", merchant: "Hotel" }),
      ],
      { linkedFingerprints: [], context: "expenses" }
    );
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["hotel", "tickets"]);
  });

  it("applies search after context filtering", () => {
    const result = filterLinkableTransactions(mixed, {
      linkedFingerprints: [],
      context: "both",
      filterMode: "all",
      search: "pay",
    });
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["pay"]);
  });
});

describe("map income and spending APIs", () => {
  it("maps income source payloads as income kind", () => {
    const mapped = mapIncomeTransactionsToLinkable([
      { fingerprint: "inc-1", merchant: "Employer", date: "2026-01-15", amount: 1000 },
    ]);
    expect(mapped).toEqual([
      {
        txFingerprint: "inc-1",
        merchant: "Employer",
        date: "2026-01-15",
        amount: 1000,
        category: "Income",
        kind: "income",
      },
    ]);
  });

  it("maps spending payloads as expense kind", () => {
    const mapped = mapSpendingTransactionsToLinkable([
      { fingerprint: "exp-1", merchant: "Store", date: "2026-01-16", amount: 20, category: "Shopping" },
    ]);
    expect(mapped[0].kind).toBe("expense");
    expect(mapped[0].txFingerprint).toBe("exp-1");
  });

  it("maps spending/income API accountLabel onto the linkable row", () => {
    const mapped = mapSpendingTransactionsToLinkable([
      {
        fingerprint: "atm-1",
        merchant: "TD ATM Withdrawal",
        date: "2026-11-04",
        amount: 60,
        category: "Other",
        accountLabel: "TD Chequing",
      },
    ]);
    expect(mapped[0].accountLabel).toBe("TD Chequing");
  });

  it("falls back to accountName when accountLabel is missing", () => {
    expect(
      accountLabelFromApi({ fingerprint: "x", accountName: "TD Chequing" })
    ).toBe("TD Chequing");
    expect(accountLabelFromApi({ fingerprint: "x", accountLabel: "  " })).toBe("");
  });
});

describe("transactionMetaLine and display-time account labels", () => {
  it("inserts the account between date and kind, and omits it when missing", () => {
    expect(
      transactionMetaLine(
        {
          date: "2026-11-04",
          accountLabel: "TD Chequing",
          category: "Other",
          kind: "expense",
        },
        { includeKind: true }
      )
    ).toBe("2026-11-04 · TD Chequing · Spending · Other");
    expect(
      transactionMetaLine(
        { date: "2026-11-04", category: "Other", kind: "expense" },
        { includeKind: true }
      )
    ).toBe("2026-11-04 · Spending · Other");
  });

  it("resolves missing stored labels from a fingerprint lookup, else omits", () => {
    const lookup = accountLabelLookup([
      { txFingerprint: "atm-1", accountLabel: "TD Chequing" },
    ]);
    expect(resolveAccountLabel("TD Chequing", "atm-1", lookup)).toBe("TD Chequing");
    expect(resolveAccountLabel(undefined, "atm-1", lookup)).toBe("TD Chequing");
    expect(resolveAccountLabel("", "unknown", lookup)).toBe("");
  });

  it("matches search against account label", () => {
    const result = filterLinkableTransactions(
      [expense("atm", { merchant: "ATM Withdrawal", accountLabel: "TD Chequing" })],
      { linkedFingerprints: [], context: "expenses", search: "chequing" }
    );
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["atm"]);
  });
});
