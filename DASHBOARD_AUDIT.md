# Dashboard Audit & Redesign Plan

## Current Dashboard Audit (`src/app/account/dashboard/page.tsx`)

### Sections in Order

1. **Hero** (lines 832-839)
   - Title: "What do you want to know?"
   - Subtitle: "Ask me anything about your spending, savings, or financial goals"
   - **Issue**: Not a financial summary - it's an AI prompt

2. **AI Question Box** (lines 842-850)
   - Large text input with placeholder
   - 3 suggestion buttons
   - Usage stats for free users
   - Link to saved answers
   - **Issue**: Takes up prime real estate that should show financial position

3. **AI Answer Card** (lines 853-862, shows conditionally)
   - Collapsible answer display
   - Save/bookmark functionality
   - "Ask another question" button
   - **Duplicate**: AI chat already exists at `/account/chat`

4. **Debt Review List** (lines 865-878, shows if unreviewed > 0)
   - Review unclassified debt payments
   - **Good**: Action-oriented, but buried

5. **Where Your Money Goes** (lines 880-907)
   - Range switcher (3mo/12mo/ytd)
   - Coverage warning
   - 5 bucket cards: Income, Fixed, Essentials, Flexible, Savings
   - Each card shows: amount/mo, % of income, status, progress bar, advice
   - Click opens drawer with full breakdown
   - **Duplicate**: Same 5-bucket breakdown exists on `/account/spending`
   - **Issue**: No quick navigation to other pages

6. **Drawer** (lines 910-917)
   - Opens on hash change (#income, #fixed, etc.)
   - Shows full transaction list for each bucket
   - **Duplicate**: Same data as Spending page

### Data Sources

- `/api/user/money-coach?range={range}` - income, buckets, coverage, advice
- `/api/user/ai-ask` - suggestions, usage stats
- `/api/user/debt-payment-anomalies` - unreviewed count
- `/api/user/saved-answers` - count of saved answers

### What's Missing (Critical)

1. **Hero financial snapshot** - Net worth, monthly change, current position
2. **Monthly cash flow view** - Income vs expenses for current month
3. **Action list** - Real signals requiring attention:
   - Subscriptions with no recent charge (noRecentCharge flag)
   - Upcoming subscription renewals
   - Debt payoff progress/milestones
   - Flagged transfers (external accounts)
   - Unreviewed debt payments (already shown but not grouped with actions)
4. **Quick navigation** - Compact links to:
   - Spending (detailed breakdown)
   - Debts (liabilities page)
   - Assets (assets page)
   - Subscriptions (subscriptions tab)
   - Debt Payoff (payoff planner)
5. **"What changed" view** - Month-over-month deltas

### Duplication Issues

| Feature | Dashboard | Duplicated On |
|---------|-----------|---------------|
| 5-bucket breakdown | ✓ | `/account/spending` (same data) |
| AI chat | ✓ | `/account/chat` (full interface) |
| Drawer transactions | ✓ | `/account/spending` (same transactions) |
| Debt reviews | ✓ | Embedded in Fixed bucket |

### Clutter & Unclear

- **AI dominates**: Takes up 50% of above-the-fold space
- **No hierarchy**: Everything is equal weight - no clear "most important first"
- **Advice text too long**: Each bucket has 2-3 sentences of generic advice
- **No distinction between "see more" and "take action"**: Every card just opens a drawer

---

## Landing Page Issues (Brief) - `src/app/page.tsx`

1. **Too long**: 620 lines, 9 major sections
2. **Repetitive security messaging**: Trust bar (line 272), security badges (line 394), security section (line 396), footer note (line 595)
3. **No clear value prop in hero**: Generic "Know where your money goes"
4. **Pricing buried**: Appears at line 456 (should be higher)
5. **Testimonials lack specificity**: Generic quotes without real context
6. **Call-to-action weak**: "Upload your first statement" isn't compelling

**Not in scope for current task** - focus is on logged-in dashboard.

---

## Redesign Proposal

### Design Principles

Answer three questions in order:
1. **What's my financial position?** (Hero: net worth + month change)
2. **What changed recently?** (Cash flow strip: income vs expenses this month)
3. **What should I do next?** (Action list: signals requiring attention)

### Layout (Top to Bottom)

#### 1. Hero - Financial Position (Compact)
```
Net Worth: $45,234 CAD                    [↑ +$1,234 this month]
```
- One line, large text
- Green/red indicator for monthly change
- Data: `/api/user/net-worth-summary`

#### 2. Monthly Cash Flow Strip
```
October 2026: Income $5,200 | Fixed $1,800 | Essentials $650 | Flexible $420 | Savings $2,330
```
- Horizontal bar chart with Fixed/Essentials/Flexible colors (same as Spending page)
- Loan payments always in Fixed
- Click bar section → navigates to Spending page filtered to that group
- Data: `/api/user/money-coach?range=3mo` (use current month from monthlyHistory)

#### 3. Action List - Signals
```
□ 3 subscriptions haven't charged in 45+ days (Netflix, Spotify, LinkedIn)
□ 2 subscriptions renewing this month ($45 total)
□ Debt payoff: On track to save $340 in interest (see progress →)
□ $1,200 in flagged transfers to external accounts last month
```
- Real data-driven signals only (no invented/generic advice)
- Each item is actionable (click → goes to relevant page)
- Data sources:
  - Subscriptions: `/api/user/subscriptions` (filter noRecentCharge: true)
  - Renewals: Calculate from subscription nextDate
  - Debt payoff: `/api/user/debt-plans` (if active plan exists)
  - Transfers: From `gapReconciliation.flaggedTransfers` in money-coach response

#### 4. Quick Navigation - Compact Cards
```
[Spending]  [Debts]  [Assets]  [Subscriptions]  [Debt Payoff]  [Ask AI]
```
- 6 small cards, each with:
  - Icon
  - Label
  - One-line summary (e.g. "Spending: $2,870 this month")
  - Click → navigates to that page
- AI chat moved here (not removed, just deprioritized)

### Removed from New Design

- AI Question Box (hero position) → moved to Quick Nav
- AI Answer Card → use `/account/chat` for conversations
- 5-bucket breakdown cards with advice → use Spending page
- Drawer → use Spending page

### Kept from Old Design

- Debt Review List (but moved to Action List section)
- Range concept (but applied to cash flow, not buckets)
- Color scheme and styling

### Query Param Feature Flag

- Old dashboard: `/account/dashboard` (default)
- New dashboard: `/account/dashboard?v=2`
- Both versions work, easy A/B comparison

---

## Implementation Plan

1. **Create new component** `DashboardV2` in same file
2. **Check query param** at page load
3. **Build hero** using `/api/user/net-worth-summary`
4. **Build cash flow strip** using current month from `/api/user/money-coach`
5. **Build action list** using:
   - `/api/user/subscriptions` (noRecentCharge)
   - Calculate renewals from subscription data
   - `/api/user/debt-plans` (active plan)
   - `gapReconciliation.flaggedTransfers` from money-coach
6. **Build quick nav** cards (6 links)
7. **Run tests** and tsc
8. **Open draft PR**

---

## Data APIs Needed

All existing, no new endpoints required:

1. `/api/user/net-worth-summary` - hero data
2. `/api/user/money-coach?range=3mo` - cash flow + flagged transfers
3. `/api/user/subscriptions` - subscription signals
4. `/api/user/debt-plans` - debt payoff progress
5. `/api/user/debt-payment-anomalies` - unreviewed count (existing)

---

## Expected Outcome

A dashboard that:
- **Shows financial position first** (net worth + change)
- **Explains what changed** (monthly cash flow)
- **Guides next actions** (real signals, not generic advice)
- **Provides quick access** to detailed pages
- **Reduces duplication** (defer to dedicated pages)
- **Stays compact** (fits above the fold on desktop)
