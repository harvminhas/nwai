import { describe, expect, it } from "vitest";
import {
  filterPlannerLinkableTransactions,
  mapSpendingTransactionsToLinkable,
  reselectPlanById,
  togglePlannerTxSelection,
  type PlannerLinkableTransaction,
  type SpendingApiTransaction,
} from "../linkTransactions";

const apiTx = (
  fingerprint: string,
  overrides: Partial<SpendingApiTransaction> = {}
): SpendingApiTransaction => ({
  fingerprint,
  date: "2026-06-15",
  merchant: "Cafe",
  amount: 12.5,
  category: "Dining",
  ...overrides,
});

const linkable = (
  txFingerprint: string,
  overrides: Partial<PlannerLinkableTransaction> = {}
): PlannerLinkableTransaction => ({
  txFingerprint,
  date: "2026-06-15",
  merchant: "Cafe",
  amount: 12.5,
  category: "Dining",
  kind: "expense",
  ...overrides,
});

describe("mapSpendingTransactionsToLinkable", () => {
  it("maps spending-API fingerprint onto txFingerprint", () => {
    const mapped = mapSpendingTransactionsToLinkable([
      apiTx("fp-abc", { merchant: "Store", date: "2026-01-15", amount: 10, category: "Shopping" }),
    ]);
    expect(mapped).toEqual([
      {
        txFingerprint: "fp-abc",
        merchant: "Store",
        date: "2026-01-15",
        amount: 10,
        category: "Shopping",
        kind: "expense",
      },
    ]);
  });

  it("does not read a txFingerprint field from the spending API payload", () => {
    const raw = {
      fingerprint: "fp-1",
      merchant: "Cafe",
      date: "2026-02-01",
      amount: 4,
      category: "Dining",
    };
    expect((raw as { txFingerprint?: string }).txFingerprint).toBeUndefined();
    expect(mapSpendingTransactionsToLinkable([raw])[0].txFingerprint).toBe("fp-1");
  });

  it("drops rows with a missing fingerprint so row keys stay unique", () => {
    const mapped = mapSpendingTransactionsToLinkable([
      { merchant: "No fingerprint", date: "2026-01-16", amount: 5, category: "Other" },
      apiTx("fp-keep"),
      { fingerprint: "", merchant: "Empty", date: "2026-01-17", amount: 1, category: "Other" },
    ]);
    expect(mapped.map((tx) => tx.txFingerprint)).toEqual(["fp-keep"]);
    expect(mapped.every((tx) => Boolean(tx.txFingerprint))).toBe(true);
  });

  it("returns an empty list when the API omits transactions (expenseTxns-style miss)", () => {
    expect(mapSpendingTransactionsToLinkable(undefined)).toEqual([]);
    expect(mapSpendingTransactionsToLinkable([])).toEqual([]);
  });
});

describe("filterPlannerLinkableTransactions", () => {
  it("a future plan with only past transactions returns all of them", () => {
    const pastTxns: PlannerLinkableTransaction[] = [
      linkable("tickets", { date: "2026-03-01", merchant: "Airline" }),
      linkable("hotel", { date: "2026-04-15", merchant: "Hotel" }),
      linkable("gear", { date: "2026-05-20", merchant: "REI" }),
    ];
    const result = filterPlannerLinkableTransactions(pastTxns, {
      linkedFingerprints: [],
    });
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["gear", "hotel", "tickets"]);
  });

  it("results are ordered newest first", () => {
    const txns: PlannerLinkableTransaction[] = [
      linkable("new", { date: "2026-11-01", merchant: "New" }),
      linkable("mid", { date: "2026-06-15", merchant: "Mid" }),
      linkable("old", { date: "2026-01-01", merchant: "Old" }),
    ];
    const result = filterPlannerLinkableTransactions(txns, {
      linkedFingerprints: [],
    });
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["new", "mid", "old"]);
    expect(result.map((tx) => tx.date)).toEqual(["2026-11-01", "2026-06-15", "2026-01-01"]);
  });

  it("already-linked transactions are excluded", () => {
    const txns: PlannerLinkableTransaction[] = [
      linkable("keep-a", { date: "2026-06-15", merchant: "Keep A" }),
      linkable("linked", { date: "2026-06-10", merchant: "Linked" }),
      linkable("keep-b", { date: "2026-05-01", merchant: "Keep B" }),
    ];
    const result = filterPlannerLinkableTransactions(txns, {
      linkedFingerprints: ["linked"],
    });
    expect(result.map((tx) => tx.txFingerprint)).toEqual(["keep-a", "keep-b"]);
  });
});

describe("togglePlannerTxSelection", () => {
  it("toggles rows independently by fingerprint", () => {
    let selected = new Set<string>();
    selected = togglePlannerTxSelection(selected, "fp-1", true);
    expect(selected.has("fp-1")).toBe(true);
    expect(selected.has("fp-2")).toBe(false);

    selected = togglePlannerTxSelection(selected, "fp-2", true);
    expect(selected.has("fp-1")).toBe(true);
    expect(selected.has("fp-2")).toBe(true);

    selected = togglePlannerTxSelection(selected, "fp-1", false);
    expect(selected.has("fp-1")).toBe(false);
    expect(selected.has("fp-2")).toBe(true);
  });

  it("does not treat undefined fingerprints as the same row", () => {
    const mapped = mapSpendingTransactionsToLinkable([
      apiTx("fp-a", { merchant: "A", date: "2026-01-01", amount: 1 }),
      apiTx("fp-b", { merchant: "B", date: "2026-01-02", amount: 2 }),
    ]);
    const fingerprints = mapped.map((tx) => tx.txFingerprint);
    expect(new Set(fingerprints).size).toBe(2);
    expect(fingerprints.every(Boolean)).toBe(true);

    let selected = new Set<string>();
    selected = togglePlannerTxSelection(selected, fingerprints[0], true);
    expect(selected.has(fingerprints[0])).toBe(true);
    expect(selected.has(fingerprints[1])).toBe(false);
    expect(selected.has(undefined as unknown as string)).toBe(false);
  });
});

describe("reselectPlanById", () => {
  it("replaces the open plan with the fresh copy of the same id", () => {
    const previous = { id: "plan-1", linkedTransactions: [] as { txFingerprint: string }[] };
    const fresh = [
      { id: "plan-2", linkedTransactions: [] as { txFingerprint: string }[] },
      { id: "plan-1", linkedTransactions: [{ txFingerprint: "fp-1" }] },
    ];
    const result = reselectPlanById(fresh, previous);
    expect(result).toBe(fresh[1]);
    expect(result?.linkedTransactions).toEqual([{ txFingerprint: "fp-1" }]);
  });

  it("clears the selection when the open plan is gone", () => {
    expect(reselectPlanById([{ id: "other" }], { id: "plan-1" })).toBeNull();
  });

  it("stays closed when nothing was selected", () => {
    expect(reselectPlanById([{ id: "plan-1" }], null)).toBeNull();
  });
});
