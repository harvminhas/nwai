"use client";

import { useState, useEffect } from "react";
import { calculateDebtPayoff, calculateMinimumPayment, solveForTargetDate, compareWithMinimumOnly, isHELOC, type DebtInput, type PayoffStrategy } from "@/lib/debtPayoff";
import { formatCurrency } from "@/lib/currencyUtils";
import type { DebtPlan } from "@/lib/debtPlanTypes";
import { useToast } from "@/components/useToast";

interface PlanModalProps {
  debts: DebtInput[];
  currency: string;
  token: string;
  existingPlan?: DebtPlan | null;
  onClose: () => void;
  onSave: () => void;
}

type Step = 1 | 2 | 3;
type DebtSelection = "credit_cards" | "exclude_heloc" | "all" | "custom";
type GoalMode = "extra" | "target_date";

export default function PlanModal({ debts, currency, token, existingPlan, onClose, onSave }: PlanModalProps) {
  const { error, Toast } = useToast();
  const [step, setStep] = useState<Step>(1);
  const [debtSelection, setDebtSelection] = useState<DebtSelection>("exclude_heloc");
  const [customDebts, setCustomDebts] = useState<Record<string, boolean>>({});
  const [goalMode, setGoalMode] = useState<GoalMode>("extra");
  const [extraAmount, setExtraAmount] = useState(500);
  const [targetDate, setTargetDate] = useState("");
  const [planName, setPlanName] = useState("");
  const [strategy, setStrategy] = useState<PayoffStrategy>("avalanche");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [saving, setSaving] = useState(false);

  // Initialize from existing plan
  useEffect(() => {
    if (existingPlan) {
      setPlanName(existingPlan.name);
      setStrategy(existingPlan.strategy);
      setGoalMode(existingPlan.mode === "extra" ? "extra" : "target_date");
      if (existingPlan.mode === "extra" && existingPlan.extraMonthly) {
        setExtraAmount(existingPlan.extraMonthly);
      }
      if (existingPlan.mode === "targetDate" && existingPlan.targetDate) {
        setTargetDate(existingPlan.targetDate);
      }
      
      // Initialize custom debt selection
      const selection: Record<string, boolean> = {};
      existingPlan.debtSlugs.forEach(slug => {
        selection[slug] = true;
      });
      setCustomDebts(selection);
      setDebtSelection("custom");
    }
  }, [existingPlan]);

  // Get selected debts based on current selection mode
  const getSelectedDebts = (): DebtInput[] => {
    if (debtSelection === "credit_cards") {
      return debts.filter(d => d.accountType.toLowerCase().includes("credit"));
    } else if (debtSelection === "exclude_heloc") {
      return debts.filter(d => !isHELOC(d) && !d.accountType.toLowerCase().includes("mortgage"));
    } else if (debtSelection === "all") {
      return debts;
    } else {
      // custom
      return debts.filter(d => customDebts[d.id]);
    }
  };

  const selectedDebts = getSelectedDebts();
  const totalBalance = selectedDebts.reduce((sum, d) => sum + d.balance, 0);
  const totalMinimums = selectedDebts.reduce((sum, d) => sum + calculateMinimumPayment(d), 0);

  // Compute result for current settings
  const workingDebts = debts.map(d => ({
    ...d,
    included: selectedDebts.some(sd => sd.id === d.id),
  }));

  let result = null;
  let comparison = null;
  let requiredPayment = 0;
  let isPossible = true;

  if (goalMode === "extra" && selectedDebts.length > 0) {
    const budget = totalMinimums + extraAmount;
    result = calculateDebtPayoff(workingDebts, budget, strategy);
    comparison = compareWithMinimumOnly(workingDebts, budget, strategy);
  } else if (goalMode === "target_date" && selectedDebts.length > 0 && targetDate) {
    const [year, month] = targetDate.split("-").map(Number);
    const now = new Date();
    const target = new Date(year, month - 1);
    const monthsToTarget = Math.round((target.getTime() - now.getTime()) / (30.44 * 24 * 60 * 60 * 1000));
    
    if (monthsToTarget > 0) {
      const solved = solveForTargetDate(workingDebts, monthsToTarget, strategy);
      if (solved) {
        requiredPayment = solved.requiredBudget;
        result = solved.result;
        comparison = compareWithMinimumOnly(workingDebts, requiredPayment, strategy);
      } else {
        isPossible = false;
        result = calculateDebtPayoff(workingDebts, totalMinimums, strategy);
      }
    }
  }

  // Auto-generate plan name from debt selection
  useEffect(() => {
    if (!existingPlan && !planName) {
      if (debtSelection === "credit_cards") {
        setPlanName("Credit cards payoff");
      } else if (debtSelection === "exclude_heloc") {
        setPlanName("Debt payoff plan");
      } else if (debtSelection === "all") {
        setPlanName("Pay off everything");
      } else if (selectedDebts.length > 0) {
        setPlanName(`${selectedDebts.length} debts payoff`);
      }
    }
  }, [debtSelection, selectedDebts.length, existingPlan, planName]);

  const handleNext = () => {
    if (step < 3) setStep((step + 1) as Step);
  };

  const handleBack = () => {
    if (step > 1) setStep((step - 1) as Step);
  };

  const handleSave = async () => {
    if (!planName.trim() || selectedDebts.length === 0) {
      error("Please enter a plan name and select at least one debt.");
      return;
    }

    setSaving(true);
    try {
      const debtSlugs = selectedDebts.map(d => d.id);
      const budget = goalMode === "extra" ? totalMinimums + extraAmount : requiredPayment;
      const extra = goalMode === "extra" ? extraAmount : Math.max(0, requiredPayment - totalMinimums);
      
      // Build baseline
      const baseline = {
        balances: Object.fromEntries(selectedDebts.map(d => [d.id, d.balance])),
        monthlyProjection: result?.monthlyBalances.map(mb => {
          const now = new Date();
          const future = new Date(now);
          future.setMonth(future.getMonth() + mb.month);
          return {
            month: `${future.getFullYear()}-${String(future.getMonth() + 1).padStart(2, "0")}`,
            totalBalance: mb.totalBalance,
          };
        }) || [],
      };

      const planData = {
        name: planName.trim(),
        mode: goalMode === "extra" ? ("extra" as const) : ("targetDate" as const),
        debtSlugs,
        strategy,
        extraMonthly: extra,
        targetDate: goalMode === "target_date" ? targetDate : undefined,
        monthlyBudget: budget,
        baseline,
        interestSaved: comparison?.interestSaved || 0,
        monthsSaved: comparison?.monthsSaved || 0,
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
      error("Failed to save plan. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-auto">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4">
          <div className="flex items-center justify-between mb-4">
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
          
          {/* Step indicator */}
          <div className="flex items-center gap-2">
            {[1, 2, 3].map((s) => (
              <div key={s} className="flex items-center flex-1">
                <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-semibold ${
                  s === step ? "bg-purple-600 text-white" : s < step ? "bg-purple-200 text-purple-800" : "bg-gray-200 text-gray-500"
                }`}>
                  {s}
                </div>
                {s < 3 && <div className={`flex-1 h-1 mx-2 ${s < step ? "bg-purple-600" : "bg-gray-200"}`} />}
              </div>
            ))}
          </div>
        </div>

        <div className="p-6">
          {/* Step 1: Debt Selection */}
          {step === 1 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900">What do you want to pay off?</h3>
              
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => setDebtSelection("credit_cards")}
                  className={`p-4 rounded-lg border-2 text-left transition ${
                    debtSelection === "credit_cards"
                      ? "border-purple-600 bg-purple-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="font-semibold text-gray-900">Credit cards</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {debts.filter(d => d.accountType.toLowerCase().includes("credit")).length} cards
                  </div>
                </button>
                
                <button
                  onClick={() => setDebtSelection("exclude_heloc")}
                  className={`p-4 rounded-lg border-2 text-left transition ${
                    debtSelection === "exclude_heloc"
                      ? "border-purple-600 bg-purple-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="font-semibold text-gray-900">Everything except HELOC & mortgage</div>
                  <div className="text-sm text-gray-600 mt-1">
                    {debts.filter(d => !isHELOC(d) && !d.accountType.toLowerCase().includes("mortgage")).length} debts
                  </div>
                </button>
                
                <button
                  onClick={() => setDebtSelection("all")}
                  className={`p-4 rounded-lg border-2 text-left transition ${
                    debtSelection === "all"
                      ? "border-purple-600 bg-purple-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="font-semibold text-gray-900">Everything</div>
                  <div className="text-sm text-gray-600 mt-1">All {debts.length} debts</div>
                </button>
                
                <button
                  onClick={() => setDebtSelection("custom")}
                  className={`p-4 rounded-lg border-2 text-left transition ${
                    debtSelection === "custom"
                      ? "border-purple-600 bg-purple-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="font-semibold text-gray-900">Custom</div>
                  <div className="text-sm text-gray-600 mt-1">Pick specific debts</div>
                </button>
              </div>

              {debtSelection === "custom" && (
                <div className="space-y-2 max-h-64 overflow-y-auto border border-gray-200 rounded-lg p-3">
                  {debts.map(debt => (
                    <label key={debt.id} className="flex items-center gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded">
                      <input
                        type="checkbox"
                        checked={customDebts[debt.id] || false}
                        onChange={(e) => setCustomDebts({ ...customDebts, [debt.id]: e.target.checked })}
                        className="h-4 w-4 rounded accent-purple-600"
                      />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-900 truncate">{debt.name}</p>
                        <p className="text-xs text-gray-600 whitespace-nowrap">
                          {formatCurrency(debt.balance, currency)}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              )}

              <div className="bg-gray-50 rounded-lg p-4">
                <div className="text-sm text-gray-600">Total balance to pay off</div>
                <div className="text-2xl font-bold text-gray-900 whitespace-nowrap">{formatCurrency(totalBalance, currency)}</div>
                <div className="text-sm text-gray-600 mt-1 whitespace-nowrap">
                  Minimums: {formatCurrency(totalMinimums, currency)}/mo
                </div>
              </div>
            </div>
          )}

          {/* Step 2: Goal */}
          {step === 2 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900">What's your goal?</h3>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  onClick={() => setGoalMode("extra")}
                  className={`p-6 rounded-lg border-2 text-left transition ${
                    goalMode === "extra"
                      ? "border-purple-600 bg-purple-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-lg font-bold text-gray-900 mb-2">Pay extra each month</div>
                  <div className="text-sm text-gray-600">Add money above minimums to pay off faster</div>
                </button>
                
                <button
                  onClick={() => setGoalMode("target_date")}
                  className={`p-6 rounded-lg border-2 text-left transition ${
                    goalMode === "target_date"
                      ? "border-purple-600 bg-purple-50"
                      : "border-gray-200 hover:border-gray-300"
                  }`}
                >
                  <div className="text-lg font-bold text-gray-900 mb-2">Be debt-free by a date</div>
                  <div className="text-sm text-gray-600">Pick a target month and see what you need</div>
                </button>
              </div>

              {goalMode === "extra" && (
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      Extra monthly amount
                    </label>
                    <input
                      type="range"
                      min="0"
                      max={Math.min(10000, totalBalance / 12)}
                      step="50"
                      value={extraAmount}
                      onChange={(e) => setExtraAmount(Number(e.target.value))}
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <div className="flex justify-between items-center mt-2">
                      <input
                        type="number"
                        value={extraAmount}
                        onChange={(e) => setExtraAmount(Number(e.target.value) || 0)}
                        className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-lg font-semibold"
                      />
                      <div className="flex gap-2">
                        {[100, 250, 500, 1000].map(amt => (
                          <button
                            key={amt}
                            onClick={() => setExtraAmount(amt)}
                            className={`px-3 py-1 text-sm rounded-full whitespace-nowrap ${
                              extraAmount === amt
                                ? "bg-purple-600 text-white"
                                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
                            }`}
                          >
                            +{formatCurrency(amt, currency)}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {goalMode === "target_date" && (
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    Target debt-free date
                  </label>
                  <input
                    type="month"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                    className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg"
                  />
                </div>
              )}

              {/* Live preview */}
              {result && result.monthsToPayoff !== null && (
                <div className="bg-purple-50 border border-purple-200 rounded-lg p-4">
                  <div className="text-sm font-semibold text-purple-900 mb-2">
                    {goalMode === "extra" 
                      ? `Paying ${formatCurrency(extraAmount, currency)} extra:` 
                      : isPossible 
                        ? `To be debt-free by ${targetDate}:` 
                        : "Target not achievable"}
                  </div>
                  <div className="space-y-1">
                    {goalMode === "extra" ? (
                      <>
                        <div className="text-gray-900">
                          <span className="font-bold">Debt-free {result.debtFreeDate ? new Date(result.debtFreeDate + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"}</span>
                        </div>
                        {comparison && comparison.interestSaved > 0 && (
                          <div className="text-sm text-gray-700 whitespace-nowrap">
                            Saves {formatCurrency(comparison.interestSaved, currency)} interest
                          </div>
                        )}
                      </>
                    ) : isPossible ? (
                      <>
                        <div className="text-gray-900">
                          You need <span className="font-bold whitespace-nowrap">{formatCurrency(requiredPayment - totalMinimums, currency)}/mo extra</span>
                        </div>
                        <div className="text-sm text-gray-700 whitespace-nowrap">
                          ({formatCurrency(requiredPayment, currency)} total)
                        </div>
                      </>
                    ) : (
                      <div className="text-amber-800">
                        Earliest possible: {result.debtFreeDate ? new Date(result.debtFreeDate + "-01").toLocaleDateString("en-US", { month: "long", year: "numeric" }) : "—"}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Advanced: Strategy */}
              <div>
                <button
                  onClick={() => setShowAdvanced(!showAdvanced)}
                  className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1"
                >
                  <svg className={`w-4 h-4 transition-transform ${showAdvanced ? "rotate-90" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                  Advanced
                </button>
                
                {showAdvanced && (
                  <div className="mt-3 pl-5">
                    <label className="block text-sm font-semibold text-gray-900 mb-2">Payoff strategy</label>
                    <div className="inline-flex rounded-lg border border-gray-200 bg-gray-50 p-1">
                      <button
                        onClick={() => setStrategy("avalanche")}
                        className={`px-3 py-2 rounded-md text-sm font-medium transition whitespace-nowrap ${
                          strategy === "avalanche"
                            ? "bg-white text-purple-700 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        Highest interest first
                      </button>
                      <button
                        onClick={() => setStrategy("snowball")}
                        className={`px-3 py-2 rounded-md text-sm font-medium transition whitespace-nowrap ${
                          strategy === "snowball"
                            ? "bg-white text-purple-700 shadow-sm"
                            : "text-gray-600 hover:text-gray-900"
                        }`}
                      >
                        Smallest balance first
                      </button>
                    </div>
                    <p className="text-xs text-gray-500 mt-2">Highest interest saves the most money</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Step 3: Review & Name */}
          {step === 3 && (
            <div className="space-y-6">
              <h3 className="text-lg font-semibold text-gray-900">Review & name</h3>
              
              {result && result.monthsToPayoff !== null && comparison && (
                <div className="bg-gray-50 rounded-lg p-6 space-y-4">
                  <div>
                    <div className="text-sm text-gray-600">Extra payment</div>
                    <div className="text-3xl font-bold text-purple-900 whitespace-nowrap">
                      {formatCurrency(goalMode === "extra" ? extraAmount : Math.max(0, requiredPayment - totalMinimums), currency)}/mo
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <div className="text-gray-600">Debt-free date</div>
                      <div className="font-semibold text-gray-900 whitespace-nowrap">
                        {result.debtFreeDate ? new Date(result.debtFreeDate + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" }) : "—"}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-600">Saves vs minimums</div>
                      <div className="font-semibold text-gray-900 whitespace-nowrap">
                        {formatCurrency(comparison.interestSaved, currency)} · {comparison.monthsSaved} mo
                      </div>
                    </div>
                  </div>
                  
                  {result.payoffOrder.length > 0 && result.payoffOrder.length <= 5 && (
                    <div>
                      <div className="text-sm text-gray-600 mb-2">Payoff order</div>
                      <div className="space-y-1">
                        {result.payoffOrder.map((po, idx) => (
                          <div key={po.debtId} className="flex items-center gap-2 text-sm">
                            <span className="flex items-center justify-center w-5 h-5 rounded-full bg-purple-100 text-purple-700 text-xs font-bold shrink-0">
                              {idx + 1}
                            </span>
                            <span className="text-gray-700 truncate">{po.debtName}</span>
                            <span className="text-gray-500 text-xs whitespace-nowrap ml-auto">Month {po.payoffMonth}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              <div>
                <label className="block text-sm font-semibold text-gray-900 mb-2">Plan name</label>
                <input
                  type="text"
                  value={planName}
                  onChange={(e) => setPlanName(e.target.value)}
                  placeholder="e.g., Credit cards payoff"
                  className="w-full px-4 py-3 text-lg border border-gray-300 rounded-lg"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="sticky bottom-0 bg-white border-t border-gray-200 px-6 py-4 flex justify-between">
          <button
            onClick={step === 1 ? onClose : handleBack}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
          >
            {step === 1 ? "Cancel" : "Back"}
          </button>
          <button
            onClick={step === 3 ? handleSave : handleNext}
            disabled={
              (step === 1 && selectedDebts.length === 0) ||
              (step === 2 && goalMode === "target_date" && !targetDate) ||
              (step === 3 && saving)
            }
            className="px-6 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {step === 3 ? (saving ? "Saving..." : "Save plan") : "Next"}
          </button>
        </div>
      </div>
      
      {/* Toast */}
      <Toast />
    </div>
  );
}
