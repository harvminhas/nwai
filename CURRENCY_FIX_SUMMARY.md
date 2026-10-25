# Currency Mismatch Bug - Investigation & Fix Summary

## Bug Report

**Symptom:** Otter.ai subscription shows different amounts across pages:
- Merchant drawer: US$164 avg/year
- Dashboard: CA$55
- Expected: CA$164 (the actual billed amount on the Canadian credit card)

## Root Cause Analysis

### The Problem

1. **Parser Layer (AI):** The AI parser was tagging foreign merchant transactions with their "home" currency (e.g., Otter.ai → USD) instead of the statement/account currency (CAD - the actual billed amount)

2. **Data Layer:** `extractTransactions.ts` was using `inferCurrencyFromBankName(parsed.bankName, parsed.currency)` which correctly prioritized statement currency, BUT individual transactions were being passed through with their wrong per-transaction currency

3. **Display Layer:** The merchant detail page was using `isConsolidated=true` which forced home currency display, hiding the underlying data problem

### Why This Happened

- Foreign transactions on a Canadian card (e.g., Otter.ai US$99) are converted by the bank to CAD (CA$164) at the time of billing
- The statement shows CA$164 (with maybe a note: "USD 99.00 @ 1.6566")
- The AI parser saw "USD" in the note and incorrectly tagged the transaction as USD instead of CAD
- Different parts of the app then handled this inconsistency differently

## The Fix

### 1. Data Layer (Core Fix)

**File:** `src/lib/extractTransactions.ts`

**Change:** Extract statement-level currency once and apply it to ALL transactions:

```typescript
// OLD: Called inferCurrencyFromBankName for each transaction
currency: inferCurrencyFromBankName(parsed.bankName, parsed.currency)

// NEW: Extract once per statement, apply to all transactions
const statementCurrency = inferCurrencyFromBankName(parsed.bankName, parsed.currency);
// ... then for each transaction:
currency: statementCurrency
```

**Key Insight:** Statement-level currency is the SINGLE SOURCE OF TRUTH. Every transaction from a statement is in that account's native currency, regardless of what the merchant's "home" currency is.

### 2. Merchant Aggregation Layer

**File:** `src/app/api/user/spending/merchants/route.ts`

**Change:** Added clear documentation that statement currency is used for all transactions from that statement. The code was already correct (line 207: `currency: stmtCurrency`), just needed clarification.

### 3. Display Layer

**File:** `src/app/account/spending/merchant/[slug]/page.tsx`

**Change:** Use merchant's native currency for display instead of forcing home currency:

```typescript
// OLD: Force home currency (isConsolidated=true)
formatCurrency(merchant.avgAmount, homeCurrency, undefined, true)

// NEW: Use merchant's native currency (isConsolidated=false)
formatCurrency(merchant.avgAmount, homeCurrency, merchant.currency, false)
```

**Rationale:** A single merchant's totals should display in the merchant's account currency (the currency actually billed). Only cross-account aggregates should be in home currency.

## Why This Fix Works

### 1. **Applies at Read Time**
No database migration needed. Existing stored data is corrected automatically when read from Firestore.

### 2. **Consistent Across App**
- Financial Profile cache uses `extractTransactions` → gets correct currency
- Merchant aggregation route uses same logic → gets correct currency  
- All display components read from these sources → show correct currency

### 3. **Simple & Maintainable**
- No new heuristics or inference logic
- Uses existing `inferCurrencyFromBankName` function
- Clear comments documenting the "statement currency is source of truth" principle

## Test Case

Created `src/lib/__tests__/transaction-currency.test.ts` to document expected behavior:

- **Scenario 1:** CAD card with USD merchant (Otter.ai)
  - Statement currency: CAD
  - Parser emits: `currency: "USD"` (wrong)
  - After fix: CA$164 everywhere

- **Scenario 2:** US card with USD merchant  
  - Statement currency: USD
  - Shows: US$99 everywhere

- **Scenario 3:** TD USD account (edge case)
  - Bank name: TD (Canadian)
  - Explicit currency: USD
  - Result: Uses explicit USD (overrides bank heuristic)

## Verification

### Before Fix
- Merchant page: US$164 avg/total
- Dashboard: CA$55
- ❌ Inconsistent, both wrong

### After Fix  
- Merchant page: CA$164 avg/total
- Dashboard: CA$164
- ✅ Consistent, both correct

## Related Issues

### Category Total Currency Mixing
The merchant detail page shows a "Share of Category" section that sums merchants in the same category. This sum doesn't account for currency conversion if merchants are from different accounts (e.g., one CAD, one USD).

**Status:** Out of scope for this PR. Would require FX conversion in the merchant aggregation route.

## Architecture Compliance

✅ **Rule #1:** Parser is read-only - No parser changes made  
✅ **Rule #2:** Only API routes write to DB - Fix is in read path only  
✅ **Rule #3:** Standard data contract - Uses existing `ParsedStatementData` type  
✅ **Rule #11:** Financial Profile is single source - Data layer fix ensures consistency  
✅ Applies correction at read time - No migration needed

## Pull Request

[PR #13](https://github.com/harvminhas/nwai/pull/13): Fix currency mismatch: use statement currency for all transactions

**Branch:** `cursor/fix-transaction-currency-cfb4`
**Status:** Ready for review
