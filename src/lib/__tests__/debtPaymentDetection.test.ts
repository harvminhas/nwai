/**
 * Test: Debt payment detection using paymentsMade from loan statements
 * 
 * Verifies that Scotia Plan Loan (1142) and TD FlexLine (2849) payments
 * are correctly detected from statement paymentsMade, with anomalies flagged.
 */

import { computeScheduledDebtPayments } from "../debtPayments";
import type { AccountSnapshot, ExpenseTxnRecord } from "../extractTransactions";

describe("Debt Payment Detection", () => {
  test("Scotia Plan Loan: detects CA$1,142 regular payment from paymentsMade", () => {
    // Scotia Plan Loan with 6 months of regular payments
    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "scotiabank-plan-loan-5678",
        bankName: "Scotiabank",
        accountId: "5678",
        accountName: "Scotia Plan Loan",
        accountType: "loan",
        balance: -50000,
        parsedAssets: 0,
        parsedDebts: 50000,
        statementMonth: "2026-04",
        interestRate: 6.5,
        currency: "CAD",
        paymentsMade: 1142,
      },
      {
        slug: "scotiabank-plan-loan-5678",
        bankName: "Scotiabank",
        accountId: "5678",
        accountName: "Scotia Plan Loan",
        accountType: "loan",
        balance: -48858,
        parsedAssets: 0,
        parsedDebts: 48858,
        statementMonth: "2026-05",
        interestRate: 6.5,
        currency: "CAD",
        paymentsMade: 1142,
      },
      {
        slug: "scotiabank-plan-loan-5678",
        bankName: "Scotiabank",
        accountId: "5678",
        accountName: "Scotia Plan Loan",
        accountType: "loan",
        balance: -47716,
        parsedAssets: 0,
        parsedDebts: 47716,
        statementMonth: "2026-06",
        interestRate: 6.5,
        currency: "CAD",
        paymentsMade: 1142,
      },
      {
        slug: "scotiabank-plan-loan-5678",
        bankName: "Scotiabank",
        accountId: "5678",
        accountName: "Scotia Plan Loan",
        accountType: "loan",
        balance: -46574,
        parsedAssets: 0,
        parsedDebts: 46574,
        statementMonth: "2026-07",
        interestRate: 6.5,
        currency: "CAD",
        paymentsMade: 1142,
      },
      {
        slug: "scotiabank-plan-loan-5678",
        bankName: "Scotiabank",
        accountId: "5678",
        accountName: "Scotia Plan Loan",
        accountType: "loan",
        balance: -45432,
        parsedAssets: 0,
        parsedDebts: 45432,
        statementMonth: "2026-08",
        interestRate: 6.5,
        currency: "CAD",
        paymentsMade: 1142,
      },
      {
        slug: "scotiabank-plan-loan-5678",
        bankName: "Scotiabank",
        accountId: "5678",
        accountName: "Scotia Plan Loan",
        accountType: "loan",
        balance: -44290,
        parsedAssets: 0,
        parsedDebts: 44290,
        statementMonth: "2026-09",
        interestRate: 6.5,
        currency: "CAD",
        paymentsMade: 1142,
      },
    ];

    const expenseTxns: ExpenseTxnRecord[] = [];

    const result = computeScheduledDebtPayments(
      accountSnapshots,
      expenseTxns,
      [],
      {},
      "CAD"
    );

    expect(result).toHaveLength(1);
    expect(result[0].accountSlug).toBe("scotiabank-plan-loan-5678");
    expect(result[0].amount).toBe(1142);
    expect(result[0].isEstimated).toBe(false); // 6+ payments = high confidence
    expect(result[0].method).toBe("usual payment");
    expect(result[0].debtType).toBe("loan");
  });

  test("TD FlexLine: detects regular payment (~CA$2,849) and flags CA$32K anomaly", () => {
    // TD Home Equity FlexLine with regular ~$2,849 payments and one $32,000 lump sum
    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "td-flexline-1185",
        bankName: "TD Bank",
        accountId: "1185-4190085",
        accountName: "TD Home Equity FlexLine",
        accountType: "line_of_credit",
        balance: -520000,
        parsedAssets: 0,
        parsedDebts: 520000,
        statementMonth: "2026-03",
        interestRate: 4.65,
        currency: "CAD",
        paymentsMade: 2849,
      },
      {
        slug: "td-flexline-1185",
        bankName: "TD Bank",
        accountId: "1185-4190085",
        accountName: "TD Home Equity FlexLine",
        accountType: "line_of_credit",
        balance: -517151,
        parsedAssets: 0,
        parsedDebts: 517151,
        statementMonth: "2026-04",
        interestRate: 4.65,
        currency: "CAD",
        paymentsMade: 2849,
      },
      {
        slug: "td-flexline-1185",
        bankName: "TD Bank",
        accountId: "1185-4190085",
        accountName: "TD Home Equity FlexLine",
        accountType: "line_of_credit",
        balance: -514302,
        parsedAssets: 0,
        parsedDebts: 514302,
        statementMonth: "2026-05",
        interestRate: 4.65,
        currency: "CAD",
        paymentsMade: 2849,
      },
      {
        slug: "td-flexline-1185",
        bankName: "TD Bank",
        accountId: "1185-4190085",
        accountName: "TD Home Equity FlexLine",
        accountType: "line_of_credit",
        balance: -511453,
        parsedAssets: 0,
        parsedDebts: 511453,
        statementMonth: "2026-06",
        interestRate: 4.65,
        currency: "CAD",
        paymentsMade: 2849,
      },
      {
        slug: "td-flexline-1185",
        bankName: "TD Bank",
        accountId: "1185-4190085",
        accountName: "TD Home Equity FlexLine",
        accountType: "line_of_credit",
        balance: -476604,
        parsedAssets: 0,
        parsedDebts: 476604,
        statementMonth: "2026-07",
        interestRate: 4.65,
        currency: "CAD",
        paymentsMade: 32000, // Large lump-sum prepayment
      },
      {
        slug: "td-flexline-1185",
        bankName: "TD Bank",
        accountId: "1185-4190085",
        accountName: "TD Home Equity FlexLine",
        accountType: "line_of_credit",
        balance: -473755,
        parsedAssets: 0,
        parsedDebts: 473755,
        statementMonth: "2026-08",
        interestRate: 4.65,
        currency: "CAD",
        paymentsMade: 2849,
      },
      {
        slug: "td-flexline-1185",
        bankName: "TD Bank",
        accountId: "1185-4190085",
        accountName: "TD Home Equity FlexLine",
        accountType: "line_of_credit",
        balance: -470906,
        parsedAssets: 0,
        parsedDebts: 470906,
        statementMonth: "2026-09",
        interestRate: 4.65,
        currency: "CAD",
        paymentsMade: 2849,
      },
    ];

    const expenseTxns: ExpenseTxnRecord[] = [];

    const result = computeScheduledDebtPayments(
      accountSnapshots,
      expenseTxns,
      [],
      {},
      "CAD"
    );

    expect(result).toHaveLength(1);
    expect(result[0].accountSlug).toBe("td-flexline-1185");
    expect(result[0].amount).toBe(2849); // Regular payment detected
    expect(result[0].isEstimated).toBe(false); // 6+ regular payments
    expect(result[0].method).toBe("usual payment");
    expect(result[0].debtType).toBe("loan");
    
    // Verify the $32K anomaly is flagged
    expect(result[0].unreviewedAnomalies).toBeDefined();
    expect(result[0].unreviewedAnomalies!.length).toBe(1);
    expect(result[0].unreviewedAnomalies![0].amount).toBe(32000);
    expect(result[0].unreviewedAnomalies![0].reason).toBe("much_higher");
    expect(result[0].unreviewedAnomalies![0].txMonth).toBe("2026-07");
  });

  test("FlexLine line_of_credit treated as loan (mortgage-like), not skipped", () => {
    // Ensure line_of_credit account type is processed by the loan path
    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "td-flexline-1185",
        bankName: "TD Bank",
        accountId: "1185-4190085",
        accountName: "TD Home Equity FlexLine",
        accountType: "line_of_credit",
        balance: -500000,
        parsedAssets: 0,
        parsedDebts: 500000,
        statementMonth: "2026-08",
        interestRate: 4.65,
        currency: "CAD",
        paymentsMade: 2849,
      },
      {
        slug: "td-flexline-1185",
        bankName: "TD Bank",
        accountId: "1185-4190085",
        accountName: "TD Home Equity FlexLine",
        accountType: "line_of_credit",
        balance: -497151,
        parsedAssets: 0,
        parsedDebts: 497151,
        statementMonth: "2026-09",
        interestRate: 4.65,
        currency: "CAD",
        paymentsMade: 2849,
      },
    ];

    const result = computeScheduledDebtPayments(
      accountSnapshots,
      [],
      [],
      {},
      "CAD"
    );

    // Should return a payment, not skip
    expect(result).toHaveLength(1);
    expect(result[0].accountSlug).toBe("td-flexline-1185");
    expect(result[0].amount).toBe(2849);
  });
});
