# Regression Testing - Standing Rule

**Established**: Tuesday, Oct 27, 2026

## Rule

For every new feature or changed functionality:

1. **Extend `scripts/regression-report.ts`** with checks covering:
   - Card vs drawer/tab totals match
   - All sums reconcile (components = total)
   - Exit non-zero on mismatch/failure

2. **Verify the script**:
   - Type-checks: Runs in Next.js build
   - Executes: `npx tsx scripts/regression-report.ts --help`
   - Can run against test fixtures if no credentials

3. **Document new checks** in PR description

## Regression Checks Added for Spending Page (PR #16) - UPDATED

### Spending Summary Reconciliation

**File**: `scripts/regression-report.ts` (lines 113-202)

1. **Spending Summary Stats** (lines 116-123)
   ```
   ✓ Last complete month total
   ✓ Typical monthly (3-month AVERAGE, matching dashboard)
   ✓ Fixed/Essentials/Flexible bucket totals (3-month average)
   ✓ Category count
   ✓ Merchant count
   ```

2. **12-Month History Reconciliation** (lines 126-149)
   - For each month in `monthlyHistory`:
     - `month.total === (month.fixed + month.essentials + month.flexible)` (within 1¢)
     - `month.total === sum(month.categories[].amount)` (within 1¢)
   - **Exit code 1** if any month fails reconciliation
   - **Pass**: All months reconcile

3. **Spending Buckets vs Dashboard Cards** (lines 152-177) - **NOW EXITS NON-ZERO**
   - Compare 3-month average spending buckets with dashboard Money Coach 3-month average
   - For each bucket (Fixed/Essentials/Flexible):
     - `spendingPage.bucket.total === dashboard.bucket.monthlyAverage` (within $1)
   - **Exit code 1** if any bucket mismatches by >$1
   - **Exit code 1** if typical monthly ≠ bucket sum (within $1)
   - Uses **same bucket classification**: `getCategoryBucket()` from `moneyCoachBuckets.ts`

4. **Subscriptions Summary with Sanity Checks** (lines 180-202)
   ```
   ✓ Active subscription count
   ✓ Monthly total (yearly prorated)
   ✓ Yearly total
   ✓ New subscriptions count (last 60 days)
   ✓ Price increase count (5% threshold)
   ✓ Ambiguous count (need review)
   ```
   
   **Sanity Checks** (exit code 1 on failure):
   - Subscription count must be ≤ 30
   - Subscriptions must be ≤ 10% of total spending
   - No sanityCheckFailures in response
   
   **Conservative Detection**:
   - Only: streaming, software, gym, cloud storage
   - Excluded: loans, utilities, insurance, rent, groceries, fuel, dining
   - Ambiguous → review framework (not counted)

### Exit Behavior

- **Exit 0**: All checks pass
- **Exit 1**: Spending history reconciliation fails
- **Exit 1**: Bucket mismatch (spending page ≠ dashboard cards)
- **Exit 1**: Typical monthly ≠ bucket sum
- **Exit 1**: Subscription sanity checks fail (>30 or >10%)

### Example Output

```
💳 Spending Summary (buildSpendingSummary):
   Last complete month (2026-09): CA$5,234
   Typical monthly (last 3 complete): CA$5,156
   Fixed: CA$1,234
   Essentials: CA$2,456
   Flexible: CA$1,544
   Categories: 12
   Merchants: 87

✅ Spending reconciliation passed (12 months)

💵 Spending Buckets vs Dashboard (3-month average):
   fixed: Dashboard = CA$1,234, Spending page = CA$1,234 ✓
   essentials: Dashboard = CA$2,456, Spending page = CA$2,456 ✓
   flexible: Dashboard = CA$1,544, Spending page = CA$1,544 ✓
✅ Spending buckets match dashboard cards

🔄 Subscriptions (buildSubscriptionSummary):
   Active subscriptions: 8
   Monthly total: CA$127
   Yearly total: CA$1,524
   New subscriptions: 1
   Price increases: 2
   Ambiguous (need review): 3
   Subscriptions as % of spending: 2.5%
✅ Subscription detection passed sanity checks
```

## Historical Checks (Pre-existing)

### Dashboard Buckets
- Fixed/Essentials/Flexible/Savings card = drawer reconciliation
- Verified across last 3 complete months

### Net Savings
- Cash change + Debt change + Outside contributions = Total
- Account-level balance sums match monthly component sums
- Monthly average = mean of monthly totals

### Income
- Typical monthly calculation
- Regular vs one-off split
- Source count and amounts

## Usage

```bash
# Run full report (requires credentials)
npx tsx --env-file=.env.local scripts/regression-report.ts <uid>

# Save baseline
npx tsx --env-file=.env.local scripts/regression-report.ts <uid> --save-baseline

# Verify script runs
npx tsx scripts/regression-report.ts --help
```
