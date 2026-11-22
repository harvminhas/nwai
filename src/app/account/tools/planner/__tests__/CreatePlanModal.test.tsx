/**
 * Create/edit form shows end-date validation inline.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { PLAN_DATE_RANGE_ERROR } from "../planList";
import { CreatePlanModal } from "../page";

describe("CreatePlanModal date validation", () => {
  it("shows a plain-language error inline when the end date is before the start date", () => {
    render(
      <CreatePlanModal
        token="test-token"
        existing={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Start Date"), {
      target: { value: "2027-05-15" },
    });
    fireEvent.change(screen.getByLabelText("End Date"), {
      target: { value: "2027-05-03" },
    });

    expect(screen.getByRole("alert").textContent).toBe(PLAN_DATE_RANGE_ERROR);
  });

  it("clears the inline error when the range becomes valid", () => {
    render(
      <CreatePlanModal
        token="test-token"
        existing={null}
        onClose={vi.fn()}
        onSave={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("Start Date"), {
      target: { value: "2027-05-15" },
    });
    fireEvent.change(screen.getByLabelText("End Date"), {
      target: { value: "2027-05-03" },
    });
    expect(screen.getByRole("alert")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("End Date"), {
      target: { value: "2027-05-20" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
