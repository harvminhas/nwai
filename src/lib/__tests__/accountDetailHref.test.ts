import { describe, it, expect } from "vitest";
import { accountDetailHref, netWorthAccountRow } from "../accountDetailHref";

describe("accountDetailHref", () => {
  it("links imported statement accounts to the account detail page", () => {
    expect(accountDetailHref("3156")).toBe("/account/accounts/3156");
    expect(accountDetailHref({ slug: "td-credit-7780", type: "credit" })).toBe(
      "/account/accounts/td-credit-7780"
    );
    expect(accountDetailHref({ slug: "honda-finance-1234", type: "loan", side: "debt" })).toBe(
      "/account/accounts/honda-finance-1234"
    );
  });

  it("links manual assets the same way the Assets list does", () => {
    expect(
      accountDetailHref({ slug: "manual-car-1", type: "manual-vehicle", side: "asset" })
    ).toBe("/account/assets/car-1");
    expect(
      accountDetailHref({ slug: "manual-house-1", type: "manual-property" })
    ).toBe("/account/assets/house-1");
  });

  it("leaves manual liabilities non-clickable, matching the Debts list", () => {
    expect(
      accountDetailHref({
        slug: "manual-student-1",
        type: "manual-student_loan",
        side: "debt",
      })
    ).toBeNull();
    expect(
      accountDetailHref({ slug: "manual-other-1", type: "manual-other", side: "debt" })
    ).toBeNull();
  });

  it("leaves aggregate / empty rows non-clickable", () => {
    expect(accountDetailHref(null)).toBeNull();
    expect(accountDetailHref("")).toBeNull();
    expect(accountDetailHref({ slug: "   " })).toBeNull();
    expect(accountDetailHref({ slug: "manual-" })).toBeNull();
  });
});

describe("netWorthAccountRow", () => {
  it("sends What Changed statement rows to the account detail page", () => {
    expect(
      netWorthAccountRow({
        slug: "3156",
        label: "ALLINCLUSIVE",
        type: "checking",
        side: "asset",
      })
    ).toEqual({ label: "ALLINCLUSIVE", href: "/account/accounts/3156" });

    expect(
      netWorthAccountRow({
        slug: "td-credit-7780",
        label: "TD FIRST CLASS TRAVEL CARD",
        type: "credit",
        side: "debt",
      })
    ).toEqual({
      label: "TD FIRST CLASS TRAVEL CARD",
      href: "/account/accounts/td-credit-7780",
    });
  });

  it("keeps baseline first-statement wording and still links the account", () => {
    expect(
      netWorthAccountRow({
        slug: "honda-finance-1234",
        label: "Honda Finance",
        type: "loan",
        side: "debt",
        isBaseline: true,
      })
    ).toEqual({
      label: "Honda Finance (first statement)",
      href: "/account/accounts/honda-finance-1234",
    });
  });
});
