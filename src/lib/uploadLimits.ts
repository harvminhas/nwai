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

export function quotaCounterField(
  pool: QuotaPool
): "onetimeUploadsUsed" | "monthlyUploadsUsed" {
  return pool === "onetime" ? "onetimeUploadsUsed" : "monthlyUploadsUsed";
}

/**
 * How to decrement a used-count without going below 0.
 * Callers apply `increment: -1` with FieldValue.increment(-1) inside a
 * transaction; `set: 0` is the floor when the counter is already 0.
 */
export type QuotaRefundWrite = { kind: "increment"; by: -1 } | { kind: "set"; value: 0 };

export function quotaRefundWrite(currentUsed: number): QuotaRefundWrite {
  return currentUsed > 0 ? { kind: "increment", by: -1 } : { kind: "set", value: 0 };
}

export function applyQuotaRefund(
  used: { onetimeUploadsUsed?: number; monthlyUploadsUsed?: number },
  pool: QuotaPool
): { onetimeUploadsUsed?: number; monthlyUploadsUsed?: number } {
  const field = quotaCounterField(pool);
  const current = used[field] ?? 0;
  return { [field]: Math.max(0, current - 1) };
}

/** Pool to refund, or null when this statement was already refunded / never charged. */
export function canRefundQuota(data: {
  quotaRefunded?: unknown;
  quotaPool?: unknown;
} | null | undefined): QuotaPool | null {
  if (!data || data.quotaRefunded === true) return null;
  return isQuotaPool(data.quotaPool) ? data.quotaPool : null;
}

/** Pool to charge again after a previously refunded statement completes on retry. */
export function canRechargeQuota(data: {
  quotaRefunded?: unknown;
  quotaPool?: unknown;
} | null | undefined): QuotaPool | null {
  if (!data || data.quotaRefunded !== true) return null;
  return isQuotaPool(data.quotaPool) ? data.quotaPool : null;
}

export function isQuotaPool(value: unknown): value is QuotaPool {
  return value === "onetime" || value === "monthly";
}

/** The upload route returns `{ statementId }`, not `{ id }`. */
export function statementIdFromUploadResponse(
  data: { statementId?: unknown; id?: unknown } | null | undefined
): string | null {
  if (typeof data?.statementId === "string" && data.statementId.trim()) {
    return data.statementId.trim();
  }
  return null;
}
