import { describe, test, expect } from "vitest";
import { AI_USAGE_LIMIT_FREE, getResetDate } from "../aiUsageLimit";

describe("aiUsageLimit", () => {
  test("AI_USAGE_LIMIT_FREE is 50", () => {
    expect(AI_USAGE_LIMIT_FREE).toBe(50);
  });

  test("getResetDate returns a valid date string", () => {
    const resetDate = getResetDate();
    expect(resetDate).toMatch(/^[A-Z][a-z]+ \d{1,2}, \d{4}$/); // e.g. "November 1, 2026"
  });

  test("getResetDate is first day of next month", () => {
    const resetDate = getResetDate();
    const date = new Date(resetDate);
    expect(date.getDate()).toBe(1); // First day of month
  });
});
