# Income Linking - Ready for Testing

## What Was Fixed

**The Bug**: Income linking threw a 400 error when trying to link income transactions.

**Root Cause**: The `/api/user/tx-links` POST endpoint had a hardcoded `validRoles` array that was missing `"income_from"`.

**The Fix**: Added `"income_from"` to the validRoles array (single line change).

**Commits**:
- 74f3aa7 - The actual fix
- 235dfa4 - Test documentation
- 47de4cf - Complete validation

## How to Test on Localhost

### Prerequisites
```bash
git pull origin cursor/typed-links-hubs-p1-7f84
npm install  # if needed
npm run dev
```

### Test Flow

1. **Open an asset** (rental property, Uber vehicle, etc.)
   ```
   http://localhost:3000/account/assets/{asset-id}
   ```

2. **Click the "Income" tab**
   - Should show tab switcher with Income and Expenses
   - Income tab should be empty if no income linked yet

3. **Click "+ Add" next to the Income header**
   - Transaction picker modal opens
   - Three type buttons visible: Funding | Expense | Income

4. **Click "Income" type button**
   - Button highlights purple
   - Transaction list shows income transactions (Uber, Airbnb, payroll, etc.)

5. **Search for a specific source**
   - Type "Uber" or "Airbnb" in the search box
   - List filters to matching transactions
   - Shows date, merchant, amount, account

6. **Select transactions**
   - Click individual checkboxes, OR
   - Click "Select all" to select all filtered results
   - "Deselect all" appears to clear selection
   - Link button shows count: "Link 5" (or however many selected)

7. **Click the Link button**
   - ✅ Should succeed (no error)
   - ✅ Toast message: "5 transactions linked"
   - ✅ Modal closes
   - ✅ Income tab refreshes

8. **Verify income displays**
   - Income tab shows grouped sections
   - Each merchant/source as a collapsible group:
     ```
     Uber Technologies     12 transactions     C$8,450.00    ▶
     Airbnb Payments       6 transactions      C$5,200.00    ▶
     ```
   - Click a group to expand
   - See individual transactions with dates and amounts
   - Each transaction has a compact × button

9. **Refresh the page (F5)**
   - ✅ Income tab still shows all linked transactions
   - ✅ Groups still correct
   - ✅ Counts and totals still correct
   - Data persisted to Firestore

10. **Test removal**
    - Click × on an individual transaction
    - Transaction disappears
    - Group count and total update
    - If last transaction in group, entire group disappears

11. **Switch to Expenses tab**
    - Shows existing spending functionality
    - Pie chart if expenses linked
    - "+ Add" for expenses still works

## What Should Work

### Income Linking ✅
- Add income transactions from picker
- Income type filters to income transactions only
- Search works on merchant/source field
- Multi-select with checkboxes
- Select all / Deselect all
- Link button creates all links
- No errors in browser console
- No 400 responses in Network tab

### Display ✅
- Income grouped by merchant/source
- Shows transaction count per group
- Shows total amount per group
- Click to expand/collapse groups
- Individual transactions show date + amount
- Compact × removal on each transaction

### Persistence ✅
- Linked income persists after refresh
- Stored in Firestore: `users/{uid}/txLinks/{fingerprint}`
- Each link has role: "income_from"
- Retrieved by tx-links-for-hub endpoint
- Matched against income transactions in frontend

### UI ✅
- Income and Expenses tabs
- Tab shows totals: "Income (C$5,234)"
- Purple underline on active tab
- "+ Add" buttons simple and consistent
- Only × shown for removal (no text)
- Grouped display clean and modern

## Expected Console Output

### Browser Console (should be clean)
- No errors
- No warnings about missing data
- Auth messages OK

### Network Tab
```
POST /api/user/tx-links
Status: 200 OK
Request: { fingerprint: "...", hubId: "...", role: "income_from" }
Response: { ok: true, links: [...] }

GET /api/user/tx-links-for-hub?hubId=...
Status: 200 OK
Response: { links: [{ fingerprint: "...", role: "income_from", ... }, ...] }
```

## What Was Wrong Before

### Before Fix (commit dd3ceed)
```
POST /api/user/tx-links
{ "fingerprint": "...", "hubId": "...", "role": "income_from" }

❌ Status: 400 Bad Request
❌ Response: { "error": "Invalid role. Must be one of: finances, secures, funds, spend_on, grouped_under" }
```

User saw error toast, income was not linked, nothing persisted.

### After Fix (commit 74f3aa7)
```
POST /api/user/tx-links
{ "fingerprint": "...", "hubId": "...", "role": "income_from" }

✅ Status: 200 OK
✅ Response: { ok: true, links: [...] }
```

User sees success toast, income is linked, data persists, displays correctly.

## Firestore Verification

If you want to manually verify in Firebase Console:

1. Go to Firestore Database
2. Navigate to: `users/{your-uid}/txLinks`
3. Find a document with ID matching a transaction fingerprint
4. Check the `links` array
5. Should see entry like:
   ```json
   {
     "hubId": "asset-xyz",
     "role": "income_from",
     "createdAt": "2024-11-05T23:30:00Z"
   }
   ```

## Testing Different Scenarios

### Test 1: Single Income Transaction
- Select 1 Uber payment
- Link it
- Should appear under "Uber Technologies" group
- Group should show "1 transaction"

### Test 2: Multiple Transactions Same Source
- Search "Uber"
- Select all (e.g. 12 transactions)
- Link them
- Should appear as single "Uber Technologies" group
- Group shows "12 transactions"
- Expand to see all 12 individually

### Test 3: Multiple Sources
- Link 5 Uber transactions
- Link 3 Airbnb transactions
- Link 2 Salary payments
- Should see 3 separate groups:
  - Uber Technologies (5 transactions)
  - Airbnb Payments (3 transactions)
  - Employer Name (2 transactions)

### Test 4: Persistence
- Link some income
- Close browser
- Reopen and navigate to asset
- Income still there

### Test 5: Removal
- Click × on one transaction
- That transaction disappears
- Group count decreases
- If it was the last in a group, group disappears

### Test 6: Tab Switching
- Link income on Income tab
- Switch to Expenses tab
- Link some expenses
- Switch back to Income tab
- Both types persist independently

## Troubleshooting

### If income linking still fails:

1. **Check git branch**
   ```bash
   git branch
   # Should show: * cursor/typed-links-hubs-p1-7f84
   ```

2. **Check commit**
   ```bash
   git log --oneline -5
   # Should include: 74f3aa7 URGENT FIX: Add income_from...
   ```

3. **Clear Next.js cache**
   ```bash
   rm -rf .next
   npm run dev
   ```

4. **Check browser console for errors**
   - Open DevTools → Console
   - Look for red errors
   - Check Network tab for failed requests

5. **Verify API response**
   - Network tab → POST /api/user/tx-links
   - Check Status (should be 200)
   - Check Response body (should have ok: true)
   - If 400, check Request body role field

6. **Check Firebase Auth**
   - Make sure you're logged in
   - Check that ID token is being sent
   - Authorization header should be present

### If income doesn't persist:

1. **Check Firestore rules**
   - User should have write access to users/{uid}/txLinks

2. **Check Network tab after refresh**
   - GET /api/user/tx-links-for-hub should return links
   - Links should include income_from entries

3. **Check frontend filter**
   - Open React DevTools
   - Check linkedTxns state
   - Should include entries with role: "income_from"

## Files Changed

Only one file actually changed to fix the bug:

```
src/app/api/user/tx-links/route.ts (line 44)
```

Documentation files added:
```
test-income-linking.md
INCOME-LINKING-FIX-SUMMARY.md
READY-FOR-TESTING.md (this file)
```

## Success Criteria

✅ Can open asset page  
✅ Can click Income tab  
✅ Can click "+ Add"  
✅ Can select Income type  
✅ Can search income transactions  
✅ Can select multiple transactions  
✅ Can click "Link" without error  
✅ Income appears grouped by merchant  
✅ Can expand/collapse groups  
✅ Can see individual transactions  
✅ Can remove individual transactions  
✅ Income persists after refresh  
✅ No errors in console  
✅ POST returns 200 OK  

If all of the above work, the fix is complete and ready to merge when you're ready.

## Questions or Issues?

If you encounter any problems or unexpected behavior during testing, check:

1. Browser console for JavaScript errors
2. Network tab for failed API calls
3. Git branch and commit hash
4. Whether .next cache was cleared

The fix is a single line change that allows the API to accept the income_from role. All other code was already correct, so the fix should be reliable and complete.
