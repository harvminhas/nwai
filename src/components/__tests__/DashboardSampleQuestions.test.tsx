/**
 * Dashboard sample questions: mobile dropdown vs desktop chips.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DashboardSampleQuestions,
  SAMPLE_QUESTIONS_CHIPS_CLASS,
  SAMPLE_QUESTIONS_DROPDOWN_CLASS,
} from "../DashboardSampleQuestions";

const SUGGESTIONS = [
  "Where is my money going?",
  "Am I saving enough?",
  "What subscriptions am I paying for?",
  "How does my spending compare to last month?",
];

describe("DashboardSampleQuestions", () => {
  it("keeps desktop chips hidden below lg and visible at lg", () => {
    render(
      <DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={() => {}} />
    );
    const chips = screen.getByText("Try asking:").parentElement as HTMLElement;
    expect(chips.className).toBe(SAMPLE_QUESTIONS_CHIPS_CLASS);
    expect(SAMPLE_QUESTIONS_CHIPS_CLASS).toContain("hidden");
    expect(SAMPLE_QUESTIONS_CHIPS_CLASS).toContain("lg:flex");
  });

  it("keeps the compact dropdown phone-only (hidden at lg)", () => {
    render(
      <DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={() => {}} />
    );
    const select = screen.getByLabelText("Try asking a sample question");
    expect(select.closest("div")?.className).toBe(SAMPLE_QUESTIONS_DROPDOWN_CLASS);
    expect(SAMPLE_QUESTIONS_DROPDOWN_CLASS).toContain("lg:hidden");
  });

  it("uses the same first three suggestions in the dropdown and the chips", () => {
    render(
      <DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={() => {}} />
    );
    const select = screen.getByLabelText("Try asking a sample question") as HTMLSelectElement;
    const optionLabels = Array.from(select.options)
      .map((o) => o.value)
      .filter(Boolean);
    expect(optionLabels).toEqual(SUGGESTIONS.slice(0, 3));
    expect(screen.getByRole("button", { name: "Where is my money going?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Am I saving enough?" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "What subscriptions am I paying for?" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "How does my spending compare to last month?" })).toBeNull();
  });

  it("dropdown selection submits the same onAsk path as a chip click", () => {
    const onAsk = vi.fn();
    render(<DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={onAsk} />);

    fireEvent.change(screen.getByLabelText("Try asking a sample question"), {
      target: { value: "Am I saving enough?" },
    });
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith("Am I saving enough?");

    fireEvent.click(screen.getByRole("button", { name: "Where is my money going?" }));
    expect(onAsk).toHaveBeenCalledWith("Where is my money going?");
    expect(onAsk).toHaveBeenCalledTimes(2);
  });

  it("resets the select after submit so the same question can be asked again", () => {
    const onAsk = vi.fn();
    render(<DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={onAsk} />);
    const select = screen.getByLabelText("Try asking a sample question") as HTMLSelectElement;
    fireEvent.change(select, { target: { value: "Am I saving enough?" } });
    expect(select.value).toBe("");
    fireEvent.change(select, { target: { value: "Am I saving enough?" } });
    expect(onAsk).toHaveBeenCalledTimes(2);
  });
});
