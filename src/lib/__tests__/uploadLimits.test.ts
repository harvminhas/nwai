import { describe, expect, it } from "vitest";
import {
  applyQuotaRefund,
  canRechargeQuota,
  canRefundQuota,
  decideDuplicateUpload,
  quotaRefundWrite,
  statementIdFromUploadResponse,
} from "../uploadLimits";

describe("decideDuplicateUpload", () => {
  it("retries a rejected file instead of calling it already uploaded", () => {
    expect(decideDuplicateUpload("rejected")).toEqual({ action: "retry", reason: "rejected" });
  });

  it("retries a previous error", () => {
    expect(decideDuplicateUpload("error")).toEqual({ action: "retry", reason: "error" });
  });

  it("conflicts on a completed upload of the same file", () => {
    const decision = decideDuplicateUpload("completed");
    expect(decision.action).toBe("conflict");
    if (decision.action !== "conflict") return;
    expect(decision.message).toBe("You've already uploaded this exact file.");
  });
});

describe("applyQuotaRefund", () => {
  it("refunds a rejected one-time upload so it does not count toward the free limit", () => {
    expect(applyQuotaRefund({ onetimeUploadsUsed: 3, monthlyUploadsUsed: 1 }, "onetime")).toEqual({
      onetimeUploadsUsed: 2,
    });
  });

  it("does not refund below zero", () => {
    expect(applyQuotaRefund({ onetimeUploadsUsed: 0 }, "onetime")).toEqual({ onetimeUploadsUsed: 0 });
  });
});

describe("quotaRefundWrite", () => {
  it("uses increment(-1) when the counter is above zero", () => {
    expect(quotaRefundWrite(4)).toEqual({ kind: "increment", by: -1 });
  });

  it("floors at 0 instead of going negative", () => {
    expect(quotaRefundWrite(0)).toEqual({ kind: "set", value: 0 });
  });
});

describe("canRefundQuota / canRechargeQuota", () => {
  it("refunds once, then refuses a second refund of the same statement", () => {
    const first = { quotaPool: "onetime" as const, quotaRefunded: false };
    expect(canRefundQuota(first)).toBe("onetime");
    expect(canRefundQuota({ ...first, quotaRefunded: true })).toBeNull();
  });

  it("charges again when a previously refunded statement later completes", () => {
    expect(canRechargeQuota({ quotaPool: "onetime", quotaRefunded: true })).toBe("onetime");
    expect(canRechargeQuota({ quotaPool: "onetime", quotaRefunded: false })).toBeNull();
    expect(canRechargeQuota({ quotaRefunded: true })).toBeNull();
  });
});

describe("statementIdFromUploadResponse", () => {
  it("reads statementId from the upload route, not id", () => {
    expect(statementIdFromUploadResponse({ statementId: "stmt-1" })).toBe("stmt-1");
    expect(statementIdFromUploadResponse({ id: "stmt-1" })).toBeNull();
    expect(statementIdFromUploadResponse({ statementId: "stmt-1", id: "other" })).toBe("stmt-1");
    expect(statementIdFromUploadResponse({})).toBeNull();
  });
});
