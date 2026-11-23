export type QuotaPool = "onetime" | "monthly";

export type DuplicateUploadDecision =
  | { action: "retry"; reason: "error" | "rejected" }
  | { action: "conflict"; message: string };

/** Failed or rejected prior attempts of the same file can be retried. */
export function decideDuplicateUpload(
  existingStatus: string | undefined
): DuplicateUploadDecision {
  if (existingStatus === "error" || existingStatus === "rejected") {
    return { action: "retry", reason: existingStatus };
  }
  return {
    action: "conflict",
    message: "You've already uploaded this exact file.",
  };
}

export function applyQuotaRefund(
  used: { onetimeUploadsUsed?: number; monthlyUploadsUsed?: number },
  pool: QuotaPool
): { onetimeUploadsUsed?: number; monthlyUploadsUsed?: number } {
  if (pool === "onetime") {
    return { onetimeUploadsUsed: Math.max(0, (used.onetimeUploadsUsed ?? 0) - 1) };
  }
  return { monthlyUploadsUsed: Math.max(0, (used.monthlyUploadsUsed ?? 0) - 1) };
}

export function isQuotaPool(value: unknown): value is QuotaPool {
  return value === "onetime" || value === "monthly";
}
