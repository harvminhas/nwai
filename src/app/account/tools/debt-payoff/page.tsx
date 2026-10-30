"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { onAuthStateChanged } from "firebase/auth";
import { getFirebaseClient } from "@/lib/firebase";
import { usePlan } from "@/contexts/PlanContext";
import UpgradePrompt from "@/components/UpgradePrompt";
import type { DebtsSummary } from "@/lib/debtsSummary";
import { calculateMinimumPayment, classifyPlanStatus, type DebtInput } from "@/lib/debtPayoff";
import { formatCurrency } from "@/lib/currencyUtils";
import type { DebtPlan } from "@/lib/debtPlanTypes";
import PlanModal from "./PlanModal";

export default function DebtPayoffPage() {
  const router = useRouter();
  const { can, loading: planLoading } = usePlan();
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [debts, setDebts] = useState<DebtInput[]>([]);
  const [plans, setPlans] = useState<DebtPlan[]>([]);
  const [currency, setCurrency] = useState("CAD");
  const [showModal, setShowModal] = useState(false);
  const [editingPlan, setEditingPlan] = useState<DebtPlan | null>(null);

  useEffect(() => {
    const { auth } = getFirebaseClient();
    return onAuthStateChanged(auth, async (user) => {
      if (!user) {
        router.push("/login");
        return;
      }
      const tok = await user.getIdToken();
      setToken(tok);
      
      await loadData(tok);
    });
  }, [router]);

  const loadData = async (tok: string) => {
    try {
      // Load debts
      const debtsRes = await fetch("/api/user/debts-summary", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (debtsRes.ok) {
        const summary: DebtsSummary = await debtsRes.json();
        setCurrency(summary.currency);
        
        const debtInputs: DebtInput[] = summary.groups.flatMap(g =>
          g.accounts.map(acc => ({
            id: acc.slug,
            name: acc.accountName || acc.bankName,
            balance: acc.balance,
            interestRate: acc.interestRate,
            monthlyPayment: acc.monthlyPayment, // Detected regular payment from Debts page
            minPayment: acc.minPayment,
            accountType: acc.accountType,
            included: true,
            paymentHistory: acc.paymentHistory,
          }))
        );
        setDebts(debtInputs);
      }

      // Load plans
      const plansRes = await fetch("/api/user/debt-plans", {
        headers: { Authorization: `Bearer ${tok}` },
      });
      if (plansRes.ok) {
        const data = await plansRes.json();
        setPlans(data.plans || []);
      }
    } catch (err) {
      console.error("Failed to load data:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleNewPlan = () => {
    setEditingPlan(null);
    setShowModal(true);
  };

  const handleEditPlan = (plan: DebtPlan) => {
    setEditingPlan(plan);
    setShowModal(true);
  };

  const handleDeletePlan = async (plan: DebtPlan) => {
    if (!confirm(`Delete "${plan.name}"?`)) return;
    
    try {
      const res = await fetch(`/api/user/debt-plans/${plan.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok && token) {
        await loadData(token);
      }
    } catch (err) {
      console.error("Delete error:", err);
      alert("Failed to delete plan. Please try again.");
    }
  };

  const handleModalClose = () => {
    setShowModal(false);
    setEditingPlan(null);
  };

  const handleModalSave = async () => {
    setShowModal(false);
    setEditingPlan(null);
    if (token) await loadData(token);
  };

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

  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 pb-8 sm:py-8 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Debt Payoff Plans</h1>
          <p className="mt-1 text-sm text-gray-500">
            Create and track multiple payoff strategies
          </p>
        </div>
        <button
          onClick={handleNewPlan}
          className="px-4 py-2 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
        >
          + New plan
        </button>
      </div>

      {/* Plans List */}
      {plans.length === 0 ? (
        <div className="bg-white rounded-lg border border-gray-200 p-12 text-center">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-purple-100 mb-4">
            <svg className="w-8 h-8 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 7h6m0 10v-3m-3 3h.01M9 17h.01M9 14h.01M12 14h.01M15 11h.01M12 11h.01M9 11h.01M7 21h10a2 2 0 002-2V5a2 2 0 00-2-2H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-gray-900 mb-2">No plans yet</h3>
          <p className="text-sm text-gray-500 mb-6">
            Create your first debt payoff plan to see when you'll be debt-free
          </p>
          <button
            onClick={handleNewPlan}
            className="px-6 py-3 text-sm font-medium text-white bg-purple-600 rounded-lg hover:bg-purple-700"
          >
            Create your first plan
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {plans.map(plan => (
            <PlanCard
              key={plan.id}
              plan={plan}
              debts={debts}
              currency={currency}
              onEdit={() => handleEditPlan(plan)}
              onDelete={() => handleDeletePlan(plan)}
            />
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && token && (
        <PlanModal
          debts={debts}
          currency={currency}
          token={token}
          existingPlan={editingPlan}
          onClose={handleModalClose}
          onSave={handleModalSave}
        />
      )}
    </div>
  );
}

interface PlanCardProps {
  plan: DebtPlan;
  debts: DebtInput[];
  currency: string;
  onEdit: () => void;
  onDelete: () => void;
}

function PlanCard({ plan, debts, currency, onEdit, onDelete }: PlanCardProps) {
  // Get current balances for included debts
  const includedDebts = debts.filter(d => plan.debtSlugs.includes(d.id));
  const currentTotalBalance = includedDebts.reduce((sum, d) => sum + d.balance, 0);
  const totalMinimums = includedDebts.reduce((sum, d) => sum + calculateMinimumPayment(d), 0);
  
  // Get projected balance for current month
  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const projectedEntry = plan.baseline.monthlyProjection.find(p => p.month === currentMonth);
  const projectedBalance = projectedEntry?.totalBalance ?? currentTotalBalance;
  
  // Calculate progress
  const baselineTotal = Object.values(plan.baseline.balances).reduce((sum, b) => sum + b, 0);
  const paidSoFar = Math.max(0, baselineTotal - currentTotalBalance);
  const progressPercent = baselineTotal > 0 ? (paidSoFar / baselineTotal) * 100 : 0;
  
  // Classify status
  const workingDebts: DebtInput[] = debts.map(d => ({
    ...d,
    included: plan.debtSlugs.includes(d.id),
  }));
  
  const status = classifyPlanStatus(
    currentTotalBalance,
    projectedBalance,
    plan.monthlyBudget,
    plan.strategy,
    workingDebts
  );
  
  // Get extra monthly amount (stored for both modes, or compute for old plans)
  const extraMonthly = plan.extraMonthly ?? Math.max(0, plan.monthlyBudget - totalMinimums);
  
  // Target date or debt-free date
  let targetDisplay = "";
  if (plan.mode === "targetDate" && plan.targetDate) {
    const [year, month] = plan.targetDate.split("-");
    targetDisplay = new Date(Number(year), Number(month) - 1).toLocaleDateString("en-US", { month: "short", year: "numeric" });
  } else {
    // Estimate from baseline projection
    const lastEntry = plan.baseline.monthlyProjection[plan.baseline.monthlyProjection.length - 1];
    if (lastEntry && lastEntry.totalBalance < 10) {
      targetDisplay = new Date(lastEntry.month + "-01").toLocaleDateString("en-US", { month: "short", year: "numeric" });
    }
  }
  
  // Get savings (stored or default to 0 for old plans)
  const interestSaved = plan.interestSaved ?? 0;
  const monthsSaved = plan.monthsSaved ?? 0;

  // Debt names for small text
  const debtNames = includedDebts.map(d => d.name).join(", ");

  return (
    <div className="bg-white rounded-lg border border-gray-200 hover:border-purple-300 transition-colors cursor-pointer" onClick={onEdit}>
      <div className="p-5 space-y-3">
        {/* Delete button */}
        <div className="flex items-start justify-between">
          <div className="flex-1" />
          <button
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            className="text-gray-400 hover:text-red-600 text-xl leading-none shrink-0"
            title="Delete plan"
          >
            ×
          </button>
        </div>

        {/* Extra payment headline */}
        <div>
          <div className="text-4xl font-bold text-purple-900 whitespace-nowrap">
            {formatCurrency(extraMonthly, currency)}/mo
          </div>
          <div className="text-sm text-gray-600 mt-0.5">extra payment</div>
        </div>

        {/* Debt-free date */}
        {targetDisplay && (
          <div className="text-lg font-semibold text-gray-900">
            Debt-free {targetDisplay}
          </div>
        )}

        {/* Savings */}
        {(interestSaved > 0 || monthsSaved > 0) && (
          <div className="text-sm text-gray-700 whitespace-nowrap">
            Saves {formatCurrency(interestSaved, currency)} interest · {monthsSaved} months sooner
          </div>
        )}

        {/* Status Pill */}
        <div>
          {status.status === "on-track" && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-800 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-green-600"></span>
              On track
            </div>
          )}
          {status.status === "ahead" && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-blue-100 text-blue-800 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-600"></span>
              Ahead by {formatCurrency(status.deltaAmount, currency)}
            </div>
          )}
          {status.status === "behind" && (
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-800 text-xs font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-600"></span>
              Behind by {formatCurrency(status.deltaAmount, currency)}
            </div>
          )}
        </div>

        {/* Progress Bar */}
        <div>
          <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-purple-600 transition-all"
              style={{ width: `${Math.min(progressPercent, 100)}%` }}
            ></div>
          </div>
          <div className="flex justify-between items-center mt-1">
            <p className="text-xs text-gray-500">{Math.round(progressPercent)}% paid</p>
          </div>
        </div>

        {/* Debt names */}
        <div className="text-xs text-gray-400 truncate" title={debtNames}>
          {plan.name}
        </div>
      </div>
    </div>
  );
}
