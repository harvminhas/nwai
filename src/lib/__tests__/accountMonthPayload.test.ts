import { describe, it, expect } from "vitest";
import { commitAccountMonth } from "../accountMonthPayload";

describe("commitAccountMonth", () => {
  it("commits yearMonth, payments, and data from the same payload", () => {
    const result = commitAccountMonth(
      { data: { expenses: { total: 10 } }, yearMonth: "2026-08", paymentsMade: 500 },
      "2026-08",
      true,
    );
    expect(result).toEqual({
      yearMonth: "2026-08",
      paymentsMade: 500,
      data: { expenses: { total: 10 } },
      previousMonth: undefined,
    });
  });

  it("returns null when the fetch failed so a new label cannot sit on stale totals", () => {
    expect(commitAccountMonth(
      { data: { expenses: { total: 10 } }, yearMonth: "2026-08", paymentsMade: 500 },
      "2026-08",
      false,
    )).toBeNull();
  });

  it("returns null when data is missing", () => {
    expect(commitAccountMonth(
      { yearMonth: "2026-08", paymentsMade: 500 },
      "2026-08",
      true,
    )).toBeNull();
  });

  it("uses the requested month when the API omits yearMonth", () => {
    const result = commitAccountMonth(
      { data: {}, paymentsMade: 0 },
      "2026-07",
      true,
    );
    expect(result?.yearMonth).toBe("2026-07");
    expect(result?.paymentsMade).toBe(0);
  });
});
