import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const pageSrc = readFileSync(resolve(__dirname, "../page.tsx"), "utf8");

describe("Net worth tabs", () => {
  it("does not include a Growth tab", () => {
    expect(pageSrc).not.toContain("GrowthTab");
    expect(pageSrc).not.toContain('setActiveTab("growth")');
    expect(pageSrc).not.toContain("net-worth-growth");
    expect(pageSrc).toContain('setActiveTab("changes")');
    expect(pageSrc).toContain('setActiveTab("assets")');
    expect(pageSrc).toContain('setActiveTab("debts")');
  });
});
