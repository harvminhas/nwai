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

## Regression Checks Added for Spending Page (PR #16)

### Spending Summary Reconciliation

**File**: `scripts/regression-report.ts` (lines 113-175)

1. **Spending Summary Stats** (lines 113-123)
   ```
   ✓ Last complete month total
   ✓ Typical monthly (last 3 complete)
   ✓ Fixed/Essentials/Flexible bucket totals
   ✓ Category count
   ✓ Merchant count
   ```

2. **12-Month History Reconciliation** (lines 126-149)
   - For each month in `monthlyHistory`:
     - `month.total === (month.fixed + month.essentials + month.flexible)` (within 1¢)
     - `month.total === sum(month.categories[].amount)` (within 1¢)
   - **Exit code 1** if any month fails reconciliation
   - **Pass**: All months reconcile

3. **Spending Buckets vs Dashboard Cards** (lines 152-165)
   - Compare spending page bucket totals with dashboard Money Coach breakdown
   - Log dashboard average vs last month for each bucket (Fixed/Essentials/Flexible)
   - Validates consistency between dashboard cards and spending page

4. **Subscriptions Summary** (lines 168-175)
   ```
   ✓ Active subscription count
   ✓ Monthly total (yearly prorated)
   ✓ Yearly total
   ✓ New subscriptions count (last 60 days)
   ✓ Price increase count (5% threshold)
   ```

### Exit Behavior

- **Exit 0**: All checks pass
- **Exit 1**: Any reconciliation fails (spending history mismatch)

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

   fixed: Dashboard avg = CA$1,234, Last month = CA$1,234
   essentials: Dashboard avg = CA$2,400, Last month = CA$2,456
   flexible: Dashboard avg = CA$1,500, Last month = CA$1,544

🔄 Subscriptions (buildSubscriptionSummary):
   Active subscriptions: 8
   Monthly total: CA$127
   Yearly total: CA$1,524
   New subscriptions: 1
   Price increases: 2
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
