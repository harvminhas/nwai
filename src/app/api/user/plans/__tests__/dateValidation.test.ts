/**
 * POST/PATCH date validation and completedAt — mocked Firestore, no live writes.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PLAN_DATE_RANGE_ERROR } from "@/app/account/tools/planner/planList";

const { mockSet, mockUpdate, mockGet, mockDoc } = vi.hoisted(() => ({
  mockSet: vi.fn(),
  mockUpdate: vi.fn(),
  mockGet: vi.fn(),
  mockDoc: vi.fn(),
}));

vi.mock("@/lib/firebase-admin", () => ({
  getFirebaseAdmin: () => ({
    db: {
      collection: vi.fn(() => ({
        orderBy: vi.fn(() => ({
          get: vi.fn(async () => ({ docs: [] })),
        })),
      })),
      doc: (...args: unknown[]) => {
        mockDoc(...args);
        return {
          set: mockSet,
          update: mockUpdate,
          get: mockGet,
          delete: vi.fn(),
        };
      },
    },
  }),
}));

vi.mock("@/lib/access/resolveAccess", () => ({
  resolveAccess: vi.fn(),
}));

import { resolveAccess } from "@/lib/access/resolveAccess";
import { PATCH, POST } from "../route";

function request(method: string, body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/user/plans", {
    method,
    headers: {
      Authorization: "Bearer test-token",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

const existingPlan = {
  id: "plan-1",
  name: "Trip",
  startDate: "2027-05-03",
  endDate: "2027-05-15",
  budget: 5000,
  linkedTransactions: [],
  cashEntries: [],
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

describe("plans API date validation and PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(resolveAccess).mockResolvedValue({
      targetUid: "user-1",
      actorUid: "user-1",
      isOwn: true,
    });
    mockGet.mockResolvedValue({
      exists: true,
      data: () => existingPlan,
    });
  });

  it("POST returns 400 and does not write when endDate is before startDate", async () => {
    const res = await POST(
      request("POST", {
        name: "Trip",
        startDate: "2027-05-15",
        endDate: "2027-05-03",
        budget: 1000,
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: PLAN_DATE_RANGE_ERROR });
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("POST writes when endDate is on or after startDate", async () => {
    mockSet.mockResolvedValue(undefined);
    const res = await POST(
      request("POST", {
        name: "Trip",
        startDate: "2027-05-03",
        endDate: "2027-05-03",
        budget: 1000,
      }),
    );
    expect(res.status).toBe(200);
    expect(mockSet).toHaveBeenCalledTimes(1);
    expect(mockDoc).toHaveBeenCalledWith(expect.stringMatching(/^users\/user-1\/plans\//));
  });

  it("PATCH returns 400 and does not write when the new range is invalid", async () => {
    const res = await PATCH(
      request("PATCH", {
        id: "plan-1",
        startDate: "2027-06-01",
        endDate: "2027-05-01",
      }),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: PLAN_DATE_RANGE_ERROR });
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("PATCH is auth-only and owner-scoped", async () => {
    vi.mocked(resolveAccess).mockResolvedValueOnce(null);
    const unauthorized = await PATCH(request("PATCH", { id: "plan-1", completedAt: null }));
    expect(unauthorized.status).toBe(401);
    expect(mockUpdate).not.toHaveBeenCalled();

    mockUpdate.mockResolvedValue(undefined);
    const res = await PATCH(
      request("PATCH", { id: "plan-1", completedAt: "2026-11-22T00:00:00.000Z" }),
    );
    expect(res.status).toBe(200);
    expect(mockDoc).toHaveBeenCalledWith("users/user-1/plans/plan-1");
    expect(mockUpdate).toHaveBeenCalledTimes(1);
    const update = mockUpdate.mock.calls[0][0] as { completedAt: string };
    expect(update.completedAt).toBe("2026-11-22T00:00:00.000Z");
  });

  it("PATCH can clear completedAt without migrating other fields", async () => {
    mockUpdate.mockResolvedValue(undefined);
    const res = await PATCH(request("PATCH", { id: "plan-1", completedAt: null }));
    expect(res.status).toBe(200);
    const update = mockUpdate.mock.calls[0][0] as { completedAt: null };
    expect(update.completedAt).toBeNull();
    expect(update).not.toHaveProperty("linkedTransactions");
  });
});
