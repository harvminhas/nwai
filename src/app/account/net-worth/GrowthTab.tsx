"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { IntactAmount } from "@/components/IntactAmount";
import { NET_WORTH_LABEL_CLASS } from "@/components/netWorthReadLayout";
import { netWorthAccountRow } from "@/lib/accountDetailHref";
import { formatCurrencyWithCents } from "@/lib/currencyUtils";
import { isDebtAccountType, type MonthGrowthBreakdown } from "@/lib/netWorthGrowth";

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
  const revolving = breakdown?.debtAccounts.filter((a) => a.kind === "revolving" && !a.isBaseline) ?? [];

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

          {breakdown.interestFeesNotInSpending > 0.005 && breakdown.netSavings != null ? (
            <Section
              title="Interest not in spending"
              amount={-breakdown.interestFeesNotInSpending}
              currency={currency}
              note="Card/loan interest categorized as Interest (excluded from spending). Fees and installment interest already in spending are not subtracted again."
            />
          ) : breakdown.interestAndFeesMissingNote ? (
            <p className="text-xs text-gray-500 break-words">
              Interest isn't itemized on these debt statements. Fees already in spending are left there.
            </p>
          ) : null}

          {Math.abs(breakdown.installmentPrincipalAddBack) >= 0.005 && (
            <Section
              title="Installment principal"
              amount={breakdown.installmentPrincipalAddBack}
              currency={currency}
              note="Principal portion of mortgage/loan payments already counted as spending — added back so only interest reduces net worth."
            >
              {breakdown.installmentAccounts.map((acc) => {
                const row = netWorthAccountRow({
                  slug: acc.slug,
                  label: acc.label,
                  type: acc.type,
                  side: "debt",
                });
                return (
                  <Row
                    key={acc.slug}
                    label={row.label}
                    amount={acc.principalChange}
                    currency={currency}
                    href={row.href}
                  />
                );
              })}
            </Section>
          )}

          {breakdown.spendingInvestmentAddBack > 0.005 && (
            <Section
              title="Investment contributions in spending"
              amount={breakdown.spendingInvestmentAddBack}
              currency={currency}
              note="Investments & Savings already counted as spending — added back because those dollars increased investment accounts."
            />
          )}

          <Section
            title="Investment market growth"
            amount={breakdown.investmentMarketGrowth}
            currency={currency}
          >
            {breakdown.investmentAccounts.filter((a) => a.split === "split" && !a.isBaseline).map((acc) => {
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
                  amount={acc.marketGrowth ?? 0}
                  currency={currency}
                  href={row.href}
                  sub="Market growth (contributions are under Where your savings went)"
                />
              );
            })}
            {breakdown.investmentAccounts.filter((a) => a.split === "split" && !a.isBaseline).length === 0 && (
              <p className="text-xs text-gray-400">No split investment accounts this period</p>
            )}
          </Section>

          {Math.abs(breakdown.investmentUnsplit) >= 0.005 && (
            <Section
              title="Investment change (unsplit)"
              amount={breakdown.investmentUnsplit}
              currency={currency}
              note="No deposit/withdrawal transactions on these statements — the full balance change is shown here instead of Other/unexplained."
            >
              {breakdown.investmentAccounts.filter((a) => a.split === "unsplit" && !a.isBaseline).map((acc) => {
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
                    amount={acc.delta}
                    currency={currency}
                    href={row.href}
                  />
                );
              })}
            </Section>
          )}

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

          {breakdown.newAccounts.length > 0 && (
            <Section
              title="New accounts (first statement)"
              amount={breakdown.newAccountsTotal}
              currency={currency}
              note="Same baselines as What Changed — opening balances, not growth."
            >
              {breakdown.newAccounts.map((acc) => {
                const side = isDebtAccountType(acc.type) ? "debt" : "asset";
                const row = netWorthAccountRow({
                  slug: acc.slug,
                  label: acc.label,
                  type: acc.type,
                  side,
                  isBaseline: true,
                });
                return (
                  <Row
                    key={acc.slug}
                    label={row.label}
                    amount={acc.amount}
                    currency={currency}
                    href={row.href}
                  />
                );
              })}
            </Section>
          )}

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

          <div className="pt-4 mt-2 border-t border-gray-200">
            <p className="text-xs font-medium uppercase tracking-wide text-gray-500 mb-2">
              Where your savings went
            </p>
            <p className="text-xs text-gray-500 break-words mb-2">
              Card/LOC payments and investment contributions are uses of savings, not extra net-worth change.
            </p>
            <Section title="Cash kept" amount={breakdown.cashKept} currency={currency} />
            <Section title="Debt paid down (cards / LOC)" amount={breakdown.revolvingPaydown} currency={currency}>
              {revolving.filter((a) => Math.abs(a.paydown) >= 0.005 || a.usedActivity).map((acc) => {
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
            </Section>
            <Section title="Invested" amount={breakdown.investedFromSavings} currency={currency}>
              {breakdown.investmentAccounts
                .filter((a) => a.split === "split" && !a.isBaseline)
                .map((acc) => {
                  const row = netWorthAccountRow({
                    slug: acc.slug,
                    label: acc.label,
                    type: acc.type,
                    side: "asset",
                  });
                  const net = (acc.contributions ?? 0) - (acc.withdrawals ?? 0);
                  return (
                    <Row
                      key={acc.slug}
                      label={row.label}
                      amount={net}
                      currency={currency}
                      href={row.href}
                      sub={
                        (acc.withdrawals ?? 0) > 0
                          ? `Deposits ${formatCurrencyWithCents(acc.contributions ?? 0, currency)} − Withdrawals ${formatCurrencyWithCents(acc.withdrawals ?? 0, currency)}`
                          : undefined
                      }
                    />
                  );
                })}
            </Section>
          </div>
        </div>
      )}
    </div>
  );
}
