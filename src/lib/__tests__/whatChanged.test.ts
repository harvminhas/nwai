import { describe, expect, it } from "vitest";
import {
  buildWhatChanged,
  finalizeDrivers,
  periodPhrase,
  roundCents,
  type WaterfallRow,
} from "../whatChanged";

const months = [
  {
    month: "2026-08",
    accountDetails: [
      { slug: "chk", label: "Chequing", type: "checking", value: 8000 },
      { slug: "tfsa", label: "TFSA", type: "tfsa", value: 20000 },
      { slug: "broker", label: "Brokerage", type: "investment", value: 10000 },
      { slug: "visa", label: "Visa", type: "credit", value: -2000 },
    ],
  },
  {
    month: "2026-09",
    accountDetails: [
      { slug: "chk", label: "Chequing", type: "checking", value: 9000 },
      { slug: "tfsa", label: "TFSA", type: "tfsa", value: 21000 },
      { slug: "broker", label: "Brokerage", type: "investment", value: 10500 },
      { slug: "eq", label: "EQ Bank Savings", type: "savings", value: 4000 },
      { slug: "visa", label: "Visa", type: "credit", value: -1800 },
    ],
  },
  {
    month: "2026-10",
    accountDetails: [
      { slug: "chk", label: "Chequing", type: "checking", value: 11000 },
      { slug: "tfsa", label: "TFSA", type: "tfsa", value: 22100 },
      { slug: "broker", label: "Brokerage", type: "investment", value: 10800 },
      { slug: "eq", label: "EQ Bank Savings", type: "savings", value: 4100 },
      { slug: "visa", label: "Visa", type: "credit", value: -1500 },
      { slug: "manual-civic", label: "Honda Civic", type: "manual-vehicle", value: 18000 },
      { slug: "manual-house", label: "Home", type: "manual-property", value: 502000 },
    ],
  },
];

const priorAugust = months[0];
const rangeSepOct = months.slice(1);

function drivers(rows: WaterfallRow[]): WaterfallRow[] {
  return rows.filter((r) => r.kind === "driver");
}

function amount(rows: WaterfallRow[], key: string): number {
  return rows.find((r) => r.key === key)?.amount ?? 0;
}

function reconcile(start: number, rows: WaterfallRow[], end: number) {
  const sum = roundCents(start + drivers(rows).reduce((s, r) => s + r.amount, 0));
  expect(sum).toBe(roundCents(end));
}

describe("buildWhatChanged assets", () => {
  it("reconciles start + drivers to end with known splits, new accounts, and manuals", () => {
    const model = buildWhatChanged({
      kind: "asset",
      months: rangeSepOct,
      priorMonth: {
        month: "2026-08",
        accountDetails: [
          ...priorAugust.accountDetails!,
          { slug: "manual-house", label: "Home", type: "manual-property", value: 500000 },
        ],
      },
      expenseTxns: [],
      incomeTxns: [
        { txMonth: "2026-09", amount: 500, accountSlug: "tfsa", category: "Transfer In" },
        { txMonth: "2026-10", amount: 500, accountSlug: "tfsa", category: "Transfer In" },
        { txMonth: "2026-10", amount: 100, accountSlug: "tfsa", category: "Dividend" },
        { txMonth: "2026-10", amount: 200, accountSlug: "broker", category: "Transfer In" },
      ],
      currency: "CAD",
      range: "1Y",
    })!;
    expect(model.header).toMatch(/Sep 2026 – Oct 2026/);
    expect(model.header).toMatch(/accounts/);
    expect(model.title).toBe("What moved your total");
    reconcile(model.start, model.rows, model.end);
    expect(model.start).toBe(8000 + 20000 + 10000 + 500000);
    expect(model.end).toBe(11000 + 22100 + 10800 + 4100 + 18000 + 502000);

    const d = drivers(model.rows);
    expect(amount(d, "contrib-registered")).toBe(1000);
    expect(amount(d, "market-registered")).toBe(1100);
    expect(amount(d, "contrib-investments")).toBe(200);
    expect(amount(d, "market-investments")).toBe(600);
    expect(amount(d, "cash-net")).toBe(3000);
    expect(amount(d, "new-accounts")).toBe(4100 + 18000);
    expect(amount(d, "property")).toBe(2000);
    expect(d.find((r) => r.key === "property")?.badge).toBe("Manual");
    expect(d.find((r) => r.key === "new-accounts")?.label).toBe("New accounts");
    expect(model.summary).toMatch(/over the last 12 months/);
    expect(model.summary).toMatch(/money you put in/);
    expect(model.summary).toMatch(/manual estimates/);
  });

  it("labels net withdrawals and does not invent a contribution", () => {
    const model = buildWhatChanged({
      kind: "asset",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 7000 }],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 10000 }],
      },
      expenseTxns: [{ txMonth: "2026-12", amount: 4000, accountSlug: "tfsa", category: "Transfer Out" }],
      incomeTxns: [],
      currency: "CAD",
      range: "1Y",
    })!;
    reconcile(model.start, model.rows, model.end);
    const row = drivers(model.rows).find((r) => r.key === "contrib-registered")!;
    expect(row.label).toBe("Withdrawals from registered accounts");
    expect(row.amount).toBe(-4000);
    expect(model.summary).not.toMatch(/put in/);
  });

  it("explains a drop even when contributions were positive", () => {
    const model = buildWhatChanged({
      kind: "asset",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 9000 }],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 10000 }],
      },
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-12", amount: 5000, accountSlug: "tfsa", category: "Transfer In" }],
      currency: "CAD",
      range: "1Y",
    })!;
    reconcile(model.start, model.rows, model.end);
    expect(model.summary).toBe(
      "Your assets went down CA$1,000 over the last 12 months. You put in CA$5,000, so markets and other changes were −CA$6,000.",
    );
  });

  it("signs manual estimates in the summary", () => {
    const model = buildWhatChanged({
      kind: "asset",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "manual-civic", label: "Civic", type: "manual-vehicle", value: 15000 }],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "manual-civic", label: "Civic", type: "manual-vehicle", value: 18000 }],
      },
      expenseTxns: [],
      incomeTxns: [],
      currency: "CAD",
      range: "YTD",
    })!;
    reconcile(model.start, model.rows, model.end);
    expect(model.summary).toMatch(/this year/);
    expect(model.summary).toMatch(/−CA\$3,000 came from manual estimates/);
  });

  it("falls back to a single Change — category row when the split is unknown", () => {
    const model = buildWhatChanged({
      kind: "asset",
      months: [
        {
          month: "2026-12",
          accountDetails: [
            { slug: "tfsa", label: "TFSA", type: "tfsa", value: 12000 },
            { slug: "broker", label: "Brokerage", type: "investment", value: 8000 },
          ],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [
          { slug: "tfsa", label: "TFSA", type: "tfsa", value: 10000 },
          { slug: "broker", label: "Brokerage", type: "investment", value: 9000 },
        ],
      },
      expenseTxns: [],
      incomeTxns: [],
      currency: "CAD",
      range: "1Y",
    })!;
    reconcile(model.start, model.rows, model.end);
    const d = drivers(model.rows);
    expect(d.find((r) => r.key === "contrib-registered")).toBeUndefined();
    expect(d.find((r) => r.key === "market-registered")).toBeUndefined();
    expect(d.find((r) => r.key === "contrib-investments")).toBeUndefined();
    expect(d.find((r) => r.label === "Change — Registered (RRSP/TFSA)")?.amount).toBe(2000);
    expect(d.find((r) => r.label === "Change — Investments")?.amount).toBe(-1000);
  });

  it("lists a new account's opening separately from registered market growth", () => {
    const model = buildWhatChanged({
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
      range: "YTD",
    })!;
    reconcile(model.start, model.rows, model.end);
    expect(model.start).toBe(0);
    expect(amount(drivers(model.rows), "new-accounts")).toBe(5000);
    expect(amount(drivers(model.rows), "market-registered")).toBe(300);
    expect(drivers(model.rows).find((r) => r.key === "contrib-registered")).toBeUndefined();
  });

  it("badges vehicle depreciation as Manual", () => {
    const model = buildWhatChanged({
      kind: "asset",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "manual-civic", label: "Civic", type: "manual-vehicle", value: 17000 }],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "manual-civic", label: "Civic", type: "manual-vehicle", value: 18000 }],
      },
      expenseTxns: [],
      incomeTxns: [],
      currency: "CAD",
      range: "1Y",
    })!;
    reconcile(model.start, model.rows, model.end);
    const vehicle = drivers(model.rows).find((r) => r.key === "vehicle")!;
    expect(vehicle.label).toBe("Vehicle depreciation");
    expect(vehicle.amount).toBe(-1000);
    expect(vehicle.badge).toBe("Manual");
  });
});

describe("buildWhatChanged debts", () => {
  it("reconciles payments, charges, and interest to the end balance", () => {
    const model = buildWhatChanged({
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
      range: "1Y",
    })!;
    expect(model.title).toBe("What moved your debt");
    reconcile(model.start, model.rows, model.end);
    expect(model.start).toBe(2000);
    expect(model.end).toBe(1750);
    expect(amount(drivers(model.rows), "payments")).toBe(-500);
    expect(amount(drivers(model.rows), "charges")).toBe(200);
    expect(amount(drivers(model.rows), "interest-fees")).toBe(50);
    expect(model.summary).toMatch(/went down/);
    expect(model.summary).toMatch(/you paid/);
    expect(model.summary).toMatch(/new charges/);
    expect(model.summary).toMatch(/interest/);
  });

  it("falls back to Change — category when debt flows are unknown, and lists paid-off accounts", () => {
    const model = buildWhatChanged({
      kind: "debt",
      months: [
        {
          month: "2026-09",
          accountDetails: [
            { slug: "mort", label: "Mortgage", type: "mortgage", value: -240500 },
            { slug: "visa", label: "Visa", type: "credit", value: -900 },
          ],
        },
        {
          month: "2026-10",
          accountDetails: [{ slug: "mort", label: "Mortgage", type: "mortgage", value: -240000 }],
        },
      ],
      priorMonth: {
        month: "2026-08",
        accountDetails: [
          { slug: "mort", label: "Mortgage", type: "mortgage", value: -241000 },
          { slug: "visa", label: "Visa", type: "credit", value: -900 },
        ],
      },
      expenseTxns: [],
      incomeTxns: [],
      currency: "CAD",
      range: "1Y",
    })!;
    reconcile(model.start, model.rows, model.end);
    const d = drivers(model.rows);
    expect(d.find((r) => r.key === "payments")).toBeUndefined();
    expect(d.find((r) => r.label === "Change — Mortgage")?.amount).toBe(-1000); // 241000 → 240000
    expect(d.find((r) => r.key === "paid-off")?.amount).toBe(-900);
    expect(d.find((r) => r.label === "Debts paid off/closed")).toBeTruthy();
  });

  it("puts a new debt's opening on New debts, not in Payments", () => {
    const model = buildWhatChanged({
      kind: "debt",
      months: [
        {
          month: "2026-12",
          accountDetails: [
            { slug: "visa", label: "Visa", type: "credit", value: -1500 },
            { slug: "loc", label: "HELOC", type: "loc", value: -5000 },
          ],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "visa", label: "Visa", type: "credit", value: -1800 }],
      },
      expenseTxns: [{ txMonth: "2026-12", amount: 100, accountSlug: "visa", category: "Shopping" }],
      incomeTxns: [{ txMonth: "2026-12", amount: 400, accountSlug: "visa", category: "Other" }],
      currency: "CAD",
      range: "1Y",
    })!;
    reconcile(model.start, model.rows, model.end);
    expect(amount(drivers(model.rows), "new-debts")).toBe(5000);
    expect(amount(drivers(model.rows), "payments")).toBe(-400);
  });

  it("keeps mortgage payments exact and shows unitemized interest as a grey gap, not new charges", () => {
    const model = buildWhatChanged({
      kind: "debt",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "mort", label: "Mortgage", type: "mortgage", value: -228000 }],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "mort", label: "Mortgage", type: "mortgage", value: -240000 }],
      },
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-12", amount: 24000, accountSlug: "mort", category: "Other" }],
      currency: "CAD",
      range: "1Y",
    })!;
    reconcile(model.start, model.rows, model.end);
    expect(model.start).toBe(240000);
    expect(model.end).toBe(228000);
    const d = drivers(model.rows);
    expect(amount(d, "payments")).toBe(-24000);
    expect(d.find((r) => r.key === "charges")).toBeUndefined();
    expect(d.find((r) => r.key === "interest-fees")).toBeUndefined();
    const gap = d.find((r) => r.key === "other-gap")!;
    expect(gap.label).toBe("Other changes (not in your transactions)");
    expect(gap.amount).toBe(12000);
    expect(gap.tone).toBe("neutral");
    expect(model.summary).toMatch(/went down CA\$12,000 over the last 12 months/);
    expect(model.summary).toMatch(/you paid CA\$24,000/);
    expect(model.summary).not.toMatch(/new charges/);
  });

  it("does not show Payments on a mixed known/unknown card", () => {
    const model = buildWhatChanged({
      kind: "debt",
      months: [
        {
          month: "2026-12",
          accountDetails: [
            { slug: "visa", label: "Visa", type: "credit", value: -1500 },
            { slug: "amex", label: "Amex", type: "credit", value: -3200 },
          ],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [
          { slug: "visa", label: "Visa", type: "credit", value: -2000 },
          { slug: "amex", label: "Amex", type: "credit", value: -3000 },
        ],
      },
      expenseTxns: [{ txMonth: "2026-12", amount: 100, accountSlug: "visa", category: "Shopping" }],
      incomeTxns: [{ txMonth: "2026-12", amount: 500, accountSlug: "visa", category: "Other" }],
      currency: "CAD",
      range: "1Y",
    })!;
    reconcile(model.start, model.rows, model.end);
    const d = drivers(model.rows);
    expect(d.find((r) => r.key === "payments")).toBeUndefined();
    expect(d.find((r) => r.key === "charges")).toBeUndefined();
    expect(d.find((r) => r.label === "Change — Credit Cards")?.amount).toBe(-300);
  });
});

describe("periodPhrase", () => {
  it("uses range-specific wording", () => {
    expect(periodPhrase("1Y")).toBe("over the last 12 months");
    expect(periodPhrase("YTD")).toBe("this year");
    expect(periodPhrase("6M")).toBe("over the last 6 months");
    expect(periodPhrase("3Y")).toBe("over the last 3 years");
    expect(periodPhrase("All", "2024-03")).toBe("since Mar 2024");
  });
});

describe("finalizeDrivers cent reconciliation", () => {
  it("folds a sub-$0.50 remainder into the nearest kept row so start + rows = end", () => {
    const out = finalizeDrivers(1000.1, 1100.33, [
      { key: "contrib-registered", label: "Contributions to registered accounts", amount: 100.2 },
      { key: "market-registered", label: "Market growth — registered", amount: 0.03 },
    ]);
    expect(out.start).toBe(1000.1);
    expect(out.end).toBe(1100.33);
    expect(out.drivers.find((d) => d.key === "market-registered")).toBeUndefined();
    expect(out.drivers.find((d) => d.key === "contrib-registered")?.amount).toBe(100.23);
    expect(roundCents(out.start + out.drivers.reduce((s, d) => s + d.amount, 0))).toBe(out.end);
  });

  it("keeps a tiny leftover as the gap row when nothing else remains", () => {
    const out = finalizeDrivers(1000, 1000.33, [
      { key: "contrib-registered", label: "Contributions to registered accounts", amount: 0.33 },
    ]);
    expect(out.drivers).toEqual([
      { key: "other-gap", label: "Other changes (not in your transactions)", amount: 0.33 },
    ]);
    expect(roundCents(out.start + out.drivers.reduce((s, d) => s + d.amount, 0))).toBe(out.end);
  });

  it("reconciles a live asset waterfall that would otherwise drift by cents", () => {
    const model = buildWhatChanged({
      kind: "asset",
      months: [
        {
          month: "2026-12",
          accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 1100.33 }],
        },
      ],
      priorMonth: {
        month: "2026-11",
        accountDetails: [{ slug: "tfsa", label: "TFSA", type: "tfsa", value: 1000.1 }],
      },
      expenseTxns: [],
      incomeTxns: [{ txMonth: "2026-12", amount: 100.2, accountSlug: "tfsa", category: "Transfer In" }],
      currency: "CAD",
      range: "1Y",
    })!;
    reconcile(model.start, model.rows, model.end);
    expect(model.start).toBe(1000.1);
    expect(model.end).toBe(1100.33);
  });
});
