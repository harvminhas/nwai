import { describe, expect, it } from "vitest";
import {
  classifyUploadedDocument,
  csvParseResultToClassifiable,
  rejectionMessageForDocumentType,
} from "../classifyUploadedDocument";
import type { ParsedStatementData } from "../types";

function base(overrides: Partial<ParsedStatementData> = {}): Partial<ParsedStatementData> {
  return {
    netWorth: 100,
    statementDate: "2026-03-31",
    bankName: "Example Issuer",
    accountType: "other",
    income: { total: 0, sources: [], transactions: [] },
    expenses: { total: 0, categories: [], transactions: [] },
    subscriptions: [],
    savingsRate: 0,
    paymentsMade: 0,
    ...overrides,
  };
}

describe("classifyUploadedDocument", () => {
  it("rejects a utility bill", () => {
    const result = classifyUploadedDocument(base({
      documentType: "bill",
      bankName: "City Electric",
      netWorth: 142.18,
      accountType: "other",
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bill");
    expect(result.message).toBe(rejectionMessageForDocumentType("bill"));
    expect(result.message).toBe(
      "This looks like a bill, not an account statement. Upload a bank, credit card, loan or investment statement."
    );
  });

  it("rejects a phone bill", () => {
    const result = classifyUploadedDocument(base({
      documentType: "bill",
      bankName: "Mobile Phone Co",
      netWorth: 85,
      accountName: "Wireless monthly bill",
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bill");
    expect(result.message).toContain("a bill, not an account statement");
  });

  it("rejects a receipt", () => {
    const result = classifyUploadedDocument(base({
      documentType: "receipt",
      bankName: "Corner Store",
      netWorth: 24.5,
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("receipt");
    expect(result.message).toBe(
      "This looks like a receipt, not an account statement. Upload a bank, credit card, loan or investment statement."
    );
  });

  it("rejects a pay stub", () => {
    const result = classifyUploadedDocument(base({
      documentType: "pay_stub",
      bankName: "Acme Corp Payroll",
      netWorth: 3200,
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("pay_stub");
    expect(result.message).toBe(
      "This looks like a pay stub, not an account statement. Upload a bank, credit card, loan or investment statement."
    );
  });

  it("rejects a tax form", () => {
    const result = classifyUploadedDocument(base({
      documentType: "tax_form",
      bankName: "Revenue Agency",
      netWorth: 0,
    }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("tax_form");
    expect(result.message).toBe(
      "This looks like a tax form, not an account statement. Upload a bank, credit card, loan or investment statement."
    );
  });

  it("accepts a credit card with amount due and minimum payment", () => {
    const parsed = {
      ...base({
        documentType: "account_statement",
        accountType: "credit",
        bankName: "Example Card",
        previousBalance: 1500,
        newBalance: 980,
        netWorth: -980,
        debts: 980,
        expenses: { total: 0, categories: [], transactions: [] },
      }),
      amountDue: 980,
      minimumPayment: 35,
    };
    expect(classifyUploadedDocument(parsed).ok).toBe(true);
  });

  it("accepts a loan without transactions", () => {
    const result = classifyUploadedDocument(base({
      documentType: "account_statement",
      accountType: "loan",
      bankName: "Example Lender",
      netWorth: -18500,
      debts: 18500,
      interestRate: 6.49,
      expenses: { total: 0, categories: [], transactions: [] },
      income: { total: 0, sources: [], transactions: [] },
    }));
    expect(result.ok).toBe(true);
  });

  it("accepts a mortgage", () => {
    const result = classifyUploadedDocument(base({
      documentType: "account_statement",
      accountType: "mortgage",
      bankName: "Example Mortgage Co",
      netWorth: -412000,
      debts: 412000,
      interestRate: 3.9,
      subAccounts: [
        { id: "1", label: "Term", type: "mortgage", balance: 412000, apr: 3.9 },
      ],
      expenses: { total: 0, categories: [], transactions: [] },
    }));
    expect(result.ok).toBe(true);
  });

  it("accepts an investment with holdings", () => {
    const result = classifyUploadedDocument(base({
      documentType: "account_statement",
      accountType: "investment",
      bankName: "Example Brokerage",
      netWorth: 64510.67,
      assets: 64510.67,
      holdings: [
        { name: "US Large Cap Equity Index", type: "mutual_fund", value: 64510.67, units: 697.073 },
      ],
    }));
    expect(result.ok).toBe(true);
  });

  it("accepts a checking statement", () => {
    const result = classifyUploadedDocument(base({
      documentType: "account_statement",
      accountType: "checking",
      bankName: "Example Bank",
      netWorth: 7148.01,
      assets: 7148.01,
      expenses: {
        total: 8.5,
        categories: [],
        transactions: [{ merchant: "Coffee", amount: 8.5, date: "2026-03-05", category: "Dining" }],
      },
    }));
    expect(result.ok).toBe(true);
  });

  it("accepts a savings statement", () => {
    const result = classifyUploadedDocument(base({
      documentType: "account_statement",
      accountType: "savings",
      bankName: "Example Bank",
      netWorth: 12000,
      assets: 12000,
    }));
    expect(result.ok).toBe(true);
  });

  it("soft-rejects an unclassified other document with only an amount due", () => {
    const parsed = {
      ...base({
        accountType: "other",
        netWorth: 90.12,
      }),
      amountDue: 90.12,
      minimumPayment: 90.12,
    };
    const result = classifyUploadedDocument(parsed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toContain("not an account statement");
  });

  it("does not reject a credit card on amount due or minimum payment alone", () => {
    const parsed = {
      ...base({
        accountType: "credit",
        previousBalance: 200,
        newBalance: 175,
        netWorth: -175,
        debts: 175,
      }),
      amountDue: 175,
      minimumPayment: 25,
    };
    expect(classifyUploadedDocument(parsed).ok).toBe(true);
  });
});

describe("csvParseResultToClassifiable", () => {
  it("rejects a bill CSV through the same check as PDF", () => {
    const parsed = csvParseResultToClassifiable({
      documentType: "bill",
      rows: [],
      dateRange: null,
      closingBalance: 80,
    });
    const result = classifyUploadedDocument(parsed);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toBe("bill");
  });

  it("accepts a checking CSV with transactions", () => {
    const parsed = csvParseResultToClassifiable({
      documentType: "account_statement",
      rows: [
        { date: "2026-03-01", description: "Payroll", amount: 2000, isExpense: false },
        { date: "2026-03-02", description: "Grocer", amount: 50, isExpense: true },
      ],
      dateRange: { from: "2026-03-01", to: "2026-03-02" },
      closingBalance: 1950,
    }, "checking");
    expect(classifyUploadedDocument(parsed).ok).toBe(true);
  });
});
