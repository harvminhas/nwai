"use client";

import { useState, useEffect } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import type { DebtsSummary } from "@/lib/debtsSummary";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatChange, getChangeColor } from "@/lib/colorHelpers";
import { ReviewList } from "@/components/ReviewList";
import { calculatePayoffInsight, type DebtForPayoff } from "@/lib/payoffInsight";

interface OverviewTabProps {
  summary: DebtsSummary;
}

export function OverviewTab({ summary }: OverviewTabProps) {
  const [token, setToken] = useState<string | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (user) {
        const tok = await user.getIdToken();
        setToken(tok);
      } else {
        setToken(null);
      }
    });
  }, []);

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

  // Calculate payoff insight
  const debtsForPayoff: DebtForPayoff[] = groups.flatMap(g =>
    g.accounts.map(acc => ({
      accountSlug: acc.slug,
      accountName: acc.accountName,
      balance: acc.balance,
      interestRate: acc.interestRate,
      monthlyPayment: acc.monthlyPayment,
    }))
  );
  const payoffInsight = calculatePayoffInsight(debtsForPayoff, 200);

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

      {/* Payoff Insight */}
      {payoffInsight.hasInsight && payoffInsight.highestRateAccount && (
        <div className="bg-violet-50 border border-violet-200 rounded-lg p-5">
          <h3 className="text-sm font-semibold text-violet-900 mb-2">
            💡 Payoff Insight
          </h3>
          <p className="text-sm text-violet-800 mb-4">
            Accelerate payoff by adding <strong>{formatCurrency(200, currency)}/mo</strong> extra to your highest-rate debt 
            ({payoffInsight.highestRateAccount.accountName || "Account"} at {payoffInsight.highestRateAccount.rate.toFixed(2)}%).
          </p>
          
          <div className="space-y-4">
            {payoffInsight.scenarios.map(scenario => {
              const payoffDate = new Date();
              payoffDate.setMonth(payoffDate.getMonth() + scenario.currentMonths);
              const acceleratedDate = new Date();
              acceleratedDate.setMonth(acceleratedDate.getMonth() + scenario.acceleratedMonths);
              
              return (
                <div key={scenario.accountSlug} className="bg-white rounded-lg p-4 border border-violet-100">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <p className="font-medium text-gray-900">{scenario.accountName || "Account"}</p>
                      <p className="text-sm text-gray-600">
                        {formatCurrency(scenario.balance, currency)} @ {scenario.rate.toFixed(2)}%
                      </p>
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <p className="text-gray-600 mb-1">Current Payment</p>
                      <p className="font-semibold text-gray-900">
                        {formatCurrency(scenario.currentPayment, currency)}/mo
                      </p>
                      <p className="text-xs text-gray-500 mt-1">
                        {scenario.currentMonths} months → {payoffDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                      </p>
                      <p className="text-xs text-gray-500">
                        {formatCurrency(scenario.currentInterestPaid, currency)} interest
                      </p>
                    </div>
                    
                    {scenario.extraPayment > 0 && (
                      <div className="border-l border-violet-200 pl-4">
                        <p className="text-gray-600 mb-1">With +{formatCurrency(scenario.extraPayment, currency)}/mo</p>
                        <p className="font-semibold text-violet-700">
                          {formatCurrency(scenario.currentPayment + scenario.extraPayment, currency)}/mo
                        </p>
                        <p className="text-xs text-violet-600 mt-1">
                          {scenario.acceleratedMonths} months → {acceleratedDate.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })}
                        </p>
                        <p className="text-xs text-violet-600">
                          {formatCurrency(scenario.acceleratedInterestPaid, currency)} interest
                        </p>
                        <p className="text-xs font-semibold text-green-600 mt-2">
                          💰 Save {scenario.monthsSaved} months & {formatCurrency(scenario.interestSaved, currency)}
                        </p>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

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

      {/* Debt Payment Reviews */}
      <ReviewList 
        token={token}
        reviewType="debt_payment"
      />
    </div>
  );
}

function formatPayoffDate(dateStr: string): string {
  const [year, month] = dateStr.split("-");
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${monthNames[parseInt(month) - 1]} ${year}`;
}
