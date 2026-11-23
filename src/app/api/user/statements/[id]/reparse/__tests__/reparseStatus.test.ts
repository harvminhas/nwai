import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { statementGet, statementUpdate, verifyIdToken, cacheDelete } = vi.hoisted(() => ({
  statementGet: vi.fn(),
  statementUpdate: vi.fn().mockResolvedValue(undefined),
  verifyIdToken: vi.fn(),
  cacheDelete: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAdmin: () => ({
    auth: { verifyIdToken },
    db: {
      collection: () => ({
        doc: () => ({
          get: statementGet,
          update: statementUpdate,
        }),
      }),
      doc: () => ({ delete: cacheDelete }),
    },
  }),
}));

import { POST } from "../route";

describe("reparse route records status before reparse", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyIdToken.mockResolvedValue({ uid: "user-1" });
  });

  it("stores needs_review as statusBeforeReparse so a later reject does not promote it", async () => {
    statementGet.mockResolvedValue({
      exists: true,
      data: () => ({
        userId: "user-1",
        status: "needs_review",
        fileHash: "abc",
      }),
    });

    const req = new NextRequest("http://localhost/api/user/statements/stmt-1/reparse", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    });
    const res = await POST(req, { params: Promise.resolve({ id: "stmt-1" }) });
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(statementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "processing",
        statusBeforeReparse: "needs_review",
      })
    );
  });

  it("keeps a previously recorded status if reparse is hit while already processing", async () => {
    statementGet.mockResolvedValue({
      exists: true,
      data: () => ({
        userId: "user-1",
        status: "processing",
        statusBeforeReparse: "error",
      }),
    });

    const req = new NextRequest("http://localhost/api/user/statements/stmt-2/reparse", {
      method: "POST",
      headers: { Authorization: "Bearer token" },
    });
    await POST(req, { params: Promise.resolve({ id: "stmt-2" }) });

    expect(statementUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "processing",
        statusBeforeReparse: "error",
      })
    );
  });
});
