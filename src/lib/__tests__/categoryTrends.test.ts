import { describe, expect, it } from "vitest";
import { assetCategory } from "../assetsSummary";
import {
  buildCategoryTrendCards,
  describeAssetChangePill,
  describeDebtChangePill,
} from "../categoryTrends";
import { debtCategory } from "../debtsSummary";
import { priorMonthBeforeRange, sliceMonthsByTrendRange } from "../trendRange";

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

const priorAugust = months[0];
const rangeSepOct = months.slice(1);

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

  it("starts existing accounts from the prior month, not the first in-range ending balance", () => {
    const cards = buildCategoryTrendCards({
      kind: "asset",
      months: rangeSepOct,
      priorMonth: priorAugust,
      expenseTxns: [],
      incomeTxns: [],
      currency: "CAD",
    });
    const cash = cards.find((c) => c.key === "cash")!;
    // Chequing: Aug $8,000 → Oct $11,000. EQ is new (start 0).
    expect(cash.start).toBe(8000);
    expect(cash.current).toBe(15100);
    expect(cash.change).toBe(7100);
    const chk = cash.accounts.find((a) => a.slug === "chk")!;
    expect(chk.start).toBe(8000);
    expect(chk.openedInRange).toBe(false);
  });

  it("counts a new account's opening deposit as a contribution, not as the start balance", () => {
    const cards = buildCategoryTrendCards({
      kind: "asset",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 5300 }],
        },
      ],
      priorMonth: { month: "2026-11", accountDetails: [] },
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-12", amount: 5000, accountSlug: "tfsa", category: "Transfer In" }],
      currency: "CAD",
    });
    const registered = cards.find((c) => c.key === "registered")!;
    expect(registered.start).toBe(0);
    expect(registered.current).toBe(5300);
    expect(registered.change).toBe(5300);
    expect(registered.subtitle).toMatch(/Contributions CA\$5,000/);
    expect(registered.subtitle).toMatch(/Market growth CA\$300/);
    expect(registered.subtitle).not.toMatch(/−CA\$4,700/);
    expect(registered.newAccountNote).toMatch(/Opened this period: TFSA/);
    expect(registered.accounts[0].openedInRange).toBe(true);
  });

  it("does not double-count the first in-range month's deposit against that month's ending balance", () => {
    // Bug: start = Dec end $10,000 (includes $1,000 Dec deposit) + count Dec+$1,000 later
    //   → Contributions $2,000 · Market growth $0
    // Fix: start = Nov $9,000, count both in-range deposits
    //   → Contributions $2,000 · Market growth $1,000
    // One-month form: Nov $8,000 → Dec $10,000 with $1,000 Dec deposit
    //   → Contributions $1,000 · Market growth $1,000
    const oneMonth = buildCategoryTrendCards({
      kind: "asset",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 10000 }],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 8000 }],
      },
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-12", amount: 1000, accountSlug: "tfsa", category: "Transfer In" }],
      currency: "CAD",
    });
    const dec = oneMonth.find((c) => c.key === "registered")!;
    expect(dec.start).toBe(8000);
    expect(dec.current).toBe(10000);
    expect(dec.subtitle).toMatch(/Contributions CA\$1,000/);
    expect(dec.subtitle).toMatch(/Market growth CA\$1,000/);

    const twoMonth = buildCategoryTrendCards({
      kind: "asset",
      months: [
        {
          month: "2025-12",
          accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 10000 }],
        },
        {
          month: "2026-11",
          accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 12000 }],
        },
      ],
      priorMonth: {
        month: "2025-11",
        accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 9000 }],
      },
      expenseTxns: [],
      incomeTxns: [
        { txMonth: "2025-12", amount: 1000, accountSlug: "tfsa", category: "Transfer In" },
        { txMonth: "2026-11", amount: 1000, accountSlug: "tfsa", category: "Transfer In" },
      ],
      currency: "CAD",
    });
    const span = twoMonth.find((c) => c.key === "registered")!;
    expect(span.start).toBe(9000);
    expect(span.current).toBe(12000);
    expect(span.subtitle).toMatch(/Contributions CA\$2,000/);
    expect(span.subtitle).toMatch(/Market growth CA\$1,000/);
    expect(span.subtitle).not.toMatch(/Market growth CA\$0/);
  });

  it("prints a minus sign when market growth is negative", () => {
    const cards = buildCategoryTrendCards({
      kind: "asset",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 5300 }],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 10000 }],
      },
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-12", amount: 0, accountSlug: "tfsa", category: "Transfer In" }],
      currency: "CAD",
    });
    // Known flows, start 10000, end 5300, put-in ~0 → market −$4,700
    const registered = cards.find((c) => c.key === "registered")!;
    expect(registered.change).toBe(-4700);
    expect(registered.subtitle).toMatch(/Market growth −CA\$4,700/);
    expect(registered.subtitle).not.toMatch(/Market growth CA\$4,700/);
  });

  it("counts dividends as market growth, not contributions", () => {
    const cards = buildCategoryTrendCards({
      kind: "asset",
      months: rangeSepOct,
      priorMonth: priorAugust,
      expenseTxns: [],
      incomeTxns: [
        { txMonth: "2026-10", amount: 100, accountSlug: "tfsa", category: "Dividend" },
        { txMonth: "2026-09", amount: 500, accountSlug: "tfsa", category: "Transfer In" },
        { txMonth: "2026-10", amount: 500, accountSlug: "tfsa", category: "Transfer In" },
      ],
      currency: "CAD",
    });
    const registered = cards.find((c) => c.key === "registered")!;
    expect(registered.start).toBe(20000);
    expect(registered.current).toBe(22100);
    expect(registered.subtitle).toMatch(/Contributions CA\$1,000/);
    expect(registered.subtitle).not.toMatch(/Contributions CA\$1,100/);
    expect(registered.subtitle).toMatch(/Market growth CA\$1,100/);
  });

  it("uses prior-month owed for debt flows so first-month payments are not double counted", () => {
    const cards = buildCategoryTrendCards({
      kind: "debt",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "visa", label: "Visa", type: "credit", value: -1750 }],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "visa", label: "Visa", type: "credit", value: -2000 }],
      },
      expenseTxns: [
        { txMonth: "2026-12", amount: 50, accountSlug: "visa", category: "Interest" },
        { txMonth: "2026-12", amount: 200, accountSlug: "visa", category: "Shopping" },
      ],
      incomeTxns: [{ txMonth: "2026-12", amount: 500, accountSlug: "visa", category: "Other" }],
      currency: "CAD",
    });
    const credit = cards.find((c) => c.key === "credit_card")!;
    expect(credit.start).toBe(2000);
    expect(credit.current).toBe(1750);
    expect(credit.change).toBe(-250);
    expect(credit.subtitle).toBe("Paid CA$500 · New charges CA$200 · Interest CA$50");
  });

  it("omits the debt flow line unless every account in the card has transactions", () => {
    const cards = buildCategoryTrendCards({
      kind: "debt",
      months: [
        {
          month: "2026-12",
          accountDetails: [
            { slug: "visa", label: "Visa", type: "credit", value: -1500 },
            { slug: "amex", label: "Amex", type: "credit", value: -800 },
          ],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [
          { slug: "visa", label: "Visa", type: "credit", value: -1600 },
          { slug: "amex", label: "Amex", type: "credit", value: -800 },
        ],
      },
      expenseTxns: [{ txMonth: "2026-12", amount: 40, accountSlug: "visa", category: "Interest" }],
      incomeTxns: [{ txMonth: "2026-12", amount: 140, accountSlug: "visa", category: "Other" }],
      currency: "CAD",
    });
    const credit = cards.find((c) => c.key === "credit_card")!;
    expect(credit.accountCount).toBe(2);
    expect(credit.subtitle).toBeNull();
  });

  it("uses debt grouping and Paid down / Grew colour semantics", () => {
    const cards = buildCategoryTrendCards({
      kind: "debt",
      months: rangeSepOct,
      priorMonth: priorAugust,
      expenseTxns: [
        { txMonth: "2026-10", amount: 40, accountSlug: "visa", category: "Interest" },
        { txMonth: "2026-10", amount: 200, accountSlug: "visa", category: "Shopping" },
        { txMonth: "2026-09", amount: 40, accountSlug: "visa", category: "Interest" },
        { txMonth: "2026-09", amount: 200, accountSlug: "visa", category: "Shopping" },
      ],
      incomeTxns: [
        { txMonth: "2026-10", amount: 740, accountSlug: "visa", category: "Other" },
        { txMonth: "2026-09", amount: 740, accountSlug: "visa", category: "Other" },
      ],
      currency: "CAD",
    });
    const credit = cards.find((c) => c.key === "credit_card")!;
    expect(credit.current).toBe(1500);
    expect(credit.start).toBe(2000);
    expect(credit.change).toBe(-500);
    expect(credit.subtitle).toMatch(/Paid/);
    expect(credit.subtitle).toMatch(/New charges/);
    expect(credit.subtitle).toMatch(/Interest/);
    const pill = describeDebtChangePill(credit.change, "CAD");
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
      priorMonth: {
        month: "2026-08",
        accountDetails: [{ slug: "visa", label: "Visa", type: "credit", value: -900 }],
      },
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
    expect(describeAssetChangePill(-4700, -0.47, "CAD").text).toMatch(/^−/);
  });
});

describe("trend range", () => {
  it("slices 6M / YTD / 1Y from a longer series and keeps a prior month for 1Y", () => {
    const history = [];
    for (let i = 0; i < 18; i++) {
      const d = new Date(2025, i, 1);
      const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      history.push({ month });
    }
    expect(sliceMonthsByTrendRange(history, "6M")).toHaveLength(6);
    const oneYear = sliceMonthsByTrendRange(history, "1Y");
    expect(oneYear).toHaveLength(12);
    const prior = priorMonthBeforeRange(history, oneYear);
    expect(prior?.month).toBe(history[history.length - 13].month);
    const ytd = sliceMonthsByTrendRange(history, "YTD");
    expect(ytd.every((m) => m.month.startsWith("2026-"))).toBe(true);
  });
});
