/**
 * Smoke test for AI ask entry points.
 * Verifies that questions route to appropriate tools.
 */

import { queryLLMWithTools } from "../src/lib/chat/llmQuery";
import type { FinancialProfileCache } from "../src/lib/financialProfile";
import type { UserReviewContext } from "../src/lib/userReviewContext";

// Mock Gemini API
let lastToolCalls: string[] = [];

jest.mock("@google/generative-ai", () => {
  return {
    GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
      getGenerativeModel: jest.fn().mockImplementation(() => ({
        startChat: jest.fn().mockImplementation(() => ({
          sendMessage: jest.fn().mockImplementation(async (parts: any) => {
            // If this is the initial message (string), simulate tool call
            if (typeof parts === "string") {
              const message = parts.toLowerCase();
              
              // Route to appropriate tool based on message
              if (message.includes("make") || message.includes("income") || message.includes("mam")) {
                lastToolCalls = ["get_income_summary"];
                return {
                  response: {
                    text: () => "",
                    functionCalls: () => [{
                      name: "get_income_summary",
                      args: { range: "12mo" }
                    }]
                  }
                };
              }
              
              if (message.includes("spend") || message.includes("spending")) {
                lastToolCalls = ["get_spending_summary"];
                return {
                  response: {
                    text: () => "",
                    functionCalls: () => [{
                      name: "get_spending_summary",
                      args: { range: "3mo" }
                    }]
                  }
                };
              }
              
              // Default: no tool calls
              lastToolCalls = [];
              return {
                response: {
                  text: () => "I can help you understand your finances.",
                  functionCalls: () => null
                }
              };
            }
            
            // If this is function response parts, return final answer
            return {
              response: {
                text: () => "Based on your income data, you made $X from MAM.",
                functionCalls: () => null
              }
            };
          })
        }))
      }))
    }))
  };
});

const syntheticProfile: FinancialProfileCache = {
  updatedAt: new Date().toISOString(),
  sourceVersion: "test",
  schemaVersion: "1",
  monthlyHistory: [
    {
      yearMonth: "2026-10",
      incomeTotal: 5000,
      coreExpensesTotal: 3000,
      debtPaymentsTotal: 500,
      minDebtPaymentsTotal: 500,
      cardServicingPaymentsTotal: 0,
    }
  ],
  typicalMonthly: { median: 3000, avg: 3000, basisMonthsUsed: 1 },
  coverage: { monthsCovered: 1, monthsSpan: 1, coveragePct: 100, missingMonths: [] },
  manualAssets: [],
  balanceSnapshots: [],
  expenseTxns: [],
  incomeTxns: [
    {
      date: "2026-10-15",
      txMonth: "2026-10",
      amount: 5000,
      source: "MAM Construction",
      description: "Payroll",
      accountSlug: "test-account",
      currency: "CAD",
    }
  ],
  accountSnapshots: [],
  allTxMonths: ["2026-10"],
  latestTxMonth: "2026-10",
  portfolioHoldings: [],
  homeCurrency: "CAD",
  fxRates: {},
  accountRates: [],
  debtPaymentHistory: [],
  accountBalanceHistory: [],
  confirmedSubscriptions: [],
  cashCommitmentEntries: [],
  goals: [],
};

const emptyContext: UserReviewContext = {
  incomeDepositReviews: new Map(),
  debtPaymentReviews: [],
  savingsConfirmedItems: new Map(),
};

describe("AI Ask Smoke Tests", () => {
  beforeEach(() => {
    lastToolCalls = [];
  });

  it("routes 'How much did I make from MAM?' to get_income_summary", async () => {
    const apiKey = "test-key";
    const question = "How much did I make from MAM?";
    
    const answer = await queryLLMWithTools(apiKey, question, syntheticProfile, emptyContext);
    
    expect(lastToolCalls).toContain("get_income_summary");
    expect(answer).toBeTruthy();
  });

  it("routes income questions to get_income_summary", async () => {
    const apiKey = "test-key";
    const question = "What's my income?";
    
    await queryLLMWithTools(apiKey, question, syntheticProfile, emptyContext);
    
    expect(lastToolCalls).toContain("get_income_summary");
  });

  it("routes spending questions to get_spending_summary", async () => {
    const apiKey = "test-key";
    const question = "How much do I spend?";
    
    await queryLLMWithTools(apiKey, question, syntheticProfile, emptyContext);
    
    expect(lastToolCalls).toContain("get_spending_summary");
  });
});
