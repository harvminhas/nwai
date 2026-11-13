import { describe, it, expect } from "vitest";
import {
  accountDisplayLabel,
  accountMatchesQuery,
  compactAccountDisplayName,
  displayNameFromProfileAccount,
  findAccountHistoryLabel,
  joinAccountMeta,
  maskedAccountLast4,
  resolveAccountDisplayName,
  statementAccountDisplayName,
  switcherAccountPresentation,
} from "../accountListLabel";

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

  it("applies the same generic priority across several account shapes", () => {
    const shapes: Array<{
      input: Parameters<typeof resolveAccountDisplayName>[0];
      primary: string;
      secondary?: string;
      fullMustNotPrefixProduct?: boolean;
    }> = [
      {
        input: {
          nickname: "Rainy Day",
          accountName: "High Interest Savings",
          bankName: "Example Credit Union",
          fallback: "1001",
        },
        primary: "Rainy Day",
        secondary: "Example Credit Union",
      },
      {
        input: {
          accountName: "Chequing",
          bankName: "Example Bank",
          fallback: "2002",
        },
        primary: "Chequing",
        secondary: "Example Bank",
      },
      {
        input: {
          accountName: "Example Bank",
          bankName: "Example Bank",
          historyLabel: "Everyday Chequing",
          fallback: "3003",
        },
        primary: "Everyday Chequing",
        secondary: "Example Bank",
      },
      {
        input: {
          bankName: "Example Bank",
          historyLabel: "Everyday Chequing",
          fallback: "3003",
        },
        primary: "Everyday Chequing",
        secondary: "Example Bank",
      },
      {
        input: { bankName: "Example Bank", fallback: "4004" },
        primary: "Example Bank",
      },
      {
        input: { fallback: "5005" },
        primary: "5005",
      },
      {
        input: {
          accountName: "Real Estate Co",
          bankName: "Unknown Bank",
          fallback: "6006",
        },
        primary: "Real Estate Co",
        fullMustNotPrefixProduct: true,
      },
      {
        input: {
          accountName: "Product Truncated",
          bankName: "Unknown Bank",
        },
        primary: "Product Truncated",
        fullMustNotPrefixProduct: true,
      },
    ];

    for (const shape of shapes) {
      const resolved = resolveAccountDisplayName(shape.input);
      expect(resolved.primary, JSON.stringify(shape.input)).toBe(shape.primary);
      if (shape.secondary) {
        expect(resolved.secondary, JSON.stringify(shape.input)).toBe(shape.secondary);
      }
      if (shape.fullMustNotPrefixProduct) {
        expect(resolved.full.startsWith("Unknown Bank")).toBe(false);
        expect(resolved.secondary).toBeUndefined();
      }
    }
  });

  it("does not prefix a placeholder institution onto a product name", () => {
    expect(
      resolveAccountDisplayName({
        accountName: "Brokerage",
        bankName: "Unknown Bank",
      })
    ).toEqual({
      primary: "Brokerage",
      full: "Brokerage",
    });
    expect(
      statementAccountDisplayName(
        { accountName: "Chequing", bankName: "Unknown" },
        "abc-chequing-1111"
      )
    ).toBe("Chequing");
  });
});

describe("compactAccountDisplayName", () => {
  it("appends masked last4 when the resolved name is the institution, so same-bank accounts stay distinct", () => {
    expect(
      statementAccountDisplayName({ bankName: "Example Bank" }, "7780")
    ).toBe("Example Bank •••7780");
    expect(
      statementAccountDisplayName({ bankName: "Example Bank" }, "3156")
    ).toBe("Example Bank •••3156");
    expect(
      compactAccountDisplayName(
        { accountName: "Example Bank", bankName: "Example Bank" },
        "ex-checking-7780"
      )
    ).toBe("Example Bank •••7780");
  });

  it("does not append last4 when a product or nickname is the primary name", () => {
    expect(
      statementAccountDisplayName(
        { accountName: "Chequing", bankName: "Example Bank" },
        "2002"
      )
    ).toBe("Chequing");
    expect(
      compactAccountDisplayName(
        { nickname: "Rainy Day", bankName: "Example Bank" },
        "1001"
      )
    ).toBe("Rainy Day");
  });

  it("never emits a raw account number; uses masked last4 or Account", () => {
    const fullId = "1234567890123456";
    expect(statementAccountDisplayName({ bankName: "Example Bank" }, fullId)).toBe(
      "Example Bank •••3456"
    );
    expect(statementAccountDisplayName({}, fullId)).toBe("•••3456");
    expect(statementAccountDisplayName({})).toBe("Account");
    expect(statementAccountDisplayName({ bankName: "Example Bank" }, fullId)).not.toContain(fullId);
    expect(maskedAccountLast4(fullId)).toBe("•••3456");
    expect(maskedAccountLast4("unknown")).toBe("");
  });

  it("does not fold last4 into resolveAccountDisplayName primary (lists / switcher keep it as meta)", () => {
    expect(
      resolveAccountDisplayName({
        bankName: "Example Bank",
        fallback: "7780",
      }).primary
    ).toBe("Example Bank");
  });
});

describe("displayNameFromProfileAccount", () => {
  it("uses each account's own snapshot/history, not a cached institution · last4 label", () => {
    const profile = {
      accountSnapshots: [
        { slug: "1001", accountName: "Example Credit Union", bankName: "Example Credit Union" },
        { slug: "2002", accountName: "Chequing", bankName: "Example Bank" },
        { slug: "6006", accountName: "Real Estate Co", bankName: "Unknown Bank" },
      ],
      accountBalanceHistory: [{ slug: "1001", label: "Everyday Chequing" }],
    };
    expect(
      displayNameFromProfileAccount("1001", profile, "Example Credit Union · •••1001")
    ).toBe("Everyday Chequing");
    expect(displayNameFromProfileAccount("2002", profile, "Example Bank · •••2002")).toBe(
      "Chequing"
    );
    expect(displayNameFromProfileAccount("6006", profile, "Unknown Bank · REAL ES...")).toBe(
      "Real Estate Co"
    );
  });

  it("distinguishes two same-institution accounts with last4 when neither has a product name", () => {
    const profile = {
      accountSnapshots: [
        { slug: "7780", accountName: "Example Bank", bankName: "Example Bank" },
        { slug: "3156", bankName: "Example Bank" },
      ],
    };
    expect(displayNameFromProfileAccount("7780", profile)).toBe("Example Bank •••7780");
    expect(displayNameFromProfileAccount("3156", profile)).toBe("Example Bank •••3156");
  });
});

describe("switcherAccountPresentation", () => {
  it("uses the resolved product name, with institution and last4 as search/meta", () => {
    const row = switcherAccountPresentation(
      { slug: "ex-checking-2002", bankName: "Example Bank", accountName: "Chequing" },
      { groupLabel: "Cash & Savings", last4: "•••2002" }
    );
    expect(row.label).toBe("Chequing");
    expect(row.sub).toContain("Example Bank");
    expect(row.sub).toContain("•••2002");
    expect(row.label.startsWith("Example Bank ·")).toBe(false);
    expect(accountMatchesQuery("cheq", row.label, row.sub, row.searchText)).toBe(true);
    expect(accountMatchesQuery("example", row.label, row.sub, row.searchText)).toBe(true);
    expect(accountMatchesQuery("2002", row.label, row.sub, row.searchText)).toBe(true);
    expect(accountMatchesQuery("zzz", row.label, row.sub, row.searchText)).toBe(false);
  });

  it("keeps last4 on the meta line only when the title is the institution", () => {
    const row = switcherAccountPresentation(
      { slug: "7780", bankName: "Example Bank" },
      { groupLabel: "Cash & Savings", last4: "•••7780" }
    );
    expect(row.label).toBe("Example Bank");
    expect(row.label).not.toContain("•••7780");
    expect(row.sub).toContain("•••7780");
  });

  it("matches a history product name and last4 even when the latest snapshot has no product", () => {
    const row = switcherAccountPresentation(
      { slug: "1001", bankName: "Example Credit Union" },
      {
        groupLabel: "Cash & Savings",
        last4: "•••1001",
        historyLabel: "Everyday Chequing",
      }
    );
    expect(row.label).toBe("Everyday Chequing");
    expect(accountMatchesQuery("everyday", row.searchText)).toBe(true);
    expect(accountMatchesQuery("credit union", row.searchText)).toBe(true);
    expect(accountMatchesQuery("1001", row.searchText)).toBe(true);
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
