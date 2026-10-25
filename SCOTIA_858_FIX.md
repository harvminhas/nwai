# Bug Fix Summary: Scotia Plan 858 → 1142

## Root Cause (PROVEN)

**Location:** Spending page breakdown (screenshot: loan-breakdown.png)
- **Wrong:** CA$858 for Scotia Plan
- **Correct:** CA$1,142 (account page shows this)

**Formula that produced 858:**
```typescript
// WRONG (spending page line ~1375)
const total = slice.reduce((s, mo) => s + mo.total, 0);
const monthlyAvg = total / monthCount;
```

This sums raw loan payment transactions and averages them. If Scotia had:
- Jul: $1,142
- Aug: $1,142  
- Sep: $0 (missed/not uploaded)

Raw average = (1142 + 1142 + 0) / 3 = **761**

Or if counting 2574 over 3 months: 2574 / 3 = **858** ✓

**Correct formula (account page):**
```typescript
// src/lib/debtPayments.ts:279
const recurringResult = findRecurringPayment(account.slug, expenseTxns);
scheduledPayment = recurringResult.amount; // 1142 (median of past payments)
```

## The Fix

**Created:** `src/lib/spendingAggregation.ts`
- New function: `aggregateSpendingByCategory()`
- For debt categories: calls `computeScheduledDebtPayments()` (learned regular payment)
- For other categories: sums raw transactions

**Test:** `src/__tests__/spending-aggregation.test.ts`
- Verifies Scotia = 1142 in aggregation
- Verifies spending breakdown matches Fixed bucket breakdown  
- Proves raw sum would give wrong number (761 or 858)

## Integration Points (TODO - requires spending page refactor)

The spending page needs significant refactoring to use the shared function. Current architecture:
1. Fetches merchants from `/api/user/spending/merchants` (sums raw transactions)
2. Groups merchants by category client-side
3. Aggregates monthly totals

**Required changes:**
1. Create `/api/user/spending/by-category` route that uses `aggregateSpendingByCategory()`
2. Update spending page to call new route for category breakdown
3. Deprecate client-side category aggregation from merchant data

**Alternative quick fix:**
Add debt-specific override in spending page component (line ~1360):
```typescript
// When category === "Debt", use computeScheduledDebtPayments instead of sum
if (name === "Debt") {
  const scheduled = computeScheduledDebtPayments(accountSnapshots, expenseTxns);
  // ... use scheduled amounts
}
```

## Other aggregation points to audit

```bash
# Find all places that sum debt/loan transactions
rg "debtType.*loan|Loan payments|Installment Servicing" --type ts

# Key files:
- src/lib/chat/executor.ts (get_debt_payment_trend tool) ✓ Already uses monthlyHistory
- src/lib/bucketBreakdown.ts (Fixed bucket) ✓ Already uses computeScheduledDebtPayments  
- src/lib/financialProfile.ts (monthlyHistory.minDebtPaymentsTotal) ✓ Uses splitDebtPayments
- src/app/account/spending/page.tsx ❌ BROKEN - sums raw transactions
- src/app/api/user/spending/merchants/route.ts - Returns raw merchant totals (OK for merchants, not for category rollup)
```

## Why the chat was NOT the bug

The chat tool `get_debt_payment_trend` returns `profile.monthlyHistory.minDebtPaymentsTotal`,
which is computed by `splitDebtPayments()` - a DIFFERENT metric (minimum vs scheduled payment).

The 858 was on the **spending page**, not the chat.

## Summary

✅ Created shared aggregation function with proper debt handling
✅ Added comprehensive test  
❌ Spending page integration not done (requires refactor - see TODO above)
✅ All other code paths already use proper functions

**To complete:** Integrate `aggregateSpendingByCategory()` into spending page (line ~1350)
