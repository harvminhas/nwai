# Task Completion Report: Merchant Cadence & Currency Fixes

**Branch:** `cursor/fix-transaction-currency-cfb4` (commit f33997a)  
**PR:** #13

---

## Summary

All three tasks have been completed:

✅ **Task C**: Investigated Otter $164 source  
✅ **Task A**: Made merchant cadence single source of truth  
✅ **Task B**: Added transaction traceability to merchant drawer

---

## Task C: Investigation Results

### Finding: Subscriptions do NOT create phantom transactions

**Verified data flow:**
1. **Transaction aggregation** (`merchants/route.ts`): Only reads from `parsed.expenses.transactions`, never touches subscriptions
2. **Parser subscriptions**: AI extracts `subscriptions[]` as metadata only—not added to expense transactions
3. **Subscription registry**: Stores subscriptions in `users/{uid}/subscriptions` for **upcoming-charge predictions only**, never writes to `parsedData`

**Root cause of CA$55 on dashboard:**
- `bucketBreakdown.ts` was using subscription amounts from the subscriptions collection to override transaction-based averages
- If Otter had a subscription record with wrong frequency or amount (AI-detected or stale), it would override the real transaction totals
- The CA$55 figure (164 ÷ 3 months) suggested it was averaging over 3 months instead of using the annual cadence

**Conclusion:** Subscriptions are metadata only and cannot create spending without real transactions. However, they **can** override display amounts in bucket breakdowns when present.

---

## Task A: Merchant Cadence as Single Source of Truth

### Changes Made

#### 1. Added merchantCadence to Financial Profile Cache (`src/lib/financialProfile.ts`)

```typescript
// Fetches users/{uid}/merchantCadence collection
// Stores as Record<merchantSlug, frequency> in profile cache
merchantCadence?: Record<string, string>;
```

**Priority:** `merchantCadence` (user's choice) → `subscription.frequency` (AI-detected) → fallback

#### 2. Updated Bucket Breakdown (`src/lib/bucketBreakdown.ts`)

**New signature:**
```typescript
computeBucketBreakdown(
  bucket,
  expenseTxns,
  accountSnapshots,
  months,
  homeCurrency,
  merchantCadence,      // ← NEW: Primary source
  subscriptions         // ← Fallback only
)
```

**Logic:**
- For each subscription merchant, check `merchantCadence[merchantSlug]` first
- Fall back to `subscription.frequency` only if user hasn't set a cadence
- Annual/yearly → `amount / 12` (monthly rate)
- Quarterly → `amount / 3`
- Biweekly → `amount * 26 / 12`
- Weekly → `amount * 52 / 12`

#### 3. Added Billing Frequency Selector to Merchant Drawer (`src/components/MerchantsTab.tsx`)

**New UI elements:**
- Dropdown with options: Weekly, Every 2 weeks, Monthly, Quarterly, Yearly, One-time
- Positioned above "Merge with..." and "Change category" buttons
- Loads current cadence from `/api/user/spending/merchant-cadence` on drawer open
- Saves changes via PUT to same API (reusing existing merchant-cadence endpoint)

**API call:**
```typescript
PUT /api/user/spending/merchant-cadence
{
  slug,
  frequency,
  merchantName,
  amount,
  lastSeenDate
}
```

#### 4. Updated Dashboard Drawers (`src/app/api/user/dashboard-drawers/route.ts`)

Now passes `profile.merchantCadence` to both `computeBucketBreakdown` and `compute3MonthTrend`, ensuring consistent calculations across all bucket views.

---

## Task B: Transaction Traceability

### Changes Made

Updated merchant drawer to show account source for each transaction:

**Before:**
```
Otter.ai
Jul 13, 2026
```

**After:**
```
Otter.ai
Jul 13, 2026 · TD VISA ••••1234
```

**Implementation:**
- Each transaction now displays `txn.accountLabel` (e.g., "TD VISA ••••1234")
- Account label is truncated with ellipsis if too long (max-w-[150px])
- Hovering shows full label in tooltip via `title` attribute

The `accountLabel` field was already present in the API response (set by merchants/route.ts from `accountDisplayLabel(parsed)`), so this was a UI-only change.

---

## Currency Display Fix

### Problem
User reported merchant drawer still showed "US$164" for Otter (a Canadian TD card transaction).

### Root Cause
The merchants API was using `profile.country` to determine `homeCurrency`, defaulting to "USD" when country wasn't set. If the bank name regex didn't match, `inferCurrencyFromBankName` would fall back to that USD default.

### Fix (`src/app/api/user/spending/merchants/route.ts`)

Added bank-name auto-detection (same logic as `financialProfile.ts`):

```typescript
// Auto-detect country from bank names if not explicitly set
let homeCurrency = "USD"; // default
if (storedCountry === "CA") {
  homeCurrency = "CAD";
} else if (storedCountry === "US") {
  homeCurrency = "USD";
} else {
  // Auto-detect from bank names across all statements
  const CA_BANK_DETECT = /\b(td|rbc|bmo|cibc|...)\b/i;
  const bankText = Array.from(bestDocPerSlugYm.values())
    .map(doc => {
      const p = doc.data().parsedData;
      return [p?.bankName ?? "", p?.accountName ?? ""].join(" ");
    })
    .join(" ");
  
  if (CA_BANK_DETECT.test(bankText)) {
    homeCurrency = "CAD";
  }
}
```

**Result:** Even without `profile.country` set, TD/RBC/BMO accounts will correctly infer "CAD" and display CA$ in the merchant drawer.

---

## Files Changed

1. `src/lib/financialProfile.ts` — Added merchantCadence collection fetch
2. `src/lib/bucketBreakdown.ts` — Updated to use merchantCadence as primary source
3. `src/app/api/user/dashboard-drawers/route.ts` — Pass merchantCadence to breakdown functions
4. `src/app/api/user/spending/merchants/route.ts` — Added bank-name currency auto-detection
5. `src/components/MerchantsTab.tsx` — Added billing selector and account labels to drawer

---

## Testing Checklist

### Currency Display
- [ ] Open merchant drawer for Otter.ai (or any merchant on TD/RBC/BMO card)
- [ ] Verify "Avg / Month" and "This Year" show **CA$** (not US$)
- [ ] Verify transaction amounts also show **CA$**

### Billing Frequency Selector
- [ ] Open any merchant drawer
- [ ] Verify "Billing frequency" dropdown appears above action buttons
- [ ] Change frequency from Monthly → Yearly
- [ ] Verify save completes (no loading spinner stuck)
- [ ] Refresh page, reopen drawer
- [ ] Verify frequency is still "Yearly"

### Dashboard Bucket Breakdown
- [ ] Open "Fixed costs" or "Essentials" drawer (any bucket with subscriptions)
- [ ] Set a merchant to "Yearly" billing
- [ ] Verify dashboard shows `amount / 12` (not `total / 3 months`)

### Transaction Traceability
- [ ] Open any merchant drawer with transactions
- [ ] Verify each transaction shows: `Date · Account Label`
- [ ] Verify account label includes bank name and last 4 digits (e.g., "TD VISA ••••1234")

---

## Known Limitations

1. **Cached data**: If statements were parsed before commit 4eb74a1 (the currency fix), the drawer might still show old currency until statements are re-uploaded or cache is cleared
2. **No statement links yet**: Transactions show the account but don't link to the source statement (future enhancement if needed)
3. **Category change button**: Still non-functional (not in scope for this task)

---

## Next Steps (If Needed)

1. **Test on production data** to verify currency display is correct
2. **Clear financial profile cache** if needed: DELETE `users/{uid}.financialProfile` in Firestore
3. **Verify Otter specifically**: Check what's in `users/{uid}/subscriptions/{otter-slug}` and `users/{uid}/merchantCadence/{otter-slug}`

---

## Architecture Compliance

All changes follow the architecture rules:
- ✅ Parser not modified (read-only layer preserved)
- ✅ No cross-layer violations (business logic stays in lib/, DB writes in api/)
- ✅ Currency inference applied at read time (no parsedData writes needed)
- ✅ Merchant cadence integrated into common data layer (financialProfile)
- ✅ Bucket breakdown remains a pure function (no DB access)
