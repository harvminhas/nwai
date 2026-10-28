/**
 * Debts Summary Fixture Test
 * 
 * Tests debt grouping, payment tracking, interest calculations, and payoff estimates with realistic Canadian data.
 */

import { describe, test, expect } from "vitest";
import { buildDebtsSummary } from "../debtsSummary";
import type { AccountSnapshot, DebtPaymentHistoryEntry } from "../extractTransactions";
import type { AccountBalanceHistory } from "../financialProfile";
import type { ManualLiability } from "../types";

describe("Debts Summary", () => {
  const fxRates: Record<string, number> = {}; // All CAD
  const homeCurrency = "CAD";

  test("should group debts by type and calculate totals", () => {
    const accountSnapshots: AccountSnapshot[] = [
      // Credit Cards
      {
        slug: "td-visa-1234",
        bankName: "TD",
        accountId: "1234",
        accountName: "TD Visa",
        accountType: "credit_card",
        balance: -2500,
        statementMonth: "2026-10",
        interestRate: 19.99,
        currency: "CAD",
        paymentsMade: 200,
      },
      {
        slug: "rbc-mc-5678",
        bankName: "RBC",
        accountId: "5678",
        accountName: "RBC Mastercard",
        accountType: "credit_card",
        balance: -1500,
        statementMonth: "2026-10",
        interestRate: 20.99,
        currency: "CAD",
        paymentsMade: 150,
      },
      // Mortgage
      {
        slug: "td-mortgage-9999",
        bankName: "TD",
        accountId: "9999",
        accountName: "TD Home Equity FlexLine",
        accountType: "mortgage",
        balance: -350000,
        statementMonth: "2026-10",
        interestRate: 5.5,
        currency: "CAD",
        paymentsMade: 2000,
      },
      // Line of Credit
      {
        slug: "cibc-loc-7777",
        bankName: "CIBC",
        accountId: "7777",
        accountName: "CIBC Personal LOC",
        accountType: "line_of_credit",
        balance: -10000,
        statementMonth: "2026-10",
        interestRate: 7.5,
        currency: "CAD",
        paymentsMade: 300,
      },
      // Auto Loan
      {
        slug: "scotiabank-auto-6666",
        bankName: "Scotiabank",
        accountId: "6666",
        accountName: "Scotiabank Auto Loan",
        accountType: "auto_loan",
        balance: -15000,
        statementMonth: "2026-10",
        interestRate: 4.5,
        currency: "CAD",
        paymentsMade: 450,
      },
    ];

    const paymentHistory: DebtPaymentHistoryEntry[] = [
      // TD Visa payments
      { accountSlug: "td-visa-1234", statementMonth: "2026-08", paymentsMade: 200, currency: "CAD" },
      { accountSlug: "td-visa-1234", statementMonth: "2026-09", paymentsMade: 200, currency: "CAD" },
      { accountSlug: "td-visa-1234", statementMonth: "2026-10", paymentsMade: 200, currency: "CAD" },
      // RBC MC payments
      { accountSlug: "rbc-mc-5678", statementMonth: "2026-08", paymentsMade: 150, currency: "CAD" },
      { accountSlug: "rbc-mc-5678", statementMonth: "2026-09", paymentsMade: 150, currency: "CAD" },
      { accountSlug: "rbc-mc-5678", statementMonth: "2026-10", paymentsMade: 150, currency: "CAD" },
      // Mortgage payments
      { accountSlug: "td-mortgage-9999", statementMonth: "2026-08", paymentsMade: 2000, currency: "CAD" },
      { accountSlug: "td-mortgage-9999", statementMonth: "2026-09", paymentsMade: 2000, currency: "CAD" },
      { accountSlug: "td-mortgage-9999", statementMonth: "2026-10", paymentsMade: 2000, currency: "CAD" },
      // LOC payments
      { accountSlug: "cibc-loc-7777", statementMonth: "2026-08", paymentsMade: 300, currency: "CAD" },
      { accountSlug: "cibc-loc-7777", statementMonth: "2026-09", paymentsMade: 300, currency: "CAD" },
      { accountSlug: "cibc-loc-7777", statementMonth: "2026-10", paymentsMade: 300, currency: "CAD" },
      // Auto loan payments
      { accountSlug: "scotiabank-auto-6666", statementMonth: "2026-08", paymentsMade: 450, currency: "CAD" },
      { accountSlug: "scotiabank-auto-6666", statementMonth: "2026-09", paymentsMade: 450, currency: "CAD" },
      { accountSlug: "scotiabank-auto-6666", statementMonth: "2026-10", paymentsMade: 450, currency: "CAD" },
    ];

    const balanceHistory: AccountBalanceHistory[] = [
      {
        slug: "td-visa-1234",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-08", balance: -2700 },
          { yearMonth: "2026-09", balance: -2600 },
          { yearMonth: "2026-10", balance: -2500 },
        ],
      },
      {
        slug: "rbc-mc-5678",
        currency: "CAD",
        entries: [
          { yearMonth: "2026-08", balance: -1600 },
          { yearMonth: "2026-09", balance: -1550 },
          { yearMonth: "2026-10", balance: -1500 },
        ],
      },
    ];

    const manualLiabilities: ManualLiability[] = [
      {
        id: "student-loan-1",
        label: "OSAP Student Loan",
        category: "student_loan",
        balance: 20000,
        interestRate: 0, // Interest-free during study
        updatedAt: "2026-10-01T00:00:00Z",
      },
    ];

    const summary = buildDebtsSummary(
      accountSnapshots,
      balanceHistory,
      paymentHistory,
      manualLiabilities,
      fxRates,
      homeCurrency
    );

    // Total Debt = 2500 + 1500 + 350000 + 10000 + 15000 + 20000 = 399,000
    expect(summary.totalDebt).toBe(399000);
    expect(summary.currency).toBe("CAD");

    // Groups
    const groupsByType = Object.fromEntries(
      summary.groups.map(g => [g.type, g])
    );

    // Credit Cards = 2500 + 1500 = 4,000
    expect(groupsByType.credit_card.totalBalance).toBe(4000);
    expect(groupsByType.credit_card.accounts.length).toBe(2);

    // Mortgage = 350,000
    expect(groupsByType.mortgage.totalBalance).toBe(350000);
    expect(groupsByType.mortgage.accounts.length).toBe(1);

    // Line of Credit = 10,000
    expect(groupsByType.loc.totalBalance).toBe(10000);
    expect(groupsByType.loc.accounts.length).toBe(1);

    // Other = 15000 (auto) + 20000 (student) = 35,000
    expect(groupsByType.other.totalBalance).toBe(35000);
    expect(groupsByType.other.accounts.length).toBe(1);
    expect(groupsByType.other.manualLiabilities.length).toBe(1);

    // Monthly Payments = 200 + 150 + 2000 + 300 + 450 = 3,100
    expect(summary.monthlyPayments).toBe(3100);

    // Weighted Average Rate
    // (2500 * 19.99 + 1500 * 20.99 + 350000 * 5.5 + 10000 * 7.5 + 15000 * 4.5) / (2500 + 1500 + 350000 + 10000 + 15000)
    // = (49975 + 31485 + 1925000 + 75000 + 67500) / 379000
    // = 2148960 / 379000 = 5.67%
    expect(summary.weightedAvgRate).toBeCloseTo(5.67, 1);

    // Payoff Estimates
    expect(summary.payoffEstimates.length).toBeGreaterThan(0);
    
    // Credit card should have payoff estimates
    const tdVisaPayoff = summary.payoffEstimates.find(e => e.accountSlug === "td-visa-1234");
    expect(tdVisaPayoff).toBeDefined();
    expect(tdVisaPayoff?.monthsToPayoff).toBeGreaterThan(0);
    expect(tdVisaPayoff?.payoffDate).toBeTruthy();
  });

  test("should calculate change correctly (decrease is good for debt)", () => {
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
    
    let lastMonthDate = new Date(now);
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonth = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}`;

    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "td-visa-1234",
        bankName: "TD",
        accountId: "1234",
        accountName: "TD Visa",
        accountType: "credit_card",
        balance: -2500, // Current: $2,500 debt
        statementMonth: currentMonth,
        interestRate: 19.99,
        currency: "CAD",
        paymentsMade: 200,
      },
    ];

    const balanceHistory: AccountBalanceHistory[] = [
      {
        slug: "td-visa-1234",
        currency: "CAD",
        entries: [
          { yearMonth: lastMonth, balance: -3000 }, // Last month: $3,000 debt
          { yearMonth: currentMonth, balance: -2500 }, // Current: $2,500 debt
        ],
      },
    ];

    const summary = buildDebtsSummary(
      accountSnapshots,
      balanceHistory,
      [],
      [],
      fxRates,
      homeCurrency
    );

    // Change vs last month = 2500 - 3000 = -500 (negative is good for debt - paid down $500)
    expect(summary.changeVsLastMonth).toBe(-500);
  });

  test("should estimate payoff months correctly", () => {
    const accountSnapshots: AccountSnapshot[] = [
      {
        slug: "td-visa-1234",
        bankName: "TD",
        accountId: "1234",
        accountName: "TD Visa",
        accountType: "credit_card",
        balance: -1000,
        statementMonth: "2026-10",
        interestRate: 20.0, // 20% APR
        currency: "CAD",
        paymentsMade: 100, // $100/month payment
      },
    ];

    const paymentHistory: DebtPaymentHistoryEntry[] = [
      { accountSlug: "td-visa-1234", statementMonth: "2026-08", paymentsMade: 100, currency: "CAD" },
      { accountSlug: "td-visa-1234", statementMonth: "2026-09", paymentsMade: 100, currency: "CAD" },
      { accountSlug: "td-visa-1234", statementMonth: "2026-10", paymentsMade: 100, currency: "CAD" },
    ];

    const summary = buildDebtsSummary(
      accountSnapshots,
      [],
      paymentHistory,
      [],
      fxRates,
      homeCurrency
    );

    const payoff = summary.payoffEstimates.find(e => e.accountSlug === "td-visa-1234");
    expect(payoff).toBeDefined();
    
    // With $1000 balance, 20% APR (1.67%/month), and $100/month payment:
    // Monthly interest = $1000 * 0.0167 = $16.70
    // Principal paid = $100 - $16.70 = $83.30
    // Should take approximately 11-12 months
    expect(payoff?.monthsToPayoff).toBeGreaterThan(10);
    expect(payoff?.monthsToPayoff).toBeLessThan(13);
  });

  test("should handle empty data gracefully", () => {
    const summary = buildDebtsSummary([], [], [], [], fxRates, homeCurrency);

    expect(summary.totalDebt).toBe(0);
    expect(summary.groups.length).toBe(0);
    expect(summary.monthlyPayments).toBe(0);
    expect(summary.payoffEstimates.length).toBe(0);
  });
});
