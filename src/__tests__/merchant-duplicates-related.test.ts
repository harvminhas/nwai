import { describe, it, expect } from "vitest";
import { areSimilarMerchants, findRelatedMerchants } from "@/lib/merchantDuplicates";

const m = (name: string, total = 100) => ({ name, slug: name.toLowerCase().replace(/[^a-z0-9]+/g, "-"), total });

describe("findRelatedMerchants", () => {
  it("offers merchants that share a brand word but no opening word", () => {
    const target = m("ESSO CIRCLE K", 816);
    const others = [m("CHERRYCREST ESSO", 239), m("PETRO CANADA", 500)];
    expect(areSimilarMerchants(target, others[0])).toBe(false);
    expect(findRelatedMerchants(target, others).map((x) => x.name)).toEqual(["CHERRYCREST ESSO"]);
  });

  it("never offers the target itself", () => {
    const target = m("ESSO CIRCLE K");
    expect(findRelatedMerchants(target, [target]).length).toBe(0);
  });

  it("ignores noise words and very short words", () => {
    const target = m("CITY OF BRAMPTON");
    const others = [m("CITY OF MISSISSAUGA"), m("THE SHOP STORE")];
    expect(findRelatedMerchants(target, others).length).toBe(0);
  });
});