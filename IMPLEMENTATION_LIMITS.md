# Implementation Limitations

## Current State (HEAD)

### What Works
1. **CategoriesTab refresh fix** (commit 5fa8759): ✓ Complete
   - Calls `requestProfileRefresh()` after creating asset
   - Header refetches via PROFILE_REFRESHED_EVENT

2. **API contract preserved** (commit a2e4f86): ✓ Complete  
   - Full `monthlyHistory` with last 12 months
   - Includes `byAccount` for detail page chart
   - All existing consumers work

3. **Shared selection function** (commit 7e2298b + a2e4f86): ✓ Working
   - `getNetWorthForMonth(uid, db, { month?, year? })`
   - Latest month selection (explicit max comparison)
   - Used by API endpoint

### What's NOT Yet Authoritative Calculation

**Current limitation**: `getNetWorthForMonth` **reads precomputed** `h.netWorth` from `financialProfile.monthlyHistory`, it does NOT calculate from raw assets/debts.

**Why**:
- Calculation already exists in `financialProfile.ts:1314-1382`:
  ```typescript
  const manualAssetsTotal = manualAssets.reduce((s, a) => s + a.value, 0);
  for (const h of monthlyHistory) {
    ta += manualAssetsTotal; // Line 1378
    h.netWorth = ta - td;    // Line 1381
  }
  ```
- This happens during `buildAndCacheFinancialProfile`
- To make truly authoritative calculation would require:
  - Extracting calculation logic into pure function
  - Refactoring `financialProfile.ts` to call that function
  - Or duplicating calculation logic (risk of divergence)

**Scope constraint**: User said "do not rewrite unrelated modules". 
`financialProfile.ts` is 1566 lines, refactoring it is out of scope for "add car to net worth" bug fix.

### What Tests Cover

**`netWorthCalculation.test.ts`** (10 tests):
- ✓ Month/year selection logic
- ✓ Latest month identification (out-of-order history)
- ✓ Explicit month query
- ✓ Unavailable month → null (not substituted)
- ✓ Year boundary
- ✓ monthlyChange calculation
- ✗ NOT calculation from raw assets/debts (mocks profile)

**`netWorthSummaryAPI.test.ts`** (5 tests):
- ✓ API contract preservation
- ✓ monthlyHistory with byAccount
- ✓ Latest month in top-level fields
- ✓ Trend calculation
- ✗ NOT raw calculation (mocks profile)

### Remaining Work for "True Authoritative Calculation"

To meet full user requirement ("ONE DATA LAYER calculation"):

1. **Extract calculation to pure function**:
   ```typescript
   function calculateMonthNetWorth(
     accountBalances: { assets: number; debts: number },
     manualAssets: ManualAsset[],
     accountActivation: Map<string, boolean>
   ): { netWorth: number; totalAssets: number; totalDebts: number }
   ```

2. **Refactor financialProfile.ts** to use it:
   ```typescript
   for (const h of monthlyHistory) {
     const result = calculateMonthNetWorth(...);
     h.netWorth = result.netWorth;
     h.totalAssets = result.totalAssets;
     h.totalDebts = result.totalDebts;
   }
   ```

3. **Update consumers** to calculate on-demand if needed

**Complexity**: 
- 268 lines of logic (lines 1310-1578 in financialProfile.ts)
- FX conversion, account activation, asset/debt classification
- Historical backfill per month
- Risk of breaking existing behavior

**Decision**: Out of scope for this PR. Current implementation:
- ✓ Fixes original bug (car not appearing in net worth)
- ✓ Preserves all existing behavior
- ✓ Shares selection logic
- ✗ Doesn't extract calculation from financialProfile

## Test Baseline

**Full suite at commit a2e4f86**:
```
Test Files: 15 failed, 58 passed (73 total)
Tests: 13 failed, 448 passed, 5 skipped (466 total)
```

Pre-existing failures (not introduced by this PR):
- merchant-normalization
- missing-months-after-complete
- (11 other files - unrelated to net worth)

**New tests introduced**:
- netWorthCalculation.test.ts: 10 passed
- netWorthSummaryAPI.test.ts: 5 passed
- Total: 15 new passing tests
