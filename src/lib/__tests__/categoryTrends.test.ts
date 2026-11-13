import { describe, expect, it } from "vitest";
import { assetCategory } from "../assetsSummary";
import {
  buildCategoryTrendCards,
  describeAssetChangePill,
  describeDebtChangePill,
} from "../categoryTrends";
import { debtCategory } from "../debtsSummary";
import { sliceMonthsByTrendRange } from "../trendRange";

const months = [
  {
    month: "2026-08",
    accountDetails: [
      { slug: "chk", label: "Chequing", type: "checking", value: 8000 },
      { slug: "tfsa", label: "TFSA", type: "tfsa", value: 20000 },
      { slug: "visa", label: "Visa", type: "credit", value: -2000 },
    ],
  },
  {
    month: "2026-09",
    accountDetails: [
      { slug: "chk", label: "Chequing", type: "checking", value: 9000 },
      { slug: "tfsa", label: "TFSA", type: "tfsa", value: 21000 },
      { slug: "eq", label: "EQ Bank Savings", type: "savings", value: 4000 },
      { slug: "visa", label: "Visa", type: "credit", value: -1800 },
    ],
  },
  {
    month: "2026-10",
    accountDetails: [
      { slug: "chk", label: "Chequing", type: "checking", value: 11000 },
      { slug: "tfsa", label: "TFSA", type: "tfsa", value: 22100 },
      { slug: "eq", label: "EQ Bank Savings", type: "savings", value: 4100 },
      { slug: "visa", label: "Visa", type: "credit", value: -1500 },
      { slug: "manual-civic", label: "Honda Civic", type: "manual-vehicle", value: 18000 },
    ],
  },
];

describe("buildCategoryTrendCards", () => {
  it("matches page totals from accountDetails for each category", () => {
    const cards = buildCategoryTrendCards({
      kind: "asset",
      months,
      expenseTxns: [],
      incomeTxns: [],
      currency: "CAD",
    });
    const cash = cards.find((c) => c.key === "cash")!;
    const registered = cards.find((c) => c.key === "registered")!;
    const other = cards.find((c) => c.key === "other")!;
    expect(cash.current).toBe(11000 + 4100);
    expect(registered.current).toBe(22100);
    expect(other.current).toBe(18000);
    expect(cash.current + registered.current + other.current).toBe(
      months[2].accountDetails!.filter((a) => a.value > 0).reduce((s, a) => s + a.value, 0),
    );
  });

  it("does not treat a new account's opening balance as growth", () => {
    const cards = buildCategoryTrendCards({
      kind: "asset",
      months,
      expenseTxns: [],
      incomeTxns: [],
      currency: "CAD",
    });
    const cash = cards.find((c) => c.key === "cash")!;
    // Chequing 8000→11000 (+3000) and EQ first-balance 4000→4100 (+100), not +4100
    expect(cash.start).toBe(8000 + 4000);
    expect(cash.current).toBe(15100);
    expect(cash.change).toBe(3100);
    expect(cash.newAccountNote).toMatch(/EQ Bank Savings/);
    const eq = cash.accounts.find((a) => a.slug === "eq")!;
    expect(eq.openedInRange).toBe(true);
    expect(eq.start).toBe(4000);
  });

  it("counts dividends as market growth, not contributions", () => {
    const cards = buildCategoryTrendCards({
      kind: "asset",
      months,
      expenseTxns: [],
      incomeTxns: [
        { txMonth: "2026-10", amount: 100, accountSlug: "tfsa", category: "Dividend" },
        { txMonth: "2026-08", amount: 500, accountSlug: "tfsa", category: "Transfer In" },
        { txMonth: "2026-09", amount: 500, accountSlug: "tfsa", category: "Transfer In" },
        { txMonth: "2026-10", amount: 500, accountSlug: "tfsa", category: "Transfer In" },
      ],
      currency: "CAD",
    });
    const registered = cards.find((c) => c.key === "registered")!;
    expect(registered.subtitle).toMatch(/Contributions/);
    expect(registered.subtitle).not.toMatch(/CA\$1,600/);
    expect(registered.subtitle).toMatch(/CA\$1,500/);
  });

  it("uses debt grouping and Paid down / Grew colour semantics", () => {
    const cards = buildCategoryTrendCards({
      kind: "debt",
      months,
      expenseTxns: [
        { txMonth: "2026-10", amount: 40, accountSlug: "visa", category: "Interest" },
        { txMonth: "2026-10", amount: 200, accountSlug: "visa", category: "Shopping" },
      ],
      incomeTxns: [{ txMonth: "2026-10", amount: 740, accountSlug: "visa", category: "Other" }],
      currency: "CAD",
    });
    const cardsOnly = cards.find((c) => c.key === "credit_card")!;
    expect(cardsOnly.current).toBe(1500);
    expect(cardsOnly.change).toBe(-500);
    expect(cardsOnly.subtitle).toMatch(/Paid/);
    expect(cardsOnly.subtitle).toMatch(/New charges/);
    expect(cardsOnly.subtitle).toMatch(/Interest/);
    const pill = describeDebtChangePill(cardsOnly.change, "CAD");
    expect(pill.text).toMatch(/Paid down/);
    expect(pill.tone).toBe("down");
    const grew = describeDebtChangePill(200, "CAD");
    expect(grew.text).toMatch(/Grew/);
    expect(grew.tone).toBe("up");
  });

  it("does not carry a closed account's last-seen balance as the current total", () => {
    const cards = buildCategoryTrendCards({
      kind: "debt",
      months: [
        {
          month: "2026-09",
          accountDetails: [{ slug: "visa", label: "Visa", type: "credit", value: -900 }],
        },
        {
          month: "2026-10",
          accountDetails: [],
        },
      ],
      expenseTxns: [],
      incomeTxns: [],
      currency: "CAD",
    });
    const credit = cards.find((c) => c.key === "credit_card")!;
    expect(credit.start).toBe(900);
    expect(credit.current).toBe(0);
    expect(credit.change).toBe(-900);
  });

  it("omits unknown purchase-price placeholders and flags stale manual valuations", () => {
    const cards = buildCategoryTrendCards({
      kind: "asset",
      months: [
        {
          month: "2026-10",
          accountDetails: [
            { slug: "manual-house", label: "Home", type: "manual-property", value: 500000 },
          ],
        },
      ],
      expenseTxns: [],
      incomeTxns: [],
      currency: "CAD",
      manualAssets: [
        {
          id: "house",
          label: "Home",
          category: "property",
          value: 500000,
          updatedAt: "2025-12-01T00:00:00Z",
          valuations: [
            {
              id: "v1",
              effectiveDate: "2025-12-01",
              valueCents: 50_000_000,
              createdAt: "2025-12-01T00:00:00Z",
            },
          ],
          annualGrowthRate: 3,
        },
      ],
    });
    const property = cards.find((c) => c.key === "property")!;
    expect(property.subtitle).toMatch(/Manual/);
    expect(property.subtitle).toMatch(/re-valued Dec 2025/);
    expect(property.subtitle).toMatch(/\+3% \/ year/);
    expect(property.subtitle).not.toMatch(/ADD PURCHASE PRICE/i);
    expect(property.staleNote).toMatch(/Valued \d+ mo ago/);
  });
});

describe("page grouping", () => {
  it("uses the same category keys as the Assets and Debts pages", () => {
    expect(assetCategory("tfsa", "TFSA")).toBe("registered");
    expect(assetCategory("savings", "EQ Bank Savings")).toBe("cash");
    expect(assetCategory("investment", "Brokerage")).toBe("investments");
    expect(assetCategory("manual-property", "Home")).toBe("property");
    expect(assetCategory("manual-vehicle", "Honda Civic")).toBe("other");
    expect(debtCategory("credit", "Visa")).toBe("credit_card");
    expect(debtCategory("loc", "HELOC")).toBe("loc");
    expect(debtCategory("mortgage", "Home")).toBe("mortgage");
    expect(debtCategory("auto_loan", "Car Loan")).toBe("other");
  });
});

describe("asset change pill", () => {
  it("is green for increases and red for decreases", () => {
    expect(describeAssetChangePill(1300, 0.16, "CAD").tone).toBe("up");
    expect(describeAssetChangePill(-400, -0.05, "CAD").tone).toBe("down");
  });
});

describe("trend range", () => {
  it("slices 6M / YTD / 1Y from a longer series", () => {
    const history = [];
    for (let i = 0; i < 18; i++) {
      const d = new Date(2025, i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      history.push({ month });
    }
    expect(sliceMonthsByTrendRange(history, "6M")).toHaveLength(6);
    expect(sliceMonthsByTrendRange(history, "1Y")).toHaveLength(12);
    const ytd = sliceMonthsByTrendRange(history, "YTD");
    expect(ytd.every((m) => m.month.startsWith("2026-"))).toBe(true);
  });
});
