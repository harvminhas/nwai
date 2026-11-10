/**
 * IntactAmount keeps currency values on one line.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { IntactAmount, INTACT_AMOUNT_CLASS } from "../IntactAmount";

describe("IntactAmount", () => {
  it("renders the value with nowrap so a leading minus cannot wrap", () => {
    render(
      <IntactAmount className="text-lg font-bold text-red-600">
        -CA$41,122
      </IntactAmount>
    );
    const el = screen.getByText("-CA$41,122");
    expect(el.className).toContain("whitespace-nowrap");
    expect(el.className).toContain("shrink-0");
    expect(el.className).toContain("text-lg");
    expect(INTACT_AMOUNT_CLASS).toBe("shrink-0 whitespace-nowrap tabular-nums");
  });
});
