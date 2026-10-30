"use client";

import { useState, useEffect } from "react";
import { calculateDebtPayoff, calculateMinimumPayment, solveForTargetDate, compareWithMinimumOnly, isHELOC, type DebtInput, type PayoffStrategy } from "@/lib/debtPayoff";
import { formatCurrency } from "@/lib/currencyUtils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import type { DebtPlan, DebtPlanMode } from "@/lib/debtPlanTypes";

interface PlanModalProps {
  debts: DebtInput[];
  currency: string;
  token: string;
  existingPlan?: DebtPlan | null;
  onClose: () => void;
  onSave: () => void;
}

export default function PlanModal({ debts, currency, token, existingPlan, onClose, onSave }: PlanModalProps) {
  const [tab, setTab] = useState<DebtPlanMode>(existingPlan?.mode || "extra");
  const [planName, setPlanName] = useState(existingPlan?.name || "");
  const [strategy, setStrategy] = useState<PayoffStrategy>(existingPlan?.strategy || "avalanche");
  const [selectedDebts, setSelectedDebts] = useState<Record<string, boolean>>({});
  const [extraAmount, setExtraAmount] = useState(existingPlan?.extraMonthly || 0);
  const [targetDate, setTargetDate] = useState(existingPlan?.targetDate || "");
  const [saving, setSaving] = useState(false);

  // Initialize debt selection
  useEffect(() => {
    if (existingPlan) {
      const selection: Record<string, boolean> = {};
      existingPlan.debtSlugs.forEach(slug => {
        selection[slug] = true;
      });
      setSelectedDebts(selection);
    } else {
      // Default: all non-HELOC/non-mortgage debts
      const selection: Record<string, boolean> = {};
      debts.forEach(d => {
        const isHELOCorMortgage = isHELOC(d) || d.accountType.toLowerCase().includes("mortgage");
        selection[d.id] = !isHELOCorMortgage;
      });
      setSelectedDebts(selection);
    }
  }, [debts, existingPlan]);

  const workingDebts = debts.map(d => ({
    ...d,
    included: selectedDebts[d.id] || false,
  }));

  const includedDebts = workingDebts.filter(d => d.included);
  const totalMinimums = includedDebts.reduce((sum, d) => sum + calculateMinimumPayment(d), 0);

  // Quick selection presets
  const selectCreditCardsOnly = () => {
    const selection: Record<string, boolean> = {};
    debts.forEach(d => {
      selection[d.id] = d.accountType.toLowerCase().includes("credit");
    });
    setSelectedDebts(selection);
  };

  const excludeHELOCMortgage = () => {
    const selection: Record<string, boolean> = {};
    debts.forEach(d => {
      const isHELOCorMortgage = isHELOC(d) || d.accountType.toLowerCase().includes("mortgage");
      selection[d.id] = !isHELOCorMortgage;
    });
    setSelectedDebts(selection);
  };

  const selectAll = () => {
    const selection: Record<string, boolean> = {};
    debts.forEach(d => {
      selection[d.id] = true;
    });
    setSelectedDebts(selection);
  };

  // Calculate results based on mode
  let result = null;
  let comparison = null;
  let chartData = null;
  let requiredPayment = 0;
  let isPossible = true;

  if (tab === "extra" && includedDebts.length > 0) {
    const budget = totalMinimums + extraAmount;
    result = calculateDebtPayoff(workingDebts, budget, strategy);
    comparison = compareWithMinimumOnly(workingDebts, budget, strategy);
    
    const minimumOnlyResult = calculateDebtPayoff(workingDebts, totalMinimums, strategy);
    chartData = result.monthlyBalances.map((mb, i) => ({
      month: mb.month,
      "Your plan": Math.round(mb.totalBalance),
      "Minimums only": Math.round(minimumOnlyResult.monthlyBalances[i]?.totalBalance || 0),
    })).filter((_, i) => i % 3 === 0);
  } else if (tab === "targetDate" && includedDebts.length > 0 && targetDate) {
    const [year, month] = targetDate.split("-").map(Number);
    const now = new Date();
    const target = new Date(year, month - 1);
    const monthsToTarget = Math.round((target.getTime() - now.getTime()) / (30.44 * 24 * 60 * 60 * 1000));
    
    if (monthsToTarget > 0) {
      const solved = solveForTargetDate(workingDebts, monthsToTarget, strategy);
      if (solved) {
        requiredPayment = solved.requiredBudget;
        result = solved.result;
        
        const minimumOnlyResult = calculateDebtPayoff(workingDebts, totalMinimums, strategy);
        chartData = result.monthlyBalances.map((mb, i) => ({
          month: mb.month,
          "Your plan": Math.round(mb.totalBalance),
          "Minimums only": Math.round(minimumOnlyResult.monthlyBalances[i]?.totalBalance || 0),
        })).filter((_, i) => i % 3 === 0);
      } else {
        isPossible = false;
        // Show earliest possible date at minimums
        result = calculateDebtPayoff(workingDebts, totalMinimums, strategy);
      }
    }
  }

  const handleSave = async () => {
    if (!planName.trim() || includedDebts.length === 0) {
      alert("Please enter a plan name and select at least one debt.");
      return;
    }

    setSaving(true);
    try {
      const debtSlugs = includedDebts.map(d => d.id);
      const budget = tab === "extra" ? totalMinimums + extraAmount : requiredPayment;
      
      // Build baseline
      const baseline = {
        balances: Object.fromEntries(includedDebts.map(d => [d.id, d.balance])),
        monthlyProjection: result?.monthlyBalances.map(mb => ({
          month: (() => {
            const now = new Date();
            const future = new Date(now);
            future.setMonth(future.getMonth() + mb.month);
            return `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`;
          })(),
          totalBalance: mb.totalBalance,
        })) || [],
      };

      const planData = {
        name: planName.trim(),
        mode: tab,
        debtSlugs,
        strategy,
        extraMonthly: tab === "extra" ? extraAmount : undefined,
        targetDate: tab === "targetDate" ? targetDate : undefined,
        monthlyBudget: budget,
        baseline,
      };

      const url = existingPlan 
        ? `/api/user/debt-plans/${existingPlan.id}`
        : "/api/user/debt-plans";
      const method = existingPlan ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(planData),
      });

      if (!res.ok) {
        throw new Error("Failed to save plan");
      }

      onSave();
    } catch (err) {
      console.error("Save error:", err);
      alert("Failed to save plan. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-auto">
      <div className="bg-white rounded-lg max-w-4xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between">
          <h2 className="text-xl font-bold text-gray-900">
            {existingPlan ? "Edit plan" : "New debt payoff plan"}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Plan Name */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Plan name</label>
            <input
              type="text"
              value={planName}
              onChange={(e) => setPlanName(e.target.value)}
              placeholder="e.g., Pay off credit cards"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
          </div>

          {/* Debt Selection */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Which debts?</label>
            <div className="flex flex-wrap gap-2 mb-3">
              <button
                onClick={selectCreditCardsOnly}
                className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Credit cards only
              </button>
              <button
                onClick={excludeHELOCMortgage}
                className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                Exclude HELOC/mortgage
              </button>
              <button
                onClick={selectAll}
                className="px-3 py-1 text-xs font-medium rounded-full bg-gray-100 text-gray-700 hover:bg-gray-200"
              >
                All
              </button>
            </div>
            <div className="space-y-2 max-h-40 overflow-y-auto border border-gray-200 rounded-lg p-3">
              {debts.map(debt => (
                <label key={debt.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
                  <input
                    type="checkbox"
                    checked={selectedDebts[debt.id] || false}
                    onChange={(e) => setSelectedDebts({ ...selectedDebts, [debt.id]: e.target.checked })}
                    className="h-4 w-4 rounded accent-purple-600"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{debt.name}</p>
                    <p className="text-xs text-gray-600">
                      {formatCurrency(debt.balance, currency)} · {debt.interestRate ? `${debt.interestRate.toFixed(2)}%` : "No rate"}
                    </p>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* Strategy */}
          <div>
            <label className="block text-sm font-semibold text-gray-900 mb-2">Payoff strategy</label>
            <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1 w-full">
              <button
                onClick={() => setStrategy("avalanche")}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition whitespace-nowrap ${
                  strategy === "avalanche"
                    ? "bg-white text-purple-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Highest interest first (saves the most)
              </button>
              <button
                onClick={() => setStrategy("snowball")}
                className={`flex-1 px-4 py-2 rounded-md text-sm font-medium transition whitespace-nowrap ${
                  strategy === "snowball"
                    ? "bg-white text-purple-700 shadow-sm"
                    : "text-gray-600 hover:text-gray-900"
                }`}
              >
                Smallest balance first (quick wins)
              </button>
            </div>
          </div>

          {/* Mode Tabs */}
          <div>
            <div className="border-b border-gray-200">
              <div className="flex gap-4">
                <button
                  onClick={() => setTab("extra")}
                  className={`pb-3 px-1 text-sm font-semibold border-b-2 transition ${
                    tab === "extra"
                      ? "border-purple-600 text-purple-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  I have extra to pay
                </button>
                <button
                  onClick={() => setTab("targetDate")}
                  className={`pb-3 px-1 text-sm font-semibold border-b-2 transition ${
                    tab === "targetDate"
                      ? "border-purple-600 text-purple-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  Debt-free by a date
                </button>
              </div>
            </div>

            <div className="pt-6 space-y-6">
              {tab === "extra" ? (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Extra monthly payment (above minimums)
                    </label>
                    <input
                      type="number"
                      value={extraAmount}
                      onChange={(e) => setExtraAmount(Number(e.target.value) || 0)}
                      className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                    <p className="mt-2 text-sm text-gray-600">
                      Minimums total {formatCurrency(totalMinimums, currency)}
                    </p>
                  </div>

                  {result && result.monthsToPayoff !== null && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <p className="text-xs text-purple-700 mb-1">Debt-free date</p>
                          <p className="text-xl font-bold text-purple-900 whitespace-nowrap">
                            {result.debtFreeDate ? new Date(result.debtFreeDate + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-purple-700 mb-1">Total interest</p>
                          <p className="text-xl font-bold text-purple-900 whitespace-nowrap">
                            {formatCurrency(result.totalInterestPaid, currency)}
                          </p>
                        </div>
                        {comparison && comparison.interestSaved > 0 && (
                          <div>
                            <p className="text-xs text-green-700 mb-1">Interest saved</p>
                            <p className="text-xl font-bold text-green-800 whitespace-nowrap">
                              {formatCurrency(comparison.interestSaved, currency)}
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Target debt-free date
                    </label>
                    <input
                      type="month"
                      value={targetDate}
                      onChange={(e) => setTargetDate(e.target.value)}
                      className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>

                  {!isPossible && result && (
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
                      <p className="text-sm font-semibold text-amber-900 mb-1">⚠ Target not achievable</p>
                      <p className="text-sm text-amber-800">
                        The earliest possible debt-free date at minimum payments is{" "}
                        <strong>
                          {result.debtFreeDate ? new Date(result.debtFreeDate + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "unknown"}
                        </strong>.
                      </p>
                    </div>
                  )}

                  {isPossible && result && result.monthsToPayoff !== null && (
                    <div className="bg-purple-50 border border-purple-200 rounded-lg p-6">
                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                        <div>
                          <p className="text-xs text-purple-700 mb-1">Required monthly payment</p>
                          <p className="text-xl font-bold text-purple-900 whitespace-nowrap">
                            {formatCurrency(requiredPayment, currency)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-purple-700 mb-1">Above minimums</p>
                          <p className="text-xl font-bold text-purple-900 whitespace-nowrap">
                            {formatCurrency(requiredPayment - totalMinimums, currency)}
                          </p>
                        </div>
                        <div>
                          <p className="text-xs text-purple-700 mb-1">Total interest</p>
                          <p className="text-xl font-bold text-purple-900 whitespace-nowrap">
                            {formatCurrency(result.totalInterestPaid, currency)}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Minimums breakdown */}
              {includedDebts.length > 0 && (
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-2">
                    Minimum payments
                    <span 
                      className="ml-2 text-[10px] px-1.5 py-0.5 bg-gray-200 text-gray-600 rounded uppercase font-semibold cursor-help"
                      title="Cards: max(interest + 1%, 3%, $10); HELOC: interest only; Loans: interest + 1%"
                    >
                      how?
                    </span>
                  </p>
                  <div className="space-y-1 text-xs text-gray-700">
                    {includedDebts.map(d => (
                      <div key={d.id} className="flex justify-between">
                        <span className="truncate">{d.name}</span>
                        <span className="whitespace-nowrap ml-2">{formatCurrency(calculateMinimumPayment(d), currency)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Chart */}
              {chartData && chartData.length > 1 && (
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-3">Balance projection</p>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={chartData}>
                      <XAxis dataKey="month" hide />
                      <YAxis hide />
                      <Tooltip 
                        formatter={(value) => formatCurrency(Number(value), currency)}
                        labelFormatter={(month) => `Month ${month}`}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="Your plan"
                        stroke="#8b5cf6"
                        strokeWidth={3}
                        dot={false}
                      />
                      <Line
                        type="monotone"
                        dataKey="Minimums only"
                        stroke="#d1d5db"
                        strokeWidth={2}
                        strokeDasharray="5 5"
                        dot={false}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Payoff order preview */}
              {result && result.payoffOrder.length > 0 && result.payoffOrder.length <= 5 && (
                <div>
                  <p className="text-sm font-semibold text-gray-900 mb-2">Payoff order</p>
                  <div className="space-y-1 text-xs text-gray-700">
                    {result.payoffOrder.map((po, idx) => (
                      <div key={po.debtId} className="flex items-center gap-2">
                        <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-[10px] font-bold shrink-0">
                          {idx + 1}
                        </span>
                        <span className="flex-1 truncate">{po.debtName}</span>
                        <span className="whitespace-nowrap text-gray-600">Month {po.payoffMonth}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving || includedDebts.length === 0 || !planName.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? "Saving..." : "Save plan"}
          </button>
        </div>
      </div>
    </div>
  );
}
