"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { IntactAmount } from "@/components/IntactAmount";
import { NET_WORTH_LABEL_CLASS } from "@/components/netWorthReadLayout";
import { netWorthAccountRow } from "@/lib/accountDetailHref";
import { formatCurrencyWithCents } from "@/lib/currencyUtils";
import type { MonthGrowthBreakdown } from "@/lib/netWorthGrowth";

export type GrowthScope = "month" | "range";

function amountClass(n: number): string {
  if (n > 0.005) return "text-green-600";
  if (n < -0.005) return "text-red-600";
  return "text-gray-900";
}

function signed(n: number, currency: string): string {
  const prefix = n > 0.005 ? "+" : "";
  return `${prefix}${formatCurrencyWithCents(n, currency)}`;
}

function Row({
  label,
  amount,
  currency,
  href,
  muted,
  sub,
}: {
  label: string;
  amount: number;
  currency: string;
  href?: string | null;
  muted?: boolean;
  sub?: string;
}) {
  const content = (
    <div className="flex items-center justify-between gap-3 py-2 border-b border-gray-100 last:border-0">
      <div className="min-w-0">
        <span className={`${NET_WORTH_LABEL_CLASS} ${muted ? "text-gray-500" : ""}`}>
          {label}
        </span>
        {sub && <p className="mt-0.5 text-xs text-gray-500 break-words">{sub}</p>}
      </div>
      <IntactAmount className={`text-sm font-semibold ${muted ? "text-gray-500" : amountClass(amount)}`}>
        {signed(amount, currency)}
      </IntactAmount>
    </div>
  );
  if (href) {
    return (
      <Link href={href} className="block hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">
        {content}
      </Link>
    );
  }
  return content;
}

function Section({
  title,
  amount,
  currency,
  children,
  note,
}: {
  title: string;
  amount: number;
  currency: string;
  children?: ReactNode;
  note?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-3 py-2">
        <span className="min-w-0 text-sm font-medium text-gray-800 break-words">{title}</span>
        <IntactAmount className={`text-sm font-bold ${amountClass(amount)}`}>
          {signed(amount, currency)}
        </IntactAmount>
      </div>
      {note && <p className="text-xs text-gray-500 break-words pb-1">{note}</p>}
      {children}
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
  breakdown: MonthGrowthBreakdown | null;
  currency: string;
  scope: GrowthScope;
  onScopeChange: (scope: GrowthScope) => void;
  monthLabel: string;
  rangeLabel: string;
}) {
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

      {!breakdown ? (
        <p className="text-sm text-gray-500 text-center py-4">
          No growth breakdown for this period yet.
        </p>
      ) : (
        <div className="space-y-5">
          <Section
            title="Gross savings"
            amount={breakdown.grossSavings}
            currency={currency}
            note={`${formatCurrencyWithCents(breakdown.income, currency)} income − ${formatCurrencyWithCents(breakdown.spending, currency)} spending${
              breakdown.savingsRate != null
                ? ` · ${(breakdown.savingsRate * 100).toFixed(0)}% savings rate`
                : " · savings rate n/a (no income)"
            }`}
          />

          {breakdown.interestAndFeesIdentifiable && breakdown.netSavings != null ? (
            <Section
              title="Net savings"
              amount={breakdown.netSavings}
              currency={currency}
              note={`Gross savings − ${formatCurrencyWithCents(breakdown.interestAndFees, currency)} interest & fees`}
            />
          ) : breakdown.interestAndFeesMissingNote || breakdown.debtAccounts.length > 0 ? (
            <p className="text-xs text-gray-500 break-words">
              {breakdown.interestAndFeesMissingNote
                ? "Interest and fees aren't itemized on these debt statements, so only gross savings is shown."
                : "No itemized debt interest or fees this period — showing gross savings."}
            </p>
          ) : null}

          <Section title="Debt paydown" amount={breakdown.debtPaydown} currency={currency}>
            {breakdown.debtAccounts.filter((a) => Math.abs(a.paydown) >= 0.005 || a.usedActivity).map((acc) => {
              const row = netWorthAccountRow({
                slug: acc.slug,
                label: acc.label,
                type: acc.type,
                side: "debt",
              });
              const sub = acc.usedActivity
                ? `Paid ${formatCurrencyWithCents(acc.paid, currency)} − New charges ${formatCurrencyWithCents(acc.newCharges, currency)}`
                : "From balance change";
              return (
                <Row
                  key={acc.slug}
                  label={row.label}
                  amount={acc.paydown}
                  currency={currency}
                  href={row.href}
                  sub={sub}
                />
              );
            })}
            {breakdown.debtAccounts.length === 0 && (
              <p className="text-xs text-gray-400">No debt accounts this period</p>
            )}
          </Section>

          <Section title="Investment growth" amount={breakdown.investmentDelta} currency={currency}>
            {breakdown.investmentAccounts.map((acc) => {
              const row = netWorthAccountRow({
                slug: acc.slug,
                label: acc.label,
                type: acc.type,
                side: "asset",
              });
              if (acc.split === "unsplit") {
                return (
                  <Row
                    key={acc.slug}
                    label={row.label}
                    amount={acc.delta}
                    currency={currency}
                    href={row.href}
                    sub="Unsplit — contributions aren't identifiable for this account"
                  />
                );
              }
              return (
                <div key={acc.slug} className="pl-0 sm:pl-1">
                  <Row
                    label={row.label}
                    amount={acc.delta}
                    currency={currency}
                    href={row.href}
                  />
                  <div className="pl-3">
                    <Row
                      label="Contributions"
                      amount={(acc.contributions ?? 0) - (acc.withdrawals ?? 0)}
                      currency={currency}
                      muted
                      sub={
                        (acc.withdrawals ?? 0) > 0
                          ? `Deposits ${formatCurrencyWithCents(acc.contributions ?? 0, currency)} − Withdrawals ${formatCurrencyWithCents(acc.withdrawals ?? 0, currency)}`
                          : undefined
                      }
                    />
                    <Row
                      label="Market growth"
                      amount={acc.marketGrowth ?? 0}
                      currency={currency}
                      muted
                    />
                  </div>
                </div>
              );
            })}
            {breakdown.investmentAccounts.length === 0 && (
              <p className="text-xs text-gray-400">No investment accounts this period</p>
            )}
          </Section>

          <Section title="Other assets" amount={breakdown.otherAssetChanges} currency={currency}>
            {breakdown.otherAssets.map((acc) => {
              const row = netWorthAccountRow({
                slug: acc.slug,
                label: acc.label,
                type: acc.type,
                side: "asset",
              });
              return (
                <Row
                  key={acc.slug}
                  label={row.label}
                  amount={acc.amount}
                  currency={currency}
                  href={row.href}
                  sub="Valuation change"
                />
              );
            })}
            {breakdown.otherAssets.length === 0 && (
              <p className="text-xs text-gray-400">No manual asset valuation changes</p>
            )}
          </Section>

          {breakdown.netWorthChange != null && breakdown.unexplained != null && (
            <>
              <Section
                title="Other / unexplained"
                amount={breakdown.unexplained}
                currency={currency}
                note="Remainder so this list matches the What Changed total. Never omitted."
              />

              <div className="pt-2 border-t-2 border-gray-300">
                <div className="flex items-center justify-between gap-3">
                  <span className="min-w-0 text-sm font-bold text-gray-900 break-words">
                    Total (matches What Changed)
                  </span>
                  <IntactAmount className={`text-lg font-bold ${amountClass(breakdown.netWorthChange)}`}>
                    {signed(breakdown.netWorthChange, currency)}
                  </IntactAmount>
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
