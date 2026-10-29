/**
 * AI usage limit enforcement for Free plan users.
 * 
 * Free plan: 50 AI responses per calendar month
 * Paid plans: Unlimited
 */

import type { Firestore } from "firebase-admin/firestore";

export const AI_USAGE_LIMIT_FREE = 50;

interface UsageRecord {
  count: number;
  month: string; // YYYY-MM format
  updatedAt: string;
}

/**
 * Get the current calendar month in YYYY-MM format
 */
function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * Get the reset date for the current month (first day of next month)
 */
export function getResetDate(): string {
  const now = new Date();
  const nextMonth = new Date(now.getUTCFullYear(), now.getUTCMonth() + 1, 1);
  return nextMonth.toLocaleDateString("en-US", { 
    month: "long", 
    day: "numeric", 
    year: "numeric" 
  });
}

/**
 * Check if user has reached their AI usage limit
 * Returns { allowed: boolean, remaining: number, limit: number }
 */
export async function checkAIUsageLimit(
  uid: string,
  db: Firestore,
  plan: string = "free"
): Promise<{ allowed: boolean; remaining: number; limit: number }> {
  // Paid plans have unlimited usage
  if (plan !== "free") {
    return { allowed: true, remaining: -1, limit: -1 };
  }

  const currentMonth = getCurrentMonth();
  const usageRef = db.collection("users").doc(uid).collection("aiUsage").doc(currentMonth);
  
  const usageDoc = await usageRef.get();
  const usage = usageDoc.data() as UsageRecord | undefined;
  
  const count = usage?.count || 0;
  const remaining = Math.max(0, AI_USAGE_LIMIT_FREE - count);
  
  return {
    allowed: count < AI_USAGE_LIMIT_FREE,
    remaining,
    limit: AI_USAGE_LIMIT_FREE,
  };
}

/**
 * Increment AI usage counter for the current month (transactional)
 * Returns the new count
 */
export async function incrementAIUsage(
  uid: string,
  db: Firestore
): Promise<number> {
  const currentMonth = getCurrentMonth();
  const usageRef = db.collection("users").doc(uid).collection("aiUsage").doc(currentMonth);
  
  // Use transaction to ensure atomic increment
  const newCount = await db.runTransaction(async (transaction) => {
    const usageDoc = await transaction.get(usageRef);
    const usage = usageDoc.data() as UsageRecord | undefined;
    
    const currentCount = usage?.count || 0;
    const newCount = currentCount + 1;
    
    transaction.set(usageRef, {
      count: newCount,
      month: currentMonth,
      updatedAt: new Date().toISOString(),
    });
    
    return newCount;
  });
  
  return newCount;
}

/**
 * Get friendly limit reached message
 */
export function getLimitReachedMessage(): string {
  const resetDate = getResetDate();
  return `You've used all ${AI_USAGE_LIMIT_FREE} AI answers for this month. Your limit resets on ${resetDate}. Upgrade to Pro for unlimited AI answers and more features.`;
}
