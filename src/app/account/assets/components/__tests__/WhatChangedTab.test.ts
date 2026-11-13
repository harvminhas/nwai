import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const src = readFileSync(resolve(__dirname, "../WhatChangedTab.tsx"), "utf8");
const page = readFileSync(resolve(__dirname, "../../page.tsx"), "utf8");

describe("Assets WhatChangedTab", () => {
  it("is wired after Performance and uses full history", () => {
    expect(src).toContain("WhatChangedPanel");
    expect(src).toContain('kind="asset"');
    expect(src).toContain("allMonthlyHistory");
    expect(page).toContain('activeTab === "what-changed"');
    expect(page.indexOf("performance")).toBeLessThan(page.indexOf("what-changed"));
  });
});
