# Conditional Income Summary Card

## Feature Overview

Income summary card now appears **only when linked income exists**, keeping the asset page clean and focused.

## Implementation (Commit 6721e7b)

### Conditional Rendering
```typescript
{totalIncome > 0 && (
  <div className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm">
    <p className="text-xs font-medium text-gray-500">Income</p>
    <p className="mt-2 text-2xl font-bold text-green-700 tabular-nums">
      {formatCurrency(totalIncome, currency)}
    </p>
  </div>
)}
```

### Dynamic Grid Layout
```typescript
<div className={`grid gap-4 ${totalIncome > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
```

### Calculation
```typescript
const totalIncome = incomeTxns.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);

// incomeTxns = linkedTxns.filter((tx) => tx.role === "income_from")
```

## User Experience

### Initial State (No Income)
```
Asset Page
┌────────────────────────────────────────────────┐
│                                                │
│  ┌──────────────┐   ┌──────────────┐         │
│  │ Value/Equity │   │  Debt Owed   │         │
│  │   C$1.3M     │   │  C$800K      │         │
│  │              │   │  + Add       │         │
│  └──────────────┘   └──────────────┘         │
│                                                │
│  ┌────────────────────────────────┐           │
│  │ Income  |  Expenses            │           │
│  └────────────────────────────────┘           │
│  (Income tab available for adding)            │
└────────────────────────────────────────────────┘
```

### After Linking Income
```
Asset Page
┌──────────────────────────────────────────────────────┐
│                                                      │
│  ┌───────────┐  ┌───────────┐  ┌───────────┐      │
│  │Value/Equ. │  │  Income   │  │Debt Owed  │      │
│  │  C$1.3M   │  │  C$24K    │  │  C$800K   │      │
│  │           │  │  ✨NEW    │  │  + Add    │      │
│  └───────────┘  └───────────┘  └───────────┘      │
│                                                      │
│  ┌──────────────────────────────────┐               │
│  │ Income (C$24K) | Expenses        │               │
│  └──────────────────────────────────┘               │
│  Uber Technologies    12 txns   C$18,450           │
│  Airbnb Payments       6 txns    C$5,550           │
└──────────────────────────────────────────────────────┘
```

### After Unlinking All Income
```
Asset Page
┌────────────────────────────────────────────────┐
│                                                │
│  ┌──────────────┐   ┌──────────────┐         │
│  │ Value/Equity │   │  Debt Owed   │         │
│  │   C$1.3M     │   │  C$800K      │         │
│  │              │   │  + Add       │         │
│  └──────────────┘   └──────────────┘         │
│  (Income card disappeared)                    │
│                                                │
│  ┌────────────────────────────────┐           │
│  │ Income  |  Expenses            │           │
│  └────────────────────────────────┘           │
│  (Income tab still available)                  │
└────────────────────────────────────────────────┘
```

## Behavior Rules

### Card Visibility
- **Hidden**: `totalIncome === 0` (no income links exist)
- **Shown**: `totalIncome > 0` (one or more income transactions linked)

### Grid Layout
- **2 columns**: When income card hidden
  - Value & Equity (left)
  - Debt owed (right)
- **3 columns**: When income card shown
  - Value & Equity (left)
  - Income (center) ✨
  - Debt owed (right)

### Tab Availability
- **Income tab**: Always visible and clickable
- **Expenses tab**: Always visible and clickable
- Users can add income even when card is hidden
- Card appears automatically after first income link

## Benefits

### Cleaner UI When Irrelevant
- Asset with no income (e.g., non-rental property) shows focused 2-card layout
- No empty or zero-value income card cluttering the page
- Progressive disclosure: information appears when relevant

### Clear Signal of Income Activity
- Income card appearance is a visual confirmation that income is linked
- Green styling reinforces positive financial activity
- Prominent display when income exists

### Consistent Access to Functionality
- Income/Expenses tabs always present
- Users can add income anytime via Income tab
- No need to hunt for how to add income initially

## Edge Cases Handled

### Zero Income
```typescript
totalIncome === 0 → card hidden
```

### Small Income
```typescript
totalIncome === 50 → card shown with "C$50.00"
```

### Large Income
```typescript
totalIncome === 125000 → card shown with "C$125,000.00"
```

### Mixed Unlinking
- Unlink 5 of 10 income transactions → card still shown (totalIncome still > 0)
- Unlink last income transaction → card disappears

### Multiple Sources
- Income from Uber + Airbnb + Salary → one total shown in card
- Detailed breakdown visible in Income tab

## Responsive Behavior

### Mobile
```typescript
sm:grid-cols-2  // Below sm breakpoint: stacks vertically
sm:grid-cols-3  // Above sm breakpoint: 2 or 3 columns
```

On small screens, all cards stack regardless of count.

### Tablet/Desktop
Grid expands horizontally:
- 2-card layout: cards are wider (50% each)
- 3-card layout: cards are narrower (33% each)

## Test Cases

### Test 1: New Asset
1. Create new asset
2. Verify: 2 cards shown (Value/Equity, Debt)
3. Verify: No income card
4. Verify: Income tab available

### Test 2: Add First Income
1. Click Income tab → "+ Add"
2. Link 1 income transaction
3. Verify: Income card **appears**
4. Verify: Grid expands to 3 columns
5. Verify: Shows correct total

### Test 3: Add More Income
1. With existing income links
2. Link additional income transactions
3. Verify: Card total **updates**
4. Verify: Still 3-column layout

### Test 4: Remove Some Income
1. With multiple income links
2. Click × on one income transaction
3. Verify: Card total **decreases**
4. Verify: Card still **shown** (totalIncome > 0)

### Test 5: Remove All Income
1. With income links
2. Click × on each until none remain
3. Verify: Card **disappears**
4. Verify: Grid returns to 2 columns
5. Verify: Income tab still available

### Test 6: Page Refresh
1. Asset with income links
2. Refresh page (F5)
3. Verify: Income card still shown
4. Verify: Correct total displayed

### Test 7: Asset with No Income
1. Asset never had income (e.g., car, jewelry)
2. Verify: 2-card layout
3. Verify: Clean, focused page
4. Verify: Can still access Income tab if needed

## Styling Details

### Income Card
```typescript
className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm"
```
- Green theme matches positive financial activity
- Same shadow/border style as other cards
- Consistent padding and rounded corners

### Label
```typescript
<p className="text-xs font-medium text-gray-500">Income</p>
```
- Same label style as Value and Debt owed
- Consistent hierarchy

### Amount
```typescript
<p className="mt-2 text-2xl font-bold text-green-700 tabular-nums">
  {formatCurrency(totalIncome, currency)}
</p>
```
- Green text reinforces positive income
- Large, bold for prominence
- Tabular numbers for clean alignment

## Code Location

**File**: `src/app/account/assets/[id]/page.tsx`

**Calculation** (line ~408):
```typescript
const totalIncome = incomeTxns.reduce((sum, tx) => sum + Math.abs(tx.amount), 0);
```

**Grid** (line ~455):
```typescript
<div className={`grid gap-4 ${totalIncome > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'}`}>
```

**Card** (line ~479):
```typescript
{totalIncome > 0 && (
  <div className="rounded-xl border border-green-200 bg-green-50 p-5 shadow-sm">
    ...
  </div>
)}
```

## Related Features

### Income Tab
- Always available for adding income
- Shows grouped income transactions
- Displays even when summary card hidden

### Expenses Tab
- Unaffected by income card visibility
- Independent functionality

### Value & Equity Card
- Always shown
- Not affected by income state

### Debt Owed Card
- Always shown
- "+ Add" button always present

## Future Enhancements (Not Implemented)

### Potential Future Ideas
- Click income card to jump to Income tab
- Show income trend (e.g., monthly average)
- Compare income vs expenses in card
- Show time period (e.g., "Last 12 months")

These are NOT implemented and would require additional work.

## Testing on Localhost

```bash
# 1. Pull latest
git pull origin cursor/typed-links-hubs-p1-7f84

# 2. Run dev server
npm run dev

# 3. Test scenarios
# Scenario A: Asset with no income
- Open asset page
- Verify: 2 cards (Value/Equity, Debt)
- Verify: No income card

# Scenario B: Add income
- Click Income tab
- Click "+ Add" → select transactions → Link
- Verify: Income card appears
- Verify: 3-column grid

# Scenario C: Remove all income
- Click × on each income transaction
- Verify: Card disappears after last one
- Verify: 2-column grid returns

# Scenario D: Refresh with income
- With income linked
- F5 to refresh
- Verify: Income card persists
```

## Commit Info

**Hash**: 6721e7b  
**Branch**: cursor/typed-links-hubs-p1-7f84  
**PR**: #61  
**Message**: "feat: Conditionally display Income summary card"

## Summary

✅ Income card hidden when `totalIncome === 0`  
✅ Income card shown when `totalIncome > 0`  
✅ Grid adjusts dynamically (2 or 3 columns)  
✅ Tabs always available for adding income  
✅ Clean UI when income not relevant  
✅ Prominent display when income exists  
✅ Approved by Harvinder
