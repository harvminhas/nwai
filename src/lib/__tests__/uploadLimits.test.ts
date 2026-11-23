import { describe, expect, it } from "vitest";
import { applyQuotaRefund, decideDuplicateUpload } from "../uploadLimits";

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
