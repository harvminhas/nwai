import { describe, it, expect } from "vitest";
import { isCategoryGroupOpen, toggleCategoryGroup } from "../categoryGroupExpand";

describe("category group expand defaults", () => {
  it("treats unseen groups as expanded", () => {
    expect(isCategoryGroupOpen({}, "cash")).toBe(true);
    expect(isCategoryGroupOpen({}, "credit_card")).toBe(true);
  });

  it("keeps an explicit collapse after other groups are added", () => {
    const afterCollapse = toggleCategoryGroup({}, "cash");
    expect(isCategoryGroupOpen(afterCollapse, "cash")).toBe(false);
    expect(isCategoryGroupOpen(afterCollapse, "investments")).toBe(true);
  });

  it("toggle expands a collapsed group again", () => {
    const collapsed = toggleCategoryGroup({}, "mortgage");
    const reopened = toggleCategoryGroup(collapsed, "mortgage");
    expect(isCategoryGroupOpen(reopened, "mortgage")).toBe(true);
  });
});
