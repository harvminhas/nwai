# Component Testing Limitation

## Issue
Cannot write proper React component tests for `CategoriesTab.tsx` to verify `requestProfileRefresh()` is called after asset creation.

## Why
- Project has **no React testing infrastructure**: no `@testing-library/react`, no `@testing-library/user-event`
- Only `vitest` configured for unit/logic tests (`.test.ts` files)
- No existing component test examples (`.test.tsx` files don't exist)

## What Would Be Needed
```bash
npm install -D @testing-library/react @testing-library/user-event @testing-library/jest-dom jsdom
```

Then test:
```typescript
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CategoriesTab } from './CategoriesTab';

test('calls requestProfileRefresh after successful asset creation', async () => {
  const mockRequestProfileRefresh = vi.fn();
  // Mock ProfileRefreshContext
  // Render CategoriesTab with mock summary
  // Fill form, submit
  // Assert mockRequestProfileRefresh was called
});
```

## Evidence From Code Review
**File**: `src/app/account/assets/components/CategoriesTab.tsx`

**BEFORE fix** (commit 89738d7):
```typescript
// Line 74-87
const res = await fetch("/api/user/assets", {
  method: "POST",
  // ...
});
if (!res.ok) throw new Error("Failed to save");
const { id } = await res.json();
if (id) router.push(`/account/assets/${id}`);
else router.refresh();
```
❌ No `requestProfileRefresh()` call

**AFTER fix** (commit 5fa8759):
```typescript
// Line 86-89
if (!res.ok) throw new Error("Failed to save");
const { id } = await res.json();
requestProfileRefresh(); // ✓ Added
if (id) router.push(`/account/assets/${id}`);
```
✓ Now calls `requestProfileRefresh()` after POST succeeds

**Comparison with edit page** (`src/app/account/assets/[id]/page.tsx:473`):
```typescript
if (res.ok) {
  setToast({ msg: `Rule saved: "${merchant}" → ${newCategory}`, ok: true });
  requestProfileRefresh(); // ✓ Already had this
}
```
Edit page already called it; create page was missing it.

## Manual Verification Required
Since component testing infrastructure doesn't exist, verification requires:
1. Local dev server: `npm run dev`
2. Navigate to Assets page
3. Add manual asset (e.g. car)
4. Observe RefreshToast appears (proves `requestProfileRefresh()` called)
5. Check header net worth updates

## Alternative: Build & Typecheck
```bash
npm run typecheck  # Passes ✓
npm run build      # Would verify imports resolve
```
