"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";
import UpgradePrompt from "@/components/UpgradePrompt";
import type { DebtsSummary } from "@/lib/debtsSummary";
import { calculateDebtPayoff, calculateMinimumPayment, compareWithMinimumOnly, type DebtInput, type PayoffStrategy } from "@/lib/debtPayoff";
import { formatCurrency, fmtCompact } from "@/lib/currencyUtils";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function DebtPayoffPage() {
  const router = useRouter();
  const { can, loading: planLoading } = usePlan();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<DebtInput[]>([]);
  const [budget, setBudget] = useState(0);
  const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");
  const [currency, setCurrency] = useState("CAD");
  const [editDebtsExpanded, setEditDebtsExpanded] = useState(false);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
      
      try {
        const res = await fetch("/api/user/debts-summary", {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (res.ok) {
          const summary: DebtsSummary = await res.json();
          setCurrency(summary.currency);
          
          const debtInputs: DebtInput[] = summary.groups.flatMap(g =>
            g.accounts.map(acc => ({
              id: acc.slug,
              name: acc.accountName || acc.bankName,
              balance: acc.balance,
              interestRate: acc.interestRate,
              monthlyPayment: acc.monthlyPayment,
              minPayment: acc.minPayment,
              accountType: acc.accountType,
              included: true,
            }))
          );
          setDebts(debtInputs);
          
          const totalMinimums = debtInputs.reduce((sum, d) => sum + calculateMinimumPayment(d), 0);
          setBudget(totalMinimums);
        }
      } catch (err) {
        console.error("Failed to load debts:", err);
      } finally {
        setLoading(false);
      }
    });
  }, [router]);

  const canUsePayoffPlanner = can("payoffPlanner");

  if (planLoading || loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div className="h-10 w-10 animate-spin rounded-full border-4 border-purple-600 border-t-transparent" />
      </div>
    );
  }

  if (!canUsePayoffPlanner) {
    return <UpgradePrompt feature="payoffPlanner" description="The debt payoff planner requires a Pro subscription." />;
  }

  const updateDebt = (id: string, field: keyof DebtInput, value: unknown) => {
    setDebts(prev => prev.map(d => d.id === id ? { ...d, [field]: value } : d));
  };

  const includedDebts = debts.filter(d => d.included);
  const totalMinimums = includedDebts.reduce((sum, d) => sum + calculateMinimumPayment(d), 0);
  const extraPayment = Math.max(0, budget - totalMinimums);

  const result = calculateDebtPayoff(debts, budget, strategy);
  const comparison = compareWithMinimumOnly(debts, budget, strategy);
  
  // Prepare chart data - total balance over time
  const minimumOnlyResult = calculateDebtPayoff(debts, totalMinimums, strategy);
  const chartData = result.monthlyBalances.map((mb, i) => ({
    month: mb.month,
    "Your plan": Math.round(mb.totalBalance),
    "Minimums only": Math.round(minimumOnlyResult.monthlyBalances[i]?.totalBalance || 0),
  })).filter((_, i) => i % 3 === 0); // Sample every 3 months

  // Find target debt (where extra payment goes)
  const activeDebts = includedDebts.filter(d => d.balance > 0);
  let targetDebt = null;
  if (activeDebts.length > 0 && extraPayment > 0) {
    targetDebt = strategy === "avalanche"
      ? activeDebts.reduce((highest, d) => (d.interestRate || 0) > (highest.interestRate || 0) ? d : highest)
      : activeDebts.reduce((smallest, d) => d.balance < smallest.balance ? d : smallest);
  }

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Debt Payoff Planner</h1>
        <p className="mt-1 text-sm text-gray-500">
          See when you'll be debt-free and how much you'll save
        </p>
      </div>

      {/* Budget Input */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <label className="block text-sm font-semibold text-gray-900 mb-3">
          Monthly budget for debt
        </label>
        <input
          type="number"
          value={budget}
          onChange={(e) => setBudget(Number(e.target.value) || 0)}
          className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
        />
        <p className="mt-2 text-sm text-gray-600">
          Minimums total {formatCurrency(totalMinimums, currency)}
          {extraPayment > 0 && targetDebt && (
            <>; extra {formatCurrency(extraPayment, currency)} goes to <strong>{targetDebt.name}</strong></>
          )}
        </p>
      </div>

      {/* Strategy Selection */}
      <div className="bg-white rounded-lg border border-gray-200 p-6">
        <label className="block text-sm font-semibold text-gray-900 mb-3">
          Payoff strategy
        </label>
        <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
          <button
            onClick={() => setStrategy("avalanche")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              strategy === "avalanche"
                ? "bg-white text-purple-700 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Highest interest first (saves the most)
          </button>
          <button
            onClick={() => setStrategy("snowball")}
            className={`px-4 py-2 rounded-md text-sm font-medium transition ${
              strategy === "snowball"
                ? "bg-white text-purple-700 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Smallest balance first (quick wins)
          </button>
        </div>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-amber-900 mb-1">⚠ Warnings</p>
          <ul className="text-sm text-amber-800 space-y-0.5">
            {result.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Results Hero */}
      {result.monthsToPayoff !== null && (
        <div className="bg-gradient-to-br from-purple-50 to-violet-50 border border-purple-200 rounded-lg p-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Debt-Free Date */}
            <div>
              <p className="text-sm font-medium text-purple-700 mb-2">You'll be debt-free in</p>
              <p className="text-5xl font-bold text-purple-900">
                {result.debtFreeDate ? new Date(result.debtFreeDate + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—"}
              </p>
              <p className="text-lg text-purple-700 mt-1">{result.monthsToPayoff} months</p>
            </div>
            
            {/* Savings */}
            <div className="space-y-3">
              <div>
                <p className="text-sm text-purple-700">Total interest</p>
                <p className="text-2xl font-bold text-purple-900 whitespace-nowrap">
                  {formatCurrency(result.totalInterestPaid, currency)}
                </p>
              </div>
              
              {comparison.monthsSaved > 0 && (
                <div>
                  <p className="text-sm text-green-700">Savings vs minimums only</p>
                  <p className="text-lg font-semibold text-green-800 whitespace-nowrap">
                    {comparison.monthsSaved} months · {formatCurrency(comparison.interestSaved, currency)}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payoff Order */}
      {result.payoffOrder.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Payoff order</h2>
          <div className="space-y-2">
            {result.payoffOrder.map((po, idx) => {
              const debt = debts.find(d => d.id === po.debtId);
              return (
                <div key={po.debtId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-100 text-purple-700 text-xs font-bold shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-gray-900 truncate">{po.debtName}</p>
                      <p className="text-xs text-gray-600">
                        {debt?.interestRate ? `${debt.interestRate.toFixed(2)}%` : "No rate"} · {formatCurrency(debt?.balance || 0, currency)}
                      </p>
                    </div>
                  </div>
                  <div className="text-right shrink-0 ml-3">
                    <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">Month {po.payoffMonth}</p>
                    <p className="text-xs text-gray-600 whitespace-nowrap">{formatCurrency(po.interestPaid, currency)} interest</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Balance Over Time Chart */}
      {chartData.length > 1 && (
        <div className="bg-white rounded-lg border border-gray-200 p-6">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Balance over time</h2>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={chartData}>
              <XAxis 
                dataKey="month" 
                label={{ value: "Month", position: "insideBottom", offset: -5 }}
              />
              <YAxis 
                tickFormatter={(v) => fmtCompact(v, currency)}
              />
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

      {/* Edit Debts (Collapsed) */}
      <div className="bg-white rounded-lg border border-gray-200">
        <button
          onClick={() => setEditDebtsExpanded(!editDebtsExpanded)}
          className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition"
        >
          <span className="text-sm font-semibold text-gray-900">Edit debts</span>
          <svg 
            className={`h-5 w-5 text-gray-400 transition-transform ${editDebtsExpanded ? "rotate-180" : ""}`}
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        
        {editDebtsExpanded && (
          <div className="border-t border-gray-200 p-4">
            <div className="space-y-3">
              {debts.map(debt => {
                const minimum = calculateMinimumPayment(debt);
                return (
                  <div key={debt.id} className="grid grid-cols-1 sm:grid-cols-12 gap-3 p-3 bg-gray-50 rounded-lg">
                    <div className="sm:col-span-1 flex items-center">
                      <input
                        type="checkbox"
                        checked={debt.included}
                        onChange={(e) => updateDebt(debt.id, "included", e.target.checked)}
                        className="h-4 w-4 rounded accent-purple-600"
                      />
                    </div>
                    <div className="sm:col-span-3 flex items-center">
                      <span className="text-sm font-medium text-gray-900">{debt.name}</span>
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs text-gray-600 mb-1">Balance</label>
                      <input
                        type="number"
                        value={debt.balance}
                        onChange={(e) => updateDebt(debt.id, "balance", Number(e.target.value))}
                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-gray-600 mb-1">Rate (%)</label>
                      <input
                        type="number"
                        step="0.01"
                        value={debt.interestRate ?? ""}
                        onChange={(e) => updateDebt(debt.id, "interestRate", e.target.value ? Number(e.target.value) : null)}
                        placeholder="0"
                        className="w-full px-2 py-1 text-sm border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <label className="block text-xs text-gray-600 mb-1 flex items-center gap-1">
                        Minimum
                        <span 
                          className="text-[9px] px-1 py-0.5 bg-gray-200 text-gray-600 rounded uppercase font-semibold cursor-help"
                          title={debt.minPayment ? "From your statement" : `Calculated: ${debt.accountType.includes("credit") ? "max(interest + 1%, 3%, $10)" : debt.accountType.includes("loc") ? "interest + 1%" : "interest + 1% or observed payment"}`}
                        >
                          {debt.minPayment ? "stmt" : "calc"}
                        </span>
                      </label>
                      <div className="px-2 py-1 text-sm bg-gray-100 border border-gray-200 rounded text-gray-700">
                        {formatCurrency(minimum, currency)}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
