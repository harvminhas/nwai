"use client";

import { useState } from "react";
import Link from "next/link";
import type { DebtsSummary, DebtAccount } from "@/lib/debtsSummary";
import type { ManualLiability } from "@/lib/types";
import { formatCurrency } from "@/lib/currencyUtils";
import { formatAccountLast4 } from "@/lib/rangeUtils";
import { CategoryListRow } from "@/app/account/spending/CategoryListRow";
import { formatLastTransactionDate } from "@/lib/formatLastTransactionDate";
import { isCategoryGroupOpen, toggleCategoryGroup } from "@/lib/categoryGroupExpand";

const GROUP_COLOR: Record<string, string> = {
  mortgage: "bg-red-500",
  credit_card: "bg-orange-500",
  loc: "bg-amber-500",
  other: "bg-gray-400",
};

interface CategoriesTabProps {
  summary: DebtsSummary;
}

/** Top level of the Liabilities drill-down: categories -> category page -> account page. */
export function CategoriesTab({ summary }: CategoriesTabProps) {
  const { groups, currency, totalDebt } = summary;
  const [userGroupOpen, setUserGroupOpen] = useState<Record<string, boolean>>({});

  if (groups.length === 0) {
    return (
      <div className="rounded-xl border border-gray-200 bg-gray-50 p-8 text-center">
        <p className="font-medium text-gray-900">No debts found</p>
        <p className="mt-1 text-sm text-gray-500">Upload a statement and your loans and cards appear here.</p>
        <Link
          href="/upload"
          className="mt-4 inline-block rounded-lg bg-purple-600 px-4 py-2 text-sm font-semibold text-white hover:bg-purple-700 transition"
        >
          Upload a statement
        </Link>
      </div>
    );
  }

  const ordered = [...groups].sort((a, b) => Math.abs(b.totalBalance) - Math.abs(a.totalBalance));

  return (
    <div className="overflow-hidden rounded-xl border border-gray-200 bg-white shadow-sm">
      {ordered.map((group) => {
        const isOpen = isCategoryGroupOpen(userGroupOpen, group.type);
        const count = group.accounts.length + group.manualLiabilities.length;
        const abs = Math.abs(group.totalBalance);
        const pct = totalDebt > 0 ? (abs / totalDebt) * 100 : 0;

        return (
          <div key={group.type} className="border-b border-gray-100 last:border-0">
            <CategoryListRow
              isOpen={isOpen}
              onToggle={() => setUserGroupOpen((p) => toggleCategoryGroup(p, group.type))}
              rowContent={
                <div className="flex flex-1 items-center gap-3 py-4 pl-5 pr-2">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${GROUP_COLOR[group.type] ?? "bg-gray-300"}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2">
                      <p className="text-sm font-semibold text-gray-900">
                        {group.label}
                      </p>
                      <span className="text-xs text-gray-400">
                        {count} {count === 1 ? "account" : "accounts"}
                      </span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2">
                      <div className="h-1.5 w-full max-w-[180px] overflow-hidden rounded-full bg-gray-100">
                        <div className={`h-full rounded-full ${GROUP_COLOR[group.type] ?? "bg-gray-300"}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[11px] tabular-nums text-gray-400">{pct.toFixed(0)}%</span>
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <p className="text-sm font-semibold tabular-nums text-gray-900">
                      {formatCurrency(abs, currency)}
                    </p>
                  </div>
                </div>
              }
            >
              <div className="border-t border-gray-100 bg-gray-50/60 px-5 py-2">
                {group.accounts.map((acc) => (
                  <DebtLine key={acc.slug} account={acc} currency={currency} />
                ))}
                {group.manualLiabilities.map((liability) => (
                  <ManualLine key={liability.id} liability={liability} currency={currency} />
                ))}
              </div>
            </CategoryListRow>
          </div>
        );
      })}
    </div>
  );
}

function DebtLine({ account, currency }: { account: DebtAccount; currency: string }) {
  const lastTxDate = formatLastTransactionDate(account.lastTransactionDate);
  return (
    <Link
      href={`/account/accounts/${account.slug}`}
      className="flex items-center gap-3 border-b border-gray-100 py-2 last:border-0 hover:text-purple-600"
    >
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">
        <span className="block">
          {account.bankName}
          {account.accountName ? ` · ${account.accountName}` : ""}
        </span>
        {lastTxDate && (
          <span className="block text-xs text-gray-400 mt-0.5">{lastTxDate}</span>
        )}
      </span>
      <span className="shrink-0 text-xs tabular-nums text-gray-500">{formatAccountLast4(account.slug)}</span>
      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-gray-900">
        {formatCurrency(Math.abs(account.balance), currency)}
      </span>
    </Link>
  );
}

function ManualLine({ liability, currency }: { liability: ManualLiability; currency: string }) {
  return (
    <div className="flex items-center gap-3 border-b border-gray-100 py-2 last:border-0">
      <span className="min-w-0 flex-1 truncate text-sm text-gray-700">{liability.label}</span>
      <span className="shrink-0 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700">Manual</span>
      <span className="w-28 shrink-0 text-right text-sm tabular-nums text-gray-900">
        {formatCurrency(Math.abs(liability.balance), currency)}
      </span>
    </div>
  );
}