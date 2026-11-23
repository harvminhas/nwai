import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { dupGet, dupUpdate, fileSave, usersSet, verifyIdToken } = vi.hoisted(() => ({
  dupGet: vi.fn(),
  dupUpdate: vi.fn().mockResolvedValue(undefined),
  fileSave: vi.fn().mockResolvedValue(undefined),
  usersSet: vi.fn().mockResolvedValue(undefined),
  verifyIdToken: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAdmin: () => ({
    auth: { verifyIdToken },
    db: {
      collection: (name: string) => {
        if (name === "statements") {
          return {
            where() { return this; },
            limit() { return this; },
            get: dupGet,
            doc: () => ({ set: vi.fn(), update: vi.fn() }),
          };
        }
        if (name === "users") {
          return {
            doc: () => ({
              get: async () => ({ exists: true, data: () => ({ onetimeUploadsUsed: 1 }) }),
              set: usersSet,
            }),
          };
        }
        return { doc: () => ({ get: async () => ({ exists: false }), set: vi.fn() }) };
      },
    },
    storage: {
      bucket: () => ({
        file: () => ({ save: fileSave }),
      }),
    },
  }),
  getStorageBucketName: () => "test-bucket",
  FirebaseAdminCredentialsError: class FirebaseAdminCredentialsError extends Error {},
}));

vi.mock("@/lib/access/resolveAccess", () => ({
  resolveAccess: vi.fn(async () => ({ targetUid: "user-1" })),
}));

vi.mock("@/app/api/user/plan/route", () => ({
  resolvePlan: () => "free",
}));

import { POST } from "../route";

function pdfRequest() {
  const form = new FormData();
  form.append("file", new File([new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d])], "hydro.pdf", {
    type: "application/pdf",
  }));
  return new NextRequest("http://localhost/api/upload", {
    method: "POST",
    headers: { Authorization: "Bearer test-token" },
    body: form,
  });
}

describe("upload route — rejected duplicates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    verifyIdToken.mockResolvedValue({ uid: "user-1", email: "a@b.com", name: "A" });
  });

  it("re-runs a rejected file instead of saying already uploaded", async () => {
    dupGet.mockResolvedValue({
      empty: false,
      docs: [{
        id: "stmt-rejected-1",
        ref: { update: dupUpdate },
        data: () => ({
          status: "rejected",
          fileUrl: "",
          errorMessage: "This looks like a bill, not an account statement. Upload a bank, credit card, loan or investment statement.",
          quotaRefunded: true,
        }),
      }],
    });

    const res = await POST(pdfRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.error).not.toBe("duplicate");
    expect(json.retrying).toBe(true);
    expect(json.statementId).toBe("stmt-rejected-1");
    expect(json.previousRejection).toContain("a bill, not an account statement");
    expect(dupUpdate).toHaveBeenCalledWith(expect.objectContaining({
      status: "processing",
      fileUrl: expect.stringContaining("statements/stmt-rejected-1/"),
    }));
    expect(fileSave).toHaveBeenCalled();
    expect(usersSet).not.toHaveBeenCalled();
  });

  it("still treats a completed same-file upload as a duplicate", async () => {
    dupGet.mockResolvedValue({
      empty: false,
      docs: [{
        id: "stmt-ok-1",
        ref: { update: dupUpdate },
        data: () => ({ status: "completed", fileUrl: "statements/stmt-ok-1/statement.pdf" }),
      }],
    });

    const res = await POST(pdfRequest());
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json.error).toBe("duplicate");
    expect(json.message).toBe("You've already uploaded this exact file.");
    expect(dupUpdate).not.toHaveBeenCalled();
  });
});
