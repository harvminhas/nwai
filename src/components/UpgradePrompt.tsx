"use client";

import Link from "next/link";
import { usePlan } from "@/contexts/PlanContext";
import { PLANS, type PlanFeatures } from "@/lib/plans";

interface UpgradePromptProps {
  feature: keyof PlanFeatures;
  description?: string;
}

export default function UpgradePrompt({ feature, description }: UpgradePromptProps) {
  const { setTestPlan } = usePlan();
  const isDev = process.env.NODE_ENV === "development";
  const pro   = PLANS.pro;

  return (
    <div className="mx-auto max-w-md px-4 py-24 text-center">
      {/* Lock icon */}
      <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-purple-100">
        <svg className="h-7 w-7 text-purple-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
          <path strokeLinecap="round" strokeLinejoin="round"
            d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
        </svg>
      </div>

      <h2 className="text-xl font-bold text-gray-900">Pro feature</h2>
      <p className="mt-2 text-sm text-gray-500">
        {description ?? `This feature requires a Pro subscription.`}
      </p>

      {/* Pro plan card */}
      <div className="mt-8 rounded-2xl border border-purple-200 bg-purple-50 p-5 text-left">
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-bold text-gray-900">{pro.name}</p>
            <p className="text-xs text-gray-500 mt-0.5">{pro.price}</p>
          </div>
          <span className="rounded-full bg-purple-600 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white">
            Required
          </span>
        </div>
        <ul className="space-y-2">
          {pro.features.forecast      && <FeatureRow label="Forecast & projections" />}
          {pro.features.goals         && <FeatureRow label="Goals tracking" />}
          {pro.features.payoffPlanner && <FeatureRow label="Debt payoff planner" />}
          {pro.features.multiUpload   && <FeatureRow label="Unlimited uploads" />}
          {pro.features.export        && <FeatureRow label="CSV / PDF export" />}
          {pro.features.aiInsights    && <FeatureRow label="AI insights & chat" />}
          {pro.features.whatIf        && <FeatureRow label="What-if scenarios" />}
        </ul>
      </div>

      <Link
        href="/account/billing"
        className="mt-5 flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-purple-600 to-purple-700 py-3 text-sm font-bold text-white hover:from-purple-700 hover:to-purple-800 transition shadow-sm"
      >
        Upgrade to Pro →
      </Link>
      <p className="mt-3 text-xs text-gray-400">Cancel anytime · Secure payments via Stripe</p>

      {/* Dev-only test mode switcher */}
      {isDev && (
        <div className="mt-8 rounded-xl border border-dashed border-gray-200 bg-gray-50 p-4">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-gray-400 mb-2">
            Dev only — simulate upgrade
          </p>
          <button
            onClick={() => setTestPlan("pro")}
            className="rounded-lg bg-purple-600 px-4 py-2 text-xs font-semibold text-white hover:bg-purple-700 transition"
          >
            Switch to Pro
          </button>
        </div>
      )}
    </div>
  );
}

function FeatureRow({ label }: { label: string }) {
  return (
    <li className="flex items-center gap-2 text-xs text-gray-600">
      <svg className="h-3.5 w-3.5 shrink-0 text-purple-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      {label}
    </li>
  );
}
