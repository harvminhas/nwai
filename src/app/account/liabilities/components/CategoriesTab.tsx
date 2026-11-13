"use client";

import { useState } from "react";
import Link from "next/link";
import type { DebtsSummary, DebtAccount } from "@/lib/debtsSummary";
import type { ManualLiability } from "@/lib/types";
import { formatAccountLast4 } from "@/lib/rangeUtils";
import { formatLastTransactionDate } from "@/lib/formatLastTransactionDate";
import { isCategoryGroupOpen, toggleCategoryGroup } from "@/lib/categoryGroupExpand";
import { findAccountHistoryLabel, joinAccountMeta, resolveAccountDisplayName } from "@/lib/accountListLabel";
import { accountDetailHref } from "@/lib/accountDetailHref";
import {
  AccountCategoryList,
  AccountCategorySection,
  AccountCategoryItem,
} from "@/app/account/components/AccountCategoryList";

interface CategoriesTabProps {
  summary: DebtsSummary;
}

/** Top level of the Liabilities drill-down: categories -> category page -> account page. */
export function CategoriesTab({ summary }: CategoriesTabProps) {
  const { groups, currency } = summary;
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
    <AccountCategoryList>
      {ordered.map((group) => {
        const isOpen = isCategoryGroupOpen(userGroupOpen, group.type);
        const count = group.accounts.length + group.manualLiabilities.length;
        const abs = Math.abs(group.totalBalance);

        return (
          <AccountCategorySection
            key={group.type}
            groupType={group.type}
            label={group.label}
            count={count}
            total={abs}
            currency={currency}
            isOpen={isOpen}
            onToggle={() => setUserGroupOpen((p) => toggleCategoryGroup(p, group.type))}
          >
            {group.accounts.map((acc) => (
              <DebtLine
                key={acc.slug}
                account={acc}
                currency={currency}
                historyLabel={findAccountHistoryLabel(summary.accountBalanceHistory, acc.slug)}
              />
            ))}
            {group.manualLiabilities.map((liability) => (
              <ManualLine key={liability.id} liability={liability} currency={currency} />
            ))}
          </AccountCategorySection>
        );
      })}
    </AccountCategoryList>
  );
}

function DebtLine({
  account,
  currency,
  historyLabel,
}: {
  account: DebtAccount;
  currency: string;
  historyLabel?: string | null;
}) {
  const label = resolveAccountDisplayName({
    accountName: account.accountName,
    bankName: account.bankName,
    historyLabel,
    fallback: account.slug,
  });
  const meta = joinAccountMeta([
    label.secondary,
    formatAccountLast4(account.slug),
    formatLastTransactionDate(account.lastTransactionDate),
  ]);
  return (
    <AccountCategoryItem
      href={accountDetailHref({ slug: account.slug, type: account.accountType, side: "debt" }) ?? undefined}
      primary={label.primary}
      meta={meta}
      fullName={label.full}
      amount={Math.abs(account.balance)}
      currency={currency}
    />
  );
}

function ManualLine({ liability, currency }: { liability: ManualLiability; currency: string }) {
  return (
    <AccountCategoryItem
      primary={liability.label}
      meta="Manual"
      fullName={liability.label}
      amount={Math.abs(liability.balance)}
      currency={currency}
    />
  );
}