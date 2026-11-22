import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(__dirname, "../page.tsx"), "utf8");
const card = readFileSync(resolve(__dirname, "../PlanCard.tsx"), "utf8");

describe("planner page layout", () => {
  it("drops the Upcoming section label and lists in-progress, year groups, then collapsed Past", () => {
    expect(page).not.toContain('title="Upcoming"');
    expect(page).toContain('title="In progress"');
    expect(page).toContain("futureByYear");
    expect(page).toContain("formatYearSubtotal");
    expect(page).toContain("Past");
    expect(page).toContain("aria-expanded={pastOpen}");
    expect(page).toContain("const [pastOpen, setPastOpen] = useState(false)");
    expect(page).toContain('role="alert"');
    expect(page).toContain("validatePlanDates");
  });

  it("keeps the list from overflowing on a 390px phone", () => {
    expect(page).toContain("overflow-x-hidden");
    expect(page).toContain("flex-wrap");
    expect(page).toContain("min-w-0");
    expect(card).toContain("min-w-0");
    expect(card).toContain("break-words");
    expect(card).toContain("shrink-0");
    expect(card).toContain("whitespace-nowrap text-xs tabular-nums");
  });
});
