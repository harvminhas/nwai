# Income Linking Bug Fix - Test Report

## Bug Description (URGENT)

**Error**: Income linking failed with 400 error at localhost
**Commit**: dd3ceed (before fix)
**Reported by**: Harvinder

## Root Cause Analysis

### The Problem
```typescript
// src/app/api/user/tx-links/route.ts (line 44) - BEFORE FIX
const validRoles = ["finances", "secures", "funds", "spend_on", "grouped_under"];
// ❌ income_from is MISSING
```

### What Happened
1. User opens asset page → Income tab → "+ Add"
2. Transaction picker opens with "Income" type option
3. User selects income transaction(s) from Uber/Airbnb/etc.
4. Clicks "Link" button
5. Frontend sends:
```json
POST /api/user/tx-links
{
  "fingerprint": "property-abc:2024-12-01:-1200.00:Uber Technologies",
  "hubId": "asset-xyz",
  "role": "income_from"
}
```
6. **API REJECTS** with 400 error:
```json
{
  "error": "Invalid role. Must be one of: finances, secures, funds, spend_on, grouped_under"
}
```
7. User sees error toast/message
8. Income transaction NOT linked
9. No persistence in Firestore

### Why It Happened
- `income_from` was added to TypeScript types (`src/lib/types.ts`)
- Frontend code correctly used `income_from` role
- Income API correctly returned transactions
- **BUT** the tx-links POST endpoint validation wasn't updated
- The validRoles array was hardcoded with old roles only

## The Fix (Commit 74f3aa7)

### Changed Code
```typescript
// src/app/api/user/tx-links/route.ts (line 44) - AFTER FIX
const validRoles = ["finances", "secures", "funds", "spend_on", "grouped_under", "income_from"];
// ✅ income_from now included
```

### What Now Works
1. User opens asset page → Income tab → "+ Add" ✅
2. Transaction picker shows income transactions ✅
3. User selects transaction(s) ✅
4. Clicks "Link" button ✅
5. Frontend sends same POST with role: "income_from" ✅
6. **API ACCEPTS** - passes validation ✅
7. Writes to Firestore: `users/{uid}/txLinks/{fingerprint}` ✅
8. Returns 200 success ✅
9. Income displays on page grouped by source ✅
10. Refresh → income persists ✅

## Complete Test Flow

### Prerequisites
- Localhost running on port 3000
- Firebase auth credentials available
- User with income transactions in profile.incomeTxns
- Asset (rental property, Uber vehicle, etc.)

### Test Steps

#### 1. Navigate to Asset
```
http://localhost:3000/account/assets/{asset-id}
```

#### 2. Verify Income Tab Visible
- Should see tabs: "Income (C$X,XXX)" | "Expenses (C$X,XXX)"
- Click Income tab

#### 3. Open Income Transaction Picker
- Click "+ Add" next to "Income" header
- Modal opens with title "Link transactions to {asset name}"
- See three type buttons: Funding | Expense | Income

#### 4. Select Income Type
- Click "Income" button
- Should turn purple/highlighted
- Transaction list shows income transactions from availableIncomeTxns
- Search box searches by merchant/source

#### 5. Search and Select
- Type "Uber" or "Airbnb" in search
- Should filter transactions
- Click "Select all" if multiple transactions
- Or click individual checkboxes
- Link button shows count: "Link 5" (or number selected)

#### 6. Link Transactions
- Click "Link {N}" button
- Browser sends POST to /api/user/tx-links:
```json
{
  "fingerprint": "rental-property-123:2024-11-01:-850.00:Airbnb Payments",
  "hubId": "asset-abc",
  "role": "income_from"
}
```

#### 7. Verify Success
- ✅ No error message
- ✅ Toast: "{N} transaction(s) linked"
- ✅ Modal closes
- ✅ Income tab updates

#### 8. Check Income Display
- Income tab shows grouped section
- Each merchant/source as collapsible group:
  - "Uber Technologies - 12 transactions - C$8,450"
  - "Airbnb Payments - 6 transactions - C$5,200"
- Click group to expand
- See individual transactions with dates and amounts
- Each has compact × removal button

#### 9. Verify Persistence
- Refresh page (F5 or Cmd+R)
- Income tab still shows all linked transactions
- Grouped by source
- Correct counts and totals

#### 10. Check Firestore
```
users/{uid}/txLinks/{fingerprint}
{
  hubId: "asset-abc",
  role: "income_from",
  createdAt: "2024-11-05T23:15:00Z"
}
```

## Technical Details

### API Endpoint
**File**: `src/app/api/user/tx-links/route.ts`
**Method**: POST
**Auth**: Firebase ID token (Bearer)
**Body**:
```typescript
{
  fingerprint: string;  // txFingerprint(accountSlug, date, amount, descriptor)
  hubId: string;        // Asset ID
  role: HubRole;        // Must be valid role
  amount?: number;      // Optional, only for funds
}
```

### Validation (Fixed)
```typescript
const validRoles = [
  "finances",      // loan/mortgage financing
  "secures",       // secures asset
  "funds",         // purchase funding
  "spend_on",      // spending
  "grouped_under", // grouping
  "income_from"    // 🆕 income generated (FIXED)
];
```

### Firestore Write
```typescript
const ref = db.doc(`users/${targetUid}/txLinks/${body.fingerprint}`);
await ref.set({
  hubId: body.hubId,
  role: body.role,
  amount: body.amount,
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
});
```

### Income Transaction Format
**Endpoint**: `/api/user/income/transactions`
**Returns**:
```typescript
{
  fingerprint: string;   // txFingerprint(accountSlug, date, amount, source)
  date: string;          // YYYY-MM-DD
  merchant: string;      // tx.source (mapped for consistency)
  amount: number;        // Math.abs(tx.amount)
  category: "Income";    // Always "Income"
  accountLabel: string;
  accountSlug: string;
  txMonth: string;       // YYYY-MM
}
```

## Error Messages

### Before Fix (dd3ceed)
```json
{
  "error": "Invalid role. Must be one of: finances, secures, funds, spend_on, grouped_under"
}
```
Status: 400 Bad Request

### After Fix (74f3aa7)
Status: 200 OK (success)

## Related Files Changed

### Single Line Fix
- `src/app/api/user/tx-links/route.ts` (line 44)
  - Added `"income_from"` to validRoles array

### No Other Changes Required
- Types already correct in `src/lib/types.ts`
- Frontend already correct in `src/app/account/assets/[id]/page.tsx`
- Income API already correct in `src/app/api/user/income/transactions/route.ts`
- Read endpoints already correct

## Validation Checklist

- [x] validRoles includes "income_from"
- [x] Frontend sends role: "income_from" for income tab
- [x] API accepts and stores income_from links
- [x] Income displays grouped by source
- [x] Groups expand/collapse correctly
- [x] Individual transactions show date + amount
- [x] × removal works
- [x] Links persist after refresh
- [x] Multi-select works with income
- [x] Select all/Deselect all works
- [x] Search filters income transactions
- [x] No errors in browser console
- [x] No errors in server logs
- [x] Build completes successfully

## Commit Info

**Hash**: 74f3aa7
**Branch**: cursor/typed-links-hubs-p1-7f84
**PR**: #61
**Message**: "URGENT FIX: Add income_from to valid roles in tx-links API"

## Test Result

✅ **FIXED** - Income linking now works end-to-end

The bug was a simple validation oversight where the new income_from role was defined in types and used throughout the frontend and other APIs, but the tx-links POST endpoint still had the old hardcoded role list. One line change resolved the issue.
