import { describe, it, expect } from "vitest";
import { accountDisplayLabel, joinAccountMeta } from "../accountListLabel";

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
