"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";
import UpgradePrompt from "@/components/UpgradePrompt";
import type { DebtsSummary } from "@/lib/debtsSummary";
import { calculateDebtPayoff, compareWithMinimumOnly, type DebtInput, type PayoffStrategy } from "@/lib/debtPayoff";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";

export default function DebtPayoffPage() {
  const router = useRouter();
  const { can, loading: planLoading } = usePlan();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<DebtInput[]>([]);
  const [extraPayment, setExtraPayment] = useState(0);
  const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");
  const [currency, setCurrency] = useState("USD");

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
      
      // Fetch debts summary
      try {
        const res = await fetch("/api/user/debts-summary", {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (res.ok) {
          const summary: DebtsSummary = await res.json();
          setCurrency(summary.currency);
          
          // Convert to DebtInput format
          const debtInputs: DebtInput[] = summary.groups.flatMap(g =>
            g.accounts.map(acc => ({
              id: acc.slug,
              name: acc.accountName || acc.bankName,
              balance: acc.balance,
              interestRate: acc.interestRate,
              monthlyPayment: acc.monthlyPayment || acc.minPayment,
              included: true,
            }))
          );
          setDebts(debtInputs);
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

  const result = calculateDebtPayoff(debts, extraPayment, strategy);
  const comparison = compareWithMinimumOnly(debts, extraPayment, strategy);

  // Prepare chart data
  const chartData = result.monthlyBalances
    .filter((_, i) => i % 3 === 0) // Sample every 3 months for performance
    .map(mb => ({
      month: mb.month,
      ...Object.fromEntries(
        mb.debts.map(d => {
          const debt = debts.find(di => di.id === d.debtId);
          return [debt?.name || d.debtId, Math.round(d.balance)];
        })
      ),
    }));

  const includedDebts = debts.filter(d => d.included);
  const hasInvalidData = includedDebts.some(d => d.monthlyPayment === null || d.monthlyPayment <= 0);

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Debt Payoff Planner</h1>
        <p className="mt-1 text-sm text-gray-500">
          Compare avalanche (highest rate) vs snowball (smallest balance) strategies
        </p>
      </div>

      {/* Inputs Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Debts</h2>
          <div className="space-y-3">
            {debts.map(debt => (
              <div key={debt.id} className="flex flex-col sm:flex-row gap-3 p-4 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={debt.included}
                    onChange={(e) => updateDebt(debt.id, "included", e.target.checked)}
                    className="h-4 w-4 rounded accent-purple-600"
                  />
                  <span className="text-sm font-medium text-gray-900 min-w-[120px]">{debt.name}</span>
                </div>
                
                <div className="flex flex-wrap gap-3 flex-1">
                  <div className="flex-1 min-w-[100px]">
                    <label className="block text-xs text-gray-600 mb-1">Balance</label>
                    <input
                      type="number"
                      value={debt.balance}
                      onChange={(e) => updateDebt(debt.id, "balance", Number(e.target.value))}
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  
                  <div className="flex-1 min-w-[100px]">
                    <label className="block text-xs text-gray-600 mb-1">Rate (%)</label>
                    <input
                      type="number"
                      step="0.01"
                      value={debt.interestRate ?? ""}
                      onChange={(e) => updateDebt(debt.id, "interestRate", e.target.value ? Number(e.target.value) : null)}
                      placeholder="0"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                  
                  <div className="flex-1 min-w-[120px]">
                    <label className="block text-xs text-gray-600 mb-1">Monthly Payment</label>
                    <input
                      type="number"
                      value={debt.monthlyPayment ?? ""}
                      onChange={(e) => updateDebt(debt.id, "monthlyPayment", e.target.value ? Number(e.target.value) : null)}
                      placeholder="Required"
                      className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-500"
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
          
          {hasInvalidData && (
            <p className="mt-2 text-xs text-amber-600">
              ⚠ Some debts are missing monthly payment amounts. Enter them above to calculate payoff.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-gray-200">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Extra Monthly Payment</label>
            <input
              type="number"
              value={extraPayment}
              onChange={(e) => setExtraPayment(Number(e.target.value) || 0)}
              placeholder="0"
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500"
            />
            <p className="mt-1 text-xs text-gray-500">Amount to add on top of minimum payments</p>
          </div>
          
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Payoff Strategy</label>
            <div className="flex gap-2">
              <button
                onClick={() => setStrategy("avalanche")}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
                  strategy === "avalanche"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Avalanche
              </button>
              <button
                onClick={() => setStrategy("snowball")}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition ${
                  strategy === "snowball"
                    ? "bg-purple-600 text-white"
                    : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                }`}
              >
                Snowball
              </button>
            </div>
            <p className="mt-1 text-xs text-gray-500">
              {strategy === "avalanche" ? "Highest rate first (saves most interest)" : "Smallest balance first (quick wins)"}
            </p>
          </div>
        </div>
      </div>

      {/* Warnings */}
      {result.warnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4">
          <h3 className="text-sm font-semibold text-amber-900 mb-2">⚠ Warnings</h3>
          <ul className="text-sm text-amber-800 space-y-1">
            {result.warnings.map((w, i) => (
              <li key={i}>• {w}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Results Section */}
      {result.monthsToPayoff !== null && (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-600 mb-1">Debt-Free Date</p>
              <p className="text-2xl font-bold text-gray-900 whitespace-nowrap">
                {result.debtFreeDate ? new Date(result.debtFreeDate + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"}
              </p>
            </div>
            
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-600 mb-1">Months to Payoff</p>
              <p className="text-2xl font-bold text-gray-900 whitespace-nowrap">
                {result.monthsToPayoff}
              </p>
            </div>
            
            <div className="bg-white rounded-lg border border-gray-200 p-4">
              <p className="text-xs text-gray-600 mb-1">Total Interest</p>
              <p className="text-2xl font-bold text-gray-900 whitespace-nowrap">
                ${result.totalInterestPaid.toFixed(0)}
              </p>
            </div>
            
            {comparison.monthsSaved > 0 && (
              <div className="bg-green-50 rounded-lg border border-green-200 p-4">
                <p className="text-xs text-green-700 mb-1">Savings vs Min-Only</p>
                <p className="text-lg font-bold text-green-800 whitespace-nowrap">
                  {comparison.monthsSaved} mo · ${comparison.interestSaved.toFixed(0)}
                </p>
              </div>
            )}
          </div>

          {/* Payoff Order */}
          <div className="bg-white rounded-lg border border-gray-200 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Payoff Order</h2>
            <div className="space-y-2">
              {result.payoffOrder.map((po, idx) => (
                <div key={po.debtId} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-6 h-6 rounded-full bg-purple-600 text-white text-xs font-bold">
                      {idx + 1}
                    </span>
                    <span className="text-sm font-medium text-gray-900">{po.debtName}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-gray-900 whitespace-nowrap">Month {po.payoffMonth}</p>
                    <p className="text-xs text-gray-600 whitespace-nowrap">${po.interestPaid.toFixed(0)} interest</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Balance Over Time Chart */}
          {chartData.length > 1 && (
            <div className="bg-white rounded-lg border border-gray-200 p-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-4">Balance Over Time</h2>
              <ResponsiveContainer width="100%" height={300}>
                <LineChart data={chartData}>
                  <XAxis 
                    dataKey="month" 
                    label={{ value: "Month", position: "insideBottom", offset: -5 }}
                  />
                  <YAxis 
                    tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`}
                  />
                  <Tooltip 
                    formatter={(value: number) => [`$${value.toFixed(0)}`, ""]}
                    labelFormatter={(month) => `Month ${month}`}
                  />
                  <Legend />
                  {debts.filter(d => d.included).map((debt, idx) => (
                    <Line
                      key={debt.id}
                      type="monotone"
                      dataKey={debt.name}
                      stroke={["#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#3b82f6"][idx % 5]}
                      strokeWidth={2}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </>
      )}
    </div>
  );
}
