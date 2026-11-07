# Root Cause Analysis: Manual Assets Not Appearing in Net Worth

## Issue
User reported: *"I added a car as an asset but it did not include its value in networth calculation."*

The car asset was successfully saved to the database, but was not appearing in the net worth calculation even after refreshing.

## Root Cause

The application has a **partner profile viewing feature** that allows users to view their partner's financial data. When viewing a partner's profile:

1. The UI sets the `x-active-profile-uid` header (or `nwai_viewing_uid` cookie)
2. `resolveAccess()` returns two UIDs:
   - `actorUid`: The logged-in user's UID
   - `targetUid`: The partner's UID (whose data is being viewed)

### The Bug

The assets API routes (`/api/user/assets`) were using `actorUid` instead of `targetUid`:

```typescript
// WRONG (before fix)
const uid = access.actorUid;  // Uses logged-in user's UID
```

**All other API routes** in the codebase correctly used `targetUid`:
- `/api/user/profile` → uses `targetUid` ✓
- `/api/user/net-worth-summary` → uses `targetUid` ✓
- `/api/user/txn-category` → uses `targetUid` ✓
- `/api/user/spending/*` → uses `targetUid` ✓
- etc.

### The Impact

When the user was viewing their partner's profile and added the car asset:

1. **POST /api/user/assets** wrote to: `users/{actorUid}/manualAssets/{id}`
2. **Profile rebuild** read from: `users/{targetUid}/manualAssets/`
3. **Net worth calculation** read from the profile, which read from `targetUid`

Result: The car was saved to the wrong user's collection, so it never appeared in the partner's net worth calculation.

### Code Evidence

**Before fix:**

```typescript
// src/app/api/user/assets/route.ts
export async function POST(req: NextRequest) {
  const access = await resolveAccess(req, db);
  const uid = access.actorUid;  // ❌ WRONG
  await db.collection("users").doc(uid).collection("manualAssets").add(doc);
}
```

**After fix:**

```typescript
// src/app/api/user/assets/route.ts
export async function POST(req: NextRequest) {
  const access = await resolveAccess(req, db);
  const uid = access.targetUid;  // ✅ CORRECT
  await db.collection("users").doc(uid).collection("manualAssets").add(doc);
}
```

## The Fix

Changed all four asset API routes to use `targetUid`:

1. **GET /api/user/assets** - List assets
2. **POST /api/user/assets** - Create asset
3. **PUT /api/user/assets/[id]** - Update asset
4. **DELETE /api/user/assets/[id]** - Delete asset

The PUT and DELETE routes also needed to switch from direct `auth.verifyIdToken()` to `resolveAccess()` to respect profile switching.

## Why This Works

Now when viewing a partner's profile:

1. User adds car → saved to `users/{targetUid}/manualAssets/` ✓
2. Profile rebuild reads from `users/{targetUid}/manualAssets/` ✓
3. Net worth includes the car ✓

When viewing own profile (`targetUid === actorUid`):

1. User adds car → saved to `users/{targetUid}/manualAssets/` ✓
2. Profile rebuild reads from `users/{targetUid}/manualAssets/` ✓
3. Net worth includes the car ✓

## User Impact

**The user does NOT need to re-add or delete their car.** The existing car asset is already in the database. Once this fix is deployed:

1. The next time the user views the profile page, `buildAndCacheFinancialProfile` will be called
2. It will read from the correct collection (using `targetUid`)
3. The car will be included in the net worth calculation

**However**, if the car was added while viewing the wrong profile, it may be in the wrong user's collection. In that case:

- If viewing own profile when adding: Car is in `actorUid` collection (correct if actorUid === targetUid)
- If viewing partner profile when adding: Car is in `actorUid` collection (wrong, should be in partner's collection)

To fix existing misplaced assets, the user can:
1. Delete the asset from the wrong profile
2. Switch to the correct profile
3. Re-add the asset

Or we could write a one-time migration script to move misplaced assets.

## Tests

Created integration test: `src/__tests__/assets-partner-profile-integration.test.ts`

Tests cover:
- ✅ Asset saved to partner's collection when viewing partner profile
- ✅ Asset saved to own collection when viewing own profile
- ✅ Auth rejection without token
- ✅ Validation rejection with invalid data
- ✅ All tests pass

## Verification

To verify the fix works:

1. User A logs in
2. User A switches to view Partner B's profile
3. User A adds a car asset
4. Check Firestore: Asset should be in `users/{partnerB-uid}/manualAssets/`
5. View Partner B's profile page
6. Net worth should include the car value

## Related Issues

This bug only affected users who:
1. Use the partner profile viewing feature
2. Added assets while viewing a partner's profile

Users who only view their own profile were not affected.
