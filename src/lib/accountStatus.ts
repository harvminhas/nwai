/**
 * Account status tracking for debt payoff and account closure.
 * 
 * Status lifecycle:
 * - open: Active account (default)
 * - paid_off: Debt account with balance cleared (auto-detected or manual)
 * - closed: Account no longer active (manual only)
 * 
 * Paid-off/closed accounts:
 * - Excluded from net worth calculations from statusDate onwards
 * - Don't block month completeness checks
 * - Don't appear in missing-statement nudges
 */

import type { Firestore } from "firebase-admin/firestore";

export type AccountStatus = "open" | "paid_off" | "closed";
export type AccountStatusSource = "auto" | "user";

export interface AccountStatusRecord {
  accountSlug: string;
  status: AccountStatus;
  statusDate: string; // YYYY-MM-DD when status changed
  statusSource: AccountStatusSource;
  updatedAt: string; // ISO timestamp
  /** For auto-detected payoffs, stores detection reason */
  detectionReason?: string;
}

/**
 * Get account status from Firestore.
 * Returns null if no status record exists (implies "open").
 */
export async function getAccountStatus(
  userId: string,
  accountSlug: string,
  db: Firestore
): Promise<AccountStatusRecord | null> {
  const doc = await db
    .collection("users")
    .doc(userId)
    .collection("accountStatus")
    .doc(accountSlug)
    .get();

  if (!doc.exists) return null;
  return doc.data() as AccountStatusRecord;
}

/**
 * Set account status.
 */
export async function setAccountStatus(
  userId: string,
  record: AccountStatusRecord,
  db: Firestore
): Promise<void> {
  await db
    .collection("users")
    .doc(userId)
    .collection("accountStatus")
    .doc(record.accountSlug)
    .set({
      ...record,
      updatedAt: new Date().toISOString(),
    });
}

/**
 * Get all account statuses for a user.
 */
export async function getAllAccountStatuses(
  userId: string,
  db: Firestore
): Promise<Map<string, AccountStatusRecord>> {
  const snap = await db
    .collection("users")
    .doc(userId)
    .collection("accountStatus")
    .get();

  const map = new Map<string, AccountStatusRecord>();
  for (const doc of snap.docs) {
    map.set(doc.id, doc.data() as AccountStatusRecord);
  }
  return map;
}

/**
 * Check if an account is active (open) as of a given date.
 */
export function isAccountActive(
  accountSlug: string,
  dateStr: string, // YYYY-MM-DD or YYYY-MM
  statusMap: Map<string, AccountStatusRecord>
): boolean {
  const status = statusMap.get(accountSlug);
  if (!status) return true; // No status record = open
  if (status.status === "open") return true;
  
  // Compare dates (status becomes effective on statusDate)
  const statusDate = status.statusDate.slice(0, 10); // Normalize to YYYY-MM-DD
  const checkDate = dateStr.slice(0, 10);
  
  return checkDate < statusDate;
}
