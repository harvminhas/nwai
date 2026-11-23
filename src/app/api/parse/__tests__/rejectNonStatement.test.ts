import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { statementRef, statementUpdate, overrideSet, fileDelete, parseStatementPdf } = vi.hoisted(() => {
  const statementUpdate = vi.fn().mockResolvedValue(undefined);
  const overrideSet = vi.fn().mockResolvedValue(undefined);
  const fileDelete = vi.fn().mockResolvedValue(undefined);
  const parseStatementPdf = vi.fn();
  const statementRef = {
    get: vi.fn(),
    update: statementUpdate,
  };
  return { statementRef, statementUpdate, overrideSet, fileDelete, parseStatementPdf };
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
        return {
          doc: () => ({ get: async () => ({ exists: false }), set: vi.fn(), update: vi.fn() }),
          where() { return this; },
          get: async () => ({ empty: true, docs: [] }),
        };
      },
      doc: () => ({ get: async () => ({ exists: false }) }),
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

vi.mock("@/lib/insights/index", () => ({ fireInsightEvent: vi.fn() }));
vi.mock("@/lib/financialProfile", () => ({ invalidateFinancialProfileCache: vi.fn() }));
vi.mock("@/lib/netWorthChanges", () => ({ generateNetWorthChanges: vi.fn() }));
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

describe("parse route — non-statement rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statementRef.get.mockResolvedValue({
      exists: true,
      data: () => ({
        fileUrl: "uploads/hydro-bill.pdf",
        userId: "user-1",
        contentType: "application/pdf",
        fileName: "hydro-bill.pdf",
        storageBucket: "test-bucket",
      }),
    });
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

    expect(statementUpdate).toHaveBeenCalledTimes(1);
    const payload = statementUpdate.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.status).toBe("rejected");
    expect(payload.status).not.toBe("completed");
    expect(payload.accountSlug).toBeNull();
    expect(payload.errorMessage).toContain("a bill, not an account statement");
    expect(payload).not.toHaveProperty("parsedData");

    expect(overrideSet).not.toHaveBeenCalled();
    expect(fileDelete).toHaveBeenCalled();
  });
});
