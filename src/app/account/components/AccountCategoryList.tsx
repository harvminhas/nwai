"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CategoryListRow } from "@/app/account/spending/CategoryListRow";
import { formatCurrency } from "@/lib/currencyUtils";

const DOT: Record<string, string> = {
  cash: "bg-blue-500",
  investments: "bg-violet-500",
  registered: "bg-teal-600",
  property: "bg-amber-500",
  other: "bg-gray-400",
  mortgage: "bg-rose-500",
  credit_card: "bg-orange-500",
  loc: "bg-amber-500",
};

interface AccountCategorySectionProps {
  groupType: string;
  label: string;
  count: number;
  total: number;
  currency: string;
  isOpen: boolean;
  onToggle: () => void;
  children: ReactNode;
}

export function AccountCategorySection({
  groupType,
  label,
  count,
  total,
  currency,
  isOpen,
  onToggle,
  children,
}: AccountCategorySectionProps) {
  const accountsWord = count === 1 ? "account" : "accounts";
  return (
    <div className="border-b border-gray-200/80 last:border-0">
      <CategoryListRow
        isOpen={isOpen}
        onToggle={onToggle}
        className="px-1"
        rowContent={
          <div
            className="flex flex-1 items-center gap-3 py-2.5 pl-4 pr-1"
            aria-label={`${label}, ${count} ${accountsWord}, ${formatCurrency(total, currency)}`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[groupType] ?? "bg-gray-400"}`}
              aria-hidden
            />
            <p className="min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight text-gray-900">
              {label}
            </p>
            <p className="shrink-0 text-[13px] font-semibold tabular-nums text-gray-900">
              {formatCurrency(total, currency)}
            </p>
          </div>
        }
      >
        <div className="pb-1">{children}</div>
      </CategoryListRow>
    </div>
  );
}

interface AccountCategoryItemProps {
  href?: string;
  primary: string;
  meta: string;
  fullName: string;
  amount: number;
  currency: string;
}

export function AccountCategoryItem({
  href,
  primary,
  meta,
  fullName,
  amount,
  currency,
}: AccountCategoryItemProps) {
  const amountText = formatCurrency(amount, currency);
  const aria = meta ? `${fullName}, ${meta}, ${amountText}` : `${fullName}, ${amountText}`;

  const body = (
    <>
      <span className="min-w-0 flex-1 pr-3">
        <span className="block truncate text-[13px] leading-5 text-gray-800">
          {primary}
        </span>
        {meta ? (
          <span className="mt-0.5 block truncate text-[11px] leading-4 text-gray-400">
            {meta}
          </span>
        ) : null}
      </span>
      <span className="w-[7.25rem] shrink-0 text-right text-[13px] leading-5 tabular-nums text-gray-900">
        {amountText}
      </span>
    </>
  );

  const className =
    "flex items-start gap-3 py-2 pl-9 pr-5 text-gray-800 transition-colors hover:bg-gray-50 focus-visible:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400";

  if (href) {
    return (
      <Link href={href} aria-label={aria} title={fullName} className={className}>
        {body}
      </Link>
    );
  }

  return (
    <div aria-label={aria} title={fullName} className={className}>
      {body}
    </div>
  );
}

export function AccountCategoryList({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
      {children}
    </div>
  );
}
