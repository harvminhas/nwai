import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { FieldValue } from "firebase-admin/firestore";

const {
  statementRef,
  statementUpdate,
  overrideSet,
  fileDelete,
  parseStatementPdf,
  userRef,
  userUpdate,
  userGet,
  runTransaction,
} = vi.hoisted(() => {
  const statementUpdate = vi.fn().mockResolvedValue(undefined);
  const overrideSet = vi.fn().mockResolvedValue(undefined);
  const fileDelete = vi.fn().mockResolvedValue(undefined);
  const parseStatementPdf = vi.fn();
  const userUpdate = vi.fn().mockResolvedValue(undefined);
  const userGet = vi.fn();
  const statementRef = {
    get: vi.fn(),
    update: statementUpdate,
  };
  const userRef = {
    get: userGet,
    update: userUpdate,
    set: vi.fn(),
  };
  const runTransaction = vi.fn(async (fn: (tx: {
    get: (ref: unknown) => Promise<unknown>;
    update: (ref: unknown, data: unknown) => Promise<unknown>;
  }) => Promise<unknown>) =>
    fn({
      get: async (ref: unknown) => (ref as { get: () => Promise<unknown> }).get(),
      update: async (ref: unknown, data: unknown) => {
        if (ref === statementRef) return statementUpdate(data);
        if (ref === userRef) return userUpdate(data);
        return undefined;
      },
    })
  );
  return {
    statementRef,
    statementUpdate,
    overrideSet,
    fileDelete,
    parseStatementPdf,
    userRef,
    userUpdate,
    userGet,
    runTransaction,
  };
});

vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAdmin: () => ({
    db: {
      collection: (name: string) => {
        if (name === "statements") {
          return {
            doc: () => statementRef,
            where() { return this; },
            get: async () => ({ docs: [], empty: true }),
          };
        }
        if (String(name).includes("accountSlugOverrides")) {
          return { doc: () => ({ get: async () => ({ exists: false }), set: overrideSet }) };
        }
        if (String(name).includes("categoryRules")) {
          return { get: async () => ({ empty: true, docs: [] }) };
        }
        if (name === "users") {
          return { doc: () => userRef };
        }
        return {
          doc: () => ({ get: async () => ({ exists: false }), set: vi.fn(), update: vi.fn() }),
          where() { return this; },
          get: async () => ({ empty: true, docs: [] }),
        };
      },
      doc: () => ({ get: async () => ({ exists: false }) }),
      runTransaction,
      batch: () => ({
        update: vi.fn(),
        commit: async () => undefined,
      }),
    },
    storage: {
      bucket: () => ({
        file: () => ({
          download: async () => [Buffer.from("%PDF-1.4 test")],
          delete: fileDelete,
        }),
      }),
    },
  }),
  getStorageBucketName: () => "test-bucket",
  FirebaseAdminCredentialsError: class FirebaseAdminCredentialsError extends Error {},
}));

vi.mock("@/lib/parseStatement", () => ({
  parseStatementPdf,
  parseStatementImage: vi.fn(),
}));

vi.mock("@/lib/applyRules", () => ({
  merchantSlug: vi.fn((s: string) => s),
  applyRulesAndRecalculate: vi.fn((d: unknown) => d),
}));

vi.mock("@/lib/insights/index", () => ({ fireInsightEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/financialProfile", () => ({ invalidateFinancialProfileCache: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/netWorthChanges", () => ({ generateNetWorthChanges: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/accountStatus", () => ({ setAccountStatus: vi.fn() }));
vi.mock("@/lib/gemini-provider", () => ({
  TransientAiError: class TransientAiError extends Error {},
}));

import { POST } from "../route";

function billParsed() {
  return {
    documentType: "bill" as const,
    netWorth: 142.18,
    statementDate: "2026-03-15",
    bankName: "City Hydro",
    accountType: "other" as const,
    income: { total: 0, sources: [], transactions: [] },
    expenses: { total: 0, categories: [], transactions: [] },
    subscriptions: [],
    savingsRate: 0,
    paymentsMade: 0,
  };
}

function creditCardParsed() {
  return {
    documentType: "account_statement" as const,
    netWorth: -200,
    statementDate: "2026-02-28",
    bankName: "Example Card",
    accountType: "credit" as const,
    income: { total: 0, sources: [], transactions: [] },
    expenses: {
      total: 50,
      categories: [],
      transactions: [{ merchant: "Store", amount: 50, date: "2026-02-04", category: "Shopping" }],
    },
    subscriptions: [],
    savingsRate: 0,
    paymentsMade: 0,
  };
}

function processingStatement(overrides: Record<string, unknown> = {}) {
  return {
    exists: true,
    data: () => ({
      fileUrl: "uploads/hydro-bill.pdf",
      userId: "user-1",
      contentType: "application/pdf",
      fileName: "hydro-bill.pdf",
      storageBucket: "test-bucket",
      quotaPool: "onetime",
      quotaRefunded: false,
      ...overrides,
    }),
  };
}

describe("parse route — non-statement rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statementRef.get.mockResolvedValue(processingStatement());
    userGet.mockResolvedValue({ exists: true, data: () => ({ onetimeUploadsUsed: 4 }) });
    parseStatementPdf.mockResolvedValue(billParsed());
  });

  it("rejected parse writes no accountSlug/override and isn't completed", async () => {
    const req = new NextRequest("http://localhost/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statementId: "stmt-bill-1" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.status).toBe("rejected");
    expect(json.ok).toBe(false);
    expect(json.error).toContain("a bill, not an account statement");

    expect(runTransaction).toHaveBeenCalled();
    expect(statementUpdate).toHaveBeenCalledTimes(1);
    const payload = statementUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("rejected");
    expect(payload.status).not.toBe("completed");
    expect(payload.accountSlug).toBeNull();
    expect(payload.errorMessage).toContain("a bill, not an account statement");
    expect(payload).not.toHaveProperty("parsedData");
    expect(payload.quotaRefunded).toBe(true);

    expect(overrideSet).not.toHaveBeenCalled();
    expect(fileDelete).toHaveBeenCalled();
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ onetimeUploadsUsed: FieldValue.increment(-1) })
    );
  });

  it("floors a zero used-count instead of incrementing below zero", async () => {
    userGet.mockResolvedValue({ exists: true, data: () => ({ onetimeUploadsUsed: 0 }) });

    const req = new NextRequest("http://localhost/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statementId: "stmt-bill-floor" }),
    });

    const res = await POST(req);
    expect((await res.json()).status).toBe("rejected");
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ onetimeUploadsUsed: 0 })
    );
    expect(userUpdate.mock.calls[0][0].onetimeUploadsUsed).not.toEqual(FieldValue.increment(-1));
  });

  it("does not decrement quota twice when quotaRefunded is already true", async () => {
    statementRef.get.mockResolvedValue(processingStatement({ quotaRefunded: true }));

    const req = new NextRequest("http://localhost/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statementId: "stmt-bill-2" }),
    });

    const res = await POST(req);
    const json = await res.json();
    expect(json.status).toBe("rejected");
    expect(userUpdate).not.toHaveBeenCalled();
    const payload = statementUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.quotaRefunded).toBe(true);
  });

  it("does not reject a reparse of a previously completed statement", async () => {
    statementRef.get.mockResolvedValue(processingStatement({
      fileUrl: "uploads/visa.pdf",
      fileName: "visa.pdf",
      status: "processing",
      statusBeforeReparse: "completed",
      accountSlug: "0773",
      parsedData: creditCardParsed(),
      quotaPool: undefined,
      quotaRefunded: false,
    }));
    parseStatementPdf.mockResolvedValue(billParsed());

    const req = new NextRequest("http://localhost/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statementId: "stmt-completed-1" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.status).toBe("completed");
    expect(json.ok).toBe(true);
    expect(json.accountSlug).toBe("0773");
    expect(json.warning).toContain("a bill, not an account statement");

    expect(statementUpdate).toHaveBeenCalledTimes(1);
    const payload = statementUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("completed");
    expect(payload.accountSlug).toBeUndefined();
    expect(payload.classificationWarning).toContain("a bill, not an account statement");
    expect(overrideSet).not.toHaveBeenCalled();
    expect(fileDelete).not.toHaveBeenCalled();
  });

  it("restores needs_review instead of promoting to completed on classifier reject", async () => {
    statementRef.get.mockResolvedValue(processingStatement({
      status: "processing",
      statusBeforeReparse: "needs_review",
      accountSlug: null,
      parsedData: null,
      quotaPool: undefined,
    }));

    const req = new NextRequest("http://localhost/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statementId: "stmt-review-1" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.status).toBe("needs_review");
    expect(json.ok).toBe(true);
    expect(json.warning).toContain("a bill, not an account statement");
    const payload = statementUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("needs_review");
    expect(payload.status).not.toBe("completed");
    expect(payload.classificationWarning).toContain("a bill, not an account statement");
    expect(fileDelete).not.toHaveBeenCalled();
    expect(userUpdate).not.toHaveBeenCalled();
  });

  it("charges quota again when a previously refunded statement completes on retry", async () => {
    statementRef.get.mockResolvedValue(processingStatement({
      fileUrl: "uploads/visa.pdf",
      fileName: "visa.pdf",
      quotaRefunded: true,
      quotaPool: "onetime",
    }));
    parseStatementPdf.mockResolvedValue(creditCardParsed());

    const req = new NextRequest("http://localhost/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ statementId: "stmt-retry-ok" }),
    });

    const res = await POST(req);
    const json = await res.json();

    expect(json.ok).toBe(true);
    expect(json.status).toBe("completed");
    expect(runTransaction).toHaveBeenCalled();
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ onetimeUploadsUsed: FieldValue.increment(1) })
    );
    const completedWrite = statementUpdate.mock.calls.find(
      (call) => (call[0] as Record<string, unknown>).status === "completed"
    )?.[0] as Record<string, unknown> | undefined;
    expect(completedWrite?.quotaRefunded).toBe(false);
  });
});
