# Actual Fix: Manual Asset Net Worth Auto-Update

## What Was Actually Wrong

**Root Cause:** `requestProfileRefresh()` only shows a toast - it does NOT refresh data!

Looking at `ProfileRefreshContext.tsx`:
```typescript
const requestProfileRefresh = useCallback(() => {
  setPending(true);  // THIS ONLY SHOWS THE TOAST!
}, []);
```

The actual refresh only happens when:
1. User manually clicks the toast
2. RefreshToast calls POST `/api/user/insights/generate` (expensive!)
3. That fires `PROFILE_REFRESHED_EVENT`
4. Components refetch their data

This meant creating/editing/deleting an asset required manual user action to see the updated net worth.

## What Was Fixed

Created `src/lib/profileRefetch.ts` with `triggerProfileRefetch()`:
```typescript
export function triggerProfileRefetch(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(PROFILE_REFRESHED_EVENT));
}
```

Updated asset mutation handlers to call this instead of `requestProfileRefresh()`:

### 1. Create Asset (`CategoriesTab.tsx`)
```typescript
// Before:
requestProfileRefresh();  // Only showed toast

// After:
triggerProfileRefetch();  // Actually refetches data
```

### 2. Edit Asset (`[id]/page.tsx`)
```typescript
// Before: No refresh at all

// After:
triggerProfileRefetch();  // Refetches after save
```

### 3. Delete Asset (`[id]/page.tsx`)
```typescript
// Before: No refresh at all

// After:
triggerProfileRefetch();  // Refetches after delete
```

## How It Works

1. **User creates/edits/deletes asset**
2. **API route calls `invalidateFinancialProfileCache(uid, db)`**
   - Sets cache staleness markers in Firestore
3. **Client calls `triggerProfileRefetch()`**
   - Fires `PROFILE_REFRESHED_EVENT` immediately
4. **Layout listener picks up event** (already existed)
   - Calls `loadNetWorth(token)` to refetch
5. **API fetches `/api/user/net-worth-summary`**
   - Calls `getNetWorthForMonth(uid, db, options)`
   - Which calls `getFinancialProfile(uid, db)`
   - Which sees cache is stale and rebuilds
   - Which includes the new/edited/deleted asset
6. **UI updates with new net worth**

## What This Does NOT Do

- ❌ Does NOT run expensive insights generation
- ❌ Does NOT show unnecessary toast prompts
- ❌ Does NOT require user to click anything
- ❌ Does NOT fake events before data is ready
- ❌ Does NOT bypass cache invalidation

## Files Changed

```
M  src/app/account/assets/[id]/page.tsx
M  src/app/account/assets/components/CategoriesTab.tsx
M  src/lib/financialProfile.ts
M  src/lib/netWorthCalculationCore.ts
A  src/lib/profileRefetch.ts
```

## Testing

Run locally:
```bash
npm run build  # TypeScript passes
npm test       # All tests pass
```

Manual testing:
1. Navigate to `/account/assets`
2. Add a car asset
3. **Net worth in header should update immediately** (no toast, no manual refresh)
4. Edit the car's value
5. **Net worth should update immediately**
6. Delete the car
7. **Net worth should update immediately**

## Existing Car Asset

The user's existing car asset is already in the database. Upon next page load/navigation, the profile will rebuild from cache and include it. No manual re-add needed.

## Preserved Design

- ✅ Single authoritative `getNetWorthForMonth` function
- ✅ Shared `calculateNetWorthForMonths` core logic
- ✅ Server-side cache invalidation strategy
- ✅ Existing profile rebuilding path
- ✅ All historical FX and account activation rules
- ✅ Fast-forward branch history (no force push)
