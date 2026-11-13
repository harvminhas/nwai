"use client";

import { useState } from "react";
import Link from "next/link";
import { IntactAmount } from "@/components/IntactAmount";
import { NET_WORTH_LABEL_CLASS } from "@/components/netWorthReadLayout";
import { netWorthAccountRow } from "@/lib/accountDetailHref";
import { formatCurrencyWithCents } from "@/lib/currencyUtils";
import {
  describeCashChange,
  describeDebtChange,
  describeInvestmentChange,
  describeInvestmentPutIn,
  type GrowthBucket,
  type GrowthSection,
  type PeriodGrowth,
} from "@/lib/netWorthGrowth";

export type GrowthScope = "month" | "range";

function amountClass(n: number): string {
  if (n > 0.005) return "text-green-600";
  if (n < -0.005) return "text-red-600";
  return "text-gray-900";
}

function signed(n: number, currency: string): string {
  const prefix = n > 0.005 ? "+" : n < -0.005 ? "−" : "";
  return `${prefix}${formatCurrencyWithCents(Math.abs(n), currency)}`;
}

function sideFor(bucket: GrowthBucket): "asset" | "debt" {
  return bucket === "debts" ? "debt" : "asset";
}

function SectionCard({
  title,
  sentence,
  secondary,
  section,
  currency,
  bucket,
  changeClass,
}: {
  title: string;
  sentence: string;
  secondary?: string | null;
  section: GrowthSection;
  currency: string;
  bucket: GrowthBucket;
  changeClass: string;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-2">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <p className={`${NET_WORTH_LABEL_CLASS} text-gray-500`}>
          {formatCurrencyWithCents(section.start, currency)}
          <span className="px-1.5 text-gray-400">→</span>
          {formatCurrencyWithCents(section.end, currency)}
        </p>
        <IntactAmount className={`text-sm font-semibold ${changeClass}`}>
          {signed(section.change, currency)}
          {section.changePercent != null && Math.round(Math.abs(section.changePercent) * 100) > 0 && (
            <span className="font-medium">
              {" "}
              ({section.changePercent >= 0 ? "+" : "−"}
              {Math.round(Math.abs(section.changePercent) * 100)}%)
            </span>
          )}
        </IntactAmount>
      </div>
      <p className="text-sm text-gray-800 break-words">{sentence}</p>
      {secondary && <p className="text-xs text-gray-500 break-words">{secondary}</p>}
      {section.accounts.length > 0 && (
        <div className="pt-1">
          <button
            type="button"
            onClick={() => setExpanded((open) => !open)}
            className="text-xs font-medium text-gray-500 py-1"
          >
            {section.accounts.length === 1
              ? "1 account"
              : `${section.accounts.length} accounts`}
          </button>
          {expanded && (
            <ul className="mt-1 space-y-1">
              {section.accounts.map((acc) => {
                const row = netWorthAccountRow({
                  slug: acc.slug,
                  label: acc.label,
                  type: acc.type,
                  side: sideFor(bucket),
                });
                const body = (
                  <div className="flex items-start justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
                    <div className="min-w-0">
                      <p className={NET_WORTH_LABEL_CLASS}>
                        {row.label}
                        {acc.credit && (
                          <span className="ml-2 text-xs font-normal text-gray-400">credit</span>
                        )}
                      </p>
                      <p className="text-xs text-gray-400 break-words">
                        {formatCurrencyWithCents(acc.start, currency)}
                        <span className="px-1">→</span>
                        {formatCurrencyWithCents(acc.end, currency)}
                      </p>
                    </div>
                    <IntactAmount className={`shrink-0 text-sm font-semibold ${amountClass(acc.change)}`}>
                      {signed(acc.change, currency)}
                    </IntactAmount>
                  </div>
                );
                return (
                  <li key={acc.slug}>
                    {row.href ? (
                      <Link href={row.href} className="block hover:bg-gray-50 -mx-2 px-2 rounded">
                        {body}
                      </Link>
                    ) : (
                      body
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

export default function GrowthTab({
  breakdown,
  currency,
  scope,
  onScopeChange,
  monthLabel,
  rangeLabel,
}: {
  breakdown: PeriodGrowth | null;
  currency: string;
  scope: GrowthScope;
  onScopeChange: (scope: GrowthScope) => void;
  monthLabel: string;
  rangeLabel: string;
}) {
  const debtChangeClass =
    breakdown && breakdown.debts.change < -0.005
      ? "text-green-600"
      : breakdown && breakdown.debts.change > 0.005
        ? "text-red-600"
        : "text-gray-900";

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => onScopeChange("month")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            scope === "month"
              ? "bg-purple-100 text-purple-700"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          This month
        </button>
        <button
          type="button"
          onClick={() => onScopeChange("range")}
          className={`rounded-full px-3 py-1 text-xs font-medium transition ${
            scope === "range"
              ? "bg-purple-100 text-purple-700"
              : "text-gray-400 hover:text-gray-600"
          }`}
        >
          Chart range
        </button>
        <span className="min-w-0 break-words text-xs text-gray-400 px-1">
          {scope === "range" ? rangeLabel : monthLabel}
        </span>
      </div>

      {!breakdown || !breakdown.hasPrevious ? (
        <p className="text-sm text-gray-500 text-center py-4">
          Need another month of statements to show how things changed.
        </p>
      ) : (
        <div className="space-y-4">
          <SectionCard
            title="Savings & cash"
            sentence={describeCashChange(breakdown.cash, currency)}
            section={breakdown.cash}
            currency={currency}
            bucket="cash"
            changeClass={amountClass(breakdown.cash.change)}
          />
          <SectionCard
            title="Investments"
            sentence={describeInvestmentChange(breakdown.investments, currency)}
            secondary={describeInvestmentPutIn(breakdown.investments, currency)}
            section={breakdown.investments}
            currency={currency}
            bucket="investments"
            changeClass={amountClass(breakdown.investments.change)}
          />
          <SectionCard
            title="Debts"
            sentence={describeDebtChange(breakdown.debts, currency)}
            section={breakdown.debts}
            currency={currency}
            bucket="debts"
            changeClass={debtChangeClass}
          />
          {breakdown.newAccounts.length > 0 && (
            <p className="text-xs text-gray-400 break-words">
              New accounts added this period (not counted as growth):{" "}
              {breakdown.newAccounts
                .map((a) =>
                  netWorthAccountRow({
                    slug: a.slug,
                    label: a.label,
                    type: a.type,
                    side: sideFor(a.bucket),
                  }).label,
                )
                .join(", ")}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
