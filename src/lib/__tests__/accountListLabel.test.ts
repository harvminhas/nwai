import { describe, it, expect } from "vitest";
import { accountDisplayLabel, findAccountHistoryLabel, joinAccountMeta, resolveAccountDisplayName } from "../accountListLabel";

describe("accountDisplayLabel", () => {
  it("drops a repeated institution + account name", () => {
    const name = "HPE Hewlett Packard Enterprise 401(k) Plan";
    expect(accountDisplayLabel(name, name)).toEqual({
      primary: name,
      full: name,
    });
  });

  it("uses the account name as primary when institution is distinct", () => {
    expect(
      accountDisplayLabel(
        "Questrade",
        "Individual Registered Retirement Savings Plan (RRSP)"
      )
    ).toEqual({
      primary: "Individual Registered Retirement Savings Plan (RRSP)",
      secondary: "Questrade",
      full: "Questrade · Individual Registered Retirement Savings Plan (RRSP)",
    });
  });

  it("does not repeat a name that already contains the institution", () => {
    const account = "HPE Hewlett Packard Enterprise 401(k) Plan";
    expect(accountDisplayLabel("HPE Hewlett Packard Enterprise", account)).toEqual({
      primary: account,
      full: "HPE Hewlett Packard Enterprise · HPE Hewlett Packard Enterprise 401(k) Plan",
    });
  });

  it("keeps a short product name distinct from the bank", () => {
    expect(accountDisplayLabel("Chase", "Checking")).toEqual({
      primary: "Checking",
      secondary: "Chase",
      full: "Chase · Checking",
    });
  });

  it("uses bank name when there is no account name", () => {
    expect(accountDisplayLabel("Questrade")).toEqual({
      primary: "Questrade",
      full: "Questrade",
    });
  });
});

describe("resolveAccountDisplayName", () => {
  it("prefers a user-set nickname over statement names", () => {
    expect(
      resolveAccountDisplayName({
        nickname: "All Inclusive",
        accountName: "ALLINCLUSIVE",
        bankName: "TD Canada Trust",
      })
    ).toEqual({
      primary: "All Inclusive",
      secondary: "TD Canada Trust",
      full: "TD Canada Trust · All Inclusive",
    });
  });

  it("uses the account product name first, institution as secondary", () => {
    expect(
      resolveAccountDisplayName({
        accountName: "ALLINCLUSIVE",
        bankName: "TD Canada Trust",
      })
    ).toEqual({
      primary: "ALLINCLUSIVE",
      secondary: "TD Canada Trust",
      full: "TD Canada Trust · ALLINCLUSIVE",
    });
  });

  it("falls back to the What Changed history label when the latest statement has no product name", () => {
    expect(
      resolveAccountDisplayName({
        bankName: "TD Canada Trust",
        historyLabel: "ALLINCLUSIVE",
        fallback: "3156",
      })
    ).toEqual({
      primary: "ALLINCLUSIVE",
      secondary: "TD Canada Trust",
      full: "TD Canada Trust · ALLINCLUSIVE",
    });
  });

  it("does not use a history label that is just the institution when a product name exists", () => {
    expect(
      resolveAccountDisplayName({
        accountName: "TD FIRST CLASS TRAVEL CARD",
        bankName: "TD Canada Trust",
        historyLabel: "TD Canada Trust",
      }).primary
    ).toBe("TD FIRST CLASS TRAVEL CARD");
  });

  it("prefers the history product name when the latest accountName repeats the bank", () => {
    expect(
      resolveAccountDisplayName({
        accountName: "TD Canada Trust",
        bankName: "TD Canada Trust",
        historyLabel: "ALLINCLUSIVE",
      })
    ).toEqual({
      primary: "ALLINCLUSIVE",
      secondary: "TD Canada Trust",
      full: "TD Canada Trust · ALLINCLUSIVE",
    });
  });

  it("uses the history label alone when What Changed only has that string", () => {
    expect(
      resolveAccountDisplayName({
        historyLabel: "Honda Finance",
        fallback: "honda-finance-1234",
      })
    ).toEqual({
      primary: "Honda Finance",
      full: "Honda Finance",
    });
  });
});

describe("findAccountHistoryLabel", () => {
  it("matches the What Changed label by slug, ignoring case", () => {
    expect(
      findAccountHistoryLabel(
        [
          { slug: "3156", label: "ALLINCLUSIVE" },
          { slug: "td-credit-7780", label: "TD FIRST CLASS TRAVEL CARD" },
        ],
        "3156"
      )
    ).toBe("ALLINCLUSIVE");
    expect(
      findAccountHistoryLabel(
        [{ slug: "Honda-Finance-1234", label: "Honda Finance" }],
        "honda-finance-1234"
      )
    ).toBe("Honda Finance");
  });

  it("returns null when there is no resolvable account", () => {
    expect(findAccountHistoryLabel([], "3156")).toBeNull();
    expect(findAccountHistoryLabel(undefined, "3156")).toBeNull();
  });
});

describe("joinAccountMeta", () => {
  it("joins institution, masked id, and as-of into one subdued line", () => {
    expect(joinAccountMeta(["Questrade", "•••8044", "as of Mar 12"])).toBe(
      "Questrade  ·  •••8044  ·  as of Mar 12"
    );
  });

  it("omits empty parts", () => {
    expect(joinAccountMeta([undefined, "•••8044", null])).toBe("•••8044");
  });
});
