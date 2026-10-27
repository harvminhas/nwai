# Subscription Review System - Implementation Checklist

## ✅ Completed (commit `f41b5ac`)

1. **ReviewList Component**
   - Added `SubscriptionReviewCard` component with Yes/No buttons
   - Updated `ReviewListProps` to accept `"subscription"` type
   - Card displays merchant, cadence, amount, charge count
   - Buttons: "Yes, subscription" (primary) and "Not a subscription"

2. **Review Types**
   - Added `SubscriptionReviewItem` interface
   - Added `SubscriptionClassification` type: `is_subscription | not_subscription | still_active | cancelled`
   - Updated `ReviewRecord` to support `merchantSlug` field

3. **Detection Quality**
   - Changed minimum charges from 2 to 3 (filters one-off flights like AIRCANADA)
   - Variant merging foundation via `normalizeSubscriptionMerchant()`

4. **Engine Foundation**
   - Added `SubscriptionReview` interface for user decisions
   - Added `cancelled` array to `SubscriptionSummary`

## 🚧 Still TODO

### API Layer

#### `/api/user/reviews` GET endpoint
- [ ] Add logic to generate subscription review items from candidates
- [ ] Query: `?type=subscription`
- [ ] Response format:
```typescript
{
  items: SubscriptionReviewItem[] // From candidates list
}
```

#### `/api/user/reviews` PUT endpoint  
- [ ] Handle subscription classifications
- [ ] Persist to `users/{uid}/reviews/{merchantSlug}` with:
```typescript
{
  type: "subscription",
  merchantSlug: string,
  classification: "is_subscription" | "not_subscription" | "still_active" | "cancelled",
  reviewedAt: serverTimestamp()
}
```

#### `/api/user/subscriptions` route
- [ ] Load reviews: `db.collection('users/{uid}/reviews').where('type', '==', 'subscription').get()`
- [ ] Convert to maps:
  - `is_subscription` → add to `userConfirmedSlugs`
  - `not_subscription` → add to exclusion set (filter out before detection)
  - `still_active` → add to override map (force active)
  - `cancelled` → add to cancelled set (move to cancelled list)
- [ ] Pass to `buildSubscriptionSummary()`

### UI Layer

#### SubscriptionsTab Component
- [ ] Add `<ReviewList type="subscription" />` card at top (above summary cards)
- [ ] **Candidate rows**: Replace "Review" badge with inline action buttons:
  ```tsx
  <div className="flex gap-2">
    <button className="bg-violet-600 text-white px-3 py-1.5 rounded-md">
      Yes, subscription
    </button>
    <button className="border border-gray-300 text-gray-700 px-3 py-1.5 rounded-md">
      Not a subscription
    </button>
  </div>
  ```
- [ ] On button click: POST to `/api/user/reviews` with classification, show toast, silent refresh
- [ ] **Active rows**: Add overflow menu (⋯) with options:
  - "Not a subscription" → POST `not_subscription`
  - "Mark as cancelled" → POST `cancelled`
- [ ] **Inactive rows**: Add action buttons:
  - "Still active" → POST `still_active` (moves to active, counted)
  - "Cancelled" → POST `cancelled` (moves to cancelled list, hidden)
- [ ] Update copy:
  - Candidates header: "Is this a subscription? Not counted until you confirm."
  - Remove "Recurring charges not on known list — NOT counted in totals"

#### OverviewTab Component
- [ ] Add `<ReviewList type="subscription" />` card (same as SubscriptionsTab)
- [ ] Ensure reviews update both tabs

#### Toast Component
- [ ] Create or use existing toast for "Undo" link (~5s duration)
- [ ] On Undo: DELETE `/api/user/reviews/{id}`, refresh

### Engine Logic

#### `detectSubscription()` function
- [ ] Accept `userReviews: Map<string, SubscriptionReview>` instead of `userConfirmed: Set<string>`
- [ ] Check review decision:
  - `not_subscription` → return null (hard exclude)
  - `is_subscription` → set tier to "confirmed"
  - `still_active` → set status to "active" regardless of grace period
  - `cancelled` → set status to "inactive" (will be moved to cancelled list)

#### `buildSubscriptionSummary()` function
- [ ] Accept `userReviews: SubscriptionReview[]` instead of `userConfirmedSlugs: string[]`
- [ ] Create `Map<string, SubscriptionReview>` from reviews
- [ ] After splitting by status, create `cancelled` list:
  ```typescript
  const cancelled = allDetected.filter(s => 
    userReviews.get(s.merchantSlug)?.decision === "cancelled"
  );
  ```
- [ ] Return `cancelled` in summary

### Tests

#### Unit Tests (`src/lib/__tests__/subscriptionEngine.test.ts`)
- [ ] Test: `not_subscription` review excludes merchant from all lists
- [ ] Test: `is_subscription` review promotes candidate to confirmed
- [ ] Test: `still_active` review keeps inactive subscription active
- [ ] Test: `cancelled` review moves subscription to cancelled list
- [ ] Test: ≥3 charges required for candidate detection
- [ ] Test: variant merging (Anthropic/Claude variants → one row)

#### API Route Tests (new file: `src/__tests__/subscription-reviews.test.ts`)
- [ ] Test: POST `/api/user/reviews` with `is_subscription` classification
- [ ] Test: GET `/api/user/subscriptions` after review moves item from candidates to confirmed
- [ ] Test: POST `/api/user/reviews` with `not_subscription` removes item from all lists
- [ ] Test: Review persists in Firestore at correct path

#### Regression Script (`scripts/regression-report.ts`)
- [ ] Print review answers applied (count by classification)
- [ ] Print counts: confirmed, candidates, inactive, cancelled
- [ ] Validate no hard-excluded items in any list (existing check)

## Click Path for User Verification

Once implemented, the user flow will be:

### Option A: ReviewList Card (one at a time)
1. Open `/account/spending?tab=subscriptions`
2. See purple ReviewList card at top: "Is this a subscription?"
3. See merchant name, cadence, amount, charge count
4. Click "Yes, subscription" (primary button) OR "Not a subscription"
5. Card animates out, next candidate appears (if any)
6. Row moves from "To Review" section to "Active" (Yes) or disappears (No)
7. Small toast appears: "Classified [Merchant]" with "Undo" link for ~5s

### Option B: Inline Actions (bulk review)
1. Open `/account/spending?tab=subscriptions`
2. Scroll to "To Review" section
3. Each row shows merchant info with inline buttons: "Yes, subscription" | "Not a subscription"
4. Click button on any row → immediate action, row moves/disappears, toast notification
5. Can review multiple candidates in quick succession

### Option C: Active Row Management
1. Open `/account/spending?tab=subscriptions`
2. In "Active Subscriptions" section, hover over a row
3. Click overflow menu (⋯) on right side
4. Select "Not a subscription" OR "Mark as cancelled"
5. Row moves to appropriate section, toast notification

### Option D: Inactive Row Management
1. Open `/account/spending?tab=subscriptions`
2. Expand "Inactive / Cancelled?" section
3. Each row shows "Still active" and "Cancelled" buttons
4. Click "Still active" → row moves to Active section, counted in totals
5. Click "Cancelled" → row moves to hidden Cancelled list

## Priority Order for Implementation

1. **High Priority** (core UX):
   - API GET/PUT for subscription reviews
   - Inline action buttons on candidate rows
   - Silent refresh after classification
   - Load reviews in subscriptions API

2. **Medium Priority** (completeness):
   - ReviewList card integration
   - Overflow menu for active rows
   - Inactive row actions
   - Toast notifications

3. **Low Priority** (polish):
   - Undo functionality
   - Better copy
   - Comprehensive tests
   - Regression report updates

## Notes

- **No new npm dependencies** required (uses existing UI patterns)
- **Shared API** (`/api/user/reviews`) already exists, just needs subscription support
- **ReviewList component** already has animation and state management
- **Variant merging** already implemented via `normalizeSubscriptionMerchant()`
- **Detection quality** improved with ≥3 charge requirement
