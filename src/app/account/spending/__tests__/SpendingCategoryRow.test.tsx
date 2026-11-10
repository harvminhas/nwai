/**
 * Spending category rows: hide sparkline below lg, keep amount/vs-avg intact.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { SpendingCategoryRow } from "../SpendingCategoryRow";
import {
  SPENDING_CATEGORY_AMOUNT_CLASS,
  SPENDING_CATEGORY_NAME_CLASS,
  SPENDING_CATEGORY_SPARKLINE_CLASS,
  SPENDING_CATEGORY_TREND_CLASS,
} from "../spendingReadLayout";

describe("SpendingCategoryRow phone read layout", () => {
  it("keeps Personal Care on one line and hides the sparkline below lg", () => {
    const { container } = render(
      <SpendingCategoryRow
        currency="CAD"
        item={{
          name: "Personal Care",
          slug: "personal-care",
          monthlySeries: [{ amount: 20 }, { amount: 18 }, { amount: 22 }],
          displayShare: 0.01,
          displayTotal: 227,
          trend: -25,
        }}
      />
    );

    const name = screen.getByText("Personal Care");
    expect(name.className).toBe(SPENDING_CATEGORY_NAME_CLASS);
    expect(name.className).toContain("whitespace-nowrap");

    const sparkline = container.querySelector("[style*='width: 60px']") as HTMLElement;
    expect(sparkline.className).toBe(SPENDING_CATEGORY_SPARKLINE_CLASS);
    expect(sparkline.className).toContain("hidden");
    expect(sparkline.className).toContain("lg:block");

    const amount = screen.getByText("CA$227");
    expect(amount.className).toBe(SPENDING_CATEGORY_AMOUNT_CLASS);
    const trend = screen.getByText(/CA\$25\/mo vs avg/);
    expect(trend.className).toContain(SPENDING_CATEGORY_TREND_CLASS.split(" ")[0]);
    expect(trend.className).toContain("whitespace-nowrap");
  });
});
