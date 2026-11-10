import { describe, it, expect } from "vitest";
import {
  ASK_INPUT_CLASS,
  ASK_MOBILE_PLACEHOLDER_CLASS,
  ASK_PLACEHOLDER_DESKTOP,
  ASK_PLACEHOLDER_MOBILE,
} from "../dashboardAskLayout";

describe("dashboard ask placeholders", () => {
  it("keeps the desktop placeholder unchanged", () => {
    expect(ASK_PLACEHOLDER_DESKTOP).toBe(
      "Ask about your spending, savings, or goals…"
    );
  });

  it("uses a shorter mobile placeholder that still matches the Ask-about selector", () => {
    expect(ASK_PLACEHOLDER_MOBILE.length).toBeLessThan(
      ASK_PLACEHOLDER_DESKTOP.length
    );
    expect(ASK_PLACEHOLDER_MOBILE).toMatch(/Ask about/);
    expect(ASK_PLACEHOLDER_DESKTOP).toMatch(/Ask about/);
  });

  it("hides the native placeholder below lg and restores it at lg", () => {
    expect(ASK_INPUT_CLASS).toContain("placeholder:text-transparent");
    expect(ASK_INPUT_CLASS).toContain("lg:placeholder:text-gray-400");
    expect(ASK_INPUT_CLASS).toContain("peer");
  });

  it("shows the mobile overlay only while empty and below lg", () => {
    expect(ASK_MOBILE_PLACEHOLDER_CLASS).toContain("lg:hidden");
    expect(ASK_MOBILE_PLACEHOLDER_CLASS).toContain(
      "peer-[:not(:placeholder-shown)]:hidden"
    );
    expect(ASK_MOBILE_PLACEHOLDER_CLASS).toContain("whitespace-nowrap");
    expect(ASK_MOBILE_PLACEHOLDER_CLASS).toContain("right-28");
  });
});
