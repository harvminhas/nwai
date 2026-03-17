"use client";

import { usePlan } from "@/contexts/PlanContext";
import { PLANS, minPlanFor, type PlanFeatures } from "@/lib/plans";

interface UpgradePromptProps {
  feature: keyof PlanFeatures;
  /** Short description shown in the prompt. */
  description?: string;
}

export default function UpgradePrompt({ feature, description }: UpgradePromptProps) {
  const { setTestPlan } = usePlan();
  const required = minPlanFor(feature);

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      {/* Lock icon */}
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-purple-100">
        <svg className="h-7 w-7 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>

      <h2 className="text-xl font-bold text-gray-900">
        {required.name} feature
      </h2>
      <p className="mt-2 text-sm text-gray-500">
        {description ?? `This feature is available on the ${required.name} plan and above.`}
      </p>

      {/* Plan cards */}
      <div className="mt-8 space-y-3 text-left">
        {(["pro", "family"] as const).map((id) => {
          const plan = PLANS[id];
          const isRequired = id === required.id;
          return (
            <div key={id}
              className={`rounded-xl border p-4 ${isRequired ? "border-purple-300 bg-purple-50" : "border-gray-200 bg-white"}`}>
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-semibold text-gray-900">{plan.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{plan.price}</p>
                </div>
                {isRequired && (
                  <span className="rounded-full bg-purple-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
                    Required
                  </span>
                )}
              </div>
              <ul className="mt-3 space-y-1.5">
                {plan.features.forecast      && <FeatureRow label="Forecast & projections" />}
                {plan.features.goals         && <FeatureRow label="Goals tracking" />}
                {plan.features.payoffPlanner && <FeatureRow label="Debt payoff planner" />}
                {plan.features.multiUpload   && <FeatureRow label="Upload multiple statements at once" />}
                {plan.features.export        && <FeatureRow label="CSV / PDF export" />}
                {plan.features.multiUser     && <FeatureRow label="Multi-user (family accounts)" />}
                <FeatureRow label="Unlimited uploads & history" />
              </ul>
            </div>
          );
        })}
      </div>

      {/* Test mode switcher */}
      <div className="mt-8 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
        <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
          🧪 Test mode — simulate upgrade
        </p>
        <div className="flex gap-2 justify-center">
          {(["pro", "family"] as const).map((id) => (
            <button key={id}
              onClick={() => setTestPlan(id)}
              className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700 transition"
            >
              Switch to {id.charAt(0).toUpperCase() + id.slice(1)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function FeatureRow({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs text-gray-600">
      <svg className="h-3.5 w-3.5 shrink-0 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      {label}
    </li>
  );
}
