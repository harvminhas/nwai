import type { DebtsSummary } from "@/lib/debtsSummary";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatChange, getChangeColor } from "@/lib/colorHelpers";

interface OverviewTabProps {
  summary: DebtsSummary;
}

export function OverviewTab({ summary }: OverviewTabProps) {
  const {
    totalDebt,
    currency,
    changeVsLastMonth,
    changeVs12Months,
    monthlyPayments,
    interestPaidLast3Months,
    interestPaidByYear,
    weightedAvgRate,
    groups,
    payoffEstimates,
  } = summary;

  // Earliest payoff date across all accounts
  const earliestPayoff = payoffEstimates
    .filter(e => e.payoffDate !== null)
    .sort((a, b) => (a.payoffDate! < b.payoffDate! ? -1 : 1))[0];
  
  const latestPayoff = payoffEstimates
    .filter(e => e.payoffDate !== null)
    .sort((a, b) => (a.payoffDate! > b.payoffDate! ? -1 : 1))[0];

  return (
    <div className="space-y-6">
      {/* Total Debt Card */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <p className="text-sm text-gray-600 mb-1">Total Debt</p>
        <p className="text-3xl font-bold text-gray-900 mb-3">
          {formatCurrency(totalDebt, currency)}
        </p>
        <div className="flex gap-4 text-sm">
          <div>
            <span className="text-gray-600">vs last month: </span>
            <span className={getChangeColor(changeVsLastMonth, "negative")}>
              {formatChange(changeVsLastMonth, currency)}
            </span>
          </div>
          <div>
            <span className="text-gray-600">vs 12 months: </span>
            <span className={getChangeColor(changeVs12Months, "negative")}>
              {formatChange(changeVs12Months, currency)}
            </span>
          </div>
        </div>
      </div>

      {/* Key Metrics Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Monthly Payments */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-600 mb-1">Monthly Payments</p>
          <p className="text-2xl font-bold text-gray-900">
            {formatCurrency(monthlyPayments, currency)}
          </p>
        </div>

        {/* Interest Last 3 Months */}
        <div className="bg-white rounded-lg border border-gray-200 p-4">
          <p className="text-xs text-gray-600 mb-1">Interest (Last 3 Months)</p>
          <p className="text-2xl font-bold text-gray-900">
            {formatCurrency(interestPaidLast3Months, currency)}
          </p>
        </div>

        {/* Weighted Average Rate */}
        {weightedAvgRate !== null && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-600 mb-1">Weighted Avg Rate</p>
            <p className="text-2xl font-bold text-gray-900">
              {weightedAvgRate.toFixed(2)}%
            </p>
          </div>
        )}

        {/* Debt-Free Estimate */}
        {latestPayoff && (
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-xs text-gray-600 mb-1">Debt-Free By</p>
            <p className="text-2xl font-bold text-gray-900">
              {formatPayoffDate(latestPayoff.payoffDate!)}
            </p>
            <p className="text-xs text-gray-500 mt-1">
              {latestPayoff.monthsToPayoff} months at current payments
            </p>
          </div>
        )}
      </div>

      {/* Interest by Year */}
      {interestPaidByYear.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Interest Paid by Year</h2>
          <div className="space-y-3">
            {interestPaidByYear.map((period) => (
              <div key={period.period} className="flex items-center justify-between">
                <span className="text-sm text-gray-600">{period.period}</span>
                <span className="text-base font-semibold text-gray-900 tabular-nums">
                  {formatCurrency(period.total, currency)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Debts by Type */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">By Type</h2>
        <div className="space-y-3">
          {groups.map((group) => {
            const pct = totalDebt > 0 ? (group.totalBalance / totalDebt) * 100 : 0;
            const accountCount = group.accounts.length + group.manualLiabilities.length;
            
            return (
              <div key={group.type}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900">{group.label}</span>
                    <span className="text-xs text-gray-500">
                      ({accountCount} {accountCount === 1 ? "account" : "accounts"})
                    </span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900">
                      {formatCurrency(group.totalBalance, currency)}
                    </p>
                    <p className="text-xs text-gray-500">{pct.toFixed(1)}%</p>
                  </div>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-500 rounded-full transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatPayoffDate(dateStr: string): string {
  const [year, month] = dateStr.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}
