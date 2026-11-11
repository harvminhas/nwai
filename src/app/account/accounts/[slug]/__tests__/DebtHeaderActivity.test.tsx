/**
 * Debt-account header activity: Paid / New charges labels, hide-if-zero, wrap classes.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DebtHeaderActivity, {
  DEBT_HEADER_ACTIVITY_LABEL_CLASS,
  DEBT_HEADER_ACTIVITY_WRAP_CLASS,
} from "../DebtHeaderActivity";

const fmt = (n: number) => `CA$${n.toLocaleString("en-US")}`;

describe("DebtHeaderActivity", () => {
  it("renders Paid and New charges for the statement month", () => {
    render(
      <DebtHeaderActivity
        monthAbbrev="Oct"
        paid={{ amount: 1142, count: 1 }}
        newCharges={{ amount: 18540, count: 4 }}
        formatAmount={fmt}
      />
    );

    expect(screen.getByText("Paid · Oct")).toBeTruthy();
    expect(screen.getByText("CA$1,142")).toBeTruthy();
    expect(screen.getByText("1 transactions")).toBeTruthy();
    expect(screen.getByText("New charges · Oct")).toBeTruthy();
    expect(screen.getByText("CA$18,540")).toBeTruthy();
    expect(screen.getByText("4 transactions")).toBeTruthy();
  });

  it("hides Paid when it is null and still shows New charges", () => {
    render(
      <DebtHeaderActivity
        monthAbbrev="Oct"
        paid={null}
        newCharges={{ amount: 200, count: 2 }}
        formatAmount={fmt}
      />
    );
    expect(screen.queryByText(/Paid/)).toBeNull();
    expect(screen.getByText("New charges · Oct")).toBeTruthy();
  });

  it("hides New charges when it is null and still shows Paid", () => {
    render(
      <DebtHeaderActivity
        monthAbbrev="Nov"
        paid={{ amount: 2000, count: 0 }}
        newCharges={null}
        formatAmount={fmt}
      />
    );
    expect(screen.getByText("Paid · Nov")).toBeTruthy();
    expect(screen.queryByText(/New charges/)).toBeNull();
    expect(screen.queryByText(/transactions/)).toBeNull();
  });

  it("renders nothing when both figures are missing", () => {
    const { container } = render(
      <DebtHeaderActivity
        monthAbbrev="Oct"
        paid={null}
        newCharges={null}
        formatAmount={fmt}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("keeps labels on one line and lets the pair wrap on small screens", () => {
    const { container } = render(
      <DebtHeaderActivity
        monthAbbrev="Oct"
        paid={{ amount: 100, count: 0 }}
        newCharges={{ amount: 200, count: 0 }}
        formatAmount={fmt}
      />
    );
    const wrap = container.firstChild as HTMLElement;
    expect(wrap.className).toBe(DEBT_HEADER_ACTIVITY_WRAP_CLASS);
    expect(wrap.className).toContain("flex-wrap");
    expect(wrap.className).toContain("max-lg:w-full");
    expect(wrap.className).not.toContain("truncate");
    expect(DEBT_HEADER_ACTIVITY_LABEL_CLASS).toContain("whitespace-nowrap");
    expect(DEBT_HEADER_ACTIVITY_LABEL_CLASS).not.toContain("truncate");
  });

  it("uses the existing In/Out type scale and colors", () => {
    render(
      <DebtHeaderActivity
        monthAbbrev="Oct"
        paid={{ amount: 100, count: 0 }}
        newCharges={{ amount: 200, count: 0 }}
        formatAmount={fmt}
      />
    );
    expect(screen.getByText("CA$100").className).toContain("text-sm");
    expect(screen.getByText("CA$100").className).toContain("font-bold");
    expect(screen.getByText("CA$100").className).toContain("text-green-600");
    expect(screen.getByText("CA$200").className).toContain("text-sm");
    expect(screen.getByText("CA$200").className).toContain("font-bold");
    expect(screen.getByText("CA$200").className).toContain("text-red-500");
    expect(screen.getByText("Paid · Oct").className).toBe(DEBT_HEADER_ACTIVITY_LABEL_CLASS);
  });
});
