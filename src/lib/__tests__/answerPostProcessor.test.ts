import { describe, test, expect } from "vitest";
import { cleanAIAnswer } from "../chat/answerPostProcessor";

describe("cleanAIAnswer", () => {
  test("removes tool names at start of answer", () => {
    const input = "From get_income_summary (same as Income page): CA$5,234";
    const output = cleanAIAnswer(input);
    expect(output).toBe("CA$5,234");
    expect(output).not.toContain("get_income_summary");
    expect(output).not.toContain("same as");
  });

  test("removes tool names at end of answer", () => {
    const input = "Your savings rate is 17.3% (From get_savings_summary (same as Savings drawer)).";
    const output = cleanAIAnswer(input);
    expect(output).toBe("Your savings rate is 17.3%.");
    expect(output).not.toContain("get_savings_summary");
    expect(output).not.toContain("same as");
  });

  test("removes tool names in middle of answer", () => {
    const input = "Your income from MAM was CA$15,234 according to get_income_summary (same as Income page). This is up 5% from last year.";
    const output = cleanAIAnswer(input);
    expect(output).not.toContain("get_income_summary");
    expect(output).not.toContain("same as");
    expect(output).toContain("CA$15,234");
    expect(output).toContain("up 5%");
  });

  test("removes multiple tool names", () => {
    const input = "From get_spending_summary and list_cash_expenses (same as Spending page): Total CA$3,450";
    const output = cleanAIAnswer(input);
    expect(output).not.toContain("get_spending_summary");
    expect(output).not.toContain("list_cash_expenses");
    expect(output).not.toContain("same as");
    expect(output).toContain("Total CA$3,450");
  });

  test("removes note-style attribution", () => {
    const input = "Uses buildIncomeSummary (same as Income page). Typical monthly = average of months with data.";
    const output = cleanAIAnswer(input);
    expect(output).not.toContain("Uses buildIncomeSummary");
    expect(output).not.toContain("same as");
    expect(output).toContain("Typical monthly");
  });

  test("removes Uses/From attribution", () => {
    const input = "Uses computeWindowSavings (same as Savings drawer). Formula: cash change + debt paydown.";
    const output = cleanAIAnswer(input);
    expect(output).not.toContain("Uses computeWindowSavings");
    expect(output).not.toContain("same as");
    expect(output).toContain("Formula:");
  });

  test("handles parenthetical attribution", () => {
    const input = "Your net worth is CA$154,811 (from get_net_worth (same as dashboard card)).";
    const output = cleanAIAnswer(input);
    expect(output).toBe("Your net worth is CA$154,811.");
    expect(output).not.toContain("get_net_worth");
  });

  test("cleans up whitespace after removal", () => {
    const input = "Income:  get_income_summary   CA$5,234";
    const output = cleanAIAnswer(input);
    expect(output).not.toMatch(/\s{2,}/); // No double spaces
    expect(output).toContain("Income:");
  });

  test("preserves answers without tool names", () => {
    const input = "Your savings rate is 17.3% based on CA$5,234 income and CA$4,324 spending.";
    const output = cleanAIAnswer(input);
    expect(output).toBe(input);
  });

  test("handles all tool name patterns", () => {
    const patterns = [
      "get_income_summary",
      "list_cash_expenses", 
      "search_transactions",
      "rollup_categories",
      "get_net_worth"
    ];
    
    for (const toolName of patterns) {
      const input = `Result from ${toolName}: CA$1,234`;
      const output = cleanAIAnswer(input);
      expect(output).not.toContain(toolName);
    }
  });
});
