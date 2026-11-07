# Fix Summary: Manual Assets Not Appearing in Net Worth

## What Was Wrong

**Root Cause:** The assets API routes were using the wrong user ID when saving assets in partner profile viewing mode.

When you have a linked partner and switch to view their profile:
- The app sets a special header (`x-active-profile-uid`) to tell the backend "show this partner's data"
- **EVERY other API route** correctly used this to read/write the partner's data
- **BUT** the assets routes incorrectly saved to your own collection instead of the partner's

This meant:
1. You switched to view your partner's profile
2. You added a car asset
3. The car was saved to **your** collection instead of **your partner's**
4. When viewing the partner's net worth, it read from **their** collection
5. The car wasn't there → net worth didn't include it

## What Was Fixed

Changed 4 lines of code in the assets API:

```typescript
// Before (WRONG)
const uid = access.actorUid;  // Your UID

// After (CORRECT)
const uid = access.targetUid;  // Partner's UID when viewing their profile
```

Applied to:
- ✅ GET /api/user/assets (list)
- ✅ POST /api/user/assets (create)
- ✅ PUT /api/user/assets/[id] (update)
- ✅ DELETE /api/user/assets/[id] (delete)

## Testing

Created comprehensive integration tests that prove:
- ✅ Assets saved to correct user when viewing partner profile
- ✅ Assets saved to correct user when viewing own profile
- ✅ Auth and validation work correctly
- ✅ All 5 new tests pass
- ✅ All existing tests still pass

## What You Need to Do

### Scenario 1: You Were Viewing Your Partner's Profile When Adding the Car

**The car is in the wrong place.**

To fix:
1. Delete the car from wherever it's showing up (might be in your own profile)
2. Switch to your partner's profile
3. Add the car again
4. It will now save to the correct collection
5. Net worth will include it

### Scenario 2: You Were Viewing Your Own Profile When Adding the Car

**The bug didn't affect you.** There might be a different issue.

Check:
1. Does the car show up in your Assets page?
2. If yes: Open browser console when viewing net worth, check for errors
3. If no: The creation might have failed silently

### How to Tell Which Scenario

Look at your UI when you added the car:
- Was there a profile switcher showing your partner's name? → Scenario 1
- Were you viewing your own data? → Scenario 2

## Files Changed

1. `src/app/api/user/assets/route.ts` - Fixed GET and POST routes
2. `src/app/api/user/assets/[id]/route.ts` - Fixed PUT and DELETE routes
3. `src/__tests__/assets-partner-profile-integration.test.ts` - Added tests
4. `ROOT_CAUSE_MANUAL_ASSETS.md` - Detailed technical analysis

## Commit History

1. `cd2f9d2` - Core fix: Changed actorUid → targetUid in all 4 routes
2. `0b61f87` - Added root cause analysis documentation

## PR Status

- PR #65: https://github.com/harvminhas/nwai/pull/65
- Branch: `cursor/fix-manual-asset-networth-138d`
- Status: Ready for review
- Tests: ✅ Passing

## Next Steps

1. **Merge this PR** to fix the bug for future asset additions
2. **Check your existing car asset** to see if it's in the wrong collection
3. **Re-add if necessary** (see scenarios above)
4. **(Optional) One-time migration script** to move misplaced assets automatically

Let me know which scenario applies to you and whether you see the car asset on your Assets page!
