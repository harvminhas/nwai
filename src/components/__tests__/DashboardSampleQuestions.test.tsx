/**
 * Dashboard sample questions: mobile menu vs desktop chips.
 * @vitest-environment jsdom
 */

import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DashboardSampleQuestions,
  SAMPLE_QUESTIONS_CHIPS_CLASS,
  SAMPLE_QUESTIONS_DROPDOWN_CLASS,
  SAMPLE_QUESTIONS_MENU_CLASS,
  SAMPLE_QUESTIONS_TRIGGER_CLASS,
} from "../DashboardSampleQuestions";

const SUGGESTIONS = [
  "Where is my money going?",
  "Am I saving enough?",
  "What subscriptions am I paying for?",
  "How does my spending compare to last month?",
];

function openMenu() {
  fireEvent.click(screen.getByLabelText("Try asking a sample question"));
}

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

  it("keeps the compact menu phone-only (hidden at lg)", () => {
    render(
      <DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={() => {}} />
    );
    const trigger = screen.getByLabelText("Try asking a sample question");
    expect(trigger.closest("div.relative")?.className).toBe(
      SAMPLE_QUESTIONS_DROPDOWN_CLASS
    );
    expect(SAMPLE_QUESTIONS_DROPDOWN_CLASS).toContain("lg:hidden");
    expect(trigger.className).toBe(SAMPLE_QUESTIONS_TRIGGER_CLASS);
    expect(SAMPLE_QUESTIONS_TRIGGER_CLASS).toContain("inline-flex");
    expect(SAMPLE_QUESTIONS_TRIGGER_CLASS).toContain("max-w-max");
    expect(SAMPLE_QUESTIONS_TRIGGER_CLASS).not.toContain("w-full");
    expect(SAMPLE_QUESTIONS_TRIGGER_CLASS).not.toMatch(/purple/);
  });

  it("exposes the same first three suggestions as menu items and chips", () => {
    render(
      <DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={() => {}} />
    );
    openMenu();
    const items = screen.getAllByRole("menuitem").map((el) => el.textContent);
    expect(items).toEqual(SUGGESTIONS.slice(0, 3));
    expect(
      screen.getByRole("button", { name: "Where is my money going?" })
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Am I saving enough?" })).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "What subscriptions am I paying for?" })
    ).toBeTruthy();
    expect(
      screen.queryByRole("menuitem", {
        name: "How does my spending compare to last month?",
      })
    ).toBeNull();
  });

  it("menu selection submits onAsk exactly once and closes", () => {
    const onAsk = vi.fn();
    render(<DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={onAsk} />);

    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Am I saving enough?" }));
    expect(onAsk).toHaveBeenCalledTimes(1);
    expect(onAsk).toHaveBeenCalledWith("Am I saving enough?");
    expect(screen.queryByRole("menu")).toBeNull();

    fireEvent.click(
      screen.getByRole("button", { name: "Where is my money going?" })
    );
    expect(onAsk).toHaveBeenCalledWith("Where is my money going?");
    expect(onAsk).toHaveBeenCalledTimes(2);
  });

  it("can ask the same question again after the menu closes", () => {
    const onAsk = vi.fn();
    render(<DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={onAsk} />);
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Am I saving enough?" }));
    openMenu();
    fireEvent.click(screen.getByRole("menuitem", { name: "Am I saving enough?" }));
    expect(onAsk).toHaveBeenCalledTimes(2);
  });

  it("closes on Escape and outside click without calling onAsk", () => {
    const onAsk = vi.fn();
    render(<DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={onAsk} />);

    openMenu();
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();

    openMenu();
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("closes on touchstart outside the menu", () => {
    render(
      <DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={() => {}} />
    );
    openMenu();
    fireEvent.touchStart(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("does not open or submit while disabled/loading", () => {
    const onAsk = vi.fn();
    render(
      <DashboardSampleQuestions
        suggestions={SUGGESTIONS}
        onAsk={onAsk}
        loading
      />
    );
    const trigger = screen.getByLabelText("Try asking a sample question");
    expect(trigger).toHaveProperty("disabled", true);
    fireEvent.click(trigger);
    expect(screen.queryByRole("menu")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Where is my money going?" })
    ).toHaveProperty("disabled", true);
    fireEvent.click(
      screen.getByRole("button", { name: "Where is my money going?" })
    );
    expect(onAsk).not.toHaveBeenCalled();
  });

  it("keeps the compact menu in-flow so it does not overlay the money-goes title", () => {
    render(
      <DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={() => {}} />
    );
    openMenu();
    const menu = screen.getByRole("menu");
    expect(menu.className).toBe(SAMPLE_QUESTIONS_MENU_CLASS);
    expect(SAMPLE_QUESTIONS_MENU_CLASS).not.toContain("absolute");
    expect(SAMPLE_QUESTIONS_MENU_CLASS).toContain("mx-auto");
    expect(SAMPLE_QUESTIONS_MENU_CLASS).toContain("w-[min(17.5rem,calc(100vw-2rem))]");
  });

  it("wires accessible menu semantics on the compact trigger", () => {
    render(
      <DashboardSampleQuestions suggestions={SUGGESTIONS} onAsk={() => {}} />
    );
    const trigger = screen.getByLabelText("Try asking a sample question");
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    openMenu();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    expect(menu.getAttribute("aria-labelledby")).toBe(trigger.id);
    expect(screen.getAllByRole("menuitem")).toHaveLength(3);
  });
});
