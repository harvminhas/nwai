import { describe, expect, it } from "vitest";
import { buildWhatChanged, type WaterfallRow } from "../whatChanged";

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
  const sum = start + drivers(rows).reduce((s, r) => s + r.amount, 0);
  expect(sum).toBeCloseTo(end, 6);
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
    expect(model.summary).toMatch(/money you put in/);
    expect(model.summary).toMatch(/manual estimates/);
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
});
