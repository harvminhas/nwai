"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { CategoryListRow } from "@/app/account/spending/CategoryListRow";
import { formatCurrency } from "@/lib/currencyUtils";
import {
  ACCOUNT_CATEGORY_AMOUNT,
  ACCOUNT_CATEGORY_ITEM,
  ACCOUNT_CATEGORY_META,
  ACCOUNT_CATEGORY_PRIMARY,
} from "@/lib/accountSectionLayout";

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
            className="flex min-h-11 flex-1 items-center gap-3 py-3 pl-3 pr-1 lg:min-h-0 lg:py-2.5 lg:pl-4"
            aria-label={`${label}, ${count} ${accountsWord}, ${formatCurrency(total, currency)}`}
          >
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOT[groupType] ?? "bg-gray-400"}`}
              aria-hidden
            />
            <p className="min-w-0 flex-1 break-words text-[13px] font-semibold tracking-tight text-gray-900 lg:truncate">
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
        <span className={ACCOUNT_CATEGORY_PRIMARY}>
          {primary}
        </span>
        {meta ? (
          <span className={ACCOUNT_CATEGORY_META}>
            {meta}
          </span>
        ) : null}
      </span>
      <span className={ACCOUNT_CATEGORY_AMOUNT}>
        {amountText}
      </span>
    </>
  );

  const className = ACCOUNT_CATEGORY_ITEM;

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
