# Manual Asset Not Showing in Net Worth - Investigation

## User Report
"I added a car as an asset but it did not include its value in networth calculation"

## Code Path Analysis

### Asset Creation (POST /api/user/assets)
```
1. Line 59: Create asset in users/{uid}/manualAssets
2. Line 61: await invalidateFinancialProfileCache(uid, db)
   - Sets cacheStale: true
   - Sets updatedAt: epoch 0
```

### Cache Invalidation (invalidateFinancialProfileCache)
```
Line 1561: await db.collection("users").doc(uid).update({
  "financialProfile.updatedAt": new Date(0).toISOString(),
  "financialProfile.cacheStale": true,
});
```
✅ Uses await, should complete before POST returns

### Profile Rebuild (getFinancialProfile)
```
Line 1508: if (!cached.cacheStale) → HOT PATH (skips if stale)
Line 1510: if (!cached.cacheStale) → WARM PATH (skips if stale)  
Line 1526: Falls through → await buildAndCacheFinancialProfile(uid, db)
```
✅ Stale cache triggers rebuild

### Manual Assets Inclusion (buildAndCacheFinancialProfile)
```
Line 393: Fetches users/{uid}/manualAssets
Line 628-636: Maps to ManualAsset[]
Line 1314: manualAssetsTotal = manualAssets.reduce((s, a) => s + a.value, 0)
Line 1378: ta += manualAssetsTotal (adds to totalAssets)
Line 1381: h.netWorth = ta - td
```
✅ Manual assets ARE included in calculation

### Header/Detail Refresh (PR64 fix)
```
layout.tsx line 65-71: Refreshes on pathname === "/account/net-worth"
layout.tsx line 73-80: Refreshes on PROFILE_REFRESHED_EVENT
```
✅ Header should refresh when navigating to net worth page

## Possible Root Causes

1. **No refresh after adding asset**
   - User adds car, stays on same page
   - Header/detail don't know to reload
   - FIXED by PR64 if user navigates to net worth page after

2. **Cache not rebuilt yet** 
   - invalidateFinancialProfileCache is async
   - If user checks net worth IMMEDIATELY after POST returns
   - Next request MIGHT still hit warm cache before invalidation completes
   - UNLIKELY: await should ensure completion

3. **Manual assets in wrong currency**
   - No currency field on ManualAsset interface
   - Assumes home currency
   - If user enters USD value but expects CAD display
   - Asset would show but with wrong conversion

4. **No historical months**
   - If user has NO statement uploads yet
   - monthlyHistory is empty
   - Line 1378 never executes (no months to add to)
   - Manual asset total not reflected anywhere

## ACTUAL BUG HYPOTHESIS

**If user has NO uploaded statements:**
- monthlyHistory = []
- Line 1335: `for (const h of monthlyHistory)` → NO ITERATIONS
- Line 1378: `ta += manualAssetsTotal` → NEVER EXECUTES
- Manual asset IS in profile.manualAssets[]
- But NOT in any month's totalAssets or netWorth
- API returns netWorth from sortedHistory[0]
- sortedHistory = profile.monthlyHistory (empty!)
- currentMonth = sortedHistory[0] = undefined
- Line 37: netWorth = currentMonth?.netWorth ?? 0 → **0**

## Verification Needed
- Check if user has uploaded any statements
- If monthlyHistory is empty, manual assets won't appear in net worth API response
